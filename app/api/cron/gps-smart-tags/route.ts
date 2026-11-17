/**
 * /api/cron/gps-smart-tags — ciclo de consulta de Smart Tags (pensado cada 10 min).
 *
 * APAGADO POR DEFECTO. No hay ningún disparador programado (ni vercel.json ni
 * pg_cron): supabase/cron/20261215100000_gps_smart_tags_cron.sql está preparado
 * pero NO se aplica sin autorización.
 *
 * Requiere:
 *   · Authorization: Bearer <push_cron_secret | CRON_SECRET> (mismo esquema que el resto de los crons).
 *   · GPS_SMART_TAGS_HABILITADO=1.
 *   · GPS_SMART_TAGS_PROVEEDOR = 'simulado' (sólo tags marcados como simulados)
 *     o 'google_find_hub' (hoy SIEMPRE registra error 'integracion_no_habilitada':
 *     no existe API oficial y la no oficial quedó detenida por seguridad).
 *
 * Nunca recibe ni guarda credenciales de Google.
 */
import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { ejecutarCiclo } from '@/lib/gps-vehiculos/ciclo'
import { proveedorConfigurado } from '@/lib/gps-vehiculos/proveedor'
import { repositorioSupabase } from '@/lib/gps-vehiculos/repositorio'
import type { SmartTag } from '@/lib/gps-vehiculos/tipos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

function autorizado(req: NextRequest): { ok: boolean; status?: number; error?: string } {
  const secretos = [process.env.push_cron_secret, process.env.CRON_SECRET].filter(Boolean) as string[]
  if (secretos.length === 0) return { ok: false, status: 500, error: 'Falta push_cron_secret' }
  const header = req.headers.get('authorization') || ''
  return secretos.some(s => header === `Bearer ${s}`) ? { ok: true } : { ok: false, status: 401, error: 'Cron no autorizado' }
}

export async function GET(req: NextRequest) {
  const a = autorizado(req)
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status })
  if (process.env.GPS_SMART_TAGS_HABILITADO !== '1') {
    return NextResponse.json({ habilitado: false, mensaje: 'Consulta de Smart Tags apagada' })
  }
  const nombreProveedor = process.env.GPS_SMART_TAGS_PROVEEDOR
  const proveedor = proveedorConfigurado(nombreProveedor)
  if (!proveedor) return NextResponse.json({ error: 'GPS_SMART_TAGS_PROVEEDOR inválido' }, { status: 500 })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !clave) return NextResponse.json({ error: 'Configuración incompleta' }, { status: 500 })
  const admin = createClient(url, clave, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (u, i) => fetch(u, { ...i, cache: 'no-store' }) },
  })

  const { data: tags, error } = await admin.from('gps_tags')
    .select('id, nombre, modelo, proveedor, identificador_externo, estado, es_prueba')
    .eq('estado', 'activo').eq('proveedor', nombreProveedor)
  if (error) return NextResponse.json({ error: 'No se pudieron leer los Smart Tags' }, { status: 500 })

  const resultados = await ejecutarCiclo({
    tags: (tags ?? []) as SmartTag[],
    proveedor,
    repo: repositorioSupabase(admin),
    // Dentro del límite de la función: reintentos cortos.
    esperasMs: [2_000, 6_000],
    maxIntentos: 3,
  })
  return NextResponse.json({ habilitado: true, proveedor: nombreProveedor, resultados })
}
