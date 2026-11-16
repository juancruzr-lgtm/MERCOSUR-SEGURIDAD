/**
 * lib/tablero-gerencia/fuentes.ts
 *
 * Arma los casos del tablero A PARTIR DE LAS TABLAS QUE YA EXISTEN, sin
 * escribir nada: turnos + registros_asistencia (con el mismo detector que
 * Revisión Operativa), supervisor_intervenciones (estado de cada alerta),
 * ronda_alertas, salidas_anticipadas y la última supervisión por objetivo.
 *
 * Mientras la migración gestion_casos no esté aplicada, el estado de cada
 * caso se DERIVA de la fuente (intervenciones existentes); cuando exista, el
 * caso guardado con la misma clave manda (estado, responsable, historial).
 */

import {
  detectarAlertasOperativas,
  estadoCicloVidaAlerta,
  intervencionesDeOcurrencia,
  ESTADOS_SIN_OBLIGACION,
  type IntervencionOperativaBase,
  type RegistroDetectorOperativo,
  type TipoAlertaOperativa,
  type TurnoDetectorOperativo,
} from '@/lib/revision-operativa'
import { estadoSupervisionObjetivo, frecuenciaSupervision } from '@/lib/supervisiones'
import type { Caso, EstadoCaso, EventoCaso, TipoCaso } from './casos'
import { CATALOGO_REGLAS, causaProbable, claveCaso, gravedadEfectiva, plazoDesde } from './reglas'

const MS_MIN = 60_000
const OFFSET_AR_MS = 3 * 3_600_000 // Argentina, UTC−3 sin horario de verano

/** Instante UTC (ms) de fecha + hora local argentina. */
export function instanteAr(fecha: string, hora: string): number {
  const [y, m, d] = fecha.split('-').map(Number)
  const [hh, mm] = hora.split(':').map(Number)
  return Date.UTC(y, m - 1, d, hh, mm) + OFFSET_AR_MS
}

export function finTurnoMs(t: { fecha: string; hora_inicio: string; hora_fin: string }): number {
  const ini = instanteAr(t.fecha, t.hora_inicio)
  let fin = instanteAr(t.fecha, t.hora_fin)
  if (fin <= ini) fin += 24 * 3_600_000
  return fin
}

export interface TurnoFuente extends TurnoDetectorOperativo {}

export interface RegistroFuente extends RegistroDetectorOperativo {
  registro_anulado_at?: string | null
  hora_salida_real?: string | null
  distancia_ingreso_metros?: number | null
  precision_ingreso?: number | null
  origen_cobertura?: string | null
}

export interface ObjetivoFuente {
  id: string
  nombre?: string | null
  cliente?: string | null
  zona_id?: string | null
  estado?: string | null
  radio_metros?: number | null
  lat?: number | null
  lng?: number | null
  frecuencia_supervision_horas?: number | null
  es_prueba?: boolean | null
}

export interface IntervencionFuente extends IntervencionOperativaBase {
  supervisor_id?: string | null
  comentario?: string | null
}

export interface RondaAlertaFuente {
  id: string
  objetivo_id: string
  turno_id: string
  guardia_id: string
  tipo: string
  ventana_inicio: string
  estado: string
  detectada_at: string
  resultado_intervencion?: string | null
  accion?: string | null
  comentario?: string | null
  resuelta_at?: string | null
  resuelta_por?: string | null
}

export interface SalidaFuente {
  id: string
  registro_id?: string | null
  turno_id?: string | null
  empleado_id: string
  objetivo_id: string
  fecha: string
  minutos_antes?: number | null
  estado: string
  motivo?: string | null
  resuelto_at?: string | null
  resuelto_por?: string | null
  detectada_at: string
}

export interface Fuentes {
  ahoraIso: string
  turnos: TurnoFuente[]
  registros: RegistroFuente[]
  objetivos: ObjetivoFuente[]
  intervenciones: IntervencionFuente[]
  rondaAlertas: RondaAlertaFuente[]
  salidas: SalidaFuente[]
  /** objetivo_id → ISO de la última supervisión (lista completa, no recortada). */
  ultimaSupervision: Map<string, string>
  /** Casos ya guardados en gestion_casos (si la migración existe). */
  casosGuardados?: Caso[]
}

const REGLA_POR_TIPO_OPERATIVO: Record<TipoAlertaOperativa, { regla: string; tipo: TipoCaso }> = {
  sin_fichar: { regla: 'ASI-01', tipo: 'sin_fichaje' },
  tardanza: { regla: 'ASI-02', tipo: 'ingreso_tardio' },
  fuera_radio: { regla: 'ASI-05', tipo: 'gps_fuera_radio' },
  descubierto: { regla: 'COB-01', tipo: 'turno_sin_cobertura' },
  salida_pendiente: { regla: 'ASI-04', tipo: 'sin_salida' },
}

const ESTADO_DESDE_CICLO: Record<string, EstadoCaso> = {
  pendiente: 'detectado',
  atendida_condicion_vigente: 'en_revision',
  resuelta_operativamente: 'resuelto',
  reabierta: 'reabierto',
  cerrada: 'resuelto',
}

function regla(codigo: string) {
  const r = CATALOGO_REGLAS.find(x => x.codigo === codigo)
  if (!r) throw new Error(`Regla desconocida ${codigo}`)
  return r
}

function eventosDesdeIntervenciones(ints: IntervencionFuente[]): EventoCaso[] {
  return [...ints]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map(i => ({
      accion: i.accion === 'comentario' ? 'comentar' : 'revisar',
      actorId: i.supervisor_id ?? 'desconocido',
      at: i.created_at,
      estadoAnterior: 'detectado',
      estadoNuevo: 'en_revision',
      comentario: `[${i.accion}] ${i.comentario ?? ''}`.trim(),
    }))
}

/**
 * Casos del período. `reglasActivas` = códigos que pueden detectar (existentes
 * + aprobadas). ASI-04 (sin salida) es propuesta: sin aprobarla no aparece.
 */
export function casosDesdeFuentes(f: Fuentes, reglasActivas: ReadonlySet<string>): Caso[] {
  const ahora = new Date(f.ahoraIso)
  const ahoraMs = ahora.getTime()
  const objetivo = new Map(f.objetivos.map(o => [o.id, o]))
  const turno = new Map(f.turnos.map(t => [t.id, t]))
  const vigentes = f.registros.filter(r => !r.registro_anulado_at)
  const registrosPorTurno = new Map<string, RegistroFuente[]>()
  for (const r of vigentes) {
    const arr = registrosPorTurno.get(r.turno_id) ?? []
    arr.push(r)
    registrosPorTurno.set(r.turno_id, arr)
  }
  const operativos = f.objetivos.filter(o => !o.es_prueba)
  const casos: Caso[] = []
  const previosPorEmpleadoTipo = new Map<string, number>()

  const nuevo = (p: Omit<Caso, 'id' | 'gravedad' | 'plazoAt' | 'causa' | 'responsableId'> & { causa?: Caso['causa']; responsableId?: string | null }) => {
    const r = regla(p.regla)
    const causa = p.causa ?? 'indeterminada'
    const k = `${p.empleadoId}|${p.tipo}`
    const previos = previosPorEmpleadoTipo.get(k) ?? 0
    previosPorEmpleadoTipo.set(k, previos + 1)
    casos.push({
      ...p,
      id: p.clave,
      causa,
      gravedad: gravedadEfectiva(r.gravedad, p.empleadoId ? previos : 0, causa),
      plazoAt: plazoDesde(p.detectadoAt, r.plazoHoras),
      responsableId: p.responsableId ?? null,
    })
  }

  // ── Asistencia: mismo detector que Revisión Operativa ─────────────────────
  const alertas = detectarAlertasOperativas({ turnos: f.turnos, registros: vigentes, objetivos: f.objetivos, ahora })
  const vistos = new Set(alertas.map(a => `${a.turno_id}:${a.tipo_alerta}`))
  // El detector sólo marca "sin fichar" mientras el turno está en curso; para el
  // mes también cuentan los turnos ya terminados que nunca tuvieron entrada.
  for (const t of f.turnos) {
    if (ESTADOS_SIN_OBLIGACION.has(t.estado ?? '') || !t.guardia_id) continue
    if ((objetivo.get(t.objetivo_id)?.estado ?? 'activo') !== 'activo') continue
    if (finTurnoMs(t) > ahoraMs || vistos.has(`${t.id}:sin_fichar`)) continue
    const regs = (registrosPorTurno.get(t.id) ?? []).filter(r => r.tipo_registro !== 'ausencia')
    if (regs.some(r => r.hora_entrada_final || r.hora_entrada_real)) continue
    if ((registrosPorTurno.get(t.id) ?? []).some(r => r.tipo_registro === 'ausencia')) continue
    alertas.push({
      tipo_alerta: 'sin_fichar', turno_id: t.id, registro_asistencia_id: null, objetivo_id: t.objetivo_id,
      puesto_id: t.puesto_id ?? null, guardia_id: t.guardia_id, condicion_vigente: true,
      detectada_at: new Date(instanteAr(t.fecha, t.hora_inicio) + 15 * MS_MIN).toISOString(),
    })
  }

  for (const a of alertas) {
    const m = REGLA_POR_TIPO_OPERATIVO[a.tipo_alerta]
    if (!reglasActivas.has(m.regla)) continue
    const t = turno.get(a.turno_id)!
    const obj = objetivo.get(a.objetivo_id)
    if (obj?.es_prueba) continue
    const reg = a.registro_asistencia_id ? vigentes.find(r => r.id === a.registro_asistencia_id) : undefined
    const ints = intervencionesDeOcurrencia(f.intervenciones, a.turno_id, a.tipo_alerta, a.registro_asistencia_id)
    const ciclo = estadoCicloVidaAlerta({
      intervenciones: f.intervenciones, turnoId: a.turno_id, tipo: a.tipo_alerta,
      registroAsistenciaId: a.registro_asistencia_id, condicionVigente: true,
    })
    const causa = a.tipo_alerta === 'fuera_radio' || a.tipo_alerta === 'tardanza'
      ? causaProbable({
          gpsEstado: reg?.gps_ingreso_estado,
          precisionMetros: reg?.precision_ingreso ?? null,
          radioObjetivoMetros: obj?.radio_metros ?? null,
          objetivoSinCoordenadas: obj ? obj.lat == null || obj.lng == null : false,
        })
      : 'indeterminada'
    nuevo({
      clave: claveCaso(m.regla, { registroId: a.registro_asistencia_id, turnoId: a.turno_id }),
      regla: m.regla, tipo: m.tipo, estado: ESTADO_DESDE_CICLO[ciclo] ?? 'detectado', causa,
      empleadoId: a.guardia_id, objetivoId: a.objetivo_id, clienteId: obj?.cliente ?? null, turnoId: a.turno_id,
      fechaHecho: t.fecha, detectadoAt: a.detectada_at,
      evidencias: [{
        fuente: reg ? `registros_asistencia:${reg.id}` : `turnos:${t.id}`,
        descripcion: reg ? 'Registro de asistencia' : 'Sin registro de entrada',
        datos: {
          horario_programado: `${t.hora_inicio.slice(0, 5)}–${t.hora_fin.slice(0, 5)}`,
          entrada: reg?.hora_entrada_final ?? reg?.hora_entrada_real ?? null,
          salida: reg?.hora_salida_final ?? reg?.hora_salida_real ?? null,
          gps: reg?.gps_ingreso_estado ?? null,
          distancia_m: reg?.distancia_ingreso_metros ?? null,
          precision_m: reg?.precision_ingreso ?? null,
          radio_objetivo_m: obj?.radio_metros ?? null,
        },
      }],
      eventos: eventosDesdeIntervenciones(ints as IntervencionFuente[]),
    })
  }

  // ── Rondas ────────────────────────────────────────────────────────────────
  if (reglasActivas.has('RON-01')) {
    for (const ra of f.rondaAlertas) {
      const t = turno.get(ra.turno_id)
      const obj = objetivo.get(ra.objetivo_id)
      if (obj?.es_prueba) continue
      const resuelta = ra.estado === 'resuelta'
      const estado: EstadoCaso = !resuelta ? (ra.resultado_intervencion === 'seguimiento' ? 'en_revision' : 'detectado')
        : ra.resultado_intervencion === 'no_resuelto' ? 'en_revision'
        : ra.accion === 'cierre_administrativo' ? 'descartado' : 'resuelto'
      nuevo({
        clave: claveCaso('RON-01', { alertaId: ra.id }), regla: 'RON-01', tipo: 'ronda_incumplida', estado,
        causa: ra.accion === 'cierre_administrativo' ? 'administrativa' : 'indeterminada',
        empleadoId: ra.guardia_id, objetivoId: ra.objetivo_id, clienteId: obj?.cliente ?? null, turnoId: ra.turno_id,
        fechaHecho: t?.fecha ?? ra.ventana_inicio.slice(0, 10), detectadoAt: ra.detectada_at,
        evidencias: [{ fuente: `ronda_alertas:${ra.id}`, descripcion: `Ronda ${ra.tipo.replace('_', ' ')}`, datos: { ventana_inicio: ra.ventana_inicio, resultado: ra.resultado_intervencion ?? null } }],
        eventos: resuelta && ra.resuelta_at ? [{
          accion: 'marcar_resuelto', actorId: ra.resuelta_por ?? 'sistema', at: ra.resuelta_at,
          estadoAnterior: 'detectado', estadoNuevo: estado, comentario: `[${ra.accion ?? 'resuelta'}] ${ra.comentario ?? ''}`.trim(),
        }] : [],
      })
    }
  }

  // ── Salidas anticipadas ───────────────────────────────────────────────────
  if (reglasActivas.has('ASI-03')) {
    for (const s of f.salidas) {
      const obj = objetivo.get(s.objetivo_id)
      if (obj?.es_prueba) continue
      const estado: EstadoCaso = s.estado === 'detectada' ? 'detectado'
        : s.estado === 'sin_efecto' || s.estado === 'descartada' || s.estado === 'autorizada' ? 'descartado' : 'resuelto'
      nuevo({
        clave: claveCaso('ASI-03', { registroId: s.registro_id ?? s.id }), regla: 'ASI-03', tipo: 'salida_anticipada', estado,
        empleadoId: s.empleado_id, objetivoId: s.objetivo_id, clienteId: obj?.cliente ?? null, turnoId: s.turno_id ?? null,
        fechaHecho: s.fecha, detectadoAt: s.detectada_at,
        evidencias: [{ fuente: `salidas_anticipadas:${s.id}`, descripcion: `Salió ${s.minutos_antes ?? '?'} min antes`, datos: { estado: s.estado, motivo: s.motivo ?? null } }],
        eventos: s.resuelto_at ? [{ accion: 'marcar_resuelto', actorId: s.resuelto_por ?? 'desconocido', at: s.resuelto_at, estadoAnterior: 'detectado', estadoNuevo: estado, comentario: s.motivo ?? null }] : [],
      })
    }
  }

  // ── Supervisiones vencidas (estado a hoy) ─────────────────────────────────
  if (reglasActivas.has('SUP-01')) {
    const periodo = f.ahoraIso.slice(0, 7)
    for (const o of operativos) {
      if ((o.estado ?? 'activo') !== 'activo') continue
      const ultima = f.ultimaSupervision.get(o.id) ?? null
      const sup = { id: o.id, frecuencia_supervision_horas: o.frecuencia_supervision_horas ?? null }
      const est = estadoSupervisionObjetivo(sup, ultima, ahoraMs)
      if (est === 'vigente') continue
      const venc = ultima ? new Date(Date.parse(ultima) + frecuenciaSupervision(sup) * 3_600_000).toISOString() : f.ahoraIso
      nuevo({
        clave: claveCaso('SUP-01', { objetivoId: o.id, periodo }), regla: 'SUP-01', tipo: 'supervision_vencida', estado: 'detectado',
        empleadoId: null, objetivoId: o.id, clienteId: o.cliente ?? null, turnoId: null,
        fechaHecho: f.ahoraIso.slice(0, 10), detectadoAt: venc,
        evidencias: [{ fuente: `objetivos:${o.id}`, descripcion: ultima ? `Última supervisión ${ultima.slice(0, 10)}` : 'Nunca supervisado', datos: { ultima, frecuencia_horas: o.frecuencia_supervision_horas ?? null } }],
        eventos: [],
      })
    }
  }

  // ── Casos guardados mandan sobre lo derivado ──────────────────────────────
  if (f.casosGuardados?.length) {
    const guardados = new Map(f.casosGuardados.map(c => [c.clave, c]))
    return casos.map(c => {
      const g = guardados.get(c.clave)
      return g ? { ...c, id: g.id, estado: g.estado, responsableId: g.responsableId, causa: g.causa, plazoAt: g.plazoAt ?? c.plazoAt, eventos: [...c.eventos, ...g.eventos] } : c
    })
  }
  return casos
}
