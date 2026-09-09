/**
 * lib/alertas-alcance.ts
 *
 * Alcance de las ALERTAS DE ASISTENCIA (descubierto, sin ingreso, tardanza,
 * fuera de radio, intervenidas) derivadas de turnos/registros.
 *
 * Reutiliza el alcance operativo canónico (lib/capacidades): 'todas' ve todo;
 * 'zonas_asignadas' (supervisor) sólo los objetivos de sus zonas. Es el MISMO
 * criterio que la agenda de supervisiones de SupervisorMobile — acá no se
 * inventa un segundo sistema de zonas, sólo se comparte el existente.
 *
 * FAIL-CLOSED: para un alcance zonificado, un objetivo SIN zona no entra en el
 * alcance (igual que en la agenda). La alerta reaparece cuando el objetivo
 * recibe una zona válida; el que ve todo ('todas') nunca pierde nada.
 *
 * Motivo: un supervisor de Rosario veía en su tab Alertas los ingresos fuera
 * de radio de un objetivo de Rafaela. La consulta de turnos no filtra por
 * zona y las listas de alertas se derivaban del set completo.
 */

import type { AlcanceOperativo } from '@/lib/capacidades'

export interface ObjetivoZonificado {
  id: string
  zona_id?: string | null
}

/**
 * Ids de objetivos cuyos turnos pueden generar alertas visibles para este
 * alcance. `null` significa SIN LÍMITE (alcance 'todas'): se distingue del
 * Set vacío, que es un alcance zonificado sin zonas asignadas (fail-closed).
 */
export function objetivoIdsParaAlertas(
  alcance: AlcanceOperativo,
  objetivos: ObjetivoZonificado[],
  zonasAsignadasIds: ReadonlySet<string>,
): Set<string> | null {
  if (alcance === 'todas') return null
  return new Set(
    objetivos
      .filter(o => o.zona_id && zonasAsignadasIds.has(o.zona_id))
      .map(o => o.id),
  )
}

/** ¿El turno de este objetivo entra en el alcance de alertas? */
export function turnoEnAlcanceAlertas(
  objetivoId: string | null | undefined,
  permitidos: ReadonlySet<string> | null,
): boolean {
  if (permitidos === null) return true
  return !!objetivoId && permitidos.has(objetivoId)
}

/**
 * Filtra la base de turnos de la que se derivan TODAS las categorías de
 * alertas de asistencia. Filtrar una sola vez acá garantiza que las cuatro
 * listas, las intervenidas y los contadores usen exactamente el mismo límite.
 */
export function filtrarTurnosParaAlertas<T extends { objetivo_id?: string | null }>(
  turnos: T[],
  permitidos: ReadonlySet<string> | null,
): T[] {
  if (permitidos === null) return turnos
  return turnos.filter(t => turnoEnAlcanceAlertas(t.objetivo_id, permitidos))
}
