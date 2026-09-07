import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, getSupabaseAdmin } from '../_lib/employee-auth'

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const token = getBearerToken(req)
  if (!token) return NextResponse.json({ error: 'Sesion requerida' }, { status: 401 })

  const { data: authData, error: authError } = await admin.client.auth.getUser(token)
  if (authError || !authData.user) return NextResponse.json({ error: 'Sesion invalida' }, { status: 401 })

  const { data: usuario } = await admin.client
    .from('usuarios')
    .select('id, rol')
    .eq('auth_user_id', authData.user.id)
    .in('rol', ['supervisor', 'admin'])
    .single()

  if (!usuario) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Body invalido' }, { status: 400 })

  const { id, objetivo_id, supervisor_id, plantilla_id, lat, lng, precision_gps, estado, observaciones, respuestas } = body

  if (!objetivo_id || !supervisor_id || !estado) {
    return NextResponse.json({ error: 'Faltan campos: objetivo_id, supervisor_id, estado' }, { status: 400 })
  }

  // Idempotencia: el cliente genera el id UNA vez por intento de carga. Si la
  // respuesta se pierde (timeout) y el supervisor reintenta, el mismo id choca
  // con la PK y se devuelve la supervision ya creada en vez de duplicarla —
  // este era el origen real de las supervisiones repetidas.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const idCliente = typeof id === 'string' && UUID_RE.test(id) ? id.toLowerCase() : null

  const { data: supervision, error: supervisionError } = await admin.client
    .from('supervisiones')
    .insert({ ...(idCliente ? { id: idCliente } : {}), objetivo_id, supervisor_id, plantilla_id: plantilla_id || null, lat, lng, precision_gps, estado, observaciones: observaciones || null })
    .select('*, objetivo:objetivos(nombre)')
    .single()

  if (supervisionError) {
    if (idCliente && supervisionError.code === '23505') {
      const { data: existente } = await admin.client
        .from('supervisiones')
        .select('*, objetivo:objetivos(nombre)')
        .eq('id', idCliente)
        .maybeSingle()
      if (existente) {
        // Reintento de una carga que ya llegó. Si la primera corrida murió
        // entre la supervision y sus respuestas, las respuestas se completan
        // acá; si ya están, no se duplican.
        if (Array.isArray(respuestas) && respuestas.length > 0) {
          const { data: yaTiene } = await admin.client
            .from('supervision_respuestas')
            .select('id')
            .eq('supervision_id', existente.id)
            .limit(1)
          if (!yaTiene || yaTiene.length === 0) {
            await admin.client.from('supervision_respuestas').insert(
              respuestas.map((r: { item_id: string; resultado: string; observacion?: string | null }) => ({
                supervision_id: existente.id,
                item_id: r.item_id,
                resultado: r.resultado,
                observacion: r.observacion?.trim() || null,
              })),
            )
          }
        }
        return NextResponse.json({ supervision: existente, reintento: true })
      }
    }
    return NextResponse.json({ error: supervisionError.message }, { status: 500 })
  }
  if (!supervision) return NextResponse.json({ error: 'No se pudo crear la supervision' }, { status: 500 })

  if (Array.isArray(respuestas) && respuestas.length > 0) {
    const { error: respuestasError } = await admin.client
      .from('supervision_respuestas')
      .insert(respuestas.map((r: { item_id: string; resultado: string; observacion?: string | null }) => ({
        supervision_id: supervision.id,
        item_id: r.item_id,
        resultado: r.resultado,
        observacion: r.observacion?.trim() || null,
      })))

    if (respuestasError) {
      await admin.client.from('supervisiones').delete().eq('id', supervision.id)
      return NextResponse.json({ error: respuestasError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ supervision })
}
