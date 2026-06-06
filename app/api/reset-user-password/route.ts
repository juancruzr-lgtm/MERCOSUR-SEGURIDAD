import { NextRequest, NextResponse } from 'next/server'
import { ensureEmployeeAuth, getSupabaseAdmin, normalizeDni, normalizeEmail, requireRole } from '../_lib/employee-auth'

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const adminError = await requireRole(req, admin.client, ['admin'], 'Sesion de administrador requerida')
  if (adminError) return adminError

  try {
    const body = await req.json()
    const usuarioId = body?.usuario_id
    console.log('RESET DNI usuario', usuarioId)

    if (!usuarioId) return NextResponse.json({ error: 'usuario_id es obligatorio' }, { status: 400 })

    const { data: usuario, error: usuarioError } = await admin.client
      .from('usuarios')
      .select('id, nombre, apellido, dni, email, rol, estado, auth_user_id')
      .eq('id', usuarioId)
      .maybeSingle()

    if (usuarioError) return NextResponse.json({ error: usuarioError.message }, { status: 500 })
    if (!usuario) return NextResponse.json({ error: 'Empleado no encontrado' }, { status: 404 })

    if (!normalizeDni(usuario.dni)) {
      return NextResponse.json({ error: 'No se puede resetear: falta DNI del empleado' }, { status: 400 })
    }

    if (!normalizeEmail(usuario.email)) {
      return NextResponse.json({ error: 'No se puede resetear: falta email real del empleado' }, { status: 400 })
    }

    const resultado = await ensureEmployeeAuth(admin.client, usuario)

    if (resultado.action === 'omitido') return NextResponse.json({ error: resultado.reason }, { status: 400 })
    if (resultado.action === 'error') {
      console.error('RESET DNI error', { usuario_id: usuarioId, error: resultado.error })
      return NextResponse.json({ error: resultado.error }, { status: 400 })
    }

    return NextResponse.json({
      ok: true,
      action: resultado.action,
      user: resultado.user,
      message: 'Contraseña reseteada al DNI',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno del servidor'
    console.error('RESET DNI exception', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
