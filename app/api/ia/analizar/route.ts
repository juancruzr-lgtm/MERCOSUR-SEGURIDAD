// app/api/ia/analizar/route.ts
//
// Análisis MANUAL desde Administración, en modo prueba, sobre fotos reales ya
// existentes. El núcleo vive en lib/ia/procesar.ts, compartido con el cron.
//
// Desacoplado del fichaje: lee evidencias que ya existen.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdminIA } from '../_lib/auth'
import { procesarLote, LIMITE_DURO, type FiltrosLote } from '@/lib/ia/procesar'

export const runtime = 'nodejs'
// El plan Hobby de Vercel corta las funciones a 60 s.
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const ctx = await requireAdminIA(req)
  if (!ctx.ok) return ctx.respuesta

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Body inválido' }, { status: 400 }) }

  const { data: filas } = await ctx.client.from('app_config').select('key, value').like('key', 'ia\\_%')
  const cfg = new Map((filas ?? []).map(f => [f.key as string, f.value as string]))

  if (cfg.get('ia_analisis_enabled') !== 'true') {
    return NextResponse.json(
      { error: 'El análisis IA está apagado. Activá ia_analisis_enabled en app_config.' },
      { status: 409 },
    )
  }

  const modo = body?.modo === 'produccion' ? 'produccion' : 'prueba'
  const limite = Math.min(Math.max(1, Number(body?.limite) || 5), LIMITE_DURO)

  const filtros: FiltrosLote = {
    ...(body?.filtros ?? {}),
    evidencia_ids: Array.isArray(body?.evidencia_ids) ? body.evidencia_ids : undefined,
  }

  // En modo prueba se agrupa en un lote para poder comparar corridas.
  let loteId: string | null = null
  if (modo === 'prueba') {
    const { data: lote } = await ctx.client
      .from('ia_lotes')
      .insert({
        nombre: body?.lote_nombre?.trim() || `Lote manual ${new Date().toISOString().slice(0, 16)}`,
        modo: 'prueba',
        filtros: { ...filtros, limite },
        total_solicitado: limite,
        created_by: ctx.usuario.id,
      })
      .select('id')
      .single()
    loteId = lote?.id ?? null
  }

  try {
    const { resultados, encolados } = await procesarLote({
      client: ctx.client,
      modo,
      limite,
      filtros,
      loteId,
      presupuestoMs: 55_000,
      maxIntentos: Number(cfg.get('ia_max_intentos') ?? 5),
      maxReferencias: Number(cfg.get('ia_referencias_max') ?? 4),
      soloGpsFueraRadio: cfg.get('ia_ronda_solo_gps_fuera_radio') !== 'false',
    })

    if (loteId) {
      await ctx.client.from('ia_lotes')
        .update({ total_encolado: encolados, cerrado_at: new Date().toISOString() })
        .eq('id', loteId)
    }

    return NextResponse.json({
      lote_id: loteId,
      modo,
      analizadas: resultados.filter(r => r.estado === 'completado').length,
      errores: resultados.filter(r => r.estado === 'error').length,
      omitidas: resultados.filter(r => r.estado === 'omitida').length,
      resultados,
    })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e).slice(0, 300) }, { status: 500 })
  }
}
