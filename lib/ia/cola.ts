// lib/ia/cola.ts
//
// Reglas de la cola del análisis automático. Lógica pura: qué hacer con una
// evidencia que ya tiene fila en evidencia_analisis cuando una corrida la
// vuelve a encontrar, y en qué orden se procesan las candidatas.
//
// El lock es la fila misma: el índice único uq_evidencia_analisis_produccion
// impide dos inserts para la misma evidencia, y todo re-reclamo se hace con un
// UPDATE condicionado al estado e intentos leídos (si otra corrida ganó, el
// UPDATE no toca filas y esta corrida la omite). Ver procesar.ts.

/** Una fila 'procesando' sin novedades por más que esto se considera colgada. */
export const PROCESANDO_COLGADO_MS = 10 * 60_000

export type FilaPrevia = {
  estado: string
  intentos?: number | null
  proximo_intento_at?: string | null
  updated_at?: string | null
}

export type DecisionReclamo =
  | { accion: 'reintentar' }          // error transitorio, quedan intentos y ya es hora
  | { accion: 'recuperar' }           // quedó 'procesando' (función cortada): se reclama de nuevo
  | { accion: 'agotar' }              // sin intentos: pasa a error_definitivo y sale de la cola
  | { accion: 'omitir', motivo: string }

export function decidirReclamo(previa: FilaPrevia | null, maxIntentos: number, ahora: number = Date.now()): DecisionReclamo {
  if (!previa) return { accion: 'omitir', motivo: 'No se pudo leer el análisis previo' }
  const intentos = previa.intentos ?? 0

  if (previa.estado === 'error') {
    if (intentos >= maxIntentos) return { accion: 'agotar' }
    const prox = previa.proximo_intento_at ? new Date(previa.proximo_intento_at).getTime() : null
    if (prox !== null && !Number.isNaN(prox) && prox > ahora) {
      return { accion: 'omitir', motivo: `Reintento pendiente (intento ${intentos} de ${maxIntentos})` }
    }
    return { accion: 'reintentar' }
  }

  if (previa.estado === 'procesando') {
    const upd = previa.updated_at ? new Date(previa.updated_at).getTime() : NaN
    const colgada = Number.isNaN(upd) || ahora - upd > PROCESANDO_COLGADO_MS
    if (!colgada) return { accion: 'omitir', motivo: 'Otra corrida la está analizando' }
    return intentos >= maxIntentos ? { accion: 'agotar' } : { accion: 'recuperar' }
  }

  if (previa.estado === 'pendiente') return { accion: 'recuperar' }

  return { accion: 'omitir', motivo: previa.estado === 'completado' ? 'Ya analizada' : `Estado ${previa.estado}` }
}

/**
 * Ordena las evidencias leídas según el orden que devolvió la cola
 * (ia_evidencias_por_analizar). Lo que no esté en la cola queda afuera.
 */
export function ordenarSegunCola<T extends { id: string }>(evidencias: T[], ordenIds: string[]): T[] {
  const porId = new Map(evidencias.map(e => [e.id, e]))
  return ordenIds.map(id => porId.get(id)).filter((e): e is T => !!e)
}

/** PostgREST responde PGRST202 cuando la función todavía no existe. */
export function esFuncionAusente(error: { code?: string | null, message?: string | null } | null | undefined): boolean {
  if (!error) return false
  if (error.code === 'PGRST202' || error.code === '42883') return true
  return /could not find the function|does not exist/i.test(error.message ?? '')
}
