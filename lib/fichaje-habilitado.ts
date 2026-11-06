/**
 * lib/fichaje-habilitado.ts
 *
 * Quién puede registrar un fichaje (entrada, salida o sus evidencias).
 * Espejo en TypeScript de public.actor_activo_actual() (migración
 * 20261208100000_fichaje_solo_activos): la base es la que manda; esto sólo
 * evita llamadas inútiles y da un mensaje claro en las rutas del servidor.
 */
export type PerfilFichaje = {
  estado?: string | null
  acceso_bloqueado?: boolean | null
}

export function puedeFichar(perfil: PerfilFichaje | null | undefined): boolean {
  if (!perfil) return false
  return perfil.estado === 'activo' && !perfil.acceso_bloqueado
}
