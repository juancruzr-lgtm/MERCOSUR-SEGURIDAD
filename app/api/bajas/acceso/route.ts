/**
 * /api/bajas/acceso — acceso de una persona con baja laboral.
 *
 *   POST { empleado_id, accion: 'reintentar_bloqueo' }               (Administración / Gerencia)
 *     Vuelve a aplicar el ban en Auth a quien ya tiene el acceso bloqueado en la
 *     base (por si falló al confirmar).
 *   POST { empleado_id, accion: 'rehabilitar', motivo }               (sólo Gerencia)
 *     RPC acceso_rehabilitar (motivo, historial) y quita el ban en Auth. No
 *     reactiva la situación laboral: eso es otro paso.
 */
import { NextRequest, NextResponse } from 'next/server'
import { SIN_CACHE, clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { bloquearAccesoAuth, desbloquearAccesoAuth } from '@/app/api/_lib/employee-auth'

export const runtime = 'nodejs'
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

const responder = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE })

export async function POST(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)
  const body = await req.json().catch(() => null) as { empleado_id?: string; accion?: string; motivo?: string } | null
  const empleadoId = body?.empleado_id
  if (!empleadoId || !/^[0-9a-f-]{36}$/i.test(empleadoId)) return responder({ error: 'Falta la persona' }, 400)

  if (body?.accion === 'reintentar_bloqueo') {
    const { data: gestiona } = await c.usuario.rpc('legajo_puede_gestionar')
    if (gestiona !== true) return responder({ error: 'No autorizado' }, 403)
    const { data: u } = await c.admin.from('usuarios').select('auth_user_id, acceso_bloqueado').eq('id', empleadoId).maybeSingle()
    const fila = u as { auth_user_id?: string | null; acceso_bloqueado?: boolean } | null
    if (!fila?.acceso_bloqueado) return responder({ error: 'La persona no tiene el acceso bloqueado por una baja' }, 400)
    if (!fila.auth_user_id) return responder({ auth: 'sin_cuenta' })
    const { error } = await bloquearAccesoAuth(c.admin, fila.auth_user_id)
    if (error) return responder({ error: error.message }, 502)
    await c.admin.rpc('baja_registrar_bloqueo_auth', { p_empleado_id: empleadoId, p_bloqueado: true })
    return responder({ auth: 'bloqueado' })
  }

  if (body?.accion === 'rehabilitar') {
    const { data, error } = await c.usuario.rpc('acceso_rehabilitar', { p_empleado_id: empleadoId, p_motivo: body.motivo ?? '' })
    if (error) return responder({ error: error.message }, /Gerencia/.test(error.message) ? 403 : 400)
    const authUserId = (data as { auth_user_id?: string | null } | null)?.auth_user_id
    if (authUserId) {
      const { error: e } = await desbloquearAccesoAuth(c.admin, authUserId)
      if (e) return responder({ error: `Se rehabilitó en la base pero no en Auth: ${e.message}` }, 502)
      await c.admin.rpc('baja_registrar_bloqueo_auth', { p_empleado_id: empleadoId, p_bloqueado: false })
    }
    return responder({ ok: true })
  }

  return responder({ error: 'Acción inválida' }, 400)
}
