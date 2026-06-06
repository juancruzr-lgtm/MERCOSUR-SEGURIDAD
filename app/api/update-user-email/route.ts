import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin, normalizeEmail, requireRole } from '../_lib/employee-auth'

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const adminError = await requireRole(req, admin.client, ['admin'], 'Sesion de administrador requerida')
  if (adminError) return adminError

  try {
    const body = await req.json()
    const usuarioId = body?.usuario_id
    const email = normalizeEmail(body?.email)

    if (!usuarioId) return NextResponse.json({ error: 'usuario_id es obligatorio' }, { status: 400 })
    if (!email) return NextResponse.json({ error: 'email es obligatorio' }, { status: 400 })

    const { data: usuario, error: usuarioError } = await admin.client
      .from('usuarios')
      .select('id, auth_user_id')
      .eq('id', usuarioId)
      .maybeSingle()

    if (usuarioError) return NextResponse.json({ error: usuarioError.message }, { status: 500 })
    if (!usuario) return NextResponse.json({ error: 'Empleado no encontrado' }, { status: 404 })

    if (usuario.auth_user_id) {
      const { error: authError } = await admin.client.auth.admin.updateUserById(usuario.auth_user_id, { email })
      if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    const { data: actualizado, error: updateError } = await admin.client
      .from('usuarios')
      .update({ email })
      .eq('id', usuarioId)
      .select('id, nombre, apellido, dni, email, telefono, legajo, rol, estado, foto_url, auth_user_id, created_at')
      .single()

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

    return NextResponse.json({ ok: true, user: actualizado, message: 'Email sincronizado correctamente' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno del servidor'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
