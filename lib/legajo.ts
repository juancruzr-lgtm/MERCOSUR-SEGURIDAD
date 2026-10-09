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
 * ¿Ve y valida DATOS PERSONALES y DOCUMENTACIÓN sensibles de otros? Sólo el
 * PUESTO Administración o Gerencia. A propósito no mira capacidades ni
 * overrides (acceso_admin_pleno, rol admin): Supervisión y Dirección
 * Operativa no acceden, aunque sí abren el legajo para lo operativo. La base
 * aplica la misma regla (legajo_puede_gestionar); esto sólo evita mostrar
 * pantallas que la base va a rechazar.
 */
export function gestionaDatosSensibles(s: { puesto_organizacional?: string | null } | null | undefined): boolean {
  return s?.puesto_organizacional === 'administracion' || s?.puesto_organizacional === 'gerencia'
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
