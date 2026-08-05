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
