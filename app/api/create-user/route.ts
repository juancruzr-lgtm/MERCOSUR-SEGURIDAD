import { NextRequest, NextResponse } from 'next/server'
import { ensureEmployeeAuth, getSupabaseAdmin, requireRole } from '../_lib/employee-auth'

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const adminError = await requireRole(req, admin.client, ['admin'], 'Sesion de administrador requerida')
  if (adminError) return adminError

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

    const resultado = await ensureEmployeeAuth(admin.client, usuario)

    if (resultado.action === 'omitido') return NextResponse.json({ error: resultado.reason }, { status: 400 })
    if (resultado.action === 'error') return NextResponse.json({ error: resultado.error }, { status: 400 })

    const message =
      resultado.action === 'creado'
        ? 'Usuario Auth creado correctamente'
        : resultado.action === 'vinculado'
          ? 'Usuario Auth vinculado correctamente'
          : 'El empleado ya tenia usuario Auth; acceso reparado correctamente'

    return NextResponse.json({
      ok: true,
      action: resultado.action,
      user: resultado.user,
      message,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno del servidor'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
