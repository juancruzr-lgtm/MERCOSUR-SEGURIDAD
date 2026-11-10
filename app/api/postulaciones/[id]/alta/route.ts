/**
 * POST /api/postulaciones/<id>/alta — ALTA EFECTIVA de un postulante aprobado.
 *
 *   1. La base crea el empleado UNA sola vez (postulacion_alta_efectiva, con la
 *      sesión del usuario: sólo Administración/Gerencia; verifica duplicados por
 *      DNI, CUIL y email; idempotente: un reintento devuelve el mismo empleado).
 *   2. El servidor crea su cuenta de acceso con el mecanismo de siempre
 *      (ensureEmployeeAuth): usuario = email, contraseña inicial = DNI. La deja
 *      marcada "cambio obligatorio": en su primer ingreso la app le pide una
 *      contraseña personal (decisión JC 06/11/2026). No se envía ningún email.
 *   3. Responsable y fecha quedan en postulacion_eventos (alta) y en
 *      accesos_password_eventos (alta_con_dni).
 *
 * Si la creación de la cuenta falla, el empleado ya existe: se reintenta con este
 * mismo botón (no se duplica) o con "Crear acceso" en Guardias.
 */
import { NextRequest, NextResponse } from 'next/server'
import { ensureEmployeeAuth, getBearerToken, getSupabaseAdmin, resolverPerfil } from '../../../_lib/employee-auth'
import { clienteDelUsuario } from '../../../_lib/cliente-usuario'
import { marcarCambioObligatorio } from '../../../_lib/acceso-password'

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
    return NextResponse.json({ usuario_id: alta.usuario_id, ya_existia: alta.ya_existia, acceso: 'error', mensaje: 'Alta hecha, pero no se pudo leer el empleado para crear su acceso. Usá "Crear acceso" en Guardias.' })
  }
  if (empleado.auth_user_id) {
    return NextResponse.json({ usuario_id: alta.usuario_id, ya_existia: alta.ya_existia, acceso: 'ya_tenia', mensaje: 'El alta ya estaba hecha y la persona ya tiene su acceso.' })
  }

  // conservarPassword: nunca toca la contraseña de una cuenta que ya exista.
  const r = await ensureEmployeeAuth(admin.client, empleado, { conservarPassword: true })
  if (r.action === 'creado') {
    const m = await marcarCambioObligatorio(admin.client, empleado.id, 'alta', acceso.perfil.id)
    return NextResponse.json({
      usuario_id: alta.usuario_id, ya_existia: alta.ya_existia, acceso: 'creado',
      mensaje: `Alta hecha. Ingresa con ${empleado.email} y su DNI; en el primer ingreso la app le pide una contraseña personal.`
        + (m.ok ? '' : ' Atención: no se pudo marcar el cambio obligatorio; pedile que la cambie desde su perfil.'),
    })
  }
  if (r.action === 'vinculado' || r.action === 'actualizado') {
    return NextResponse.json({ usuario_id: alta.usuario_id, ya_existia: alta.ya_existia, acceso: 'ya_tenia', mensaje: 'Alta hecha. Ese email ya tenía una cuenta: se vinculó sin cambiar su contraseña.' })
  }
  return NextResponse.json({
    usuario_id: alta.usuario_id, ya_existia: alta.ya_existia, acceso: r.action === 'omitido' ? 'omitido' : 'error',
    mensaje: `Alta hecha, pero no se creó el acceso: ${'reason' in r ? r.reason : 'error' in r ? r.error : ''}. Reintentá con "Dar de alta" o con "Crear acceso" en Guardias.`,
  })
}
