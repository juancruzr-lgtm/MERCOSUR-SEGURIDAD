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
    .in('rol', ['guardia', 'vigilador'])
    .single()

  if (!usuario) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const form = await req.formData()
  const libro = form.get('libro') as File | null
  const uniforme = form.get('uniforme') as File | null
  const registroId = form.get('registroId') as string | null

  if (!libro || !uniforme || !registroId) {
    return NextResponse.json({ error: 'Faltan campos: libro, uniforme, registroId' }, { status: 400 })
  }

  const ts = Date.now()
  const pathLibro = `${registroId}/libro_guardia-${ts}.jpg`
  const pathUniforme = `${registroId}/uniforme-${ts}.jpg`

  const [upLibro, upUniforme] = await Promise.all([
    admin.client.storage.from('ingreso-evidencias').upload(pathLibro, libro, { upsert: true, contentType: 'image/jpeg' }),
    admin.client.storage.from('ingreso-evidencias').upload(pathUniforme, uniforme, { upsert: true, contentType: 'image/jpeg' }),
  ])

  if (upLibro.error) return NextResponse.json({ error: upLibro.error.message }, { status: 500 })
  if (upUniforme.error) return NextResponse.json({ error: upUniforme.error.message }, { status: 500 })

  return NextResponse.json({ pathLibro, pathUniforme })
}
