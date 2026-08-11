// app/api/ia/referencias/imagen/route.ts
//
// Subida y baja de fotos de referencia de uniforme / libro de guardia.
//
// La subida es SERVER-SIDE con service_role. El bucket `ia-referencias` es
// privado y no tiene ninguna policy de storage: el navegador no puede escribir
// ahí ni aunque lo intente.

import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminIA } from '../../_lib/auth'
import {
  BUCKET_REFERENCIAS,
  MAX_BYTES_REFERENCIA,
  firmaImagenValida,
  mimePermitido,
  pathReferenciaConfig,
} from '@/lib/ia/referencias'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ── POST — subir una foto de referencia ─────────────────────────────────────
export async function POST(req: NextRequest) {
  const ctx = await requireAdminIA(req)
  if (!ctx.ok) return ctx.respuesta

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Se espera multipart/form-data' }, { status: 400 })
  }

  const configuracionId = form.get('configuracion_id')
  const archivo = form.get('imagen')
  const descripcion = form.get('descripcion')

  if (typeof configuracionId !== 'string' || !UUID_RE.test(configuracionId)) {
    return NextResponse.json({ error: 'configuracion_id inválido' }, { status: 400 })
  }
  if (!(archivo instanceof Blob) || archivo.size <= 0) {
    return NextResponse.json({ error: 'Imagen requerida' }, { status: 400 })
  }
  if (archivo.size > MAX_BYTES_REFERENCIA) {
    return NextResponse.json({ error: 'La imagen supera el límite de 5 MB' }, { status: 413 })
  }
  if (!mimePermitido(archivo.type)) {
    return NextResponse.json({ error: 'Formato no permitido (JPEG, PNG o WebP)' }, { status: 415 })
  }

  const { data: config, error: errorConfig } = await ctx.client
    .from('ia_configuraciones')
    .select('id, analisis_tipo')
    .eq('id', configuracionId)
    .maybeSingle()

  if (errorConfig) return NextResponse.json({ error: errorConfig.message }, { status: 500 })
  if (!config) return NextResponse.json({ error: 'Configuración inexistente' }, { status: 404 })

  const buffer = Buffer.from(await archivo.arrayBuffer())

  // El Content-Type es una afirmación del cliente; los magic bytes no.
  if (!firmaImagenValida(buffer, archivo.type)) {
    return NextResponse.json(
      { error: 'El contenido del archivo no coincide con el formato declarado' },
      { status: 415 },
    )
  }

  const sha256 = createHash('sha256').update(buffer).digest('hex')

  // Sufijo por hash: dos subidas del MISMO archivo van al mismo path, dos
  // archivos distintos nunca colisionan. Con upsert:false no se pisa nada.
  const path = pathReferenciaConfig(configuracionId, sha256.slice(0, 16), archivo.type)

  const { data: yaExiste } = await ctx.client
    .from('ia_referencia_imagenes')
    .select('id')
    .eq('bucket', BUCKET_REFERENCIAS)
    .eq('storage_path', path)
    .maybeSingle()

  if (yaExiste) {
    return NextResponse.json({ error: 'Esa imagen ya está cargada en esta configuración' }, { status: 409 })
  }

  const { error: errorUpload } = await ctx.client.storage
    .from(BUCKET_REFERENCIAS)
    .upload(path, buffer, { contentType: archivo.type, upsert: false })

  if (errorUpload) {
    return NextResponse.json({ error: errorUpload.message }, { status: 500 })
  }

  const { data: maxOrden } = await ctx.client
    .from('ia_referencia_imagenes')
    .select('orden')
    .eq('configuracion_id', configuracionId)
    .order('orden', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: fila, error: errorInsert } = await ctx.client
    .from('ia_referencia_imagenes')
    .insert({
      configuracion_id: configuracionId,
      bucket: BUCKET_REFERENCIAS,
      storage_path: path,
      contenido_sha256: sha256,
      bytes: buffer.length,
      content_type: archivo.type,
      descripcion: typeof descripcion === 'string' ? descripcion.trim().slice(0, 240) || null : null,
      orden: Math.min((maxOrden?.orden ?? 0) + 1, 100),
      created_by: ctx.usuario.id,
    })
    .select('*')
    .single()

  if (errorInsert) {
    // Compensación: el objeto ya está en el bucket. Mismo criterio que
    // upload-supervision-photo — no dejamos huérfanos.
    await ctx.client.storage.from(BUCKET_REFERENCIAS).remove([path])
    return NextResponse.json({ error: errorInsert.message }, { status: 500 })
  }

  return NextResponse.json({ imagen: fila })
}

// ── PATCH — activar / desactivar una imagen ─────────────────────────────────
// No hay DELETE a propósito (§7 del pedido): una referencia que estuvo vigente
// no se borra, se desactiva. El objeto queda en el bucket para que un análisis
// pasado siga siendo reconstruible.
export async function PATCH(req: NextRequest) {
  const ctx = await requireAdminIA(req)
  if (!ctx.ok) return ctx.respuesta

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })
  if (typeof body?.activo !== 'boolean') {
    return NextResponse.json({ error: 'activo debe ser booleano' }, { status: 400 })
  }

  const { data: fila, error } = await ctx.client
    .from('ia_referencia_imagenes')
    .update({ activo: body.activo })
    .eq('id', id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ imagen: fila })
}
