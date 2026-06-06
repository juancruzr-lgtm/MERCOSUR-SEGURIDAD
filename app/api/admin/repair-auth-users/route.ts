import { NextRequest, NextResponse } from 'next/server'
import { auditAuthUsers, repairEmployeeAuthUser, summarizeRepairs } from '../../_lib/auth-repair'
import { getSupabaseAdmin, requireRole } from '../../_lib/employee-auth'

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const adminError = await requireRole(req, admin.client, ['admin'], 'Sesion de administrador requerida')
  if (adminError) return adminError

  try {
    const body = await req.json().catch(() => ({}))
    const usuarioId = body?.usuario_id || null
    const email = body?.email || null
    const confirm = body?.confirm === true
    const repairAll = body?.repair_all === true
    const invalidAuthUserIds = Array.isArray(body?.invalid_auth_user_ids)
      ? body.invalid_auth_user_ids.filter(Boolean)
      : body?.invalid_auth_user_id
        ? [body.invalid_auth_user_id]
        : []

    if (!usuarioId && !email && !repairAll) {
      const { report } = await auditAuthUsers(admin.client)
      return NextResponse.json({
        ok: false,
        dry_run: true,
        report,
        error: 'Para reparar masivamente envie repair_all=true y confirm=true. Para reparar un empleado envie usuario_id o email y confirm=true.',
      }, { status: 400 })
    }

    const { report, users, authIndex } = await auditAuthUsers(admin.client, { usuario_id: usuarioId, email })

    if (!confirm) {
      return NextResponse.json({
        ok: true,
        dry_run: true,
        report,
        summary: {
          auditados: users.length,
          reparados: 0,
          recreados: 0,
          creados: 0,
          vinculados: 0,
          omitidos: 0,
          errores: 0,
          duplicados_eliminados: 0,
        },
        message: 'Auditoria lista. No se modifico Auth porque falta confirm=true.',
      })
    }

    const results = []
    for (const usuario of users) {
      results.push(await repairEmployeeAuthUser(admin.client, usuario, authIndex, {
        invalidAuthUserIds: repairAll ? [] : invalidAuthUserIds,
      }))
    }

    const summary = summarizeRepairs(results)
    const { data: refreshedUsers } = await admin.client
      .from('usuarios')
      .select('id, nombre, apellido, dni, email, telefono, legajo, rol, estado, foto_url, auth_user_id, created_at')
      .order('apellido')

    return NextResponse.json({
      ok: true,
      dry_run: false,
      report,
      summary,
      results,
      users: refreshedUsers || [],
      message: `Reparacion Auth finalizada: ${summary.reparados} reparados, ${summary.recreados} recreados, ${summary.creados} creados, ${summary.vinculados} vinculados, ${summary.omitidos} omitidos, ${summary.errores} errores.`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno del servidor'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
