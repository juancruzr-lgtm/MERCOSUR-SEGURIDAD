import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, getSupabaseAdmin } from '../../_lib/employee-auth'

// ── Auth guard: solo admin ─────────────────────────────────────────────────────
async function requireAdmin(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return { error: admin.error, status: 500 }

  const token = getBearerToken(req)
  if (!token) return { error: 'Sesion requerida', status: 401 }

  const { data: authData, error: authError } = await admin.client.auth.getUser(token)
  if (authError || !authData.user) return { error: 'Sesion invalida', status: 401 }

  const { data: usuario } = await admin.client
    .from('usuarios')
    .select('id, rol')
    .eq('auth_user_id', authData.user.id)
    .eq('rol', 'admin')
    .single()

  if (!usuario) return { error: 'No autorizado', status: 403 }
  return { client: admin.client, userId: usuario.id }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function hoyISO() {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  return now.toISOString()
}

function hace7DiasISO() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

function hace30DiasISO() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

// ── GET /api/obs/summary ───────────────────────────────────────────────────────
// Devuelve el resumen ejecutivo del sistema para el dashboard Observación.
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { client } = auth

  const hoy = hoyISO()
  const hace7 = hace7DiasISO()
  const hace30 = hace30DiasISO()

  const [
    sesionesHoy,
    eventosHoy,
    erroresHoy,
    sesiones7d,
    eventosGps7d,
    eventosFoto7d,
    eventosIngreso7d,
    eventosSupervision7d,
    fichajosHoy,
    turnosHoy,
    novedadesAbiertas,
    erroresRecientes,
    eventosXScreen7d,
    eventosXVersion7d,
    sesionesXDispositivo7d,
    sesionesXOS7d,
    auditoriasRecientes,
  ] = await Promise.allSettled([
    // Sesiones activas hoy
    client.from('os_sessions').select('id, user_id, user_rol, started_at, ended_at, device_type, os_name, app_version').gte('started_at', hoy),
    // Eventos hoy: conteo por categoría
    client.from('os_events').select('event_category, value_text, err_code').gte('created_at', hoy),
    // Errores hoy
    client.from('os_events').select('event_name, err_code, err_message, user_id, objetivo_id, app_version, client_ts, screen, device_type').not('err_code', 'is', null).gte('created_at', hoy).order('client_ts', { ascending: false }).limit(20),
    // Sesiones 7 días
    client.from('os_sessions').select('id, user_rol, device_type, os_name, app_version, duration_s, started_at').gte('started_at', hace7),
    // Eventos GPS 7 días
    client.from('os_events').select('event_name, value_text').like('event_name', 'gps_%').gte('created_at', hace7),
    // Eventos foto/upload 7 días
    client.from('os_events').select('event_name, value_text').in('event_name', ['photo_taken','photo_upload_completed','photo_upload_failed','ingreso_confirmed','ingreso_error']).gte('created_at', hace7),
    // Ingresos/egresos 7 días
    client.from('os_events').select('event_name, duration_ms, value_text').in('event_name', ['ingreso_confirmed','ingreso_error','ingreso_cancelled','egreso_confirmed','egreso_error']).gte('created_at', hace7),
    // Supervisiones 7 días
    client.from('os_events').select('event_name, value_text').in('event_name', ['supervision_saved','supervision_error','supervision_abandoned']).gte('created_at', hace7),
    // Fichajes hoy desde tabla operativa
    client.from('registros_asistencia').select('id, guardia_id, hora_entrada_real, hora_salida_real, alerta_entrada, gps_ingreso_estado').gte('created_at', hoy),
    // Turnos hoy desde tabla operativa
    client.from('turnos').select('id, guardia_id, estado').gte('fecha', hoy.slice(0, 10)).lte('fecha', hoy.slice(0, 10)),
    // Novedades abiertas
    client.from('novedades').select('id, prioridad, tipo, objetivo_id, created_at').in('estado', ['pendiente', 'revisada']).order('created_at', { ascending: false }).limit(50),
    // Errores recientes (últimas 48h con más contexto)
    client.from('os_events').select('id, event_name, err_code, err_message, user_id, objetivo_id, app_version, client_ts, screen, device_type, os_name').not('err_code', 'is', null).gte('created_at', new Date(Date.now() - 48*60*60*1000).toISOString()).order('client_ts', { ascending: false }).limit(50),
    // Uso de pantallas 7 días
    client.from('os_events').select('screen, event_category').not('screen', 'is', null).gte('created_at', hace7),
    // Eventos por versión 7 días
    client.from('os_events').select('app_version, event_category, err_code').not('app_version', 'is', null).gte('created_at', hace7),
    // Sesiones por dispositivo 7 días
    client.from('os_sessions').select('device_type, os_name, browser_name, app_version').gte('started_at', hace7),
    // Sesiones por OS 7 días
    client.from('os_sessions').select('os_name, user_rol').gte('started_at', hace7),
    // Auditorías recientes
    client.from('registros_asistencia_auditoria').select('id, campo, valor_anterior, valor_nuevo, motivo, created_at, modificado_por, turno_id').order('created_at', { ascending: false }).limit(20),
  ])

  const value = <T,>(r: PromiseSettledResult<{ data: T | null }>) => r.status === 'fulfilled' ? (r.value?.data ?? []) : []

  // ── Procesamiento ────────────────────────────────────────────────────────────

  const sesionesHoyData = value<any[]>(sesionesHoy as any) as any[]
  const eventosHoyData  = value<any[]>(eventosHoy as any)  as any[]
  const erroresHoyData  = value<any[]>(erroresHoy as any)  as any[]
  const sesiones7dData  = value<any[]>(sesiones7d as any)  as any[]
  const gps7d           = value<any[]>(eventosGps7d as any) as any[]
  const foto7d          = value<any[]>(eventosFoto7d as any) as any[]
  const ingreso7d       = value<any[]>(eventosIngreso7d as any) as any[]
  const supervision7d   = value<any[]>(eventosSupervision7d as any) as any[]
  const fichajosHoyData = value<any[]>(fichajosHoy as any) as any[]
  const turnosHoyData   = value<any[]>(turnosHoy as any)   as any[]
  const novedadesData   = value<any[]>(novedadesAbiertas as any) as any[]
  const errRecientes    = value<any[]>(erroresRecientes as any) as any[]
  const screensData     = value<any[]>(eventosXScreen7d as any) as any[]
  const versionData     = value<any[]>(eventosXVersion7d as any) as any[]
  const dispositivosData = value<any[]>(sesionesXDispositivo7d as any) as any[]
  const auditoriasData  = value<any[]>(auditoriasRecientes as any) as any[]

  // Sesiones hoy
  const sesionesActivasHoy = sesionesHoyData.filter(s => !s.ended_at).length
  const sesionesTotalesHoy = sesionesHoyData.length
  const usuariosUnicosHoy  = new Set(sesionesHoyData.map(s => s.user_id)).size

  // Eventos hoy
  const totalEventosHoy = eventosHoyData.length
  const erroresHoyCnt   = eventosHoyData.filter(e => e.err_code).length
  const byCategoria     = eventosHoyData.reduce((acc: Record<string, number>, e: any) => {
    acc[e.event_category] = (acc[e.event_category] || 0) + 1
    return acc
  }, {})

  // GPS 7 días
  const gpsRequested = gps7d.filter(e => e.event_name === 'gps_requested').length
  const gpsSuccess   = gps7d.filter(e => e.event_name === 'gps_success').length
  const gpsError     = gps7d.filter(e => ['gps_denied','gps_timeout','gps_imprecise'].includes(e.event_name)).length
  const tasaGpsPct   = gpsRequested > 0 ? Math.round(gpsSuccess / gpsRequested * 100) : null

  // Ingresos 7 días
  const ingresosOk     = ingreso7d.filter(e => e.event_name === 'ingreso_confirmed').length
  const ingresosFail   = ingreso7d.filter(e => e.event_name === 'ingreso_error').length
  const ingresosCancelled = ingreso7d.filter(e => e.event_name === 'ingreso_cancelled').length
  const ingresosTotal  = ingresosOk + ingresosFail + ingresosCancelled
  const tasaIngresosPct = ingresosTotal > 0 ? Math.round(ingresosOk / ingresosTotal * 100) : null

  // P50 duración ingresos confirmados
  const duraciones = ingreso7d.filter(e => e.event_name === 'ingreso_confirmed' && e.duration_ms > 0).map(e => e.duration_ms).sort((a,b) => a-b)
  const p50Ingreso = duraciones.length > 0 ? duraciones[Math.floor(duraciones.length / 2)] : null
  const p95Ingreso = duraciones.length > 0 ? duraciones[Math.floor(duraciones.length * 0.95)] : null

  // Supervisiones 7 días
  const supervisionesOk   = supervision7d.filter(e => e.event_name === 'supervision_saved').length
  const supervisionesFail = supervision7d.filter(e => e.event_name === 'supervision_error').length
  const supervisionesAbandoned = supervision7d.filter(e => e.event_name === 'supervision_abandoned').length

  // Fichajes hoy (tabla operativa)
  const fichajesEntrada = fichajosHoyData.filter(r => r.hora_entrada_real).length
  const fichajesSinFichar = fichajosHoyData.filter(r => !r.hora_entrada_real).length
  const fichajesTardanza = fichajosHoyData.filter(r => r.alerta_entrada === 'tarde').length
  const fichajesFueraRadio = fichajosHoyData.filter(r => r.gps_ingreso_estado === 'fuera_radio').length

  // Turnos hoy (tabla operativa)
  const turnosCubiertos    = turnosHoyData.filter(t => t.guardia_id && t.estado === 'cubierto').length
  const turnosProgramados  = turnosHoyData.length
  const turnosDescubiertos = turnosHoyData.filter(t => t.estado === 'descubierto').length

  // Novedades
  const novedadesUrgentes   = novedadesData.filter(n => n.prioridad === 'urgente').length
  const novedadesImportantes = novedadesData.filter(n => n.prioridad === 'importante').length

  // Pantallas más usadas 7 días
  const screenCounts = screensData.reduce((acc: Record<string, number>, e: any) => {
    if (e.screen) acc[e.screen] = (acc[e.screen] || 0) + 1
    return acc
  }, {})
  const pantallasOrdenadas = Object.entries(screenCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)

  // Versiones activas 7 días
  const versionCounts = versionData.reduce((acc: Record<string, { total: number; errores: number }>, e: any) => {
    if (!e.app_version) return acc
    if (!acc[e.app_version]) acc[e.app_version] = { total: 0, errores: 0 }
    acc[e.app_version].total++
    if (e.err_code) acc[e.app_version].errores++
    return acc
  }, {})

  // Dispositivos 7 días
  const dispositivoCounts = dispositivosData.reduce((acc: Record<string, number>, e: any) => {
    const tipo = e.device_type || 'desconocido'
    acc[tipo] = (acc[tipo] || 0) + 1
    return acc
  }, {})
  const osCounts = dispositivosData.reduce((acc: Record<string, number>, e: any) => {
    const os = e.os_name || 'desconocido'
    acc[os] = (acc[os] || 0) + 1
    return acc
  }, {})

  // Usuarios activos 7 días por rol
  const usuariosXRol7d = sesiones7dData.reduce((acc: Record<string, Set<string>>, s: any) => {
    if (!acc[s.user_rol]) acc[s.user_rol] = new Set()
    acc[s.user_rol].add(s.user_id)
    return acc
  }, {})

  // Semáforo general del sistema
  const tasaErrorHoy = totalEventosHoy > 0 ? erroresHoyCnt / totalEventosHoy * 100 : 0
  let estadoSistema: 'operativo' | 'atencion' | 'critico' = 'operativo'
  if (tasaErrorHoy > 10 || novedadesUrgentes > 3 || turnosDescubiertos > 2) estadoSistema = 'atencion'
  if (tasaErrorHoy > 20 || novedadesUrgentes > 5) estadoSistema = 'critico'

  return NextResponse.json({
    generado_en: new Date().toISOString(),
    estado_sistema: estadoSistema,
    sesiones: {
      activas_hoy: sesionesActivasHoy,
      totales_hoy: sesionesTotalesHoy,
      usuarios_unicos_hoy: usuariosUnicosHoy,
      usuarios_x_rol_7d: Object.fromEntries(Object.entries(usuariosXRol7d).map(([k, v]) => [k, (v as Set<string>).size])),
    },
    eventos: {
      total_hoy: totalEventosHoy,
      errores_hoy: erroresHoyCnt,
      tasa_error_pct: tasaErrorHoy,
      por_categoria: byCategoria,
    },
    operaciones: {
      gps: { solicitados_7d: gpsRequested, exitosos_7d: gpsSuccess, fallidos_7d: gpsError, tasa_exito_pct: tasaGpsPct },
      ingresos: { exitosos_7d: ingresosOk, fallidos_7d: ingresosFail, cancelados_7d: ingresosCancelled, tasa_exito_pct: tasaIngresosPct, p50_ms: p50Ingreso, p95_ms: p95Ingreso },
      supervisiones: { exitosas_7d: supervisionesOk, fallidas_7d: supervisionesFail, abandonadas_7d: supervisionesAbandoned },
    },
    cobertura_hoy: {
      turnos_programados: turnosProgramados,
      turnos_cubiertos: turnosCubiertos,
      turnos_descubiertos: turnosDescubiertos,
      fichajes_entrada: fichajesEntrada,
      tardanzas: fichajesTardanza,
      fuera_radio: fichajesFueraRadio,
    },
    novedades: {
      urgentes_abiertas: novedadesUrgentes,
      importantes_abiertas: novedadesImportantes,
      total_abiertas: novedadesData.length,
    },
    pantallas_mas_usadas_7d: pantallasOrdenadas,
    versiones_activas_7d: versionCounts,
    dispositivos_7d: { por_tipo: dispositivoCounts, por_os: osCounts },
    errores_recientes: errRecientes.slice(0, 20),
    auditorias_recientes: auditoriasData,
  })
}
