/**
 * lib/gps-vehiculos/permisos.ts — quién ve y gestiona Vehículos de supervisión.
 *
 * Espejo de UI de `gps_vehiculos_puede_ver_actual()` (la base es la que decide,
 * con RLS). Política inicial, deliberadamente cerrada:
 *   · Gerencia (puesto) y delegación gerencial vigente: ven y gestionan todo.
 *   · Administración, Dirección Operativa, Jefe de Supervisores: NO por defecto.
 *     Revisado contra lib/capacidades.ts: ninguna capacidad existente cubre
 *     ubicación de vehículos; abrirles acceso es una decisión de Gerencia.
 *   · Supervisores: NO ven ubicaciones de vehículos (ni el propio, en esta fase).
 *   · Override acceso_admin_pleno y admin legado sin puesto: NO (fail-closed).
 *
 * Se mantiene fuera de lib/capacidades.ts para no tocar el mapa de capacidades
 * compartido por otros módulos mientras la política no esté confirmada.
 */
import { puestoDe, type SujetoAcceso } from '@/lib/capacidades'

export function puedeVerVehiculosSupervision(u: SujetoAcceso | null | undefined): boolean {
  if (!u) return false
  return puestoDe(u) === 'gerencia' || u.acceso_gerencia_delegado === true
}

export function puedeGestionarVehiculosSupervision(u: SujetoAcceso | null | undefined): boolean {
  return puedeVerVehiculosSupervision(u)
}
