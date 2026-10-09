/**
 * lib/legajo.ts
 *
 * Lógica compartida del Legajo Digital.
 * No depende del navegador — válido en servidor y cliente.
 */

import { alcanceDe, tieneCapacidad } from '@/lib/capacidades'

export type RolSolicitante = 'admin' | 'supervisor' | 'guardia' | 'vigilador'

export interface SolicitanteLegajo {
  id: string
  rol: RolSolicitante | string | null
  puesto_organizacional?: string | null
  acceso_admin_pleno?: boolean | null
}

/**
 * ¿Gestiona legajos ajenos? Administración y Gerencia (capacidad
 * `gestionar_personal`, por puesto o por override), y —por compatibilidad con
 * quien hoy entra— el rol legado `admin` con alcance operativo total
 * (Dirección Operativa).
 *
 * Hasta oct-2026 se miraba sólo `rol === 'admin'`: una persona de
 * Administración con otro rol recibía 403 en todo el legajo.
 */
export function gestionaLegajos(solicitante: SolicitanteLegajo): boolean {
  if (tieneCapacidad(solicitante, 'gestionar_personal')) return true
  return solicitante.rol === 'admin' && alcanceDe(solicitante) === 'todas'
}

/**
 * Determina si un usuario puede ver el legajo de un empleado: el propio, o
 * quien gestiona legajos. Supervisión no entra a legajos ajenos.
 *
 * Los datos personales y la documentación tienen además su propio control en
 * la base (RPC + RLS): esta regla sólo abre la página.
 */
export function puedeVerLegajo(
  solicitante: SolicitanteLegajo,
  empleadoId: string,
): boolean {
  if (solicitante.id === empleadoId) return true
  return gestionaLegajos(solicitante)
}
