import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, getSupabaseAdmin } from '../../_lib/employee-auth'
import { alcanceDe, tieneCapacidad } from '@/lib/capacidades'
import { validarAuditoriaAlta, MINUTOS_MAX_AUDITORIA_ALTA } from '@/lib/turnos-auditoria-alta'

export const runtime = 'nodejs'

/**
 * Registra el motivo de un turno recién creado desde Reportes.
 *
 * El alta del turno ya queda auditada por el trigger de la base; esta fila
 * agrega el motivo escrito por quien lo creó. Antes el navegador la insertaba
 * directo en turnos_auditoria, que no admite escrituras de usuarios (y usaba
 * una columna inexistente), así que el motivo se perdía en silencio.
 *
 * Controles: sesión activa con gestionar_turnos, turno existente creado hace
 * menos de MINUTOS_MAX_AUDITORIA_ALTA minutos, objetivo dentro del alcance y
 * una sola fila de motivo por turno.
 */
export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const token = getBearerToken(req)
  if (!token) return NextResponse.json({ error: 'Sesión requerida' }, { status: 401 })
  const { data: authData, error: authError } = await admin.client.auth.getUser(token)
  if (authError || !authData.user) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })

  const { data: perfil, error: perfilError } = await admin.client
    .from('usuarios')
    .select('id, rol, estado, puesto_organizacional')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()
  if (perfilError) return NextResponse.json({ error: perfilError.message }, { status: 500 })
  if (!perfil || perfil.estado !== 'activo' || !tieneCapacidad(perfil, 'gestionar_turnos')) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Body inválido' }, { status: 400 }) }
  const datos = validarAuditoriaAlta(body)
  if ('error' in datos) return NextResponse.json({ error: datos.error }, { status: 400 })

  const { data: turno, error: turnoError } = await admin.client
    .from('turnos')
    .select('id, objetivo_id, created_at')
    .eq('id', datos.turno_id)
    .maybeSingle()
  if (turnoError) return NextResponse.json({ error: turnoError.message }, { status: 500 })
  if (!turno) return NextResponse.json({ error: 'Turno no encontrado' }, { status: 404 })

  const edadMin = (Date.now() - new Date(turno.created_at as string).getTime()) / 60000
  if (!(edadMin >= -1 && edadMin <= MINUTOS_MAX_AUDITORIA_ALTA)) {
    return NextResponse.json({ error: 'Sólo se registra el motivo de un turno recién creado' }, { status: 409 })
  }

  if (alcanceDe(perfil) !== 'todas') {
    const { data: misZonas } = await admin.client
      .from('supervisor_zonas').select('zona_id').eq('supervisor_id', perfil.id)
    const zonaIds = new Set((misZonas ?? []).map((z: { zona_id: string }) => z.zona_id))
    const { data: obj } = await admin.client
      .from('objetivos').select('zona_id').eq('id', turno.objetivo_id).maybeSingle()
    if (!obj?.zona_id || !zonaIds.has(obj.zona_id)) {
      return NextResponse.json({ error: 'Objetivo fuera de tu alcance' }, { status: 403 })
    }
  }

  const { data: previa } = await admin.client
    .from('turnos_auditoria')
    .select('id')
    .eq('turno_id', turno.id)
    .eq('campo', 'motivo_alta')
    .limit(1)
  if (previa && previa.length > 0) return NextResponse.json({ ok: true, ya_registrado: true })

  const { error: insError } = await admin.client.from('turnos_auditoria').insert({
    turno_id: turno.id,
    modificado_por: perfil.id,
    campo: 'motivo_alta',
    valor_anterior: null,
    valor_nuevo: `reporte/${datos.origen}`,
    comentario: datos.comentario,
  })
  if (insError) return NextResponse.json({ error: insError.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
