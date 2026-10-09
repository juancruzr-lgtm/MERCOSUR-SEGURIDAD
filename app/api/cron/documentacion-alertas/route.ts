/**
 * /api/cron/documentacion-alertas — alertas diarias de documentación del legajo.
 *
 * La dispara pg_cron (Bearer push_cron_secret, mismo secreto que el resto de
 * los crons; ver supabase/cron/20261009170000_documentacion_alertas_cron.sql,
 * que NO se aplica hasta que Gerencia prenda las alertas).
 *
 * Con el interruptor apagado (por defecto) no hace nada. Prendido, REGISTRA
 * las alertas nuevas (vencidos, por vencer, solicitados y, si se pidió,
 * faltantes) sin duplicar. No manda push, WhatsApp ni mails.
 */

import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

function autorizado(req: NextRequest): { ok: boolean; status?: number; error?: string } {
  const secretos = [process.env.push_cron_secret, process.env.CRON_SECRET].filter(Boolean) as string[]
  if (secretos.length === 0) return { ok: false, status: 500, error: 'Falta push_cron_secret' }
  const header = req.headers.get('authorization') || ''
  return secretos.some(s => header === `Bearer ${s}`) ? { ok: true } : { ok: false, status: 401, error: 'Cron no autorizado' }
}

export async function GET(req: NextRequest) {
  const a = autorizado(req)
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !clave) return NextResponse.json({ error: 'Configuración incompleta' }, { status: 500 })

  const admin = createClient(url, clave, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (u, i) => fetch(u, { ...i, cache: 'no-store' }) },
  })
  const { data, error } = await admin.rpc('documentacion_alertas_generar')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
