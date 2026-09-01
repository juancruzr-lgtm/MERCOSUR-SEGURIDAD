/**
 * lib/planilla-acciones.ts
 *
 * De qué lista sale el turno cuando se aprieta un botón de la planilla.
 *
 * Parece una obviedad y no lo es. La planilla de Reportes dibuja sus filas con
 * el mes que el usuario eligió arriba (`turnosReportes`), pero "Editar turno" y
 * "Anular turno" buscaban el turno en la prop `turnos`, que es otra cosa: la
 * pantalla de Turnos la recarga acotada al MES EN CURSO.
 *
 * Mientras el mes elegido y el mes en curso coincidían no se notaba. El 1º de
 * septiembre, mirando agosto, ninguna fila estaba en `turnos`: los dos botones
 * cortaban con `if (!turno) return` y el click no hacía absolutamente nada —ni
 * modal, ni error, ni pista— sobre turnos duplicados que había que anular.
 *
 * La regla es que la acción se resuelve contra la MISMA lista que dibujó la
 * fila. La lista global queda como respaldo, nunca como fuente principal.
 */

export interface TurnoIdentificable {
  id: string
}

export function resolverTurnoDeFila<T extends TurnoIdentificable>(
  turnoId: string,
  delMesVisible: readonly T[],
  globales: readonly T[] = [],
): T | undefined {
  if (!turnoId) return undefined
  return delMesVisible.find(t => t.id === turnoId)
    ?? globales.find(t => t.id === turnoId)
}

/**
 * Cómo se lee en la planilla un turno que salió del mes.
 *
 * Son los tres de `ESTADOS_SIN_OBLIGACION`. Se nombran acá para que la fila
 * diga cuál de los tres fue: "Anulado" a secas sobre un turno reemplazado
 * contaría otra historia.
 */
export const ETIQUETA_TURNO_SIN_OBLIGACION: Record<string, string> = {
  anulado: 'Anulado',
  cancelado: 'Cancelado',
  reemplazado: 'Reemplazado',
}

/**
 * ¿Se puede editar o anular este turno desde la planilla?
 *
 * No, si ya está fuera del mes. El guard anterior era `row.Estado !== 'Anulado'`
 * y nunca se cumplía, porque el estado de la fila jamás decía 'Anulado'.
 */
export function admiteAccionesDePlanilla(estadoFila: string): boolean {
  return !Object.values(ETIQUETA_TURNO_SIN_OBLIGACION).includes(estadoFila)
}
