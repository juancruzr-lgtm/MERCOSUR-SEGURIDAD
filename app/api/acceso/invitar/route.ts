/**
 * POST /api/acceso/invitar  { usuario_id }
 *
 * Envía la invitación (cuenta nueva) o el enlace para crear contraseña (cuenta
 * existente) a UN empleado. Sólo Administración/Gerencia (gestionar_personal).
 * Supervisión no crea ni invita cuentas.
 *
 * Apagado mientras ACCESO_POR_INVITACION no sea "1": no envía nada.
 */
import { NextRequest, NextResponse } from 'next/server'
import { tieneCapacidad } from '@/lib/capacidades'
import { getSupabaseAdmin, resolverPerfil } from '../../_lib/employee-auth'
import { accesoPorInvitacion, invitarEmpleado, urlRetornoAcceso } from '../../_lib/acceso-invitacion'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const acceso = await resolverPerfil(req, admin.client)
  if ('respuesta' in acceso) return acceso.respuesta
  if (!tieneCapacidad(acceso.perfil, 'gestionar_personal')) {
    return NextResponse.json({ error: 'Sólo Administración o Gerencia envían invitaciones de acceso' }, { status: 403 })
  }
  if (!accesoPorInvitacion()) {
    return NextResponse.json({ error: 'El acceso por invitación todavía no está habilitado' }, { status: 409 })
  }

  let usuarioId: unknown
  try { usuarioId = (await req.json())?.usuario_id } catch { /* body inválido */ }
  if (typeof usuarioId !== 'string' || !usuarioId) return NextResponse.json({ error: 'usuario_id es obligatorio' }, { status: 400 })

  const { data: usuario, error } = await admin.client
    .from('usuarios')
    .select('id, nombre, apellido, dni, email, rol, estado, auth_user_id')
    .eq('id', usuarioId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!usuario) return NextResponse.json({ error: 'Empleado no encontrado' }, { status: 404 })

  const r = await invitarEmpleado(admin.client, usuario, {
    redirectTo: urlRetornoAcceso(req.nextUrl.origin),
    actorId: acceso.perfil.id,
    origen: 'administracion',
  })
  if (r.action === 'omitido') return NextResponse.json({ error: r.motivo }, { status: 400 })
  if (r.action === 'error') return NextResponse.json({ error: r.error }, { status: 502 })
  return NextResponse.json({
    ok: true,
    action: r.action,
    message: r.action === 'invitado'
      ? `Invitación enviada a ${r.email}`
      : `Enlace para crear contraseña enviado a ${r.email}`,
  })
}
