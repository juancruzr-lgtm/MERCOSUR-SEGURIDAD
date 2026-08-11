// app/api/ia/cron/route.ts
//
// Análisis automático de las fotos que van entrando. Lo invoca pg_cron cada
// 5 minutos desde la base, autenticado con CRON_SECRET — el mismo patrón que
// /api/push/cron.
//
// FORWARD-ONLY: sólo analiza evidencias creadas después de ia_activacion_desde.
// Sin esa marca no procesa nada. Las 2.100 evidencias históricas no entran acá
// jamás; para esas está el análisis manual en modo prueba.
//
// El fichaje del vigilador nunca espera por esto: lee evidencias que ya existen.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import { procesarLote, LIMITE_DURO } from '@/lib/ia/procesar'

export const runtime = 'nodejs'
export const maxDuration = 60

// Secreto propio de la IA. Se prefiere IA_CRON_SECRET para no compartir el de
// /api/push/cron: así rotar uno no afecta al otro, y Vercel oculta el valor de
// las variables sensibles una vez guardadas. Cae a CRON_SECRET si no está.
function autorizado(req: NextRequest): boolean {
  const esperado = process.env.IA_CRON_SECRET || process.env.CRON_SECRET
  if (!esperado) return false
  return req.headers.get('authorization') === `Bearer ${esperado}`
}

async function correr() {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const { data: filas } = await admin.client.from('app_config').select('key, value').like('key', 'ia\\_%')
  const cfg = new Map((filas ?? []).map(f => [f.key as string, f.value as string]))

  if (cfg.get('ia_analisis_enabled') !== 'true') {
    return NextResponse.json({ ok: true, motivo: 'ia_analisis_enabled = false', analizadas: 0 })
  }

  const activacion = (cfg.get('ia_activacion_desde') ?? '').trim()
  if (!activacion) {
    return NextResponse.json({
      ok: true,
      motivo: 'ia_activacion_desde vacío: el modo automático está sin activar (forward-only)',
      analizadas: 0,
    })
  }

  const tipos = (cfg.get('ia_tipos_activos') ?? 'uniforme,libro_guardia')
    .split(',').map(t => t.trim()).filter(Boolean)

  try {
    const { resultados } = await procesarLote({
      client: admin.client,
      modo: 'produccion',
      limite: Math.min(Number(cfg.get('ia_lote_max') ?? 5), LIMITE_DURO),
      filtros: { desde: activacion, tipos },
      presupuestoMs: 55_000,
      maxIntentos: Number(cfg.get('ia_max_intentos') ?? 5),
      cuotaMuestra: Number(cfg.get('ia_muestra_normales_por_dia') ?? 10),
    })

    return NextResponse.json({
      ok: true,
      analizadas: resultados.filter(r => r.estado === 'completado').length,
      errores: resultados.filter(r => r.estado === 'error').length,
      omitidas: resultados.filter(r => r.estado === 'omitida').length,
    })
  } catch (e: any) {
    // Un fallo acá no puede escalar: el cron reintenta en 5 minutos y ninguna
    // evidencia quedó tocada.
    return NextResponse.json({ ok: false, error: String(e?.message ?? e).slice(0, 300) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  return correr()
}

// pg_net puede emitir GET; se acepta con la misma autenticación.
export async function GET(req: NextRequest) {
  if (!autorizado(req)) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  return correr()
}
