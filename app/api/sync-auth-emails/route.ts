import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin, nombreEmpleado, normalizeEmail, requireRole, type UsuarioEmpleado } from '../_lib/employee-auth'

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const adminError = await requireRole(req, admin.client, ['admin'], 'Sesion de administrador requerida')
  if (adminError) return adminError

  const { data: usuarios, error: usuariosError } = await admin.client
    .from('usuarios')
    .select('id, nombre, apellido, dni, email, telefono, legajo, rol, estado, foto_url, auth_user_id, created_at')
    .not('auth_user_id', 'is', null)
    .order('apellido')

  if (usuariosError) return NextResponse.json({ error: usuariosError.message }, { status: 500 })

  const actualizados: UsuarioEmpleado[] = []
  const errores: Array<{ usuario_id: string, empleado: string, error: string }> = []
  let sincronizados = 0
  let sinAuth = 0

  for (const usuario of (usuarios || []) as UsuarioEmpleado[]) {
    const { data: authData, error: authError } = await admin.client.auth.admin.getUserById(usuario.auth_user_id!)
    const authEmail = normalizeEmail(authData?.user?.email)

    if (authError || !authEmail) {
      sinAuth += 1
      if (authError) {
        errores.push({
          usuario_id: usuario.id,
          empleado: nombreEmpleado(usuario),
          error: authError.message,
        })
      }
      actualizados.push(usuario)
      continue
    }

    if (normalizeEmail(usuario.email) === authEmail) {
      actualizados.push(usuario)
      continue
    }

    const { data: actualizado, error: updateError } = await admin.client
      .from('usuarios')
      .update({ email: authEmail })
      .eq('id', usuario.id)
      .select('id, nombre, apellido, dni, email, telefono, legajo, rol, estado, foto_url, auth_user_id, created_at')
      .single()

    if (updateError || !actualizado) {
      errores.push({
        usuario_id: usuario.id,
        empleado: nombreEmpleado(usuario),
        error: updateError?.message || 'No se pudo actualizar usuarios.email',
      })
      actualizados.push(usuario)
    } else {
      sincronizados += 1
      actualizados.push(actualizado)
    }
  }

  return NextResponse.json({
    ok: true,
    summary: {
      sincronizados,
      sin_auth: sinAuth,
      errores: errores.length,
    },
    errores,
    users: actualizados,
    message: `Emails Auth sincronizados: ${sincronizados}. Sin Auth: ${sinAuth}. Errores: ${errores.length}.`,
  })
}
