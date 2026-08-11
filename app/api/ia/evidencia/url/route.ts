// app/api/ia/evidencia/url/route.ts
//
// URLs firmadas de las fotos que están detrás de un análisis, para la bandeja
// de revisión.
//
// Recibe IDs de análisis, nunca paths: el storage_path se lee de la base.
// Alcance por zona validado acá porque service_role omite RLS.

import { NextRequest, NextResponse } from 'next/server'
import { alcanzaObjetivo, requireOperadorIA } from '../../_lib/auth'

export const runtime = 'nodejs'

const SEGUNDOS = 300
const MAX = 60

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

  const urls: Record<string, string> = {}

  for (const fila of (filas ?? []) as any[]) {
    if (!(await alcanzaObjetivo(ctx.client, ctx.usuario, fila.objetivo_id))) continue
    const ev = Array.isArray(fila.evidencias) ? fila.evidencias[0] : fila.evidencias
    if (!ev?.bucket || !ev?.storage_path) continue

    const { data: firma } = await ctx.client.storage
      .from(ev.bucket)
      .createSignedUrl(ev.storage_path, SEGUNDOS)

    if (firma?.signedUrl) urls[fila.id] = firma.signedUrl
  }

  return NextResponse.json({ urls, expira_en_s: SEGUNDOS })
}
