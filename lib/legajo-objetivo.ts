// ============================================================================
// Legajo Vivo del Objetivo — capa de datos única
// ============================================================================
//
// Fuente de verdad para todo lo que muestra el legajo de un objetivo, sin
// importar la interfaz que lo consuma: la vista de escritorio del administrador
// y, más adelante, la vista móvil del supervisor.
//
// Reglas que cumple:
//   * Toda consulta parte de `objetivo_id`. Ninguna trae datos globales para
//     filtrarlos después en el cliente.
//   * Sin `select *`. Cada consulta declara sus columnas.
//   * Las derivaciones son funciones puras: se pueden probar y no dependen de
//     React ni del navegador.
//   * La lógica de turnos se reutiliza de lib/turnos.ts. No se reimplementa.
//
// Complemento, no reemplazo: la liquidación sigue siendo dominio exclusivo de
// lib/liquidacion.ts y este servicio no calcula horas. Si el legajo necesitara
// mostrarlas, debe llamar a `resolverLineaLiquidacion`, nunca replicar la
// fórmula.

import { supabase } from '@/lib/supabase'
import { registroTieneEntradaConfirmada, turnoEsActivo } from '@/lib/turnos'
import type { RegistroEntrada } from '@/lib/turnos'

// ── Tipos ───────────────────────────────────────────────────────────────────
// Mínimos y explícitos: reflejan exactamente las columnas que se consultan.

export interface ObjetivoLegajo {
  id: string
  nombre: string
  cliente: string | null
  direccion: string | null
  lat: number | null
  lng: number | null
  radio_metros: number | null
  estado: string | null
  zona_id: string | null
  frecuencia_supervision_horas: number | null
}

export interface PuestoLegajo {
  id: string
  nombre: string
  activo: boolean
  orden: number | null
}

export interface TurnoLegajo {
  id: string
  objetivo_id: string
  puesto_id: string | null
  guardia_id: string | null
  guardia_original_id: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado: string
}

export interface RegistroLegajo extends RegistroEntrada {
  id: string
  turno_id: string | null
  guardia_id: string | null
  hora_entrada_real: string | null
  hora_salida_real: string | null
  hora_entrada_final: string | null
  hora_salida_final: string | null
  tipo_registro: string | null
}

export interface SupervisionLegajo {
  id: string
  objetivo_id: string
  estado: string | null
  observaciones: string | null
  created_at: string
  supervisor: { nombre: string, apellido: string } | null
}

export interface NovedadLegajo {
  id: string
  objetivo_id: string | null
  tipo: string
  descripcion: string
  prioridad: string
  estado: string
  created_at: string
}

export interface RondaLegajo {
  id: string
  fecha_hora: string
  checkpoint: string | null
  checkpoint_code: string | null
  dispositivo_id: string | null
  estado: string | null
  raw_data: Record<string, any> | null
}

export interface PersonaLegajo {
  id: string
  nombre: string
  apellido: string
}

export interface LegajoObjetivo {
  objetivo: ObjetivoLegajo | null
  puestos: PuestoLegajo[]
  turnosHoy: TurnoLegajo[]
  registros: RegistroLegajo[]
  ultimaSupervision: SupervisionLegajo | null
  novedadesActivas: NovedadLegajo[]
  personas: PersonaLegajo[]
  error: string | null
}

// ── Utilidades de fecha ─────────────────────────────────────────────────────

// 'sv-SE' produce YYYY-MM-DD en hora local, que es el formato de turnos.fecha.
export const fechaHoyLocal = () => new Date().toLocaleDateString('sv-SE')

// ── Carga ───────────────────────────────────────────────────────────────────

const COLS_OBJETIVO =
  'id, nombre, cliente, direccion, lat, lng, radio_metros, estado, zona_id, frecuencia_supervision_horas'
const COLS_PUESTO   = 'id, nombre, activo, orden'
const COLS_TURNO    = 'id, objetivo_id, puesto_id, guardia_id, guardia_original_id, fecha, hora_inicio, hora_fin, estado'
const COLS_REGISTRO = 'id, turno_id, guardia_id, hora_entrada_real, hora_salida_real, hora_entrada_final, hora_salida_final, tipo_registro'
const COLS_NOVEDAD  = 'id, objetivo_id, tipo, descripcion, prioridad, estado, created_at'
const COLS_RONDA    = 'id, fecha_hora, checkpoint, checkpoint_code, dispositivo_id, estado, raw_data'
const COLS_PERSONA  = 'id, nombre, apellido'

/**
 * Carga el estado operativo de un objetivo para la fecha indicada.
 *
 * Una sola llamada por pantalla. Las consultas van en paralelo y todas parten
 * de `objetivoId`.
 *
 * `registros` se trae por los turnos del día, no por rango de fechas: es la
 * relación real que necesita el legajo y evita depender de `created_at`.
 */
export async function cargarLegajoObjetivo(
  objetivoId: string,
  fecha: string = fechaHoyLocal(),
): Promise<LegajoObjetivo> {
  const vacio: LegajoObjetivo = {
    objetivo: null, puestos: [], turnosHoy: [], registros: [],
    ultimaSupervision: null, novedadesActivas: [], personas: [], error: null,
  }

  const [objetivoRes, puestosRes, turnosRes, supervisionRes, novedadesRes] = await Promise.all([
    supabase.from('objetivos').select(COLS_OBJETIVO).eq('id', objetivoId).maybeSingle(),
    supabase.from('puestos').select(COLS_PUESTO)
      .eq('objetivo_id', objetivoId).eq('activo', true)
      .order('orden', { ascending: true }),
    supabase.from('turnos').select(COLS_TURNO)
      .eq('objetivo_id', objetivoId).eq('fecha', fecha)
      .order('hora_inicio', { ascending: true }),
    supabase.from('supervisiones')
      .select('id, objetivo_id, estado, observaciones, created_at, supervisor:usuarios(nombre, apellido)')
      .eq('objetivo_id', objetivoId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('novedades').select(COLS_NOVEDAD)
      .eq('objetivo_id', objetivoId).neq('estado', 'resuelta')
      .order('created_at', { ascending: false }),
  ])

  const error =
    objetivoRes.error?.message ||
    puestosRes.error?.message ||
    turnosRes.error?.message ||
    novedadesRes.error?.message ||
    null

  if (error) return { ...vacio, error }

  const turnosHoy = (turnosRes.data ?? []) as TurnoLegajo[]
  const turnoIds  = turnosHoy.map(t => t.id)

  // Registros de los turnos del día y personas referenciadas: dos consultas
  // acotadas por id, que sólo tienen sentido una vez conocidos los turnos.
  const [registrosRes, personasRes] = await Promise.all([
    turnoIds.length
      ? supabase.from('registros_asistencia').select(COLS_REGISTRO).in('turno_id', turnoIds)
      : Promise.resolve({ data: [], error: null } as any),
    (() => {
      const ids = Array.from(new Set(
        turnosHoy.flatMap(t => [t.guardia_id, t.guardia_original_id]).filter(Boolean) as string[],
      ))
      return ids.length
        ? supabase.from('usuarios').select(COLS_PERSONA).in('id', ids)
        : Promise.resolve({ data: [], error: null } as any)
    })(),
  ])

  return {
    objetivo: (objetivoRes.data ?? null) as ObjetivoLegajo | null,
    puestos: (puestosRes.data ?? []) as PuestoLegajo[],
    turnosHoy,
    registros: (registrosRes.data ?? []) as RegistroLegajo[],
    ultimaSupervision: (supervisionRes.data ?? null) as SupervisionLegajo | null,
    novedadesActivas: (novedadesRes.data ?? []) as NovedadLegajo[],
    personas: (personasRes.data ?? []) as PersonaLegajo[],
    error: registrosRes.error?.message || personasRes.error?.message || null,
  }
}

/**
 * Historial de rondas importadas desde JWM para un objetivo y rango de fechas.
 *
 * Va aparte de `cargarLegajoObjetivo` porque la pantalla la vuelve a pedir cada
 * vez que el usuario cambia el rango, sin recargar el resto del legajo.
 */
export async function cargarRondasObjetivo(
  objetivoId: string,
  desde: string,
  hasta: string,
): Promise<{ rondas: RondaLegajo[], error: string | null }> {
  const { data, error } = await supabase
    .from('rondas_jwm')
    .select(COLS_RONDA)
    .eq('objetivo_id', objetivoId)
    .gte('fecha_hora', `${desde}T00:00:00`)
    .lte('fecha_hora', `${hasta}T23:59:59`)
    .order('fecha_hora', { ascending: false })

  return { rondas: (data ?? []) as RondaLegajo[], error: error?.message ?? null }
}

// ── Ficha operativa: historiales recientes ──────────────────────────────────
//
// Todo lo de acá alimenta las secciones del legajo que muestran "lo último" de
// un objetivo. Tres reglas comunes:
//
//   * Siempre acotado. Ninguna consulta trae un historial abierto: o va por
//     rango de días o por `limit`. El legajo es un resumen con acceso al
//     detalle, no el detalle.
//   * Sin lógica nueva. Los estados salen de columnas ya persistidas
//     (`alerta_entrada`, `gps_ingreso_estado`, `estado`) y de los helpers que ya
//     existen en lib/turnos.ts. No se recalcula ningún horario.
//   * Todo parte de `objetivo_id`.

/** Días de historial que muestran las secciones de resumen. */
export const LEGAJO_DIAS_HISTORIAL = 7
/** Tope de filas por sección de resumen. */
export const LEGAJO_LIMITE_FILAS = 10

export interface AsistenciaLegajo {
  turno_id: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado: string
  guardia_id: string | null
  guardia_nombre: string
  hora_entrada_real: string | null
  hora_salida_real: string | null
  /** Columna persistida por el motor de asistencia. No se recalcula. */
  alerta_entrada: string | null
  gps_ingreso_estado: string | null
  tipo_registro: string | null
}

export interface SupervisionRecienteLegajo {
  id: string
  created_at: string
  estado: string | null
  observaciones: string | null
  supervisor_nombre: string
  /** Conteo de respuestas del checklist. Deriva de supervision_respuestas. */
  items_correctos: number
  items_observados: number
  items_total: number
  fotos: number
}

export interface NovedadRecienteLegajo {
  id: string
  created_at: string
  tipo: string
  descripcion: string
  prioridad: string
  estado: string
  autor_nombre: string
}

/** Fecha local YYYY-MM-DD desplazada N días hacia atrás. */
export function fechaHaceDias(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toLocaleDateString('sv-SE')
}

const COLS_REGISTRO_ASISTENCIA =
  'id, turno_id, guardia_id, hora_entrada_real, hora_salida_real, alerta_entrada, gps_ingreso_estado, tipo_registro'

/**
 * Asistencias recientes del objetivo: una fila por turno, con su registro.
 *
 * Parte de los turnos (la obligación) y no de los registros, para que un turno
 * sin fichar también aparezca — es justamente el caso que interesa vigilar.
 */
export async function cargarAsistenciasObjetivo(
  objetivoId: string,
  dias: number = LEGAJO_DIAS_HISTORIAL,
  limite: number = LEGAJO_LIMITE_FILAS,
): Promise<{ asistencias: AsistenciaLegajo[]; error: string | null }> {
  const { data: turnos, error: errTurnos } = await supabase
    .from('turnos')
    .select('id, fecha, hora_inicio, hora_fin, estado, guardia_id, guardia_original_id')
    .eq('objetivo_id', objetivoId)
    .gte('fecha', fechaHaceDias(dias))
    .lte('fecha', fechaHoyLocal())
    .order('fecha', { ascending: false })
    .order('hora_inicio', { ascending: false })
    .limit(limite)

  if (errTurnos) return { asistencias: [], error: errTurnos.message }

  const lista = turnos ?? []
  if (lista.length === 0) return { asistencias: [], error: null }

  const idsTurno = lista.map(t => t.id)
  const idsPersona = Array.from(new Set(
    lista.flatMap(t => [t.guardia_id, t.guardia_original_id]).filter(Boolean) as string[],
  ))

  const [registrosRes, personasRes] = await Promise.all([
    supabase.from('registros_asistencia').select(COLS_REGISTRO_ASISTENCIA).in('turno_id', idsTurno),
    idsPersona.length
      ? supabase.from('usuarios').select(COLS_PERSONA).in('id', idsPersona)
      : Promise.resolve({ data: [], error: null } as any),
  ])

  const personas = (personasRes.data ?? []) as PersonaLegajo[]
  const registros = (registrosRes.data ?? []) as any[]

  const asistencias: AsistenciaLegajo[] = lista.map(t => {
    // Un turno puede tener varios registros; interesa el que tiene entrada.
    const suyos = registros.filter(r => r.turno_id === t.id)
    const reg = suyos.find(r => r.hora_entrada_real) ?? suyos[0] ?? null
    return {
      turno_id: t.id,
      fecha: t.fecha,
      hora_inicio: t.hora_inicio,
      hora_fin: t.hora_fin,
      estado: t.estado,
      guardia_id: t.guardia_id,
      guardia_nombre: nombrePersona(t.guardia_id, personas),
      hora_entrada_real: reg?.hora_entrada_real ?? null,
      hora_salida_real: reg?.hora_salida_real ?? null,
      alerta_entrada: reg?.alerta_entrada ?? null,
      gps_ingreso_estado: reg?.gps_ingreso_estado ?? null,
      tipo_registro: reg?.tipo_registro ?? null,
    }
  })

  return { asistencias, error: registrosRes.error?.message ?? null }
}

/**
 * Supervisiones recientes con el resumen de su checklist.
 *
 * El checklist no es una entidad aparte: ejecutar un checklist ES registrar una
 * supervisión, y sus ítems son las filas de `supervision_respuestas`. Por eso el
 * conteo viaja acá y no en una consulta propia que mostraría lo mismo.
 */
export async function cargarSupervisionesObjetivo(
  objetivoId: string,
  limite: number = LEGAJO_LIMITE_FILAS,
): Promise<{ supervisiones: SupervisionRecienteLegajo[]; error: string | null }> {
  const { data, error } = await supabase
    .from('supervisiones')
    .select('id, created_at, estado, observaciones, supervisor:usuarios(nombre, apellido), respuestas:supervision_respuestas(resultado), fotos:supervision_fotos(id)')
    .eq('objetivo_id', objetivoId)
    .order('created_at', { ascending: false })
    .limit(limite)

  if (error) return { supervisiones: [], error: error.message }

  const supervisiones = (data ?? []).map((s: any) => {
    const respuestas = (s.respuestas ?? []) as { resultado: string }[]
    const sup = Array.isArray(s.supervisor) ? s.supervisor[0] : s.supervisor
    return {
      id: s.id,
      created_at: s.created_at,
      estado: s.estado,
      observaciones: s.observaciones,
      supervisor_nombre: sup ? `${sup.apellido}, ${sup.nombre}` : '—',
      items_correctos: respuestas.filter(r => r.resultado === 'correcto').length,
      items_observados: respuestas.filter(r => r.resultado === 'observado').length,
      items_total: respuestas.length,
      fotos: (s.fotos ?? []).length,
    }
  })

  return { supervisiones, error: null }
}

/** Novedades recientes del objetivo, de cualquier estado. */
export async function cargarNovedadesObjetivo(
  objetivoId: string,
  limite: number = LEGAJO_LIMITE_FILAS,
): Promise<{ novedades: NovedadRecienteLegajo[]; error: string | null }> {
  const { data, error } = await supabase
    .from('novedades')
    .select('id, created_at, tipo, descripcion, prioridad, estado, autor:usuarios(nombre, apellido)')
    .eq('objetivo_id', objetivoId)
    .order('created_at', { ascending: false })
    .limit(limite)

  if (error) return { novedades: [], error: error.message }

  const novedades = (data ?? []).map((n: any) => {
    const autor = Array.isArray(n.autor) ? n.autor[0] : n.autor
    return {
      id: n.id,
      created_at: n.created_at,
      tipo: n.tipo,
      descripcion: n.descripcion,
      prioridad: n.prioridad,
      estado: n.estado,
      autor_nombre: autor ? `${autor.apellido}, ${autor.nombre}` : '—',
    }
  })

  return { novedades, error: null }
}

/**
 * Escribe la ubicación del objetivo.
 *
 * Misma escritura que ya hace el supervisor desde móvil (`objetivos.update` con
 * lat/lng/radio). La autorización la resuelve RLS en el servidor; la interfaz
 * además oculta la acción a quien no corresponde.
 */
export async function actualizarUbicacionObjetivo(
  objetivoId: string,
  lat: number,
  lng: number,
  radioMetros: number,
): Promise<{ objetivo: ObjetivoLegajo | null; error: string | null }> {
  const { data, error } = await supabase
    .from('objetivos')
    .update({ lat, lng, radio_metros: radioMetros })
    .eq('id', objetivoId)
    .select(COLS_OBJETIVO)
    .single()

  return { objetivo: (data ?? null) as ObjetivoLegajo | null, error: error?.message ?? null }
}

// ── Derivaciones puras ──────────────────────────────────────────────────────

export type SemaforoObjetivo = 'critico' | 'atencion' | 'operativo' | 'sin_turnos'

export interface EstadoObjetivo {
  turnosActivos: TurnoLegajo[]
  turnosProximos: TurnoLegajo[]
  turnosSinFichar: TurnoLegajo[]
  alertas: NovedadLegajo[]
  semaforo: SemaforoObjetivo
}

/** Índice turno_id → registros, para no recorrer el array en cada consulta. */
export function indexarRegistrosPorTurno(registros: RegistroLegajo[]): Map<string, RegistroLegajo[]> {
  const mapa = new Map<string, RegistroLegajo[]>()
  registros.forEach(r => {
    if (!r.turno_id) return
    mapa.set(r.turno_id, [...(mapa.get(r.turno_id) ?? []), r])
  })
  return mapa
}

/** Un turno tiene entrada si alguno de sus registros la confirma. */
export function turnoTieneEntrada(
  turnoId: string,
  registrosPorTurno: Map<string, RegistroLegajo[]>,
): boolean {
  return (registrosPorTurno.get(turnoId) ?? []).some(registroTieneEntradaConfirmada)
}

/** Nombre "APELLIDO, Nombre" o guion si no hay persona. */
export function nombrePersona(id: string | null | undefined, personas: PersonaLegajo[]): string {
  if (!id) return '—'
  const p = personas.find(x => x.id === id)
  return p ? `${p.apellido}, ${p.nombre}` : '—'
}

/**
 * Estado operativo del objetivo en un instante dado.
 *
 * `turnoEsActivo` viene de lib/turnos.ts y maneja correctamente los turnos que
 * cruzan medianoche; sustituye a la comparación de strings que estaba escrita
 * en línea dentro del componente.
 */
export function derivarEstadoObjetivo(
  turnosHoy: TurnoLegajo[],
  registros: RegistroLegajo[],
  novedadesActivas: NovedadLegajo[],
  ahora: Date = new Date(),
): EstadoObjetivo {
  const registrosPorTurno = indexarRegistrosPorTurno(registros)
  const horaActual = `${String(ahora.getHours()).padStart(2, '0')}:${String(ahora.getMinutes()).padStart(2, '0')}`

  const turnosActivos  = turnosHoy.filter(t => turnoEsActivo(t, ahora))
  const turnosProximos = turnosHoy.filter(t => t.hora_inicio > horaActual).slice(0, 3)
  const turnosSinFichar = turnosHoy.filter(
    t => !turnoTieneEntrada(t.id, registrosPorTurno) && t.hora_inicio <= horaActual,
  )

  const alertas = novedadesActivas.filter(n => n.prioridad === 'urgente')

  const hayDescubierto = turnosHoy.some(t => !t.guardia_id || t.estado === 'descubierto')
  const semaforo: SemaforoObjetivo =
    hayDescubierto || alertas.length > 0 ? 'critico'
      : turnosSinFichar.length > 0 ? 'atencion'
        : turnosHoy.length === 0 ? 'sin_turnos'
          : 'operativo'

  return { turnosActivos, turnosProximos, turnosSinFichar, alertas, semaforo }
}

/** Color y etiqueta del semáforo. Único lugar donde se define esta correspondencia. */
export function presentacionSemaforo(semaforo: SemaforoObjetivo): { color: string, label: string } {
  if (semaforo === 'critico')   return { color: '#ef4444', label: 'Crítico' }
  if (semaforo === 'atencion')  return { color: '#f59e0b', label: 'Atención' }
  if (semaforo === 'operativo') return { color: '#10b981', label: 'Operativo' }
  return { color: '#64748b', label: 'Sin turnos hoy' }
}

// ── Programación mensual del objetivo ───────────────────────────────────────
//
// Extiende la sección de turnos del legajo (Turnos hoy / Próximos) con la
// vista del mes completo. Solo lectura: la asignación de vigiladores llega en
// el próximo bloque. Los turnos sin vigilador se muestran siempre.

export interface TurnoMensualLegajo {
  id: string
  fecha: string
  puesto_id: string | null
  puesto_nombre: string | null
  guardia_id: string | null
  hora_inicio: string
  hora_fin: string
  estado: string
  tipo_evento: string | null
  servicio_base_id: string | null
}

export type FiltroAsignacion = 'todos' | 'con' | 'sin'

export const ETIQUETA_ORIGEN_TURNO = {
  programacion: 'Programación mensual',
  manual: 'Manual',
} as const

export const ETIQUETA_SIN_ASIGNAR = 'Sin asignar'

/** Origen del turno: los generados por programación llevan servicio_base_id. */
export const origenTurno = (t: Pick<TurnoMensualLegajo, 'servicio_base_id'>): string =>
  t.servicio_base_id ? ETIQUETA_ORIGEN_TURNO.programacion : ETIQUETA_ORIGEN_TURNO.manual

/** Rango [desde, hasta] de un mes YYYY-MM (respeta 28/29/30/31 días). */
export function rangoMesLegajo(mes: string): { desde: string; hasta: string } {
  const [anio, m] = mes.split('-').map(Number)
  const ultimo = new Date(anio, m, 0).getDate()
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, '0')}` }
}

/**
 * Filtro puro de la vista mensual. `puestoId` vacío = todas las posiciones
 * (incluye la histórica "Principal"); `asignacion` distingue con/sin vigilador.
 */
export function filtrarProgramacionMensual<T extends Pick<TurnoMensualLegajo, 'puesto_id' | 'guardia_id'>>(
  turnos: T[],
  filtro: { puestoId?: string | null; asignacion?: FiltroAsignacion },
): T[] {
  return turnos.filter(t => {
    if (filtro.puestoId && t.puesto_id !== filtro.puestoId) return false
    if (filtro.asignacion === 'con' && !t.guardia_id) return false
    if (filtro.asignacion === 'sin' && t.guardia_id) return false
    return true
  })
}

/**
 * Turnos del objetivo para un mes, con su posición operativa, más las
 * personas referenciadas. Trae TODOS los turnos del mes (con o sin
 * vigilador, cualquier posición): la vista no oculta nada.
 */
export async function cargarProgramacionMensualObjetivo(
  objetivoId: string,
  mes: string,
): Promise<{ turnos: TurnoMensualLegajo[]; personas: PersonaLegajo[]; error: string | null }> {
  const { desde, hasta } = rangoMesLegajo(mes)
  const { data, error } = await supabase
    .from('turnos')
    .select('id, fecha, puesto_id, guardia_id, hora_inicio, hora_fin, estado, tipo_evento, servicio_base_id, puesto:puestos(nombre)')
    .eq('objetivo_id', objetivoId)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: true })
    .order('hora_inicio', { ascending: true })

  if (error) return { turnos: [], personas: [], error: error.message }

  const turnos: TurnoMensualLegajo[] = (data ?? []).map((t: any) => {
    const puesto = Array.isArray(t.puesto) ? t.puesto[0] : t.puesto
    return {
      id: t.id,
      fecha: t.fecha,
      puesto_id: t.puesto_id ?? null,
      puesto_nombre: puesto?.nombre ?? null,
      guardia_id: t.guardia_id ?? null,
      hora_inicio: t.hora_inicio,
      hora_fin: t.hora_fin,
      estado: t.estado,
      tipo_evento: t.tipo_evento ?? null,
      servicio_base_id: t.servicio_base_id ?? null,
    }
  })

  const guardiaIds = Array.from(new Set(turnos.map(t => t.guardia_id).filter(Boolean) as string[]))
  const personasRes = guardiaIds.length
    ? await supabase.from('usuarios').select(COLS_PERSONA).in('id', guardiaIds)
    : { data: [], error: null } as any

  return {
    turnos,
    personas: (personasRes.data ?? []) as PersonaLegajo[],
    error: personasRes.error?.message ?? null,
  }
}
