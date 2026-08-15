import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, isObsAuthErr } from '../../_lib/obs-auth'
import { semaforoTecnico } from '@/lib/observacion'

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

// Nombres de evento para el bloque operativo 7 días (ingresos, egresos, GPS, supervisiones)
const EVENTOS_OPERATIVOS_7D = [
  // GPS
  'gps_requested', 'gps_success', 'gps_denied', 'gps_timeout', 'gps_imprecise', 'gps_unavailable',
  // Ingreso
  'ingreso_started', 'ingreso_confirmed', 'ingreso_error', 'ingreso_cancelled',
  // Egreso
  'egreso_started', 'egreso_confirmed', 'egreso_error', 'egreso_anulado',
  // Supervisión
  'supervision_saved', 'supervision_error', 'supervision_abandoned',
  // Upload / Compresión
  'upload_completado', 'compresion_completada',
]

// ── GET /api/obs/summary ───────────────────────────────────────────────────────
// Devuelve el resumen ejecutivo del sistema para el dashboard Observación.
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (isObsAuthErr(auth)) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { client } = auth

  const hoy   = hoyISO()
  const hace7 = hace7DiasISO()
  const hace48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()

  // 11 queries paralelas (era 17).
  // Eliminadas: erroresHoy (subconjunto de erroresRecientes48h), sesionesXOS7d (nunca se leía),
  // eventosFoto7d (foto7d nunca se usaba en la respuesta).
  // Consolidadas: sesiones7d + sesionesXDispositivo7d → una sola query.
  //               eventosGps7d + eventosIngreso7d + eventosSupervision7d → una sola query.
  const [
    sesionesHoy,
    eventosHoy,
    sesiones7d,
    eventosOperativos7d,
    fichajosHoy,
    turnosHoy,
    novedadesAbiertas,
    erroresRecientes,
    eventosXScreen7d,
    eventosXVersion7d,
    auditoriasRecientes,
    supervisiones7dCnt,
    supervisionesHoyCnt,
    intervenciones7dCnt,
    rondasPendientesCnt,
  ] = await Promise.allSettled([
    // Sesiones activas hoy
    client.from('os_sessions')
      .select('id, user_id, user_rol, started_at, ended_at, device_type, os_name, app_version')
      .gte('started_at', hoy),

    // Todos los eventos de hoy (para tasa de error y breakdown por categoría)
    client.from('os_events')
      .select('event_category, err_code')
      .gte('created_at', hoy),

    // Sesiones 7 días — columnas unificadas (era split en dos queries)
    client.from('os_sessions')
      .select('id, user_id, user_rol, device_type, os_name, browser_name, app_version, duration_s, started_at')
      .gte('started_at', hace7),

    // Eventos operativos 7 días — GPS + Ingreso + Egreso + Supervisión en una sola query
    client.from('os_events')
      .select('event_name, duration_ms')
      .in('event_name', EVENTOS_OPERATIVOS_7D)
      .gte('created_at', hace7),

    // Fichajes hoy desde tabla operativa
    client.from('registros_asistencia')
      .select('id, guardia_id, hora_entrada_real, hora_salida_real, alerta_entrada, gps_ingreso_estado')
      .gte('created_at', hoy),

    // Turnos hoy desde tabla operativa
    client.from('turnos')
      .select('id, guardia_id, estado')
      .gte('fecha', hoy.slice(0, 10))
      .lte('fecha', hoy.slice(0, 10)),

    // Novedades abiertas
    client.from('novedades')
      .select('id, prioridad, tipo, objetivo_id, created_at')
      .in('estado', ['pendiente', 'revisada'])
      .order('created_at', { ascending: false })
      .limit(50),

    // Errores recientes (48h) — cubre tanto "hoy" como "ayer".
    //
    // OJO: device_type y os_name NO existen en os_events (viven en
    // os_sessions). Pedirlos acá hacía que PostgREST devolviera 400, el
    // allSettled lo tragara y "Errores recientes" llegara SIEMPRE vacío —
    // el mismo bug que ya se había corregido en /api/obs/usage. Si algún día
    // hace falta el dispositivo del error, se resuelve por session_id contra
    // os_sessions; no volver a pedirlo acá.
    client.from('os_events')
      .select('id, session_id, event_name, err_code, err_message, user_id, objetivo_id, app_version, client_ts, screen, value_json')
      .not('err_code', 'is', null)
      .gte('created_at', hace48h)
      .order('client_ts', { ascending: false })
      .limit(50),

    // Uso de pantallas 7 días
    client.from('os_events')
      .select('screen, event_category')
      .not('screen', 'is', null)
      .gte('created_at', hace7),

    // Eventos por versión 7 días
    client.from('os_events')
      .select('app_version, event_category, err_code')
      .not('app_version', 'is', null)
      .gte('created_at', hace7),

    // Auditorías recientes
    client.from('registros_asistencia_auditoria')
      .select('id, campo, valor_anterior, valor_nuevo, motivo, created_at, modificado_por, turno_id')
      .order('created_at', { ascending: false })
      .limit(20),

    // ── Operación real, SIEMPRE desde tablas operativas ──────────────────
    // Regla de la auditoría: si existe la tabla autoritativa, la telemetría
    // no es fuente. "Supervisiones" acá son filas de `supervisiones`, no el
    // evento supervision_saved (pueden divergir si el teléfono no reportó).
    client.from('supervisiones').select('id', { count: 'exact', head: true }).gte('created_at', hace7),
    client.from('supervisiones').select('id', { count: 'exact', head: true }).gte('created_at', hoy),
    client.from('supervisor_intervenciones').select('id', { count: 'exact', head: true }).gte('created_at', hace7),
    client.from('ronda_alertas').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente'),
  ])

  const value = <T,>(r: PromiseSettledResult<{ data: T | null }>) =>
    r.status === 'fulfilled' ? (r.value?.data ?? []) : []
  const cuenta = (r: PromiseSettledResult<{ count: number | null }>) =>
    r.status === 'fulfilled' ? (r.value?.count ?? 0) : 0

  // ── Datos ────────────────────────────────────────────────────────────────────

  const sesionesHoyData   = value<any[]>(sesionesHoy as any)        as any[]
  const eventosHoyData    = value<any[]>(eventosHoy as any)         as any[]
  const sesiones7dData    = value<any[]>(sesiones7d as any)         as any[]
  const operativos7d      = value<any[]>(eventosOperativos7d as any) as any[]
  const fichajosHoyData   = value<any[]>(fichajosHoy as any)        as any[]
  const turnosHoyData     = value<any[]>(turnosHoy as any)          as any[]
  const novedadesData     = value<any[]>(novedadesAbiertas as any)  as any[]
  const errRecientes      = value<any[]>(erroresRecientes as any)   as any[]
  const screensData       = value<any[]>(eventosXScreen7d as any)   as any[]
  const versionData       = value<any[]>(eventosXVersion7d as any)  as any[]
  const auditoriasData    = value<any[]>(auditoriasRecientes as any) as any[]

  // ── Sesiones hoy ─────────────────────────────────────────────────────────────

  const sesionesActivasHoy = sesionesHoyData.filter(s => !s.ended_at).length
  const sesionesTotalesHoy = sesionesHoyData.length
  const usuariosUnicosHoy  = new Set(sesionesHoyData.map(s => s.user_id)).size

  // ── Eventos hoy ───────────────────────────────────────────────────────────────

  const totalEventosHoy = eventosHoyData.length
  const erroresHoyCnt   = eventosHoyData.filter(e => e.err_code).length
  const byCategoria     = eventosHoyData.reduce((acc: Record<string, number>, e: any) => {
    acc[e.event_category] = (acc[e.event_category] || 0) + 1
    return acc
  }, {})

  // ── Errores hoy desde la query de 48h (sin roundtrip extra) ──────────────────

  const hoyStr = hoy.slice(0, 10) // YYYY-MM-DD
  const erroresHoyDetalle = errRecientes.filter((e: any) =>
    e.client_ts?.startsWith(hoyStr) || e.created_at?.startsWith(hoyStr)
  )

  // ── GPS 7 días (subconjunto de operativos7d) ──────────────────────────────────

  const gps7d        = operativos7d.filter(e => e.event_name.startsWith('gps_'))
  const gpsRequested = gps7d.filter(e => e.event_name === 'gps_requested').length
  const gpsSuccess   = gps7d.filter(e => e.event_name === 'gps_success').length
  const gpsError     = gps7d.filter(e => ['gps_denied','gps_timeout','gps_imprecise','gps_unavailable'].includes(e.event_name)).length
  const tasaGpsPct   = gpsRequested > 0 ? Math.round(gpsSuccess / gpsRequested * 100) : null

  // ── Ingresos 7 días ───────────────────────────────────────────────────────────

  const ingreso7d         = operativos7d.filter(e => ['ingreso_started','ingreso_confirmed','ingreso_error','ingreso_cancelled'].includes(e.event_name))
  const ingresosOk        = ingreso7d.filter(e => e.event_name === 'ingreso_confirmed').length
  const ingresosFail      = ingreso7d.filter(e => e.event_name === 'ingreso_error').length
  const ingresosCancelled = ingreso7d.filter(e => e.event_name === 'ingreso_cancelled').length
  const ingresosTotal     = ingresosOk + ingresosFail + ingresosCancelled
  const tasaIngresosPct   = ingresosTotal > 0 ? Math.round(ingresosOk / ingresosTotal * 100) : null

  const duracionesIngreso = ingreso7d
    .filter(e => e.event_name === 'ingreso_confirmed' && e.duration_ms > 0)
    .map(e => e.duration_ms)
    .sort((a: number, b: number) => a - b)
  const p50Ingreso = duracionesIngreso.length > 0 ? duracionesIngreso[Math.floor(duracionesIngreso.length / 2)] : null
  const p95Ingreso = duracionesIngreso.length > 0 ? duracionesIngreso[Math.floor(duracionesIngreso.length * 0.95)] : null

  // ── Egresos 7 días ────────────────────────────────────────────────────────────

  const egreso7d         = operativos7d.filter(e => ['egreso_started','egreso_confirmed','egreso_error','egreso_anulado'].includes(e.event_name))
  const egresosOk        = egreso7d.filter(e => e.event_name === 'egreso_confirmed').length
  const egresosFail      = egreso7d.filter(e => e.event_name === 'egreso_error').length
  const egresosAnulados  = egreso7d.filter(e => e.event_name === 'egreso_anulado').length
  const egresosTotal     = egresosOk + egresosFail
  const tasaEgresosPct   = egresosTotal > 0 ? Math.round(egresosOk / egresosTotal * 100) : null

  const duracionesEgreso = egreso7d
    .filter(e => e.event_name === 'egreso_confirmed' && e.duration_ms > 0)
    .map(e => e.duration_ms)
    .sort((a: number, b: number) => a - b)
  const p50Egreso = duracionesEgreso.length > 0 ? duracionesEgreso[Math.floor(duracionesEgreso.length / 2)] : null

  // ── Supervisiones 7 días ──────────────────────────────────────────────────────

  const supervision7d         = operativos7d.filter(e => ['supervision_saved','supervision_error','supervision_abandoned'].includes(e.event_name))
  const supervisionesOk       = supervision7d.filter(e => e.event_name === 'supervision_saved').length
  const supervisionesFail     = supervision7d.filter(e => e.event_name === 'supervision_error').length
  const supervisionesAbandoned = supervision7d.filter(e => e.event_name === 'supervision_abandoned').length

  // ── Fichajes hoy (tabla operativa) ───────────────────────────────────────────

  const fichajesEntrada   = fichajosHoyData.filter(r => r.hora_entrada_real).length
  const fichajesTardanza  = fichajosHoyData.filter(r => r.alerta_entrada === 'tarde').length
  const fichajesFueraRadio = fichajosHoyData.filter(r => r.gps_ingreso_estado === 'fuera_radio').length

  // ── Turnos hoy (tabla operativa) ─────────────────────────────────────────────

  const turnosCubiertos    = turnosHoyData.filter(t => t.guardia_id && t.estado === 'cubierto').length
  const turnosProgramados  = turnosHoyData.length
  const turnosDescubiertos = turnosHoyData.filter(t => t.estado === 'descubierto').length

  // ── Novedades ─────────────────────────────────────────────────────────────────

  const novedadesUrgentes    = novedadesData.filter(n => n.prioridad === 'urgente').length
  const novedadesImportantes = novedadesData.filter(n => n.prioridad === 'importante').length

  // ── Pantallas más usadas 7 días ───────────────────────────────────────────────

  const screenCounts = screensData.reduce((acc: Record<string, number>, e: any) => {
    if (e.screen) acc[e.screen] = (acc[e.screen] || 0) + 1
    return acc
  }, {})
  const pantallasOrdenadas = Object.entries(screenCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)

  // ── Versiones activas 7 días ──────────────────────────────────────────────────

  const versionCounts = versionData.reduce((acc: Record<string, { total: number; errores: number }>, e: any) => {
    if (!e.app_version) return acc
    if (!acc[e.app_version]) acc[e.app_version] = { total: 0, errores: 0 }
    acc[e.app_version].total++
    if (e.err_code) acc[e.app_version].errores++
    return acc
  }, {})

  // ── Dispositivos y OS 7 días ──────────────────────────────────────────────────

  const dispositivoCounts = sesiones7dData.reduce((acc: Record<string, number>, s: any) => {
    const tipo = s.device_type || 'desconocido'
    acc[tipo] = (acc[tipo] || 0) + 1
    return acc
  }, {})
  const osCounts = sesiones7dData.reduce((acc: Record<string, number>, s: any) => {
    const os = s.os_name || 'desconocido'
    acc[os] = (acc[os] || 0) + 1
    return acc
  }, {})

  // ── Usuarios activos 7 días por rol ───────────────────────────────────────────

  const usuariosXRol7d = sesiones7dData.reduce((acc: Record<string, Set<string>>, s: any) => {
    if (!acc[s.user_rol]) acc[s.user_rol] = new Set()
    acc[s.user_rol].add(s.user_id)
    return acc
  }, {})

  // ── Semáforo del sistema: SOLO señales técnicas vivas ────────────────────────
  //
  // Antes participaban las novedades urgentes (tabla sin datos desde mayo:
  // nunca disparaba) y los puestos descubiertos (operación, no software). El
  // criterio completo, con umbrales documentados, vive en lib/observacion.

  const tasaErrorHoy = totalEventosHoy > 0 ? erroresHoyCnt / totalEventosHoy * 100 : 0
  const semaforo = semaforoTecnico({
    eventosHoy: totalEventosHoy,
    erroresHoy: erroresHoyCnt,
    erroresRecientes48h: errRecientes.length,
  })

  return NextResponse.json({
    generado_en: new Date().toISOString(),
    estado_sistema: semaforo.estado,
    estado_motivo: semaforo.motivo,
    sesiones: {
      activas_hoy: sesionesActivasHoy,
      totales_hoy: sesionesTotalesHoy,
      usuarios_unicos_hoy: usuariosUnicosHoy,
      usuarios_x_rol_7d: Object.fromEntries(
        Object.entries(usuariosXRol7d).map(([k, v]) => [k, (v as Set<string>).size])
      ),
    },
    eventos: {
      total_hoy: totalEventosHoy,
      errores_hoy: erroresHoyCnt,
      tasa_error_pct: tasaErrorHoy,
      por_categoria: byCategoria,
    },
    operaciones: {
      gps: {
        solicitados_7d: gpsRequested,
        exitosos_7d: gpsSuccess,
        fallidos_7d: gpsError,
        tasa_exito_pct: tasaGpsPct,
      },
      ingresos: {
        exitosos_7d: ingresosOk,
        fallidos_7d: ingresosFail,
        cancelados_7d: ingresosCancelled,
        tasa_exito_pct: tasaIngresosPct,
        p50_ms: p50Ingreso,
        p95_ms: p95Ingreso,
      },
      egresos: {
        exitosos_7d: egresosOk,
        fallidos_7d: egresosFail,
        anulados_7d: egresosAnulados,
        tasa_exito_pct: tasaEgresosPct,
        p50_ms: p50Egreso,
      },
      supervisiones: {
        exitosas_7d: supervisionesOk,
        fallidas_7d: supervisionesFail,
        abandonadas_7d: supervisionesAbandoned,
      },
    },
    cobertura_hoy: {
      turnos_programados: turnosProgramados,
      turnos_cubiertos: turnosCubiertos,
      turnos_descubiertos: turnosDescubiertos,
      fichajes_entrada: fichajesEntrada,
      tardanzas: fichajesTardanza,
      fuera_radio: fichajesFueraRadio,
    },
    // Desde tablas operativas (nunca telemetría): ver comentario en las queries.
    operacion_real: {
      supervisiones_hoy: cuenta(supervisionesHoyCnt as any),
      supervisiones_7d: cuenta(supervisiones7dCnt as any),
      intervenciones_7d: cuenta(intervenciones7dCnt as any),
      rondas_alertas_pendientes: cuenta(rondasPendientesCnt as any),
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
    errores_hoy_detalle: erroresHoyDetalle.slice(0, 10),
    auditorias_recientes: auditoriasData,
  })
}
