// app/api/ia/referencias/url/route.ts
//
// URLs firmadas de corta duración para ver las fotos de referencia.
//
// El cliente manda IDs, nunca paths: el storage_path se lee de la base. Es el
// mismo criterio que el GET de app/api/rondas/evidencia — si el path viniera
// del navegador, firmar sería equivalente a abrir el bucket.
//
// No se usa getPublicUrl en ningún caso: el bucket es privado.

import { NextRequest, NextResponse } from 'next/server'
import { alcanzaObjetivo, objetivoDePunto, requireOperadorIA } from '../../_lib/auth'
import { BUCKET_REFERENCIAS } from '@/lib/ia/referencias'

export const runtime = 'nodejs'

const URL_FIRMA_SEGUNDOS = 300
const MAX_IDS = 60

export async function POST(req: NextRequest) {
  const ctx = await requireOperadorIA(req)
  if (!ctx.ok) return ctx.respuesta

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const tipo = body?.tipo
  if (tipo !== 'configuracion' && tipo !== 'punto') {
    return NextResponse.json({ error: 'tipo debe ser configuracion o punto' }, { status: 400 })
  }

  const ids = Array.isArray(body?.ids) ? body.ids.filter((v: unknown) => typeof v === 'string') : []
  if (ids.length === 0) return NextResponse.json({ urls: {} })
  if (ids.length > MAX_IDS) {
    return NextResponse.json({ error: `Máximo ${MAX_IDS} imágenes por pedido` }, { status: 400 })
  }

  const tabla = tipo === 'configuracion' ? 'ia_referencia_imagenes' : 'ronda_punto_referencias'
  const columnas = tipo === 'configuracion'
    ? 'id, bucket, storage_path'
    : 'id, bucket, storage_path, ronda_punto_id'

  const { data: filas, error } = await ctx.client
    .from(tabla)
    .select(columnas)
    .in('id', ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const urls: Record<string, string> = {}

  for (const fila of (filas ?? []) as any[]) {
    // Cinturón y tirantes: si una fila apuntara a otro bucket, no se firma.
    if (fila.bucket !== BUCKET_REFERENCIAS) continue

    // Las referencias de punto son las únicas con alcance territorial. Las de
    // uniforme y libro son globales y cualquier operador activo puede verlas
    // (necesita ver el criterio para poder juzgar una foto después).
    if (tipo === 'punto') {
      const objetivoId = await objetivoDePunto(ctx.client, fila.ronda_punto_id)
      if (!objetivoId) continue
      if (!(await alcanzaObjetivo(ctx.client, ctx.usuario, objetivoId))) continue
    }

    const { data: firma } = await ctx.client.storage
      .from(BUCKET_REFERENCIAS)
      .createSignedUrl(fila.storage_path, URL_FIRMA_SEGUNDOS)

    if (firma?.signedUrl) urls[fila.id] = firma.signedUrl
  }

  return NextResponse.json({ urls, expira_en_s: URL_FIRMA_SEGUNDOS })
}
