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
