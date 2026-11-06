/**
 * app/api/_lib/acceso-invitacion.ts
 *
 * Acceso por INVITACIÓN (reemplazo de "contraseña inicial = DNI").
 *
 *   - Cuenta nueva: auth.admin.inviteUserByEmail → Supabase manda un email con
 *     un enlace de un solo uso; la persona elige su contraseña en
 *     /dashboard (AppShell, fase 'recuperacion', texto de bienvenida).
 *     La cuenta se crea SIN contraseña: nadie la conoce, ni Administración.
 *   - Cuenta existente (ya vinculada o con el mismo email): se manda el enlace
 *     para crear contraseña (resetPasswordForEmail). La contraseña actual sigue
 *     sirviendo hasta que la persona elija la nueva: no se corta su acceso.
 *
 * Todo queda en public.accesos_invitaciones (quién, a quién, cuándo, resultado).
 * Reintentos: si la invitación ya creó la cuenta, el segundo intento la
 * encuentra por email y manda el enlace de contraseña (no duplica cuentas).
 *
 * Interruptor: ACCESO_POR_INVITACION=1 en el entorno del servidor. Apagado
 * (por defecto) no se envía nada y "Crear acceso"/"Reset DNI" siguen como hoy.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { validarEmail } from '@/lib/auth-mensajes'
import {
  authUserDisponible,
  findAuthUserByEmail,
  motivoSinAcceso,
  normalizeEmail,
  type UsuarioEmpleado,
} from './employee-auth'

export { accesoPorInvitacion } from './acceso-modo'

/** A dónde vuelve el enlace del email. Tiene que estar en Auth → URL Configuration → Redirect URLs. */
export function urlRetornoAcceso(origenPedido: string | null | undefined): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || origenPedido || '').replace(/\/+$/, '')
  return `${base}/dashboard`
}

export type TipoEnvioAcceso = 'invitacion' | 'enlace_password'

export type ResultadoInvitacion =
  | { action: 'invitado' | 'enlace_enviado'; auth_user_id: string; email: string }
  | { action: 'omitido'; motivo: string }
  | { action: 'error'; error: string }

type Opciones = {
  redirectTo: string
  actorId: string | null
  origen: 'alta_postulante' | 'administracion'
  referenciaId?: string | null
}

async function registrar(
  admin: SupabaseClient,
  usuario: UsuarioEmpleado,
  op: Opciones,
  fila: { tipo: TipoEnvioAcceso | null; email: string | null; auth_user_id: string | null; resultado: 'enviado' | 'omitido' | 'error'; detalle: string | null },
) {
  const { error } = await admin.from('accesos_invitaciones').insert({
    usuario_id: usuario.id,
    auth_user_id: fila.auth_user_id,
    email: fila.email,
    tipo: fila.tipo,
    origen: op.origen,
    referencia_id: op.referenciaId ?? null,
    resultado: fila.resultado,
    detalle: fila.detalle ? fila.detalle.slice(0, 300) : null,
    enviado_por: op.actorId,
  })
  if (error) console.error('accesos_invitaciones: no se pudo registrar', { usuario_id: usuario.id, error: error.message })
}

export async function invitarEmpleado(
  admin: SupabaseClient,
  usuario: UsuarioEmpleado,
  op: Opciones,
): Promise<ResultadoInvitacion> {
  const email = normalizeEmail(usuario.email)
  const omitir = async (motivo: string): Promise<ResultadoInvitacion> => {
    await registrar(admin, usuario, op, { tipo: null, email: email || null, auth_user_id: usuario.auth_user_id ?? null, resultado: 'omitido', detalle: motivo })
    return { action: 'omitido', motivo }
  }
  const fallar = async (tipo: TipoEnvioAcceso | null, error: string, authId: string | null = null): Promise<ResultadoInvitacion> => {
    await registrar(admin, usuario, op, { tipo, email, auth_user_id: authId, resultado: 'error', detalle: error })
    return { action: 'error', error }
  }

  if (usuario.rol === 'admin') return omitir('omitido: las cuentas admin no se invitan por este camino')
  const sinAcceso = await motivoSinAcceso(admin, usuario)
  if (sinAcceso) return omitir(sinAcceso)
  if (!email || validarEmail(email)) return omitir('omitido: falta un email válido del empleado')

  // El email es el usuario de ingreso: no puede tenerlo otro empleado.
  const { data: otros, error: otrosError } = await admin
    .from('usuarios').select('id').eq('email', email).neq('id', usuario.id).limit(1)
  if (otrosError) return fallar(null, otrosError.message)
  if ((otros ?? []).length > 0) return omitir('omitido: ese email ya lo usa otro empleado')

  let authId = usuario.auth_user_id || null
  if (!authId) {
    const { user, error } = await findAuthUserByEmail(admin, email)
    if (error) return fallar(null, error.message)
    if (user) {
      const disponible = await authUserDisponible(admin, usuario, user.id)
      if (disponible.error) return fallar(null, disponible.error)
      authId = user.id
      const { error: vinculoError } = await admin.from('usuarios').update({ auth_user_id: authId }).eq('id', usuario.id)
      if (vinculoError) return fallar(null, vinculoError.message, authId)
    }
  }

  if (authId) {
    // Ya tiene cuenta: enlace para elegir contraseña. La actual sigue valiendo.
    const { error } = await admin.auth.resetPasswordForEmail(email, { redirectTo: op.redirectTo })
    if (error) return fallar('enlace_password', error.message, authId)
    await registrar(admin, usuario, op, { tipo: 'enlace_password', email, auth_user_id: authId, resultado: 'enviado', detalle: null })
    return { action: 'enlace_enviado', auth_user_id: authId, email }
  }

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: op.redirectTo,
    data: { usuario_id: usuario.id, nombre: usuario.nombre, apellido: usuario.apellido, rol: usuario.rol },
  })
  if (error || !data?.user) return fallar('invitacion', error?.message || 'No se pudo enviar la invitación')

  const { error: vinculoError } = await admin.from('usuarios').update({ auth_user_id: data.user.id }).eq('id', usuario.id)
  // La invitación ya salió: si el vínculo falla, el reintento encuentra la
  // cuenta por email y la vincula (no se crea otra).
  if (vinculoError) return fallar('invitacion', `Invitación enviada pero sin vincular: ${vinculoError.message}`, data.user.id)

  await registrar(admin, usuario, op, { tipo: 'invitacion', email, auth_user_id: data.user.id, resultado: 'enviado', detalle: null })
  return { action: 'invitado', auth_user_id: data.user.id, email }
}
