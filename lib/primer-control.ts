/**
 * lib/primer-control.ts
 *
 * Primer control del vigilador sobre Mi Planilla (OT-02 Bloque C).
 * Estados de revisión de un turno anterior y sus etiquetas de interfaz.
 *
 * Los nombres visibles están centralizados acá para poder cambiarlos en un
 * solo lugar. No agregar estados sin autorización.
 */

export const ESTADOS_PRIMER_CONTROL = ['pendiente', 'aceptado', 'modificacion_solicitada'] as const

export type EstadoPrimerControl = typeof ESTADOS_PRIMER_CONTROL[number]

export const ETIQUETA_PRIMER_CONTROL: Record<EstadoPrimerControl, string> = {
  pendiente: 'Pendiente de revisión',
  aceptado: 'Aceptado',
  modificacion_solicitada: 'Modificación solicitada',
}

/** Etiqueta corta para la indicación de salida automática. */
export const ETIQUETA_SALIDA_AUTOMATICA = 'Salida automática'

// ── Ciclo de la solicitud de modificación (Bloque D) ─────────────────────────
// El texto original del vigilador nunca se modifica; el estado avanza con
// eventos registrados en revisiones_planilla.

export const ESTADOS_SOLICITUD = ['pendiente', 'revisada', 'requiere_regularizacion', 'resuelta'] as const

export type EstadoSolicitud = typeof ESTADOS_SOLICITUD[number]

export const ETIQUETA_ESTADO_SOLICITUD: Record<EstadoSolicitud, string> = {
  pendiente: 'Pendiente de revisión del supervisor',
  revisada: 'Revisada por el supervisor',
  requiere_regularizacion: 'Requiere regularización administrativa',
  resuelta: 'Resuelta por Administración',
}

// ── Acciones del supervisor (Bloque D) ───────────────────────────────────────

export const ACCIONES_SUPERVISOR = ['revisado', 'observacion', 'derivar_administracion'] as const

export type AccionSupervisor = typeof ACCIONES_SUPERVISOR[number]

export const ETIQUETA_ACCION_SUPERVISOR: Record<AccionSupervisor, string> = {
  revisado: 'Marcar como revisado',
  observacion: 'Dejar observación',
  derivar_administracion: 'Requiere regularización administrativa',
}

// ── Filtros de la bandeja del supervisor ─────────────────────────────────────
// Nombres de interfaz centralizados: cambiar acá, no en la bandeja.

export const FILTROS_BANDEJA = [
  { id: 'modificaciones_solicitadas', label: 'Modificaciones solicitadas' },
  { id: 'sin_respuesta', label: 'Sin respuesta del vigilador' },
  { id: 'aceptados', label: 'Aceptados por el vigilador' },
  { id: 'salida_auto_pendiente', label: 'Salida automática pendiente' },
  { id: 'sin_fichaje_con_solicitud', label: 'Sin fichaje con solicitud' },
  { id: 'sin_fichaje_sin_respuesta', label: 'Sin fichaje y sin respuesta' },
] as const

export type FiltroBandeja = typeof FILTROS_BANDEJA[number]['id']

export interface FilaClasificableBandeja {
  tieneFichaje: boolean
  salidaAutomatica: boolean
  estadoControl: EstadoPrimerControl
}

/** A qué grupos de la bandeja pertenece una fila. Una fila puede estar en varios. */
export function filtrosDeFila(f: FilaClasificableBandeja): FiltroBandeja[] {
  const r: FiltroBandeja[] = []
  if (f.estadoControl === 'modificacion_solicitada') r.push('modificaciones_solicitadas')
  if (f.estadoControl === 'aceptado') r.push('aceptados')
  if (f.estadoControl === 'pendiente') r.push('sin_respuesta')
  if (f.salidaAutomatica && f.estadoControl === 'pendiente') r.push('salida_auto_pendiente')
  if (!f.tieneFichaje && f.estadoControl === 'modificacion_solicitada') r.push('sin_fichaje_con_solicitud')
  if (!f.tieneFichaje && f.estadoControl === 'pendiente') r.push('sin_fichaje_sin_respuesta')
  return r
}

// ── Visibilidad de acciones del vigilador ────────────────────────────────────
// Regla única (OT-01 continuidad):
//   · pasado con asistencia, no revisado      → Aceptar + Solicitar modificación
//   · pasado con salida automática, no rev.   → Aceptar + Solicitar modificación
//   · pasado sin fichaje / sin asistencia     → SOLO Solicitar modificación
//   · futuro o en curso                       → ninguna
//   · anulado/cancelado/reemplazado           → ninguna (estado_control null)
//   · vista de terceros (no titular)          → ninguna

export interface FilaAccionesPrimerControl {
  estado?: 'trabajado' | 'en_curso' | 'programado' | 'sin_programacion'
  estado_control?: EstadoPrimerControl | null
  permite_aceptar?: boolean
  turno_id?: string | null
}

export function accionesPrimerControl(
  fila: FilaAccionesPrimerControl,
  esTitular: boolean,
): { aceptar: boolean; solicitar: boolean } {
  const nada = { aceptar: false, solicitar: false }
  if (!esTitular || !fila.turno_id) return nada
  if (fila.estado_control !== 'pendiente') return nada
  if (fila.estado === 'en_curso' || fila.estado === 'sin_programacion') return nada
  if (fila.estado === 'trabajado') return { aceptar: fila.permite_aceptar !== false, solicitar: true }
  // 'programado' pasado (estado_control lo marca la API solo si ya finalizó):
  // sin fichaje → nunca Aceptar, sí Solicitar modificación.
  if (fila.estado === 'programado') return { aceptar: false, solicitar: true }
  return nada
}

// ── Resumen post-egreso (continuidad) ────────────────────────────────────────
// Aparece apenas se registra la salida y, si no se respondió ahí, queda
// disponible después en Mi Planilla (mismo turno_id, mismo estado_control:
// una sola fuente de verdad, no hay estado paralelo para el resumen).

/** "8h 30min" — nunca decimales ni conceptos de liquidación. */
export function formatearDuracionHoraMin(horasDecimal: number | null | undefined): string {
  if (horasDecimal == null || horasDecimal <= 0) return '—'
  const totalMin = Math.round(horasDecimal * 60)
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  return `${h}h ${m}min`
}

// Mismos 4 estados que ya persisten en registros_asistencia.gps_ingreso_estado /
// gps_egreso_estado (ver components/guardia/GuardiaMobile.tsx) — no inventar otros.
export type GpsEstadoRadio = 'dentro_radio' | 'fuera_radio' | 'objetivo_sin_gps' | 'gps_no_disponible'

export function etiquetaEstadoGps(estado: GpsEstadoRadio | string | null | undefined): string {
  switch (estado) {
    case 'dentro_radio': return 'GPS OK · dentro del radio'
    case 'fuera_radio': return 'GPS fuera del objetivo'
    case 'objetivo_sin_gps': return 'GPS registrado · objetivo sin ubicación configurada'
    case 'gps_no_disponible': return 'Sin GPS'
    default: return 'Sin GPS'
  }
}
