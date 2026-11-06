/**
 * /api/postulaciones/archivo — foto/PDF original de la solicitud de empleo.
 *
 *   POST multipart { postulacion_id, orden, archivo }
 *        1. la base autoriza y reserva la ruta (postulacion_registrar_archivo,
 *           con la sesión del usuario: sólo quien puede editar esa postulación);
 *        2. el servidor sube el archivo al bucket privado `postulaciones`;
 *        3. si la subida falla, se quita la reserva (no quedan registros huérfanos).
 *   GET  ?id=<archivo> → enlace firmado de 60 s, después de que la base autoriza
 *        y registra el acceso (postulacion_abrir_archivo).
 *
 * El bucket no tiene políticas de Storage: nadie lo lee ni lo escribe desde el
 * navegador; sólo esta ruta, y sólo con la autorización de la base.
 */
import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, getSupabaseAdmin } from '../../_lib/employee-auth'
import { clienteDelUsuario } from '../../_lib/cliente-usuario'
import { validarArchivoSolicitud } from '../../_lib/archivo-solicitud'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const BUCKET = 'postulaciones'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FIRMA_SEGUNDOS = 60

function sesion(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return { respuesta: NextResponse.json({ error: admin.error }, { status: 500 }) } as const
  const token = getBearerToken(req)
  if (!token) return { respuesta: NextResponse.json({ error: 'Sesión requerida' }, { status: 401 }) } as const
  const usuario = clienteDelUsuario(token)
  if (!usuario) return { respuesta: NextResponse.json({ error: 'Configuración de Supabase incompleta' }, { status: 500 }) } as const
  return { admin: admin.client, usuario } as const
}

export async function POST(req: NextRequest) {
  const s = sesion(req)
  if ('respuesta' in s) return s.respuesta

  let form: FormData
  try { form = await req.formData() } catch { return NextResponse.json({ error: 'Se espera multipart/form-data' }, { status: 400 }) }
  const postulacionId = form.get('postulacion_id')
  const orden = Number(form.get('orden') ?? 1)
  const archivo = form.get('archivo')
  if (typeof postulacionId !== 'string' || !UUID_RE.test(postulacionId)) return NextResponse.json({ error: 'Postulación inválida' }, { status: 400 })
  if (!Number.isInteger(orden) || orden < 1 || orden > 4) return NextResponse.json({ error: 'Página inválida (1 a 4)' }, { status: 400 })
  if (!(archivo instanceof Blob)) return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 })

  const buf = Buffer.from(await archivo.arrayBuffer())
  const v = validarArchivoSolicitud(buf)
  if ('error' in v) return NextResponse.json({ error: v.error }, { status: v.status })

  const archivoId = randomUUID()
  const { data: ruta, error: rpcError } = await s.usuario.rpc('postulacion_registrar_archivo', {
    p_id: postulacionId, p_archivo: archivoId, p_ext: v.tipo.ext, p_mime: v.tipo.mime,
    p_bytes: v.bytes, p_sha256: v.sha256, p_orden: orden,
  })
  if (rpcError || typeof ruta !== 'string') {
    const msg = rpcError?.message || 'No autorizado'
    return NextResponse.json({ error: msg }, { status: /acceso|autoriz|habilitad/i.test(msg) ? 403 : 400 })
  }

  const { error: upError } = await s.admin.storage.from(BUCKET).upload(ruta, buf, { contentType: v.tipo.mime, upsert: false, cacheControl: '0' })
  if (upError) {
    await s.admin.from('postulacion_archivos').delete().eq('id', archivoId)
    return NextResponse.json({ error: `No se pudo guardar el archivo: ${upError.message}` }, { status: 502 })
  }
  return NextResponse.json({ ok: true, id: archivoId })
}

export async function GET(req: NextRequest) {
  const s = sesion(req)
  if ('respuesta' in s) return s.respuesta
  const id = req.nextUrl.searchParams.get('id') || ''
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Archivo inválido' }, { status: 400 })

  const { data: ruta, error } = await s.usuario.rpc('postulacion_abrir_archivo', { p_archivo: id })
  if (error || typeof ruta !== 'string') return NextResponse.json({ error: error?.message || 'Sin acceso' }, { status: 403 })

  const { data, error: firmaError } = await s.admin.storage.from(BUCKET).createSignedUrl(ruta, FIRMA_SEGUNDOS)
  if (firmaError || !data?.signedUrl) return NextResponse.json({ error: firmaError?.message || 'No se pudo abrir el archivo' }, { status: 502 })
  return NextResponse.json({ url: data.signedUrl }, { headers: { 'Cache-Control': 'no-store' } })
}
