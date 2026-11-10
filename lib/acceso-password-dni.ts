/**
 * lib/acceso-password-dni.ts
 *
 * Contraseña inicial = DNI con cambio obligatorio (migración 20261208100100).
 *
 * Lo decide la BASE, no el navegador:
 *   - mi_acceso_password(): { es_dni, obligatorio } de la propia cuenta. La base
 *     compara el DNI contra el hash de Supabase Auth; nunca ve ni devuelve la
 *     contraseña. "obligatorio" = la cuenta está marcada (alta, restablecida o
 *     lote de Administración) Y la contraseña sigue siendo el DNI.
 *   - mi_acceso_registrar_cambio(): después de cambiarla, registra el cambio si la
 *     base confirma que ya NO es el DNI.
 *
 * Dónde se pide:
 *   - Vigilador: aviso dentro de GuardiaMobile, igual que el del teléfono. Nunca
 *     durante un fichaje: no frena fichajes, alertas ni rondas.
 *   - Supervisión / Administración / Gerencia: AppShell, antes de entrar al panel.
 *
 * Si la consulta falla (sin red, migración sin aplicar) NO se bloquea: se sigue
 * normalmente y se vuelve a preguntar en el próximo ingreso.
 */
import { supabase } from './supabase'

export type EstadoPassword = { es_dni: boolean; obligatorio: boolean }

export async function consultarCambioPassword(): Promise<EstadoPassword | null> {
  try {
    const { data, error } = await supabase.rpc('mi_acceso_password')
    if (error || !data || typeof data !== 'object') return null
    const d = data as Partial<EstadoPassword>
    return { es_dni: d.es_dni === true, obligatorio: d.obligatorio === true }
  } catch {
    return null
  }
}

/** Registra el cambio (sin la contraseña). La base verifica que ya no es el DNI. */
export async function registrarCambioPassword(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('mi_acceso_registrar_cambio')
    return !error && data === true
  } catch {
    return false
  }
}
