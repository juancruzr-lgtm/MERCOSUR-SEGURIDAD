/**
 * POST /api/postulaciones/<id>/alta — ALTA EFECTIVA de un postulante aprobado.
 *
 *   1. La base crea el empleado UNA sola vez (postulacion_alta_efectiva, con la
 *      sesión del usuario: sólo Administración/Gerencia; verifica duplicados por
 *      DNI, CUIL y email; idempotente: un reintento devuelve el mismo empleado).
 *   2. Con ACCESO_POR_INVITACION=1, el servidor envía la invitación para que la
 *      persona elija su contraseña (sin DNI ni contraseñas compartidas). Si está
 *      apagado, el alta queda hecha y la invitación "pendiente de habilitación".
 *   3. Responsable, fecha y resultado quedan en postulacion_eventos (alta) y en
 *      accesos_invitaciones (invitación).
 *
 * Si la invitación falla, el empleado ya existe: se reintenta con "Reenviar
 * invitación" (o este mismo endpoint), sin duplicar nada.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, getSupabaseAdmin, resolverPerfil } from '../../../_lib/employee-auth'
import { clienteDelUsuario } from '../../../_lib/cliente-usuario'
import { accesoPorInvitacion, invitarEmpleado, urlRetornoAcceso } from '../../../_lib/acceso-invitacion'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return NextResponse.json({ error: 'Postulación inválida' }, { status: 400 })
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })
  const acceso = await resolverPerfil(req, admin.client)
  if ('respuesta' in acceso) return acceso.respuesta
  const usuario = clienteDelUsuario(getBearerToken(req) || '')
  if (!usuario) return NextResponse.json({ error: 'Configuración de Supabase incompleta' }, { status: 500 })

  const { data, error } = await usuario.rpc('postulacion_alta_efectiva', { p_id: params.id })
  if (error) {
    const status = /Sólo Administración|autoriz/i.test(error.message) ? 403 : /ya existe|duplic/i.test(error.message) ? 409 : 400
    return NextResponse.json({ error: error.message }, { status })
  }
  const alta = data as { usuario_id: string; ya_existia: boolean }

  const { data: empleado, error: empError } = await admin.client
    .from('usuarios').select('id, nombre, apellido, dni, email, rol, estado, auth_user_id').eq('id', alta.usuario_id).maybeSingle()
  if (empError || !empleado) {
    return NextResponse.json({ usuario_id: alta.usuario_id, ya_existia: alta.ya_existia, invitacion: 'error', mensaje: 'Alta hecha; no se pudo leer el empleado para invitarlo' })
  }

  if (!accesoPorInvitacion()) {
    return NextResponse.json({
      usuario_id: alta.usuario_id, ya_existia: alta.ya_existia, invitacion: 'pendiente_habilitacion',
      mensaje: 'Alta efectiva registrada. La invitación de acceso se enviará cuando Gerencia habilite el acceso por invitación.',
    })
  }
  if (alta.ya_existia && empleado.auth_user_id) {
    return NextResponse.json({ usuario_id: alta.usuario_id, ya_existia: true, invitacion: 'omitida', mensaje: 'El alta ya estaba hecha y la persona ya tiene cuenta. Si no la usó, reenviá el enlace desde Guardias.' })
  }

  const r = await invitarEmpleado(admin.client, empleado, {
    redirectTo: urlRetornoAcceso(req.nextUrl.origin),
    actorId: acceso.perfil.id,
    origen: 'alta_postulante',
    referenciaId: params.id,
  })
  if (r.action === 'invitado') return NextResponse.json({ usuario_id: alta.usuario_id, ya_existia: alta.ya_existia, invitacion: 'enviada', mensaje: `Alta hecha. Invitación enviada a ${r.email}.` })
  if (r.action === 'enlace_enviado') return NextResponse.json({ usuario_id: alta.usuario_id, ya_existia: alta.ya_existia, invitacion: 'enlace_enviado', mensaje: `Alta hecha. Enlace para crear contraseña enviado a ${r.email}.` })
  return NextResponse.json({
    usuario_id: alta.usuario_id, ya_existia: alta.ya_existia, invitacion: r.action === 'omitido' ? 'omitida' : 'error',
    mensaje: `Alta hecha, pero la invitación no salió: ${'motivo' in r ? r.motivo : 'error' in r ? r.error : ''}. Reintentá con "Dar de alta" o desde Guardias.`,
  })
}
