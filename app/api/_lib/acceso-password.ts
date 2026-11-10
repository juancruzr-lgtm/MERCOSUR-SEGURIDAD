/**
 * app/api/_lib/acceso-password.ts
 *
 * Contraseña inicial = DNI con cambio obligatorio (migración 20261208100100).
 * Cuando el servidor deja a una persona con el DNI como contraseña (cuenta nueva
 * o restablecida por Administración), la marca "cambio obligatorio" y registra
 * el evento. En su próximo ingreso la app le pide una contraseña personal.
 * Nunca se guarda ni se registra la contraseña.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export type MotivoDni = 'alta' | 'restablecida'

export async function marcarCambioObligatorio(
  admin: SupabaseClient,
  usuarioId: string,
  motivo: MotivoDni,
  actorId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const ahora = new Date().toISOString()
  const { error } = await admin.from('accesos_password').upsert({
    usuario_id: usuarioId,
    cambio_obligatorio: true,
    obligatorio_desde: ahora,
    motivo,
    marcado_por: actorId,
  }, { onConflict: 'usuario_id' })
  if (error) {
    // La cuenta ya quedó con el DNI: si no se pudo marcar, se avisa (no se oculta).
    console.error('accesos_password: no se pudo marcar el cambio obligatorio', { usuario_id: usuarioId, error: error.message })
    return { ok: false, error: error.message }
  }
  const { error: evError } = await admin.from('accesos_password_eventos').insert({
    usuario_id: usuarioId,
    evento: motivo === 'alta' ? 'alta_con_dni' : 'restablecida_a_dni',
    actor: actorId,
  })
  if (evError) console.error('accesos_password_eventos: no se pudo registrar', { usuario_id: usuarioId, error: evError.message })
  return { ok: true }
}
