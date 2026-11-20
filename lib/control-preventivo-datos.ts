/**
 * lib/control-preventivo-datos.ts
 *
 * Lecturas del Control preventivo. SÓLO LECTURA, con consultas a tablas que ya
 * existen (no requiere migración). Todo lo que puede pasar de 1000 filas va
 * paginado (lib/fetch-paginado): PostgREST corta en 1000 sin avisar.
 *
 * Recibe el cliente Supabase (anon con sesión en el navegador): manda la RLS
 * del usuario. Cada bloque devuelve su propio error para que la vista diga
 * "no se pudo leer" en vez de mostrar un cero falso.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchEnLotesResult, fetchPaginadoResult } from '@/lib/fetch-paginado'
import { cargarContextoExigibilidad, cargarUltimaSupervisionPorObjetivo } from '@/lib/supervision-universo'
import { fechaArgentinaDe } from '@/lib/supervisiones'
import {
  instanteLocal,
  resolverResponsablesOperativos,
  type AsignacionZona,
  type GuardiaOperativa,
  type OrigenResolucion,
} from '@/lib/responsables-operativos'
import {
  HORIZONTE_PUESTOS_HORAS,
  clasificarRonda,
  jefesDeEscalamiento,
  objetivosSinSupervision,
  puestosSinCubrir,
  rondaRequiereRevision,
  type ClasificacionRonda,
  type EjecucionRonda,
  type EventoRed,
  type NovedadAusencia,
  type ObjetivoParaControl,
  type ObjetivoSinSupervision,
  type PuestoSinCubrir,
  type PuntoEjecucion,
  type TurnoProximo,
} from '@/lib/control-preventivo'

type Cliente = Pick<SupabaseClient, 'from' | 'rpc'>

const MS_DIA = 86_400_000

function sumarDias(fecha: string, dias: number): string {
  return new Date(Date.parse(`${fecha}T12:00:00Z`) + dias * MS_DIA).toISOString().slice(0, 10)
}

function mensajeError(e: unknown): string {
  if (!e) return 'error de lectura'
  if (typeof e === 'string') return e
  return (e as { message?: string }).message || 'error de lectura'
}

export interface Catalogos {
  objetivos: Array<ObjetivoParaControl & { nombre: string }>
  nombreObjetivo: (id: string) => string
  nombreUsuario: (id: string | null | undefined) => string
  nombreZona: (id: string | null | undefined) => string
}

export interface ItemSupervision extends ObjetivoSinSupervision {
  responsables: string[]
  origenResponsable: OrigenResolucion
}

export interface DatosControlPreventivo {
  supervision: { items: ItemSupervision[]; jefes: string[]; error: string | null }
  puestos: { items: PuestoSinCubrir[]; error: string | null }
  rondas: { items: Array<ClasificacionRonda & { ejecucion: EjecucionRonda }>; dias: number; error: string | null }
  catalogos: Catalogos
}

/** Días hacia atrás que mira la clasificación de rondas. */
export const DIAS_RONDAS_REVISION = 7

export async function cargarControlPreventivo(cliente: Cliente, ahora: Date = new Date()): Promise<DatosControlPreventivo> {
  const ahoraMs = ahora.getTime()
  const hoy = fechaArgentinaDe(ahora)

  const [objRes, usrRes, zonasRes, supZonasRes, guardiasRes, escRes] = await Promise.all([
    // `*`: las fechas de servicio que usa la exigibilidad pueden no existir
    // todavía como columnas (mismo criterio que ControlSupervisionesPanel).
    cliente.from('objetivos').select('*'),
    fetchPaginadoResult<{ id: string; nombre: string | null; apellido: string | null; estado: string | null }>((d, h) =>
      cliente.from('usuarios').select('id, nombre, apellido, estado').order('id').range(d, h)),
    cliente.from('zonas_operativas').select('id, nombre'),
    cliente.from('supervisor_zonas').select('supervisor_id, zona_id'),
    cliente.from('supervisores_guardia')
      .select('supervisor_id, zona, fecha, hora_inicio, hora_fin, estado, tipo_evento, rol_operativo')
      .gte('fecha', sumarDias(hoy, -2))
      .lte('fecha', sumarDias(hoy, 1)),
    // Sólo la ve quien administra; sin permiso queda vacía y se dice.
    cliente.from('escalamiento_destinatarios').select('usuario_id, rol_en_escalamiento, activo'),
  ])

  const objetivos = ((objRes.data || []) as any[]).map(o => ({ ...o, nombre: o.nombre || 'Objetivo sin nombre' }))
  const objPorId = new Map(objetivos.map(o => [o.id as string, o]))
  const usuarios = usrRes.data || []
  const usrPorId = new Map(usuarios.map(u => [u.id, u]))
  const zonas = (zonasRes.data || []) as Array<{ id: string; nombre: string }>
  const zonaPorId = new Map(zonas.map(z => [z.id, z.nombre]))

  const catalogos: Catalogos = {
    objetivos,
    nombreObjetivo: id => objPorId.get(id)?.nombre || 'Objetivo sin nombre',
    nombreUsuario: id => {
      const u = id ? usrPorId.get(id) : null
      return u ? `${u.apellido || ''}, ${u.nombre || ''}`.replace(/^, |, $/g, '') || 'Sin nombre' : '—'
    },
    nombreZona: id => (id ? zonaPorId.get(id) : null) || 'Sin zona',
  }

  const objetivosPrueba = new Set(objetivos.filter(o => o.es_prueba).map(o => o.id as string))

  const [supervision, puestos, rondas] = await Promise.all([
    // ── 4.1 ──
    (async (): Promise<DatosControlPreventivo['supervision']> => {
      if (objRes.error) return { items: [], jefes: [], error: mensajeError(objRes.error) }
      const [ult, contexto] = await Promise.all([
        cargarUltimaSupervisionPorObjetivo(cliente),
        cargarContextoExigibilidad(cliente, ahora),
      ])
      if (ult.error) return { items: [], jefes: [], error: `última supervisión: ${mensajeError(ult.error)}` }
      const { fecha, hora } = instanteLocal(ahora)
      const guardias = (guardiasRes.error ? [] : (guardiasRes.data || [])) as GuardiaOperativa[]
      const supervisorZonas = (supZonasRes.error ? [] : (supZonasRes.data || [])) as AsignacionZona[]
      const items = objetivosSinSupervision({ objetivos, ultimaPorObjetivo: ult.indice, contexto, ahoraMs })
        .map(it => {
          const r = resolverResponsablesOperativos({
            zonaId: it.zona_id, fecha, hora, guardias, supervisorZonas, zonas,
            usuarios: usuarios.map(u => ({ id: u.id, estado: u.estado })),
          })
          return { ...it, responsables: r.responsables.length ? r.responsables : r.candidatosZona, origenResponsable: r.origen }
        })
      const jefes = escRes.error ? [] : jefesDeEscalamiento((escRes.data || []) as any[])
      return { items, jefes, error: null }
    })(),

    // ── 4.2 ──
    (async (): Promise<DatosControlPreventivo['puestos']> => {
      const hasta = sumarDias(hoy, Math.ceil(HORIZONTE_PUESTOS_HORAS / 24) + 1)
      const [turnosRes, novRes] = await Promise.all([
        fetchPaginadoResult<TurnoProximo>((d, h) => cliente.from('turnos')
          .select('id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin, estado, guardia_id')
          .gte('fecha', hoy)
          .lte('fecha', hasta)
          .order('fecha').order('id')
          .range(d, h)),
        fetchPaginadoResult<NovedadAusencia>((d, h) => cliente.from('novedades_laborales')
          .select('empleado_id, tipo, fecha_desde, fecha_hasta, estado')
          .eq('estado', 'aprobada')
          .lte('fecha_desde', hasta)
          .gte('fecha_hasta', hoy)
          .order('id')
          .range(d, h)),
      ])
      if (turnosRes.error) return { items: [], error: `turnos: ${mensajeError(turnosRes.error)}` }
      // Sin novedades no se puede afirmar ausencia: se listan sólo los sin
      // asignar y se avisa del error (nunca se inventa cobertura).
      const items = puestosSinCubrir({
        turnos: turnosRes.data,
        novedades: novRes.error ? [] : novRes.data,
        ahoraMs,
        objetivosExcluidos: new Set([
          ...Array.from(objetivosPrueba),
          ...objetivos.filter(o => (o.estado || 'activo') !== 'activo').map(o => o.id as string),
        ]),
      })
      return { items, error: novRes.error ? `novedades laborales: ${mensajeError(novRes.error)} (sólo se muestran los sin asignar)` : null }
    })(),

    // ── 4.3 ──
    (async (): Promise<DatosControlPreventivo['rondas']> => {
      const desde = sumarDias(hoy, -DIAS_RONDAS_REVISION)
      const ejRes = await fetchPaginadoResult<EjecucionRonda>((d, h) => cliente.from('ronda_ejecuciones')
        .select('id, objetivo_id, guardia_id, fecha_operativa, iniciada_at, finalizada_at, estado, resultado, puntos_total, snap_ronda_nombre')
        .gte('fecha_operativa', desde)
        .eq('estado', 'finalizada')
        .neq('resultado', 'completa')
        .order('fecha_operativa', { ascending: false }).order('id')
        .range(d, h))
      if (ejRes.error) return { items: [], dias: DIAS_RONDAS_REVISION, error: `rondas: ${mensajeError(ejRes.error)}` }
      const ejecuciones = ejRes.data.filter(e => rondaRequiereRevision(e) && !objetivosPrueba.has(e.objetivo_id))
      if (ejecuciones.length === 0) return { items: [], dias: DIAS_RONDAS_REVISION, error: null }

      const [ptsRes, evRes] = await Promise.all([
        fetchEnLotesResult<PuntoEjecucion>(ejecuciones.map(e => e.id), (lote, d, h) => cliente.from('ronda_ejecucion_puntos')
          .select('id, ronda_ejecucion_id, estado, registrado_at, gps_ok, dentro_radio, foto_ok, snap_foto_requerida, precision_metros, distancia_metros, snap_radio_metros')
          .in('ronda_ejecucion_id', lote)
          .order('id')
          .range(d, h)),
        fetchPaginadoResult<{ user_id: string | null; created_at: string; value_json: any }>((d, h) => cliente.from('os_events')
          .select('user_id, created_at, value_json')
          .eq('event_name', 'ronda_red_error')
          .gte('created_at', `${desde}T00:00:00-03:00`)
          .order('created_at').order('id')
          .range(d, h)),
      ])
      if (ptsRes.error) return { items: [], dias: DIAS_RONDAS_REVISION, error: `puntos de ronda: ${mensajeError(ptsRes.error)}` }
      // Sin telemetría no se puede sugerir conectividad; se clasifica igual y se avisa.
      const eventos: EventoRed[] = (evRes.error ? [] : evRes.data).map(ev => ({
        user_id: ev.user_id,
        created_at: ev.created_at,
        ejecucion_punto_id: ev.value_json?.ejecucion_punto_id ?? null,
      }))
      const items = ejecuciones.map(ej => ({ ...clasificarRonda(ej, ptsRes.data, eventos), ejecucion: ej }))
      return {
        items,
        dias: DIAS_RONDAS_REVISION,
        error: evRes.error ? `telemetría de red: ${mensajeError(evRes.error)} (la clase «conectividad» no se puede sugerir)` : null,
      }
    })(),
  ])

  return { supervision, puestos, rondas, catalogos }
}
