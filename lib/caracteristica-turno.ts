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

/**
 * Color con el que se distingue una característica que no es la habitual.
 * `null` en 'normal': ahí manda el color de estado (asignado/programado/
 * conflicto), que es lo que importa mirar en un turno común. Son los mismos
 * violeta y celeste que usa la columna "Caract." de Reportes: un turno de
 * capacitación tiene que verse igual en la grilla y en la planilla.
 */
export const COLOR_CARACTERISTICA: Record<CaracteristicaTurno, string | null> = {
  normal: null,
  cobertura: '#38bdf8',
  capacitacion: '#a78bfa',
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

// ── Por qué la suma que se paga y la que se cobra no dan igual ───────────────
// Un total de horas que descuenta capacitaciones (planilla del objetivo) y otro
// que las suma (planilla del vigilador) muestran números distintos sobre los
// mismos turnos. Sin decirlo, esa diferencia se lee como un error de cálculo.
// El texto vive acá, con las etiquetas, para que todas las pantallas y las
// exportaciones expliquen lo mismo con las mismas palabras.

export const MOTIVO_CAPACITACION = 'se pagan al vigilador, no se cobran al objetivo'

const hsTexto = (horas: number) => horas.toFixed(2)
const turnosTexto = (turnos: number) => `${turnos} turno${turnos !== 1 ? 's' : ''}`

/**
 * Nota al pie de un total que YA descontó las capacitaciones.
 * null cuando no hay horas de capacitación: sin diferencia no hay nada que aclarar.
 */
export function notaCapacitacionExcluida(horas: number, turnos: number): string | null {
  if (horas <= 0) return null
  return `No incluye ${hsTexto(horas)} hs de capacitación (${turnosTexto(turnos)}): ${MOTIVO_CAPACITACION}.`
}

/** Nota al pie de un total que SÍ suma las capacitaciones. Mismo criterio de null. */
export function notaCapacitacionIncluida(horas: number, turnos: number): string | null {
  if (horas <= 0) return null
  return `Incluye ${hsTexto(horas)} hs de capacitación (${turnosTexto(turnos)}): ${MOTIVO_CAPACITACION}.`
}
