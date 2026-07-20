import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, isObsAuthErr } from '../../_lib/obs-auth'

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
  if (isObsAuthErr(auth)) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { client } = auth

  const p     = req.nextUrl.searchParams
  const days  = Math.min(90, Math.max(1, parseInt(p.get('days') || '7', 10)))
  const page  = Math.max(0, parseInt(p.get('page') || '0', 10))
  const limit = Math.min(200, Math.max(10, parseInt(p.get('limit') || '100', 10)))
  const desde = diasAtrasISO(days)

  // Una sola query con todas las columnas necesarias para lista Y breakdowns.
  // Eliminada la segunda query duplicada que descargaba todo el período sin paginar.
  const [todasRes, usuariosRes] = await Promise.all([
    client
      .from('os_sessions')
      .select('id, user_id, user_rol, started_at, ended_at, duration_s, event_count, device_type, device_model, os_name, os_version, browser_name, browser_version, app_version, battery_start_pct, battery_end_pct, network_start, network_end')
      .gte('started_at', desde)
      .order('started_at', { ascending: false }),
    client.from('usuarios').select('id, nombre, apellido, rol, estado'),
  ])

  const todasSesiones = todasRes.data ?? []
  const usuarios      = usuariosRes.data ?? []
  const usuMap        = new Map(usuarios.map((u: any) => [u.id, u]))

  // Página solicitada sobre los datos ya en memoria
  const sesionesConUsuario = todasSesiones
    .slice(page * limit, page * limit + limit)
    .map((s: any) => ({ ...s, usuario: usuMap.get(s.user_id) ?? null }))

  const byRol       = todasSesiones.reduce((acc: Record<string, number>, s: any) => { acc[s.user_rol || 'desconocido'] = (acc[s.user_rol || 'desconocido'] || 0) + 1; return acc }, {})
  const byDispositivo = todasSesiones.reduce((acc: Record<string, number>, s: any) => { acc[s.device_type || 'desconocido'] = (acc[s.device_type || 'desconocido'] || 0) + 1; return acc }, {})
  const byOS        = todasSesiones.reduce((acc: Record<string, number>, s: any) => { acc[s.os_name || 'desconocido'] = (acc[s.os_name || 'desconocido'] || 0) + 1; return acc }, {})
  const byBrowser   = todasSesiones.reduce((acc: Record<string, number>, s: any) => { acc[s.browser_name || 'desconocido'] = (acc[s.browser_name || 'desconocido'] || 0) + 1; return acc }, {})
  const byVersion   = todasSesiones.reduce((acc: Record<string, number>, s: any) => { acc[s.app_version || 'desconocido'] = (acc[s.app_version || 'desconocido'] || 0) + 1; return acc }, {})

  const duraciones = todasSesiones
    .filter((s: any) => s.duration_s != null && s.duration_s > 0)
    .map((s: any) => s.duration_s)
    .sort((a: number, b: number) => a - b)
  const p50Dur = duraciones.length > 0 ? duraciones[Math.floor(duraciones.length / 2)] : null
  const p95Dur = duraciones.length > 0 ? duraciones[Math.floor(duraciones.length * 0.95)] : null

  const activas        = todasSesiones.filter((s: any) => !s.ended_at).length
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
    total: todasSesiones.length,
  })
}
