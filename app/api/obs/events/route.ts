import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, getSupabaseAdmin } from '../../_lib/employee-auth'

async function requireAdmin(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return { error: admin.error, status: 500 }
  const token = getBearerToken(req)
  if (!token) return { error: 'Sesion requerida', status: 401 }
  const { data: authData, error: authError } = await admin.client.auth.getUser(token)
  if (authError || !authData.user) return { error: 'Sesion invalida', status: 401 }
  const { data: usuario } = await admin.client.from('usuarios').select('id, rol').eq('auth_user_id', authData.user.id).eq('rol', 'admin').single()
  if (!usuario) return { error: 'No autorizado', status: 403 }
  return { client: admin.client }
}

// ── GET /api/obs/events ────────────────────────────────────────────────────────
// Browser paginado de eventos de telemetría.
// Query params: page, limit, from, to, user_id, objetivo_id, event_name, category, only_errors, app_version, device_type
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { client } = auth

  const p = req.nextUrl.searchParams
  const page       = Math.max(0, parseInt(p.get('page') || '0', 10))
  const limit      = Math.min(200, Math.max(10, parseInt(p.get('limit') || '100', 10)))
  const from       = p.get('from')
  const to         = p.get('to')
  const userId     = p.get('user_id')
  const objetivoId = p.get('objetivo_id')
  const eventName  = p.get('event_name')
  const category   = p.get('category')
  const onlyErrors = p.get('only_errors') === '1'
  const appVersion = p.get('app_version')
  const deviceType = p.get('device_type')
  const sessionId  = p.get('session_id')

  let q = client.from('os_events').select('id, session_id, seq, user_id, user_rol, event_name, event_category, screen, screen_section, objetivo_id, turno_id, gps_lat, gps_lng, gps_accuracy_m, gps_distance_m, gps_status, network_type, battery_pct, client_ts, duration_ms, value_num, value_text, err_screen, err_component, err_function, err_code, err_message, prev_events, app_version, device_type, os_name, created_at')

  if (from) q = q.gte('created_at', from)
  if (to)   q = q.lte('created_at', to)
  if (userId)     q = q.eq('user_id', userId)
  if (objetivoId) q = q.eq('objetivo_id', objetivoId)
  if (eventName)  q = q.eq('event_name', eventName)
  if (category)   q = q.eq('event_category', category)
  if (onlyErrors) q = q.not('err_code', 'is', null)
  if (appVersion) q = q.eq('app_version', appVersion)
  if (deviceType) q = q.eq('device_type', deviceType)
  if (sessionId)  q = q.eq('session_id', sessionId)

  const { data, error, count } = await q
    .order('created_at', { ascending: false })
    .range(page * limit, page * limit + limit - 1)
    .returns<any[]>()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ events: data ?? [], page, limit, total: count ?? null })
}
