/**
 * POST /api/reset-user-password { usuario_id } — RESTABLECER CONTRASEÑA.
 *
 * Procedimiento de recuperación cuando un empleado olvida su contraseña. Sólo
 * Administración/Gerencia (gestionar_personal). La contraseña vuelve al DNI y
 * queda "cambio obligatorio": en su próximo ingreso la app le pide una nueva
 * (al vigilador, fuera de los fichajes). Queda registrado quién lo hizo y cuándo
 * (accesos_password_eventos), nunca la contraseña.
 */
import { NextRequest, NextResponse } from 'next/server'
import { tieneCapacidad } from '@/lib/capacidades'
import { repairEmployeeAuthUser } from '../_lib/auth-repair'
import { getSupabaseAdmin, normalizeDni, normalizeEmail, resolverPerfil } from '../_lib/employee-auth'
import { marcarCambioObligatorio } from '../_lib/acceso-password'

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const acceso = await resolverPerfil(req, admin.client)
  if ('respuesta' in acceso) return acceso.respuesta
  if (!tieneCapacidad(acceso.perfil, 'gestionar_personal')) {
    return NextResponse.json({ error: 'Sólo Administración o Gerencia restablecen contraseñas' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const usuarioId = body?.usuario_id

    if (!usuarioId) return NextResponse.json({ error: 'usuario_id es obligatorio' }, { status: 400 })

    const { data: usuario, error: usuarioError } = await admin.client
      .from('usuarios')
      .select('id, nombre, apellido, dni, email, rol, estado, auth_user_id')
      .eq('id', usuarioId)
      .maybeSingle()

    if (usuarioError) return NextResponse.json({ error: usuarioError.message }, { status: 500 })
    if (!usuario) return NextResponse.json({ error: 'Empleado no encontrado' }, { status: 404 })

    if (!normalizeDni(usuario.dni)) {
      return NextResponse.json({ error: 'No se puede restablecer: falta el DNI del empleado' }, { status: 400 })
    }

    if (!normalizeEmail(usuario.email)) {
      return NextResponse.json({ error: 'No se puede restablecer: falta el email real del empleado' }, { status: 400 })
    }

    const resultado = await repairEmployeeAuthUser(admin.client, usuario, undefined, { resetearPassword: true })

    if (resultado.action === 'omitido') return NextResponse.json({ error: resultado.motivo }, { status: 400 })
    if (resultado.action === 'error') {
      console.error('Restablecer contraseña: error', { usuario_id: usuarioId, error: resultado.error })
      return NextResponse.json({ error: resultado.error }, { status: 400 })
    }

    const m = await marcarCambioObligatorio(admin.client, usuario.id, 'restablecida', acceso.perfil.id)

    return NextResponse.json({
      ok: true,
      action: resultado.action,
      user: resultado.user,
      message: m.ok
        ? 'Contraseña restablecida: ingresa con su DNI y en ese momento tiene que elegir una nueva.'
        : 'Contraseña restablecida al DNI, pero no se pudo marcar el cambio obligatorio. Avisale que la cambie desde su perfil.',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno del servidor'
    console.error('Restablecer contraseña: excepción', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
