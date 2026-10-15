/**
 * /api/tareas-turno/foto — foto de una tarea del turno.
 *
 *   POST multipart { registroId, foto }  → sube la foto (sólo el vigilador
 *        dueño del registro, tarea que pide foto, marcada como hecha, sin foto).
 *   GET  ?registro=<id>                  → enlace firmado de 60 s (el propio
 *        vigilador o quien gestiona el objetivo).
 *
 * Quién puede lo decide la base con la identidad de quien llama
 * (tareas_turno_destino_foto / tareas_turno_ver_foto). Esta ruta sólo sube o
 * firma con la clave de servicio lo que la base ya autorizó, y la fila de
 * `evidencias` la vuelve a validar un trigger (ruta, bucket y metadatos).
 * La foto NO pasa por el análisis de IA (tipo 'tarea_turno').
 */
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, getSupabaseAdmin } from '../../_lib/employee-auth'
import { firmaImagenValida, validarFotoOperativa } from '../../_lib/validar-foto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_FOTO_BYTES = 5 * 1024 * 1024
const MIME_PERMITIDOS = new Set(['image/jpeg', 'image/png', 'image/webp'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const URL_FIRMA_SEGUNDOS = 60

function clienteDelUsuario(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })
  const token = getBearerToken(req)
  if (!token) return NextResponse.json({ error: 'Sesión requerida' }, { status: 401 })
  const usuario = clienteDelUsuario(token)
  if (!usuario) return NextResponse.json({ error: 'Configuración de Supabase incompleta' }, { status: 500 })

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Se espera multipart/form-data' }, { status: 400 })
  }
  const registroId = form.get('registroId')
  const foto = form.get('foto')
  if (typeof registroId !== 'string' || !UUID_RE.test(registroId)) {
    return NextResponse.json({ error: 'Registro inválido' }, { status: 400 })
  }
  if (!(foto instanceof Blob) || foto.size <= 0) return NextResponse.json({ error: 'Foto requerida' }, { status: 400 })
  if (foto.size > MAX_FOTO_BYTES) return NextResponse.json({ error: 'La foto supera el límite de 5 MB' }, { status: 413 })
  if (!MIME_PERMITIDOS.has(foto.type)) return NextResponse.json({ error: 'Formato de imagen no permitido' }, { status: 415 })

  // La base decide: registro propio, tarea con foto, hecha y sin foto previa.
  const destino = await usuario.rpc('tareas_turno_destino_foto', { p_registro_id: registroId })
  if (destino.error || !destino.data) {
    return NextResponse.json({ error: destino.error?.message ?? 'No autorizado' }, { status: destino.error?.code === '42501' ? 403 : 409 })
  }
  const { bucket, storage_path: storagePath } = destino.data as { bucket: string; storage_path: string }

  const buffer = Buffer.from(await foto.arrayBuffer())
  if (!firmaImagenValida(buffer, foto.type)) {
    return NextResponse.json({ error: 'El contenido del archivo no coincide con una imagen válida' }, { status: 415 })
  }
  const huella = validarFotoOperativa(buffer, MAX_FOTO_BYTES)
  if (!huella.ok) return NextResponse.json({ error: huella.error }, { status: huella.status })

  const subida = await admin.client.storage.from(bucket).upload(storagePath, buffer, {
    upsert: true, contentType: foto.type, cacheControl: '0',
  })
  if (subida.error) return NextResponse.json({ error: subida.error.message }, { status: 500 })

  // El trigger completa vigilador, objetivo y turno desde el registro.
  const { error } = await admin.client.from('evidencias').upsert({
    proceso_tipo: 'protocolo',
    proceso_id: registroId,
    tipo_evidencia: 'tarea_turno',
    bucket,
    storage_path: storagePath,
    contenido_sha256: huella.sha256,
    bytes: huella.bytes,
    content_type: huella.mime,
  }, { onConflict: 'proceso_tipo,proceso_id,tipo_evidencia' })
  if (error) {
    return NextResponse.json({ error: `La foto se subió pero no pudo registrarse: ${error.message}` }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

export async function GET(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })
  const token = getBearerToken(req)
  if (!token) return NextResponse.json({ error: 'Sesión requerida' }, { status: 401 })
  const usuario = clienteDelUsuario(token)
  if (!usuario) return NextResponse.json({ error: 'Configuración de Supabase incompleta' }, { status: 500 })

  const registroId = req.nextUrl.searchParams.get('registro') ?? ''
  if (!UUID_RE.test(registroId)) return NextResponse.json({ error: 'Registro inválido' }, { status: 400 })

  const ver = await usuario.rpc('tareas_turno_ver_foto', { p_registro_id: registroId })
  if (ver.error || !ver.data) {
    return NextResponse.json({ error: ver.error?.message ?? 'Sin permiso' }, { status: ver.error?.code === '42501' ? 403 : 404 })
  }
  const { bucket, storage_path: storagePath } = ver.data as { bucket: string; storage_path: string }
  const firma = await admin.client.storage.from(bucket).createSignedUrl(storagePath, URL_FIRMA_SEGUNDOS)
  if (firma.error || !firma.data?.signedUrl) return NextResponse.json({ error: firma.error?.message ?? 'No se pudo firmar' }, { status: 500 })
  return NextResponse.json({ url: firma.data.signedUrl })
}
