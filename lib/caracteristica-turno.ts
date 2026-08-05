/**
 * lib/caracteristica-turno.ts
 *
 * Característica obligatoria del turno (OT-01 Bloque B).
 * Reutiliza la columna turnos.tipo_evento — valores validados por el CHECK
 * turnos_tipo_evento_check (migración 20260805100000_turnos_caracteristica.sql).
 *
 * Etiquetas de interfaz centralizadas acá: cambiar el texto en un solo lugar.
 * No existe el concepto de "horas extras" — no agregar valores no aprobados.
 */

export const CARACTERISTICAS_TURNO = ['normal', 'cobertura', 'capacitacion'] as const

export type CaracteristicaTurno = typeof CARACTERISTICAS_TURNO[number]

export const ETIQUETA_CARACTERISTICA: Record<CaracteristicaTurno, string> = {
  normal: 'Normal',
  cobertura: 'Cobertura (reemplazo)',
  capacitacion: 'Capacitación',
}

/** Normaliza el valor almacenado: NULL/undefined/desconocido → 'normal'. */
export function caracteristicaTurno(tipoEvento?: string | null): CaracteristicaTurno {
  return (CARACTERISTICAS_TURNO as readonly string[]).includes(tipoEvento || '')
    ? (tipoEvento as CaracteristicaTurno)
    : 'normal'
}

/** Etiqueta legible para cualquier valor almacenado. */
export function etiquetaCaracteristica(tipoEvento?: string | null): string {
  return ETIQUETA_CARACTERISTICA[caracteristicaTurno(tipoEvento)]
}

/**
 * Un turno de capacitación se paga al vigilador pero NO se cobra al objetivo:
 * sus horas no deben sumarse en planillas ni resúmenes por objetivo.
 */
export function esCapacitacion(tipoEvento?: string | null): boolean {
  return caracteristicaTurno(tipoEvento) === 'capacitacion'
}
