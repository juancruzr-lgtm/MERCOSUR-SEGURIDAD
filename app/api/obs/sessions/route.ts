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

function diasAtrasISO(dias: number) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

// ── GET /api/obs/sessions ──────────────────────────────────────────────────────
// Análisis de sesiones: dispositivos, OS, versiones, duraciones, usuarios.
// Query params: days (default 7), page, limit
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { client } = auth

  const p    = req.nextUrl.searchParams
  const days = Math.min(90, Math.max(1, parseInt(p.get('days') || '7', 10)))
  const page = Math.max(0, parseInt(p.get('page') || '0', 10))
  const limit = Math.min(200, Math.max(10, parseInt(p.get('limit') || '100', 10)))
  const desde = diasAtrasISO(days)

  const [sesionesRes, usuariosRes] = await Promise.all([
    client
      .from('os_sessions')
      .select('id, user_id, user_rol, started_at, ended_at, duration_s, event_count, device_type, device_model, os_name, os_version, browser_name, browser_version, app_version, battery_start_pct, battery_end_pct, network_start, network_end')
      .gte('started_at', desde)
      .order('started_at', { ascending: false })
      .range(page * limit, page * limit + limit - 1),
    client.from('usuarios').select('id, nombre, apellido, rol, estado'),
  ])

  const sesiones  = sesionesRes.data ?? []
  const usuarios  = usuariosRes.data ?? []
  const usuMap    = new Map(usuarios.map((u: any) => [u.id, u]))

  // Agregar nombre de usuario a cada sesión
  const sesionesConUsuario = sesiones.map((s: any) => ({
    ...s,
    usuario: usuMap.get(s.user_id) ?? null,
  }))

  // ── Métricas agregadas ──────────────────────────────────────────────────────

  // Para los breakdowns descargamos todos los registros del período (sin paginar)
  const { data: todas } = await client
    .from('os_sessions')
    .select('user_id, user_rol, device_type, os_name, browser_name, app_version, duration_s, ended_at, battery_start_pct')
    .gte('started_at', desde)

  const todasSesiones = todas ?? []

  const byRol      = todasSesiones.reduce((acc: Record<string, number>, s: any) => { acc[s.user_rol || 'desconocido'] = (acc[s.user_rol || 'desconocido'] || 0) + 1; return acc }, {})
  const byDispositivo = todasSesiones.reduce((acc: Record<string, number>, s: any) => { acc[s.device_type || 'desconocido'] = (acc[s.device_type || 'desconocido'] || 0) + 1; return acc }, {})
  const byOS       = todasSesiones.reduce((acc: Record<string, number>, s: any) => { acc[s.os_name || 'desconocido'] = (acc[s.os_name || 'desconocido'] || 0) + 1; return acc }, {})
  const byBrowser  = todasSesiones.reduce((acc: Record<string, number>, s: any) => { acc[s.browser_name || 'desconocido'] = (acc[s.browser_name || 'desconocido'] || 0) + 1; return acc }, {})
  const byVersion  = todasSesiones.reduce((acc: Record<string, number>, s: any) => { acc[s.app_version || 'desconocido'] = (acc[s.app_version || 'desconocido'] || 0) + 1; return acc }, {})

  const duraciones = todasSesiones.filter((s: any) => s.duration_s != null && s.duration_s > 0).map((s: any) => s.duration_s).sort((a: number, b: number) => a - b)
  const p50Dur = duraciones.length > 0 ? duraciones[Math.floor(duraciones.length / 2)] : null
  const p95Dur = duraciones.length > 0 ? duraciones[Math.floor(duraciones.length * 0.95)] : null

  const activas = todasSesiones.filter((s: any) => !s.ended_at).length
  const usuariosUnicos = new Set(todasSesiones.map((s: any) => s.user_id)).size

  return NextResponse.json({
    resumen: {
      total_sesiones: todasSesiones.length,
      sesiones_activas: activas,
      usuarios_unicos: usuariosUnicos,
      p50_duracion_s: p50Dur,
      p95_duracion_s: p95Dur,
    },
    breakdowns: { por_rol: byRol, por_dispositivo: byDispositivo, por_os: byOS, por_browser: byBrowser, por_version: byVersion },
    sesiones: sesionesConUsuario,
    page,
    limit,
  })
}
