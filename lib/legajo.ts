/**
 * lib/legajo.ts
 *
 * Lógica compartida del Legajo Digital.
 * No depende del navegador — válido en servidor y cliente.
 */

export type RolSolicitante = 'admin' | 'supervisor' | 'guardia' | 'vigilador'

export interface SolicitanteLegajo {
  id: string
  rol: RolSolicitante
}

/**
 * Determina si un usuario puede ver el legajo de un empleado.
 *
 * Etapa actual: solo admin.
 * Extensión futura:
 *   - supervisor con zona que incluya al empleado
 *   - guardia/vigilador para su propio legajo (id === empleadoId)
 *
 * @param solicitante - usuario que realiza la consulta
 * @param empleadoId  - id del empleado cuyo legajo se solicita
 */
export function puedeVerLegajo(
  solicitante: SolicitanteLegajo,
  empleadoId: string,
): boolean {
  if (solicitante.rol === 'admin') return true

  // Etapa futura: supervisor con acceso por zona.
  // No implementado. No rechazar aquí para facilitar extensión, pero
  // el endpoint también debe validar alcance de zona en esa etapa.
  // if (solicitante.rol === 'supervisor') return supervisorTieneAccesoAlEmpleado(...)

  // Etapa futura: "Mi Legajo" — el empleado ve su propio legajo.
  // if (solicitante.rol === 'guardia' || solicitante.rol === 'vigilador') {
  //   return solicitante.id === empleadoId
  // }

  return false
}
