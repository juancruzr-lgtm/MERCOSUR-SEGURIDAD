import { NextResponse } from 'next/server'
import { evaluarSalud, extraerMetricas, type Medicion } from '@/lib/salud'

/**
 * GET /api/salud — chequeo de salud para el vigía externo (incidente 18/11/2026).
 *
 * Lo consulta el workflow .github/workflows/vigia.yml cada ~1 minuto desde
 * afuera de Supabase y de Vercel. También sirve para UptimeRobot / Better Stack:
 * responde 503 cuando la base o el login no responden.
 *
 * Público y sin datos personales: sólo latencias, cifras agregadas y semáforo.
 * Cada consulta tiene tiempo máximo propio, así un problema no traba al chequeo.
 * monitor_salud() tarda ~10 ms y sólo lee (ver migración 20261216150000).
 */
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const runtime = 'nodejs'
export const maxDuration = 15

const URL_SB = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
// Las claves nuevas (sb_secret_…) van sólo en "apikey"; las viejas (JWT) también como Bearer.
const esJwt = (k: string) => k.startsWith('eyJ')
const cabeceras = (k: string): Record<string, string> => ({ apikey: k, ...(esJwt(k) ? { Authorization: `Bearer ${k}` } : {}) })
// Sólo el TIPO de clave (nunca su valor), para diagnosticar desde afuera.
const TIPO_CLAVE = !SERVICE ? 'falta' : esJwt(SERVICE) ? 'jwt' : SERVICE.startsWith('sb_secret_') ? 'secret' : 'otra'

async function medir(url: string, init: RequestInit, timeoutMs: number): Promise<Medicion & { cuerpo?: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const t0 = Date.now()
  try {
    const res = await fetch(url, { ...init, cache: 'no-store', signal: ctrl.signal })
    const cuerpo = await res.text()
    return { ok: res.ok, status: res.status, ms: Date.now() - t0, cuerpo }
  } catch (e: any) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: e?.name === 'AbortError' ? 'timeout' : 'sin_respuesta' }
  } finally {
    clearTimeout(timer)
  }
}

export async function GET() {
  const t0 = Date.now()
  const [base, auth, metricas] = await Promise.all([
    medir(`${URL_SB}/rest/v1/rpc/monitor_salud`, {
      method: 'POST',
      headers: { ...cabeceras(SERVICE), 'Content-Type': 'application/json' },
      body: '{}',
    }, 4000),
    medir(`${URL_SB}/auth/v1/health`, { headers: cabeceras(ANON) }, 3000),
    medir(`${URL_SB}/customer/v1/privileged/metrics`, {
      headers: { Authorization: `Basic ${Buffer.from(`service_role:${SERVICE}`).toString('base64')}` },
    }, 4000),
  ])

  let datosBase: any = null
  if (base.ok && base.cuerpo) { try { datosBase = JSON.parse(base.cuerpo) } catch { /* se informa como falla */ } }
  const recursos = metricas.ok && metricas.cuerpo ? extraerMetricas(metricas.cuerpo) : null

  // Sin clave de servicio (p. ej. en previews) no se puede medir la base desde
  // acá: no es una caída. salud_ping del vigía sigue midiendo la base directo.
  const sinClave = TIPO_CLAVE === 'falta'
  const resultado = evaluarSalud({
    base: sinClave
      ? { ok: true, status: 0, ms: 0, error: 'sin_clave_servicio' }
      : { ok: base.ok && !!datosBase, status: base.status, ms: base.ms, error: base.error },
    auth: { ok: auth.ok, status: auth.status, ms: auth.ms, error: auth.error },
    metricas: { ok: metricas.ok, status: metricas.status, ms: metricas.ms, error: metricas.error },
    datosBase,
    recursos,
  })
  if (sinClave) {
    resultado.alertas.push({ clave: 'configuracion', nivel: 'amarillo', texto: 'Falta SUPABASE_SERVICE_ROLE_KEY: no se miden recursos', valor: null })
    if (resultado.estado === 'ok') resultado.estado = 'atencion'
  }

  return NextResponse.json(
    { ...resultado, clave_servicio: TIPO_CLAVE, ms_total: Date.now() - t0, ts: new Date().toISOString() },
    {
      status: resultado.estado === 'caido' ? 503 : 200,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    },
  )
}
