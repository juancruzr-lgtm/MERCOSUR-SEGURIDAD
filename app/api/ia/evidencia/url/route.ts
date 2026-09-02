// app/api/ia/evidencia/url/route.ts
//
// URLs firmadas de las fotos que están detrás de un análisis, para la bandeja
// de revisión.
//
// Recibe IDs de análisis, nunca paths: el storage_path se lee de la base.
// Alcance por zona validado acá porque service_role omite RLS.
//
// Se firma EN LOTE (lib/firmas-storage). Antes se pedía una URL por foto
// dentro de un `for ... await`: 60 viajes encadenados a Storage, ~12 s medidos
// en producción, y la bandeja entera mostrando "sin vista previa" mientras
// tanto. El alcance por objetivo también se resolvía foto por foto, aunque las
// 60 fueran de cuatro objetivos.

import { NextRequest, NextResponse } from 'next/server'
import { alcanzaObjetivo, requireOperadorIA } from '../../_lib/auth'
import { firmarEnLote } from '@/lib/firmas-storage'
import type { ItemFirma } from '@/lib/firmas-storage'

export const runtime = 'nodejs'

/**
 * Una hora. Antes eran 5 minutos, y revisar la bandeja lleva más que eso: las
 * fotos que no se habían llegado a cargar dejaban de aparecer en mitad del
 * trabajo, sin ningún aviso. La URL sigue siendo de un solo objeto y de
 * lectura; quien la tiene ya pasó por la autorización de arriba.
 */
const SEGUNDOS = 3600

/**
 * Tope de fotos por pedido. Con la firma en lote son dos llamadas a Storage
 * (una por bucket), así que el tope ya no lo pone el tiempo sino el tamaño de
 * la bandeja: 300 es lo que carga la pantalla.
 */
const MAX = 300

export async function POST(req: NextRequest) {
  const ctx = await requireOperadorIA(req)
  if (!ctx.ok) return ctx.respuesta

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Body inválido' }, { status: 400 }) }

  const ids = Array.isArray(body?.analisis_ids)
    ? body.analisis_ids.filter((v: unknown) => typeof v === 'string').slice(0, MAX)
    : []
  if (ids.length === 0) return NextResponse.json({ urls: {} })

  const { data: filas, error } = await ctx.client
    .from('evidencia_analisis')
    .select('id, objetivo_id, evidencias!inner(bucket, storage_path)')
    .in('id', ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // El alcance se resuelve una vez por objetivo, no una vez por foto: son las
  // mismas cuatro o cinco respuestas repetidas decenas de veces.
  const alcance = new Map<string, boolean>()
  const permitido = async (objetivoId: string): Promise<boolean> => {
    const cacheado = alcance.get(objetivoId)
    if (cacheado !== undefined) return cacheado
    const ok = await alcanzaObjetivo(ctx.client, ctx.usuario, objetivoId)
    alcance.set(objetivoId, ok)
    return ok
  }

  const items: ItemFirma[] = []
  for (const fila of (filas ?? []) as any[]) {
    if (!(await permitido(fila.objetivo_id))) continue
    const ev = Array.isArray(fila.evidencias) ? fila.evidencias[0] : fila.evidencias
    if (!ev?.bucket || !ev?.storage_path) continue
    items.push({ id: fila.id, bucket: ev.bucket, path: ev.storage_path })
  }

  const urls = await firmarEnLote(items, async (bucket, paths) => {
    const { data } = await ctx.client.storage.from(bucket).createSignedUrls(paths, SEGUNDOS)
    return data ?? []
  })

  return NextResponse.json({ urls, expira_en_s: SEGUNDOS })
}
