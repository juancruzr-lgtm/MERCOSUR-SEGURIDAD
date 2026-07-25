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
