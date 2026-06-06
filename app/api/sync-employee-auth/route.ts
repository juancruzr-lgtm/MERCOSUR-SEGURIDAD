import { NextRequest, NextResponse } from 'next/server'
import { ensureEmployeeAuth, getSupabaseAdmin, nombreEmpleado, requireRole, type UsuarioEmpleado } from '../_lib/employee-auth'

type Omitido = { usuario_id: string, empleado: string, motivo: string }
type ErrorSync = { usuario_id: string, empleado: string, error: string }

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const adminError = await requireRole(req, admin.client, ['admin'], 'Sesion de administrador requerida')
  if (adminError) return adminError

  const { data: usuarios, error: usuariosError } = await admin.client
    .from('usuarios')
    .select('id, nombre, apellido, dni, email, rol, estado, auth_user_id')
    .neq('rol', 'admin')
    .order('apellido')

  if (usuariosError) return NextResponse.json({ error: usuariosError.message }, { status: 500 })

  const omitidos: Omitido[] = []
  const errores: ErrorSync[] = []
  const summary = {
    creados: 0,
    actualizados: 0,
    vinculados: 0,
    omitidos: 0,
    errores: 0,
  }

  for (const usuario of (usuarios || []) as UsuarioEmpleado[]) {
    const resultado = await ensureEmployeeAuth(admin.client, usuario)

    if (resultado.action === 'creado') summary.creados += 1
    if (resultado.action === 'actualizado') summary.actualizados += 1
    if (resultado.action === 'vinculado') summary.vinculados += 1

    if (resultado.action === 'omitido') {
      omitidos.push({
        usuario_id: usuario.id,
        empleado: nombreEmpleado(usuario),
        motivo: resultado.reason,
      })
    }

    if (resultado.action === 'error') {
      errores.push({
        usuario_id: usuario.id,
        empleado: nombreEmpleado(usuario),
        error: resultado.error,
      })
    }
  }

  summary.omitidos = omitidos.length
  summary.errores = errores.length

  const { data: users } = await admin.client
    .from('usuarios')
    .select('id, nombre, apellido, dni, email, telefono, legajo, rol, estado, foto_url, auth_user_id, created_at')
    .order('apellido')

  return NextResponse.json({
    ok: true,
    summary,
    omitidos,
    errores,
    users: users || [],
    message: `Accesos sincronizados: ${summary.creados} creados, ${summary.actualizados} actualizados, ${summary.vinculados} vinculados, ${summary.omitidos} omitidos, ${summary.errores} errores.`,
  })
}
