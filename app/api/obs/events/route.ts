import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, isObsAuthErr } from '../../_lib/obs-auth'

const UUID_RE  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_RE   = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?/

function validUuid(v: string | null): string | null {
  return v && UUID_RE.test(v) ? v : null
}

function validIso(v: string | null): string | null {
  return v && ISO_RE.test(v) ? v : null
}

// ── GET /api/obs/events ────────────────────────────────────────────────────────
// Browser paginado de eventos de telemetría.
// Query params: page, limit, from, to, user_id, objetivo_id, event_name, category, only_errors, app_version, device_type
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (isObsAuthErr(auth)) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { client } = auth

  const p = req.nextUrl.searchParams
  const page       = Math.max(0, parseInt(p.get('page') || '0', 10))
  const limit      = Math.min(200, Math.max(10, parseInt(p.get('limit') || '100', 10)))

  // Parámetros validados — valores malformados se ignoran (no 500)
  const from       = validIso(p.get('from'))
  const to         = validIso(p.get('to'))
  const userId     = validUuid(p.get('user_id'))
  const objetivoId = validUuid(p.get('objetivo_id'))
  const sessionId  = validUuid(p.get('session_id'))
  const eventName  = p.get('event_name') || null
  const category   = p.get('category')   || null
  const onlyErrors = p.get('only_errors') === '1'
  const appVersion = p.get('app_version') || null
  const deviceType = p.get('device_type') || null

  // count: 'exact' es necesario para que la respuesta incluya el total de páginas
  let q = client
    .from('os_events')
    .select(
      'id, session_id, seq, user_id, user_rol, event_name, event_category, screen, screen_section, objetivo_id, turno_id, gps_lat, gps_lng, gps_accuracy_m, gps_distance_m, gps_status, network_type, battery_pct, client_ts, duration_ms, value_num, value_text, value_json, err_screen, err_component, err_function, err_code, err_message, prev_events, app_version, device_type, os_name, created_at',
      { count: 'exact' }
    )

  if (from)       q = q.gte('created_at', from)
  if (to)         q = q.lte('created_at', to)
  if (userId)     q = q.eq('user_id', userId)
  if (objetivoId) q = q.eq('objetivo_id', objetivoId)
  if (sessionId)  q = q.eq('session_id', sessionId)
  if (eventName)  q = q.eq('event_name', eventName)
  if (category)   q = q.eq('event_category', category)
  if (onlyErrors) q = q.not('err_code', 'is', null)
  if (appVersion) q = q.eq('app_version', appVersion)
  if (deviceType) q = q.eq('device_type', deviceType)

  const { data, error, count } = await q
    .order('created_at', { ascending: false })
    .range(page * limit, page * limit + limit - 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ events: data ?? [], page, limit, total: count ?? null })
}
