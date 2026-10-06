/**
 * /api/afip/corroborar-empleados — corroboración diaria contra el Padrón A13.
 *
 * La dispara pg_cron una vez por día (Bearer push_cron_secret, mismo secreto
 * que el resto de los crons). Autentica en WSAA (TA cacheado), recorre los empleados
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

/**
 * Misma llave que el resto de los crons de pg_cron: `push_cron_secret` (en
 * minúsculas, así está en Vercel y en el vault). El job
 * `afip_corroborar_empleados` manda ese secreto; esta ruta esperaba sólo
 * CRON_SECRET y respondía 401 todos los días, con el job marcado "succeeded"
 * porque pg_cron sólo registra que encoló el http_get. CRON_SECRET se sigue
 * aceptando para no romper una invocación manual existente.
 */
function authOk(req: NextRequest) {
  const secretos = [process.env.push_cron_secret, process.env.CRON_SECRET].filter(Boolean) as string[]
  if (secretos.length === 0) return { ok: false, error: 'Falta push_cron_secret' }
  const header = req.headers.get('authorization') || ''
  return secretos.some(s => header === `Bearer ${s}`) ? { ok: true } : { ok: false, error: 'Cron no autorizado' }
}

export async function GET(req: NextRequest) {
  const auth = authOk(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.error === 'Falta push_cron_secret' ? 500 : 401 })
  }

  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const cfg = afipConfigDesdeEnv()
  if (cfg.error || !cfg.config) return NextResponse.json({ error: cfg.error }, { status: 500 })

  const resultado = await corroborarEmpleados(admin.client, cfg.config)
  return NextResponse.json(resultado, { status: resultado.ok ? 200 : 500 })
}
