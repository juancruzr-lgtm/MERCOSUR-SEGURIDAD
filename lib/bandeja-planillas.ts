/**
 * lib/bandeja-planillas.ts
 *
 * Bandeja mensual de revisión de planillas: estado único por fila, filtros y
 * resumen del mes.
 *
 * PURO: no consulta Supabase. La bandeja (components/supervisor/BandejaPlanillas)
 * arma las filas con los datos ya traídos y usa esto para clasificarlas,
 * filtrarlas y resumirlas. Hay una sola bandeja, montada desde administración y
 * desde la vista de supervisor; acá vive lo que ambas comparten.
 *
 * Reutiliza los estados que ya existen en lib/primer-control —
 * EstadoPrimerControl (lado del vigilador), EstadoSolicitud (ciclo de la
 * solicitud) y AccionSupervisor— y los combina en UN estado visible por fila.
 * No agrega estados a la base: es una derivación de lo que ya está guardado.
 */

import type { EstadoPrimerControl, EstadoSolicitud } from '@/lib/primer-control'

// ── Estado visible de la fila ────────────────────────────────────────────────

export const ESTADOS_REVISION = [
  'pendiente',
  'aceptado',
  'modificacion_solicitada',
  'revisado_supervisor',
  'pendiente_regularizacion',
  'resuelto',
] as const

export type EstadoRevision = typeof ESTADOS_REVISION[number]

export const ETIQUETA_ESTADO_REVISION: Record<EstadoRevision, string> = {
  pendiente: 'Pendiente',
  aceptado: 'Aceptado por vigilador',
  modificacion_solicitada: 'Modificación solicitada',
  revisado_supervisor: 'Revisado por supervisor',
  pendiente_regularizacion: 'Pendiente de regularización administrativa',
  resuelto: 'Resuelto',
}

/**
 * Estados que todavía esperan que alguien haga algo. Son los que cuenta el
 * resumen del mes: "Agosto 2026 — 12 pendientes de 340 registros".
 *
 * 'aceptado' NO cuenta como pendiente: el vigilador dio conformidad y no queda
 * nada por resolver. 'revisado_supervisor' y 'resuelto' tampoco.
 */
export const ESTADOS_PENDIENTES: ReadonlySet<EstadoRevision> = new Set<EstadoRevision>([
  'pendiente',
  'modificacion_solicitada',
  'pendiente_regularizacion',
])

export const esPendienteDeAccion = (e: EstadoRevision): boolean => ESTADOS_PENDIENTES.has(e)

// ── Fila de la bandeja ───────────────────────────────────────────────────────

export interface FilaBandejaMensual {
  turnoId: string
  empleadoId: string
  vigilador: string
  fecha: string
  objetivoId: string
  objetivo: string
  puestoId: string | null
  puesto: string
  horario: string
  entrada: string | null
  salida: string | null
  horas: number
  caracteristica: string
  salidaAutomatica: boolean
  tieneFichaje: boolean
  /** Lo que respondió el vigilador. */
  estadoControl: EstadoPrimerControl
  solicitudId: string | null
  solicitudTexto: string | null
  solicitudEstado: EstadoSolicitud | null
  /** El supervisor marcó la fila como revisada. */
  revisado: boolean
  /** El supervisor la derivó a administración. */
  derivado: boolean
  observaciones: number
}

/**
 * Estado visible de una fila, combinando lo del vigilador con lo que hizo
 * después el supervisor o administración.
 *
 * Precedencia: gana lo más avanzado del ciclo. Si el supervisor ya revisó, eso
 * pesa más que la respuesta del vigilador, porque ocurrió después. Sin esta
 * regla una fila revisada seguiría apareciendo como "Modificación solicitada" y
 * volvería a la bandeja para siempre.
 */
export function estadoRevision(f: Pick<FilaBandejaMensual,
  'estadoControl' | 'solicitudEstado' | 'revisado' | 'derivado'>): EstadoRevision {
  if (f.solicitudEstado === 'resuelta') return 'resuelto'
  if (f.derivado || f.solicitudEstado === 'requiere_regularizacion') return 'pendiente_regularizacion'
  if (f.revisado || f.solicitudEstado === 'revisada') return 'revisado_supervisor'
  if (f.estadoControl === 'modificacion_solicitada') return 'modificacion_solicitada'
  if (f.estadoControl === 'aceptado') return 'aceptado'
  return 'pendiente'
}

// ── Filtros ──────────────────────────────────────────────────────────────────

export type FiltroTernario = 'todos' | 'si' | 'no'

export interface FiltrosBandejaMensual {
  /** 'YYYY-MM'. El mes NO se aplica acá: acota la consulta, no el filtrado. */
  empleadoId?: string | null
  objetivoId?: string | null
  puestoId?: string | null
  estado?: EstadoRevision | 'todos'
  /** 'si' = solo con fichaje, 'no' = solo sin fichaje. */
  conFichaje?: FiltroTernario
  salidaAutomatica?: FiltroTernario
  /** Solo lo que espera acción de alguien. */
  soloPendientes?: boolean
}

export function filtrarFilasBandeja(
  filas: FilaBandejaMensual[],
  f: FiltrosBandejaMensual,
): FilaBandejaMensual[] {
  return filas.filter(fila => {
    const estado = estadoRevision(fila)
    if (f.empleadoId && fila.empleadoId !== f.empleadoId) return false
    if (f.objetivoId && fila.objetivoId !== f.objetivoId) return false
    if (f.puestoId && (fila.puestoId ?? '') !== f.puestoId) return false
    if (f.estado && f.estado !== 'todos' && estado !== f.estado) return false
    if (f.conFichaje === 'si' && !fila.tieneFichaje) return false
    if (f.conFichaje === 'no' && fila.tieneFichaje) return false
    if (f.salidaAutomatica === 'si' && !fila.salidaAutomatica) return false
    if (f.salidaAutomatica === 'no' && fila.salidaAutomatica) return false
    if (f.soloPendientes && !esPendienteDeAccion(estado)) return false
    return true
  })
}

// ── Resumen del mes ──────────────────────────────────────────────────────────

export interface ResumenBandejaMensual {
  total: number
  pendientes: number
  porEstado: Record<EstadoRevision, number>
  /** true cuando no queda nada esperando acción: el mes está al día. */
  cerrado: boolean
}

export function resumenBandejaMensual(filas: FilaBandejaMensual[]): ResumenBandejaMensual {
  const porEstado = Object.fromEntries(
    ESTADOS_REVISION.map(e => [e, 0]),
  ) as Record<EstadoRevision, number>

  let pendientes = 0
  for (const fila of filas) {
    const e = estadoRevision(fila)
    porEstado[e] += 1
    if (esPendienteDeAccion(e)) pendientes += 1
  }
  return {
    total: filas.length,
    pendientes,
    porEstado,
    // Un mes sin registros no está "cerrado": no hay nada que revisar todavía.
    cerrado: filas.length > 0 && pendientes === 0,
  }
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
]

/** "Agosto 2026" a partir de 'YYYY-MM'. */
export function nombreMes(mes: string): string {
  const [anio, num] = mes.split('-').map(Number)
  return `${MESES[(num || 1) - 1] ?? mes} ${anio || ''}`.trim()
}

/** "Agosto 2026 — 12 pendientes de 340 registros" */
export function etiquetaResumenMes(mes: string, r: ResumenBandejaMensual): string {
  const nombre = nombreMes(mes)
  if (r.total === 0) return `${nombre} — sin registros para revisar`
  if (r.pendientes === 0) return `${nombre} — al día · ${r.total} registro${r.total !== 1 ? 's' : ''}`
  return `${nombre} — ${r.pendientes} pendiente${r.pendientes !== 1 ? 's' : ''} de ${r.total} registro${r.total !== 1 ? 's' : ''}`
}

// ── Opciones de los desplegables ─────────────────────────────────────────────
// Se derivan de las filas del mes: solo se ofrece filtrar por lo que realmente
// aparece, en vez de listar todos los vigiladores y objetivos del sistema.

export interface OpcionFiltro {
  id: string
  nombre: string
}

const opciones = (
  filas: FilaBandejaMensual[],
  id: (f: FilaBandejaMensual) => string | null,
  nombre: (f: FilaBandejaMensual) => string,
): OpcionFiltro[] => {
  const mapa = new Map<string, string>()
  for (const f of filas) {
    const k = id(f)
    if (k) mapa.set(k, nombre(f))
  }
  return [...mapa.entries()]
    .map(([id, nombre]) => ({ id, nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre))
}

export const opcionesVigilador = (filas: FilaBandejaMensual[]) =>
  opciones(filas, f => f.empleadoId, f => f.vigilador)

export const opcionesObjetivo = (filas: FilaBandejaMensual[]) =>
  opciones(filas, f => f.objetivoId, f => f.objetivo)

export const opcionesPuesto = (filas: FilaBandejaMensual[]) =>
  opciones(filas, f => f.puestoId, f => f.puesto)

// ── Alcance de datos ─────────────────────────────────────────────────────────

/**
 * Administración ve todos los objetivos; supervisión, solo los de sus zonas.
 * Un supervisor sin zonas asignadas conserva el alcance total, que es la regla
 * que ya aplican las RPC de programación — no se cambia acá.
 *
 * Esto solo decide qué se muestra: la RLS del servidor sigue siendo el límite
 * real de lo que cada usuario puede leer.
 */
export function objetivoEnAlcance(
  objetivoZonaId: string | null | undefined,
  esAdmin: boolean,
  zonasDelSupervisor: ReadonlySet<string> | null,
): boolean {
  if (esAdmin) return true
  if (!zonasDelSupervisor || zonasDelSupervisor.size === 0) return true
  return !!objetivoZonaId && zonasDelSupervisor.has(objetivoZonaId)
}
