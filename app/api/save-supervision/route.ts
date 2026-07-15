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

  const { objetivo_id, supervisor_id, plantilla_id, lat, lng, precision_gps, estado, observaciones, respuestas } = body

  if (!objetivo_id || !supervisor_id || !estado) {
    return NextResponse.json({ error: 'Faltan campos: objetivo_id, supervisor_id, estado' }, { status: 400 })
  }

  const { data: supervision, error: supervisionError } = await admin.client
    .from('supervisiones')
    .insert({ objetivo_id, supervisor_id, plantilla_id: plantilla_id || null, lat, lng, precision_gps, estado, observaciones: observaciones || null })
    .select('*, objetivo:objetivos(nombre)')
    .single()

  if (supervisionError) return NextResponse.json({ error: supervisionError.message }, { status: 500 })
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
