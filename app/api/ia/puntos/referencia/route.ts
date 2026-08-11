// app/api/ia/puntos/referencia/route.ts
//
// Foto de referencia IA de un punto de control.
//
// ⚠️  Esta ruta escribe EXCLUSIVAMENTE en `ronda_punto_referencias`.
//     No toca ronda_puntos, ni politica_foto, ni foto_requerida, ni GPS, ni
//     orden, ni obligación, ni ejecución, ni alertas. La referencia es metadata
//     nueva y nada del módulo de rondas la lee (§38 del pedido).
//
// Permiso: sólo administración escribe. Ver el informe de FASE B para el
// razonamiento sobre por qué el supervisor queda en solo lectura por ahora.

import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { alcanzaObjetivo, objetivoDePunto, requireAdminIA } from '../../_lib/auth'
import {
  BUCKET_REFERENCIAS,
  MAX_BYTES_REFERENCIA,
  firmaImagenValida,
  mimePermitido,
  pathReferenciaPunto,
} from '@/lib/ia/referencias'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ── POST — cargar la referencia de un punto ─────────────────────────────────
export async function POST(req: NextRequest) {
  const ctx = await requireAdminIA(req)
  if (!ctx.ok) return ctx.respuesta

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Se espera multipart/form-data' }, { status: 400 })
  }

  const rondaPuntoId = form.get('ronda_punto_id')
  const archivo = form.get('imagen')
  const descripcion = form.get('descripcion')
  const reemplazarActiva = form.get('reemplazar_activa') === 'true'

  if (typeof rondaPuntoId !== 'string' || !UUID_RE.test(rondaPuntoId)) {
    return NextResponse.json({ error: 'ronda_punto_id inválido' }, { status: 400 })
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

  const objetivoId = await objetivoDePunto(ctx.client, rondaPuntoId)
  if (!objetivoId) return NextResponse.json({ error: 'Punto inexistente' }, { status: 404 })
  if (!(await alcanzaObjetivo(ctx.client, ctx.usuario, objetivoId))) {
    return NextResponse.json({ error: 'Sin alcance sobre el objetivo de este punto' }, { status: 403 })
  }

  const buffer = Buffer.from(await archivo.arrayBuffer())
  if (!firmaImagenValida(buffer, archivo.type)) {
    return NextResponse.json(
      { error: 'El contenido del archivo no coincide con el formato declarado' },
      { status: 415 },
    )
  }

  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const path = pathReferenciaPunto(rondaPuntoId, sha256.slice(0, 16), archivo.type)

  const { data: yaExiste } = await ctx.client
    .from('ronda_punto_referencias')
    .select('id')
    .eq('bucket', BUCKET_REFERENCIAS)
    .eq('storage_path', path)
    .maybeSingle()

  if (yaExiste) {
    return NextResponse.json({ error: 'Esa misma imagen ya está cargada en este punto' }, { status: 409 })
  }

  const { error: errorUpload } = await ctx.client.storage
    .from(BUCKET_REFERENCIAS)
    .upload(path, buffer, { contentType: archivo.type, upsert: false })

  if (errorUpload) return NextResponse.json({ error: errorUpload.message }, { status: 500 })

  const ahora = new Date().toISOString()

  // Reemplazo con historia (§7): la anterior NO se borra, se le cierra la
  // vigencia. Así, dentro de seis meses, un análisis de hoy sigue sabiendo
  // contra qué referencia se hizo. Se cierra ANTES de crear la nueva para que
  // no queden dos activas ni por un instante.
  if (reemplazarActiva) {
    const { error: errorCierre } = await ctx.client
      .from('ronda_punto_referencias')
      .update({ activo: false, vigente_hasta: ahora })
      .eq('ronda_punto_id', rondaPuntoId)
      .eq('activo', true)

    if (errorCierre) {
      await ctx.client.storage.from(BUCKET_REFERENCIAS).remove([path])
      return NextResponse.json(
        { error: `No se pudo cerrar la referencia anterior: ${errorCierre.message}` },
        { status: 500 },
      )
    }
  }

  const { data: fila, error: errorInsert } = await ctx.client
    .from('ronda_punto_referencias')
    .insert({
      ronda_punto_id: rondaPuntoId,
      bucket: BUCKET_REFERENCIAS,
      storage_path: path,
      contenido_sha256: sha256,
      bytes: buffer.length,
      content_type: archivo.type,
      descripcion: typeof descripcion === 'string' ? descripcion.trim().slice(0, 400) || null : null,
      activo: true,
      vigente_desde: ahora,
      created_by: ctx.usuario.id,
    })
    .select('*')
    .single()

  if (errorInsert) {
    await ctx.client.storage.from(BUCKET_REFERENCIAS).remove([path])
    return NextResponse.json({ error: errorInsert.message }, { status: 500 })
  }

  return NextResponse.json({ referencia: fila })
}

// ── PATCH — activar / desactivar, o editar la descripción ───────────────────
// Sin DELETE: una referencia que estuvo vigente se desactiva, no se borra.
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

  const { data: actual, error: errorActual } = await ctx.client
    .from('ronda_punto_referencias')
    .select('id, ronda_punto_id, activo')
    .eq('id', id)
    .maybeSingle()

  if (errorActual) return NextResponse.json({ error: errorActual.message }, { status: 500 })
  if (!actual) return NextResponse.json({ error: 'Referencia inexistente' }, { status: 404 })

  const objetivoId = await objetivoDePunto(ctx.client, actual.ronda_punto_id)
  if (!objetivoId || !(await alcanzaObjetivo(ctx.client, ctx.usuario, objetivoId))) {
    return NextResponse.json({ error: 'Sin alcance sobre el objetivo de este punto' }, { status: 403 })
  }

  const cambios: Record<string, unknown> = {}
  const ahora = new Date().toISOString()

  if (typeof body?.descripcion === 'string') {
    cambios.descripcion = body.descripcion.trim().slice(0, 400) || null
  }

  if (body?.activo === true && !actual.activo) {
    // Reactivar: cerrar cualquier otra activa del mismo punto y reabrir ésta.
    const { error: errorCierre } = await ctx.client
      .from('ronda_punto_referencias')
      .update({ activo: false, vigente_hasta: ahora })
      .eq('ronda_punto_id', actual.ronda_punto_id)
      .eq('activo', true)

    if (errorCierre) {
      return NextResponse.json({ error: errorCierre.message }, { status: 500 })
    }
    cambios.activo = true
    cambios.vigente_desde = ahora
    cambios.vigente_hasta = null
  }

  if (body?.activo === false && actual.activo) {
    cambios.activo = false
    cambios.vigente_hasta = ahora
  }

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: 'Nada para actualizar' }, { status: 400 })
  }

  const { data: fila, error } = await ctx.client
    .from('ronda_punto_referencias')
    .update(cambios)
    .eq('id', id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ referencia: fila })
}
