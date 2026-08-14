import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, isObsAuthErr } from '../../_lib/obs-auth'
import { fetchPaginadoResult } from '@/lib/fetch-paginado'

const MAX_EVENTS = 10_000

function diasAtrasISO(dias: number) {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  d.setHours(0, 0, 0, 0)
  return d.toISOString()
}

// ── GET /api/obs/usage ─────────────────────────────────────────────────────────
// Análisis de cómo la empresa usa la aplicación.
// Query params: days (default 30)
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (isObsAuthErr(auth)) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { client } = auth

  const p    = req.nextUrl.searchParams
  const days = Math.min(90, Math.max(1, parseInt(p.get('days') || '30', 10)))
  const desde = diasAtrasISO(days)

  const [
    eventosRes,
    eventosTotalRes,
    usuariosRes,
    objetivosRes,
    intervencioneRes,
    auditoriasRes,
    supervisionesRes,
    novedadesRes,
  ] = await Promise.all([
    // Techo deliberado de MAX_EVENTS: no tiene sentido bajar cientos de miles
    // de filas para un tablero. Pero `.limit(MAX_EVENTS)` no lo cumplía: el
    // tope de PostgREST (1000) manda sobre el del cliente, así que el análisis
    // corría sobre 1.000 eventos y encima sin ORDER BY, o sea un subconjunto
    // arbitrario y no "los más recientes". Se pagina hasta el techo real, con
    // orden estable para que sean efectivamente los últimos.
    fetchPaginadoResult((d, h) =>
      client.from('os_events')
        // `device_type` NO existe en os_events —está en os_sessions— y venía en
        // el select desde que se escribió la ruta. PostgREST devolvía 400, el
        // .data quedaba en null y el análisis de eventos corría sobre un array
        // vacío. Como `0 >= MAX_EVENTS` es false, encima se declaraba completo.
        .select('user_id, user_rol, event_name, event_category, screen, objetivo_id, duration_ms, value_text, err_code, app_version, client_ts, id, created_at')
        .gte('created_at', desde)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(d, h),
      undefined,
      MAX_EVENTS),
    // Cuántos hay REALMENTE en la ventana. Sin este número no se puede saber si
    // el techo se alcanzó: comparar la cantidad traída contra MAX_EVENTS fallaba
    // en silencio cuando el tope efectivo era otro.
    client.from('os_events').select('id', { count: 'exact', head: true }).gte('created_at', desde),
    client.from('usuarios').select('id, nombre, apellido, rol, estado'),
    client.from('objetivos').select('id, nombre, cliente, estado'),
    client.from('supervisor_intervenciones').select('id, supervisor_id, tipo_alerta, accion, created_at').gte('created_at', desde).limit(5000),
    client.from('registros_asistencia_auditoria').select('id, modificado_por, campo, motivo, created_at').gte('created_at', desde).limit(5000),
    // Se truncaba en 1000 apenas la ventana superara ese volumen. Se agrega el
    // orden explícito porque sin él la paginación no es determinista: PostgREST
    // no garantiza el mismo orden entre páginas si no se lo pedís.
    fetchPaginadoResult((d, h) =>
      client.from('supervisiones').select('id, supervisor_id, objetivo_id, estado, created_at')
        .gte('created_at', desde)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(d, h)),
    client.from('novedades').select('id, guardia_id, objetivo_id, prioridad, estado, tipo, created_at').gte('created_at', desde).limit(2000),
  ])

  const eventos      = eventosRes.data ?? []
  const usuarios     = usuariosRes.data ?? []
  const objetivos    = objetivosRes.data ?? []
  const intervenciones = intervencioneRes.data ?? []
  const auditorias   = auditoriasRes.data ?? []
  const supervisiones = supervisionesRes.data ?? []
  const novedades    = novedadesRes.data ?? []

  const usuMap = new Map(usuarios.map((u: any) => [u.id, u]))
  const objMap = new Map(objetivos.map((o: any) => [o.id, o]))

  // ── Uso de pantallas ──────────────────────────────────────────────────────────
  const screenCount = eventos.reduce((acc: Record<string, number>, e: any) => {
    if (e.screen) acc[e.screen] = (acc[e.screen] || 0) + 1
    return acc
  }, {})
  const pantallasRanking = Object.entries(screenCount).sort((a, b) => (b[1] as number) - (a[1] as number))

  // ── Uso por event_name ────────────────────────────────────────────────────────
  const eventCount = eventos.reduce((acc: Record<string, number>, e: any) => {
    acc[e.event_name] = (acc[e.event_name] || 0) + 1
    return acc
  }, {})
  const eventosRanking = Object.entries(eventCount).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 30)

  // ── Actividad por usuario ─────────────────────────────────────────────────────
  const userActivity = eventos.reduce((acc: Record<string, { total: number; errores: number; pantallas: Set<string>; rol: string }>, e: any) => {
    if (!e.user_id) return acc
    if (!acc[e.user_id]) acc[e.user_id] = { total: 0, errores: 0, pantallas: new Set(), rol: e.user_rol }
    acc[e.user_id].total++
    if (e.err_code) acc[e.user_id].errores++
    if (e.screen) acc[e.user_id].pantallas.add(e.screen)
    return acc
  }, {})

  const actividadPorUsuario = Object.entries(userActivity)
    .map(([userId, data]: [string, any]) => ({
      user_id: userId,
      usuario: usuMap.get(userId) ?? null,
      total_eventos: data.total,
      errores: data.errores,
      tasa_error_pct: data.total > 0 ? Math.round(data.errores / data.total * 100) : 0,
      pantallas_distintas: data.pantallas.size,
      rol: data.rol,
    }))
    .sort((a, b) => b.total_eventos - a.total_eventos)

  // ── Actividad por objetivo ────────────────────────────────────────────────────
  const objActivity = eventos.reduce((acc: Record<string, { total: number; errores: number }>, e: any) => {
    if (!e.objetivo_id) return acc
    if (!acc[e.objetivo_id]) acc[e.objetivo_id] = { total: 0, errores: 0 }
    acc[e.objetivo_id].total++
    if (e.err_code) acc[e.objetivo_id].errores++
    return acc
  }, {})

  const actividadPorObjetivo = Object.entries(objActivity)
    .map(([objId, data]: [string, any]) => ({
      objetivo_id: objId,
      objetivo: objMap.get(objId) ?? null,
      total_eventos: data.total,
      errores: data.errores,
    }))
    .sort((a, b) => b.total_eventos - a.total_eventos)

  // ── Supervisores más activos ──────────────────────────────────────────────────
  const supervXSupervisor = supervisiones.reduce((acc: Record<string, number>, s: any) => {
    acc[s.supervisor_id] = (acc[s.supervisor_id] || 0) + 1
    return acc
  }, {})
  const supervisoresRanking = Object.entries(supervXSupervisor)
    .map(([uid, cnt]) => ({ usuario: usuMap.get(uid) ?? { id: uid }, supervisiones: cnt }))
    .sort((a, b) => (b.supervisiones as number) - (a.supervisiones as number))
    .slice(0, 10)

  // ── Guardias con más errores GPS ──────────────────────────────────────────────
  const gpsErrors = eventos.filter((e: any) => ['gps_denied','gps_timeout','gps_imprecise'].includes(e.event_name))
  const gpsErrXUser = gpsErrors.reduce((acc: Record<string, number>, e: any) => {
    if (e.user_id) acc[e.user_id] = (acc[e.user_id] || 0) + 1
    return acc
  }, {})
  const gpsErroresRanking = Object.entries(gpsErrXUser)
    .map(([uid, cnt]) => ({ usuario: usuMap.get(uid) ?? { id: uid }, errores_gps: cnt }))
    .sort((a, b) => (b.errores_gps as number) - (a.errores_gps as number))
    .slice(0, 10)

  // ── Intervenciones por supervisor ─────────────────────────────────────────────
  const intervXSupervisor = intervenciones.reduce((acc: Record<string, number>, i: any) => {
    if (i.supervisor_id) acc[i.supervisor_id] = (acc[i.supervisor_id] || 0) + 1
    return acc
  }, {})
  const intervencionesRanking = Object.entries(intervXSupervisor)
    .map(([uid, cnt]) => ({ usuario: usuMap.get(uid) ?? { id: uid }, intervenciones: cnt }))
    .sort((a, b) => (b.intervenciones as number) - (a.intervenciones as number))
    .slice(0, 10)

  // ── Correcciones por admin ────────────────────────────────────────────────────
  const correccionesXAdmin = auditorias.reduce((acc: Record<string, number>, a: any) => {
    if (a.modificado_por) acc[a.modificado_por] = (acc[a.modificado_por] || 0) + 1
    return acc
  }, {})
  const correccionesRanking = Object.entries(correccionesXAdmin)
    .map(([uid, cnt]) => ({ usuario: usuMap.get(uid) ?? { id: uid }, correcciones: cnt }))
    .sort((a, b) => (b.correcciones as number) - (a.correcciones as number))
    .slice(0, 10)

  // ── Novedades por objetivo ────────────────────────────────────────────────────
  const novedadesXObj = novedades.reduce((acc: Record<string, number>, n: any) => {
    if (n.objetivo_id) acc[n.objetivo_id] = (acc[n.objetivo_id] || 0) + 1
    return acc
  }, {})
  const novedadesObjetivosRanking = Object.entries(novedadesXObj)
    .map(([objId, cnt]) => ({ objetivo: objMap.get(objId) ?? { id: objId }, novedades: cnt }))
    .sort((a, b) => (b.novedades as number) - (a.novedades as number))
    .slice(0, 10)

  // ── Operaciones sin finalizar (posibles abandonos) ────────────────────────────
  const ingresoStarted = new Set(eventos.filter((e: any) => e.event_name === 'ingreso_started').map((e: any) => e.user_id + e.client_ts?.slice(0, 10)))
  const ingresoConfirmed = new Set(eventos.filter((e: any) => e.event_name === 'ingreso_confirmed').map((e: any) => e.user_id + e.client_ts?.slice(0, 10)))
  const posiblesAbandonos = [...ingresoStarted].filter(k => !ingresoConfirmed.has(k)).length

  // El total real de la ventana, que es lo único que permite saber si quedó
  // algo afuera. Antes se comparaba la cantidad traída contra MAX_EVENTS: con
  // 1.000 eventos de 20.484, `1000 >= 10000` daba false y el tablero se
  // declaraba completo mientras analizaba el 5% de los datos.
  const eventosEnVentana = eventosTotalRes.count ?? null
  const eventosTruncados = eventosEnVentana != null
    ? eventosEnVentana > eventos.length
    : eventos.length >= MAX_EVENTS

  return NextResponse.json({
    periodo_dias: days,
    analisis_parcial: eventosTruncados,
    resumen: {
      total_eventos_analizados: eventos.length,
      total_eventos_en_ventana: eventosEnVentana,
      tope_analisis: MAX_EVENTS,
      usuarios_activos_periodo: actividadPorUsuario.length,
      objetivos_con_actividad: actividadPorObjetivo.length,
      supervisiones_realizadas: supervisiones.length,
      intervenciones_realizadas: intervenciones.length,
      correcciones_admin: auditorias.length,
      novedades_generadas: novedades.length,
      posibles_abandonos_ingreso: posiblesAbandonos,
    },
    pantallas_mas_usadas: pantallasRanking,
    eventos_mas_frecuentes: eventosRanking,
    actividad_por_usuario: actividadPorUsuario.slice(0, 20),
    actividad_por_objetivo: actividadPorObjetivo.slice(0, 20),
    supervisores_mas_activos: supervisoresRanking,
    guardias_mas_errores_gps: gpsErroresRanking,
    supervisores_mas_intervenciones: intervencionesRanking,
    admins_mas_correcciones: correccionesRanking,
    objetivos_mas_novedades: novedadesObjetivosRanking,
  })
}
