/**
 * /api/afip/corroborar-empleados — corroboración diaria contra el Padrón A13.
 *
 * La dispara pg_cron una vez por día (Bearer CRON_SECRET, mismo secreto que el
 * resto de los crons). Autentica en WSAA (TA cacheado), recorre los empleados
 * activos y guarda el resultado. La UI lo lee por /api/afip/corroboracion.
 *
 * Necesita como secretos de entorno: AFIP_CERT_PEM, AFIP_KEY_PEM,
 * AFIP_CUIT_REPRESENTADA (y opcional AFIP_HOMO=1 para homologación).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import { afipConfigDesdeEnv } from '@/lib/afip/config'
import { corroborarEmpleados } from '@/lib/afip/corroborar'

export const runtime = 'nodejs'
// El ciclo consulta el padrón por cada empleado en serie; no entra en el default.
export const maxDuration = 60
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

function authOk(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) return { ok: false, error: 'Falta CRON_SECRET' }
  const header = req.headers.get('authorization') || ''
  return header === `Bearer ${expected}` ? { ok: true } : { ok: false, error: 'Cron no autorizado' }
}

export async function GET(req: NextRequest) {
  const auth = authOk(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === 'Falta CRON_SECRET' ? 500 : 401 })
  }

  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const cfg = afipConfigDesdeEnv()
  if (cfg.error || !cfg.config) return NextResponse.json({ error: cfg.error }, { status: 500 })

  const resultado = await corroborarEmpleados(admin.client, cfg.config)
  return NextResponse.json(resultado, { status: resultado.ok ? 200 : 500 })
}
