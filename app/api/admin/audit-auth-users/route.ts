import { NextRequest, NextResponse } from 'next/server'
import { auditAuthUsers } from '../../_lib/auth-repair'
import { getSupabaseAdmin, requireRole } from '../../_lib/employee-auth'

export async function GET(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const adminError = await requireRole(req, admin.client, ['admin'], 'Sesion de administrador requerida')
  if (adminError) return adminError

  try {
    const { searchParams } = new URL(req.url)
    const usuarioId = searchParams.get('usuario_id')
    const email = searchParams.get('email')
    const { report } = await auditAuthUsers(admin.client, { usuario_id: usuarioId, email })

    return NextResponse.json({
      ok: true,
      report,
      message: report.admin_api_error
        ? `Auditoria parcial: Supabase Auth Admin API devolvio: ${report.admin_api_error}`
        : 'Auditoria Auth completada.',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno del servidor'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
