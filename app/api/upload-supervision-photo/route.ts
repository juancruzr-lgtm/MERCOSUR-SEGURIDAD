import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, getSupabaseAdmin } from '../_lib/employee-auth'

export const runtime = 'nodejs'

function storageFileName(nombre: string): string {
  return nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
}

export async function POST(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const token = getBearerToken(req)
  if (!token) return NextResponse.json({ error: 'Sesión requerida' }, { status: 401 })

  const { data: authData, error: authError } = await admin.client.auth.getUser(token)
  if (authError || !authData.user) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })

  const { data: usuario } = await admin.client
    .from('usuarios')
    .select('id, rol')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (!usuario || !['supervisor', 'admin'].includes(usuario.rol ?? '')) {
    return NextResponse.json({ error: 'Acceso restringido a: supervisor, admin' }, { status: 403 })
  }

  // ── Body (multipart) ─────────────────────────────────────────────────────────
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Body inválido (se espera multipart/form-data)' }, { status: 400 })
  }

  const supervisionId = formData.get('supervision_id')
  const foto = formData.get('foto')
  const indexStr = formData.get('index') ?? '0'

  if (!supervisionId || typeof supervisionId !== 'string') {
    return NextResponse.json({ error: 'supervision_id requerido' }, { status: 400 })
  }
  if (!foto || !(foto instanceof Blob)) {
    return NextResponse.json({ error: 'foto requerida' }, { status: 400 })
  }

  // ── Verificar que la supervisión pertenezca al usuario o sea admin ────────────
  const { data: supervision, error: supervisionError } = await admin.client
    .from('supervisiones')
    .select('id, supervisor_id')
    .eq('id', supervisionId)
    .single()

  if (supervisionError || !supervision) {
    return NextResponse.json({ error: 'Supervisión no encontrada' }, { status: 404 })
  }

  if (usuario.rol !== 'admin' && supervision.supervisor_id !== usuario.id) {
    return NextResponse.json({ error: 'No tenés permiso para subir fotos a esta supervisión' }, { status: 403 })
  }

  // ── Subir al bucket usando service role ───────────────────────────────────────
  const nombre = foto instanceof File ? foto.name : 'foto.jpg'
  const index = Number(indexStr) || 0
  const path = `${supervisionId}/${Date.now()}-${index}-${storageFileName(nombre)}`

  const buffer = Buffer.from(await foto.arrayBuffer())
  const contentType = foto.type || 'image/jpeg'

  const { error: uploadError } = await admin.client.storage
    .from('supervision-fotos')
    .upload(path, buffer, { contentType, upsert: false })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  // ── Registrar en supervision_fotos ────────────────────────────────────────────
  const { data: fotoRegistrada, error: insertError } = await admin.client
    .from('supervision_fotos')
    .insert({ supervision_id: supervisionId, storage_path: path })
    .select('id, supervision_id, storage_path, created_at')
    .single()

  if (insertError) {
    // Foto ya subida al bucket — limpiar para evitar huérfanos
    await admin.client.storage.from('supervision-fotos').remove([path])
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ foto: fotoRegistrada })
}
