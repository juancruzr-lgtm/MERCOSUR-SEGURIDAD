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
import { firmarEnLote } from '@/lib/firmas-storage'
import type { ItemFirma } from '@/lib/firmas-storage'

export const runtime = 'nodejs'

/** Una hora, igual que la bandeja de evidencias: mirar referencias lleva más
 *  de cinco minutos y las fotos desaparecían en mitad del trabajo. */
const URL_FIRMA_SEGUNDOS = 3600
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

  // El alcance de cada punto se resuelve una sola vez: varias referencias del
  // mismo punto compartían las mismas dos consultas repetidas.
  const alcancePunto = new Map<string, boolean>()
  const puntoPermitido = async (rondaPuntoId: string): Promise<boolean> => {
    const cacheado = alcancePunto.get(rondaPuntoId)
    if (cacheado !== undefined) return cacheado
    const objetivoId = await objetivoDePunto(ctx.client, rondaPuntoId)
    const ok = objetivoId ? await alcanzaObjetivo(ctx.client, ctx.usuario, objetivoId) : false
    alcancePunto.set(rondaPuntoId, ok)
    return ok
  }

  const items: ItemFirma[] = []
  for (const fila of (filas ?? []) as any[]) {
    // Cinturón y tirantes: si una fila apuntara a otro bucket, no se firma.
    if (fila.bucket !== BUCKET_REFERENCIAS) continue

    // Las referencias de punto son las únicas con alcance territorial. Las de
    // uniforme y libro son globales y cualquier operador activo puede verlas
    // (necesita ver el criterio para poder juzgar una foto después).
    if (tipo === 'punto' && !(await puntoPermitido(fila.ronda_punto_id))) continue

    if (!fila.storage_path) continue
    items.push({ id: fila.id, bucket: BUCKET_REFERENCIAS, path: fila.storage_path })
  }

  // Firma en lote: una llamada a Storage en vez de una por imagen.
  const urls = await firmarEnLote(items, async (bucket, paths) => {
    const { data } = await ctx.client.storage.from(bucket).createSignedUrls(paths, URL_FIRMA_SEGUNDOS)
    return data ?? []
  })

  return NextResponse.json({ urls, expira_en_s: URL_FIRMA_SEGUNDOS })
}
