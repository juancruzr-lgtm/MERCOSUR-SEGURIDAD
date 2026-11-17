/**
 * lib/tablero-gerencia/cargar.ts
 *
 * Carga del Tablero de Gerencia. SÓLO LECTURA: ninguna función de este archivo
 * escribe. Lo que cada usuario ve lo decide la RLS de cada tabla (un supervisor
 * recibe sólo lo de su alcance); el filtro de alcance del cliente se aplica
 * igual, por si alguna tabla es más amplia.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchPaginado } from '@/lib/fetch-paginado'
import { cargarUltimaSupervisionPorObjetivo } from '@/lib/supervision-universo'
import type { Caso } from './casos'
import type { Fuentes, IntervencionFuente, RegistroFuente, RondaAlertaFuente, SalidaFuente, TurnoFuente, ObjetivoFuente } from './fuentes'
import type { RegistroHoras, TurnoHoras } from './horas'
import type { SupervisionVisita } from './supervision-preventiva'
import type { ReclamoCliente } from './calidad'

export function rangoMes(mes: string): { desde: string; hastaExcl: string } {
  const [y, m] = mes.split('-').map(Number)
  const sig = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7)
  return { desde: `${mes}-01`, hastaExcl: `${sig}-01` }
}

export function mesAnterior(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7)
}

const CAMPOS_TURNO = 'id, objetivo_id, puesto_id, guardia_id, fecha, hora_inicio, hora_fin, estado'
const CAMPOS_REGISTRO = 'id, turno_id, guardia_id, guardia_final_id, objetivo_final_id, tipo_registro, hora_entrada_real, hora_salida_real, hora_entrada_final, hora_salida_final, horas_trabajadas, horas_liquidables, origen_cobertura, cobertura_anulada_at, registro_anulado_at, alerta_entrada, gps_ingreso_estado, distancia_ingreso_metros, precision_ingreso, cierre_automatico'

async function porLotes<T>(ids: string[], consulta: (lote: string[]) => PromiseLike<{ data: T[] | null; error: any }>, tam = 150): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += tam) {
    const { data, error } = await consulta(ids.slice(i, i + tam))
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
  }
  return out
}

async function turnosYRegistros(sb: SupabaseClient, mes: string) {
  const { desde, hastaExcl } = rangoMes(mes)
  const turnos = await fetchPaginado<TurnoFuente>((a, b) =>
    sb.from('turnos').select(CAMPOS_TURNO).gte('fecha', desde).lt('fecha', hastaExcl).order('id').range(a, b))
  const ids = turnos.map(t => t.id)
  const registros = await porLotes<RegistroFuente & RegistroHoras>(ids, lote =>
    sb.from('registros_asistencia').select(CAMPOS_REGISTRO).in('turno_id', lote))
  return { turnos, registros }
}

export interface DatosTablero {
  mes: string
  fuentes: Fuentes
  horasMes: { turnos: TurnoHoras[]; registros: RegistroHoras[] }
  horasMesAnterior: { turnos: TurnoHoras[]; registros: RegistroHoras[] }
  /** false = la migración gestion_casos no está aplicada: acciones deshabilitadas. */
  migracionCasos: boolean
  /** Visitas de supervisión del mes (cobertura preventiva). */
  supervisiones: SupervisionVisita[]
  /** Reclamos de clientes del mes; null = migración 20261216120000 sin aplicar. */
  reclamos: ReclamoCliente[] | null
  /** Versiones guardadas del informe del mes; null = sin migración o sin permiso. */
  informes: { version: number; generado_at: string; sha256: string; motivo: string | null }[] | null
  /** Prefacturas del mes (sólo si se pidió y la RLS lo permite). */
  facturacion: { cliente: string; total: number; estado: string }[] | null
  advertencias: string[]
}

export async function cargarTablero(
  sb: SupabaseClient,
  p: { mes: string; objetivos: ObjetivoFuente[]; ahoraIso: string; conEconomico: boolean },
): Promise<DatosTablero> {
  const advertencias: string[] = []
  const { desde, hastaExcl } = rangoMes(p.mes)
  const clienteDe = new Map(p.objetivos.map(o => [o.id, o.cliente ?? null]))

  const [actual, previo, sup] = await Promise.all([
    turnosYRegistros(sb, p.mes),
    turnosYRegistros(sb, mesAnterior(p.mes)),
    cargarUltimaSupervisionPorObjetivo(sb as never),
  ])
  if (sup.error) advertencias.push('No se pudo leer la última supervisión por objetivo: supervisiones vencidas puede estar incompleto.')

  const intervenciones = await porLotes<IntervencionFuente>(actual.turnos.map(t => t.id), lote =>
    sb.from('supervisor_intervenciones')
      .select('id, turno_id, registro_asistencia_id, tipo_alerta, accion, comentario, supervisor_id, created_at, secuencia_evento')
      .in('turno_id', lote))

  const rondaAlertas = await fetchPaginado<RondaAlertaFuente>((a, b) =>
    sb.from('ronda_alertas')
      .select('id, objetivo_id, turno_id, guardia_id, tipo, ventana_inicio, estado, detectada_at, resultado_intervencion, accion, comentario, resuelta_at, resuelta_por')
      .gte('ventana_inicio', `${desde}T03:00:00Z`).lt('ventana_inicio', `${hastaExcl}T03:00:00Z`).order('id').range(a, b))

  const salidas = await fetchPaginado<SalidaFuente>((a, b) =>
    sb.from('salidas_anticipadas')
      .select('id, registro_id, turno_id, empleado_id, objetivo_id, fecha, minutos_antes, estado, motivo, resuelto_at, resuelto_por, detectada_at')
      .eq('periodo', p.mes).order('id').range(a, b))

  let supervisiones: SupervisionVisita[] = []
  try {
    supervisiones = await fetchPaginado<SupervisionVisita>((a, b) =>
      sb.from('supervisiones').select('id, objetivo_id, supervisor_id, estado, created_at')
        .gte('created_at', `${desde}T03:00:00Z`).lt('created_at', `${hastaExcl}T03:00:00Z`).order('id').range(a, b))
  } catch {
    advertencias.push('No se pudieron leer las supervisiones del mes: la cobertura preventiva no está disponible.')
  }

  let reclamos: ReclamoCliente[] | null = null
  const rc = await sb.from('gestion_reclamos').select('id, cliente_id, objetivo_id, fecha, recibido_at, descripcion, caso_id, estado')
    .gte('fecha', desde).lt('fecha', hastaExcl)
  if (!rc.error) reclamos = (rc.data ?? []).map((r: any) => ({
    id: r.id, clienteId: r.cliente_id, objetivoId: r.objetivo_id, fecha: r.fecha, recibidoAt: r.recibido_at, descripcion: r.descripcion, casoId: r.caso_id, estado: r.estado,
  }))
  let informes: DatosTablero['informes'] = null
  const inf = await sb.from('gestion_informes_mensuales').select('version, generado_at, sha256, motivo').eq('mes', p.mes).order('version')
  if (!inf.error) informes = inf.data ?? []

  // Casos guardados: sólo existen si la migración 20261215120000 se aplicó.
  let migracionCasos = false
  let casosGuardados: Caso[] = []
  const g = await sb.from('gestion_casos').select('id, clave, estado, responsable_id, causa, plazo_at').limit(5000)
  if (!g.error) {
    migracionCasos = true
    casosGuardados = (g.data ?? []).map((c: any) => ({
      id: c.id, clave: c.clave, estado: c.estado, responsableId: c.responsable_id, causa: c.causa, plazoAt: c.plazo_at, eventos: [],
    }) as unknown as Caso)
  }

  let facturacion: DatosTablero['facturacion'] = null
  if (p.conEconomico) {
    const f = await sb.from('fact_prefacturas').select('total_c, estado, cliente:fact_clientes(razon_social)').eq('periodo_mes', p.mes)
    if (f.error) advertencias.push('Facturación no disponible para este usuario.')
    else facturacion = (f.data ?? [])
      .filter((x: any) => x.estado !== 'descartada')
      .map((x: any) => ({ cliente: x.cliente?.razon_social ?? 'Sin cliente', total: Number(x.total_c ?? 0) / 100, estado: x.estado }))
  }

  const conCliente = (ts: TurnoFuente[]): TurnoHoras[] => ts.map(t => ({ ...t, cliente_id: clienteDe.get(t.objetivo_id) ?? null }))

  return {
    mes: p.mes,
    fuentes: {
      ahoraIso: p.ahoraIso,
      turnos: actual.turnos,
      registros: actual.registros,
      objetivos: p.objetivos,
      intervenciones,
      rondaAlertas,
      salidas,
      ultimaSupervision: sup.indice,
      casosGuardados,
    },
    horasMes: { turnos: conCliente(actual.turnos), registros: actual.registros },
    horasMesAnterior: { turnos: conCliente(previo.turnos), registros: previo.registros },
    migracionCasos,
    supervisiones,
    reclamos,
    informes,
    facturacion,
    advertencias,
  }
}

// ── Histórico: todos los meses con datos ────────────────────────────────────

/** Como porLotes, pero con varias consultas a la vez (sólo lectura). */
async function porLotesParalelo<T>(ids: string[], consulta: (lote: string[]) => PromiseLike<{ data: T[] | null; error: any }>, tam = 150, simultaneas = 6): Promise<T[]> {
  const lotes: string[][] = []
  for (let i = 0; i < ids.length; i += tam) lotes.push(ids.slice(i, i + tam))
  const out: T[][] = new Array(lotes.length)
  let siguiente = 0
  const trabajador = async () => {
    while (siguiente < lotes.length) {
      const k = siguiente++
      const { data, error } = await consulta(lotes[k])
      if (error) throw new Error(error.message)
      out[k] = data ?? []
    }
  }
  await Promise.all(Array.from({ length: Math.min(simultaneas, lotes.length) }, trabajador))
  return out.flat()
}

export interface DatosHistorico {
  turnos: TurnoHoras[]
  registros: RegistroHoras[]
  supervisiones: { objetivo_id: string; created_at: string; estado: string | null }[]
  alertasRonda: { ventana_inicio: string }[]
  facturacion: { mes: string; total: number }[] | null
}

/** SÓLO LECTURA. Trae columnas mínimas desde `desde` (AAAA-MM-DD) hasta hoy. */
export async function cargarHistorico(sb: SupabaseClient, p: { desde: string; conEconomico: boolean; onProgreso?: (t: string) => void }): Promise<DatosHistorico> {
  p.onProgreso?.('Leyendo turnos…')
  const turnos = await fetchPaginado<TurnoHoras>((a, b) =>
    sb.from('turnos').select('id, objetivo_id, guardia_id, fecha, hora_inicio, hora_fin, estado').gte('fecha', p.desde).order('id').range(a, b))
  p.onProgreso?.(`Leyendo fichajes de ${turnos.length.toLocaleString('es-AR')} turnos…`)
  const registros = await porLotesParalelo<RegistroHoras>(turnos.map(t => t.id), lote =>
    sb.from('registros_asistencia').select('id, turno_id, guardia_id, tipo_registro, hora_entrada_real, hora_salida_real, hora_entrada_final, hora_salida_final, horas_trabajadas, horas_liquidables, origen_cobertura, cobertura_anulada_at, registro_anulado_at, alerta_entrada, gps_ingreso_estado').in('turno_id', lote))
  p.onProgreso?.('Leyendo supervisiones y rondas…')
  const supervisiones = await fetchPaginado<DatosHistorico['supervisiones'][number]>((a, b) =>
    sb.from('supervisiones').select('objetivo_id, created_at, estado').gte('created_at', `${p.desde}T03:00:00Z`).order('id').range(a, b))
  const alertasRonda = await fetchPaginado<{ ventana_inicio: string }>((a, b) =>
    sb.from('ronda_alertas').select('ventana_inicio').gte('ventana_inicio', `${p.desde}T03:00:00Z`).order('id').range(a, b))
  let facturacion: DatosHistorico['facturacion'] = null
  if (p.conEconomico) {
    const f = await sb.from('fact_prefacturas').select('periodo_mes, total_c, estado')
    if (!f.error) facturacion = (f.data ?? []).filter((x: any) => x.estado !== 'descartada').map((x: any) => ({ mes: x.periodo_mes, total: Number(x.total_c ?? 0) / 100 }))
  }
  return { turnos, registros, supervisiones, alertasRonda, facturacion }
}
