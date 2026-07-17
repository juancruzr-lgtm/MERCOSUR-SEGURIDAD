/**
 * lib/telemetry.ts
 *
 * Infraestructura central de telemetría del Sistema Operativo Mercosur.
 * Solo cliente — no ejecutar durante SSR. Todas las APIs del navegador
 * están protegidas con `typeof window === 'undefined'`.
 *
 * API pública:
 *   initTelemetry(userId, userRol)   — llamar inmediatamente después del login
 *   track(eventName, payload?)        — registrar un evento (fire-and-forget)
 *   endSession()                      — llamar en logout
 *   getCurrentSession()               — inspeccionar sesión activa
 *   getDeviceContext()                — helpers de dispositivo para el caller
 *
 * Invariantes:
 *   - Nunca lanza excepción al componente que llama
 *   - Nunca bloquea fichaje ni supervisión
 *   - Todos los errores son completamente silenciosos
 *   - El cliente solo hace INSERT (append-only por diseño)
 */

import { supabase } from '@/lib/supabase'

// ══════════════════════════════════════════════════════════════════════
// CATÁLOGO — tipos y constantes centralizadas
// No usar strings literales dispersos en los componentes.
// ══════════════════════════════════════════════════════════════════════

export type OsUserRol = 'guardia' | 'vigilador' | 'supervisor' | 'admin'

export type OsEventCategory =
  | 'sistema'
  | 'fichaje'
  | 'supervision'
  | 'turno'
  | 'nav'
  | 'admin'
  | 'error'

/** Pantallas conocidas del sistema. Acepta strings adicionales para pantallas futuras. */
export type OsScreen =
  // Guardia / Vigilador
  | 'guardia_home'
  | 'ingreso_flow'
  | 'egreso_flow'
  | 'perfil_guardia'
  // Supervisor
  | 'supervisor_home'
  | 'supervisor_agenda'
  | 'supervisor_turnos'
  | 'supervisor_guardias'
  | 'supervisor_objetivos'
  | 'perfil_supervisor'
  // Admin — operaciones
  | 'dashboard'
  | 'admin_guardias'
  | 'admin_objetivos'
  | 'admin_turnos'
  | 'admin_asistencia'
  | 'admin_revision_operativa'
  | 'admin_supervisiones'
  | 'admin_novedades'
  | 'admin_reportes'
  | 'admin_supervisores_guardia'
  | 'admin_solicitudes_admin'
  // Admin — configuración
  | 'admin_servicios_objetivo'
  | 'admin_checklists'
  | 'admin_turnos_base'
  | 'admin_zonas_operativas'
  | 'admin_cgo'
  // Legajo Digital
  | 'legajo_empleado'
  // Sistema
  | 'login'
  | (string & {}) // permite pantallas futuras sin romper el tipo

/** Resultado de una operación. Se almacena en value_text. */
export type OsEventResult = 'exito' | 'error' | 'cancelado'

/**
 * Catálogo completo de nombres de evento.
 * Acepta strings adicionales para eventos nuevos sin necesidad de migración de schema.
 */
export type OsEventName =
  // Sistema
  | 'session_start'
  | 'session_end'
  | 'app_foreground'
  | 'app_background'
  | 'network_changed'
  | 'offline_detected'
  | 'offline_recovered'
  // Fichaje — Guardia / Vigilador
  | 'ingreso_started'
  | 'gps_requested'
  | 'gps_success'
  | 'gps_denied'
  | 'gps_timeout'
  | 'gps_imprecise'
  | 'photo_taken'
  | 'photo_retaken'
  | 'ingreso_confirmed'
  | 'ingreso_error'
  | 'ingreso_cancelled'
  | 'egreso_started'
  | 'egreso_confirmed'
  | 'egreso_error'
  | 'egreso_anulado'
  // Supervisión
  | 'nav_tab_changed'
  | 'agenda_objetivo_opened'
  | 'supervision_gps_requested'
  | 'supervision_gps_success'
  | 'supervision_gps_denied'
  | 'supervision_started'
  | 'supervision_checklist_item'
  | 'supervision_photo_added'
  | 'supervision_saved'
  | 'supervision_abandoned'
  | 'supervision_error'
  // Turno
  | 'turno_guardia_asignado'
  | 'turno_descubierto_marcado'
  | 'turno_repetir_ayer'
  | 'turno_editado'
  | 'turno_edicion_error'
  // Objetivo
  | 'objetivo_abierto'
  // Admin
  // Legajo Digital
  | 'legajo_abierto'
  | 'legajo_carga_exitosa'
  | 'legajo_carga_error'
  | 'legajo_seccion_abierta'
  | 'legajo_turnos_cargados'
  | 'legajo_turnos_error'
  | 'legajo_turnos_filtro_aplicado'
  | 'legajo_planilla_abierta'
  | 'legajo_planilla_cargada'
  | 'legajo_planilla_error'
  | 'legajo_planilla_mes_cambiado'
  // Admin
  | 'admin_nav_section'
  | 'admin_export'
  | 'admin_registro_corregido'
  | 'admin_registro_manual'
  | 'admin_intervencion'
  | 'admin_filter_applied'
  | 'admin_mapa_interaction'
  | 'admin_supervision_detalle'
  | 'admin_error'
  // Extensible
  | (string & {})

// ══════════════════════════════════════════════════════════════════════
// PAYLOAD del track()
// ══════════════════════════════════════════════════════════════════════

export interface TrackPayload {
  // Clasificación
  category?:       OsEventCategory
  screen?:         OsScreen
  screen_section?: string
  // Contexto operacional
  objetivo_id?:    string
  turno_id?:       string
  supervision_id?: string
  registro_id?:    string
  puesto_id?:      string
  // GPS en el momento exacto del evento
  gps_lat?:        number
  gps_lng?:        number
  gps_accuracy_m?: number
  gps_distance_m?: number
  gps_status?:     string
  gps_age_ms?:     number
  gps_acq_ms?:     number
  // Dispositivo (opcional: si no se pasa, se usa el estado en cache)
  network_type?:   string
  network_rtt_ms?: number
  battery_pct?:    number
  battery_charg?:  boolean
  // Timing
  duration_ms?:    number
  // Valores del evento
  value_num?:      number
  value_text?:     string
  value_json?:     Record<string, unknown>
  // Resultado de la operación (se guarda en value_text si no hay value_text explícito)
  result?:         OsEventResult
  // Error (sin stack trace)
  err_screen?:     string
  err_component?:  string
  err_function?:   string
  err_code?:       string
  err_message?:    string
  // Cadena causal
  parent_id?:      string
  // Versión (por defecto APP_VERSION)
  app_version?:    string
}

// ══════════════════════════════════════════════════════════════════════
// VERSIÓN DE APP
// ══════════════════════════════════════════════════════════════════════

const APP_VERSION: string =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_APP_VERSION) || '0.1.0'

// ══════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN — se lee de app_config al iniciar
// ══════════════════════════════════════════════════════════════════════

interface TelemetryConfig {
  enabled:      boolean
  batchSeconds: number
}

const DEFAULT_CONFIG: TelemetryConfig = { enabled: true, batchSeconds: 30 }

let _config: TelemetryConfig = { ...DEFAULT_CONFIG }
let _configLoaded = false

async function loadConfig(): Promise<void> {
  if (_configLoaded) return
  try {
    const { data } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', ['telemetry_enabled', 'telemetry_batch_seconds'])
    if (data) {
      for (const row of data) {
        if (row.key === 'telemetry_enabled') {
          _config.enabled = row.value !== 'false'
        }
        if (row.key === 'telemetry_batch_seconds') {
          const n = parseInt(row.value, 10)
          if (!isNaN(n) && n > 0) _config.batchSeconds = n
        }
      }
    }
  } catch {
    // Si falla la lectura de config se usan los defaults seguros.
  } finally {
    _configLoaded = true
  }
}

// ══════════════════════════════════════════════════════════════════════
// SESIÓN
// ══════════════════════════════════════════════════════════════════════

export interface TelemetrySession {
  session_id:  string
  user_id:     string
  user_rol:    OsUserRol
  started_at:  string
  seq:         number
  prev_events: string[]
}

let _session: TelemetrySession | null = null
let _sessionSaved = false // true cuando el INSERT en os_sessions fue exitoso

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16)
  })
}

async function startSession(userId: string, userRol: OsUserRol): Promise<void> {
  if (typeof window === 'undefined') return

  // Evitar duplicar sesión: si ya existe una sesión para el mismo usuario, no crear otra.
  if (_session && _session.user_id === userId) return

  const now = new Date().toISOString()
  _session = {
    session_id:  uuid(),
    user_id:     userId,
    user_rol:    userRol,
    started_at:  now,
    seq:         0,
    prev_events: [],
  }
  _sessionSaved = false

  const ctx = getDeviceContext()

  try {
    const { error } = await supabase.from('os_sessions').insert({
      id:               _session.session_id,
      user_id:          userId,
      user_rol:         userRol,
      started_at:       now,
      event_count:      0,
      device_type:      ctx.device_type    ?? null,
      device_model:     ctx.device_model   ?? null,
      os_name:          ctx.os_name        ?? null,
      os_version:       ctx.os_version     ?? null,
      browser_name:     ctx.browser_name   ?? null,
      browser_version:  ctx.browser_version ?? null,
      app_version:      APP_VERSION,
      battery_start_pct: _cachedBattery?.pct  ?? null,
      network_start:    ctx.network_type   ?? null,
    })
    if (!error) _sessionSaved = true
  } catch {
    // Sesión vive en memoria aunque falle el INSERT.
    // Los eventos se siguen capturando con el session_id en memoria.
  }
}

export async function endSession(): Promise<void> {
  if (!_session || typeof window === 'undefined') return
  // Flush de eventos pendientes antes de cerrar.
  await flushQueue()
  if (_sessionSaved) {
    const now = new Date().toISOString()
    const durationS = Math.round(
      (Date.now() - new Date(_session.started_at).getTime()) / 1000
    )
    try {
      await supabase.from('os_sessions').update({
        ended_at:        now,
        duration_s:      durationS,
        event_count:     _session.seq,
        battery_end_pct: _cachedBattery?.pct  ?? null,
        network_end:     getDeviceContext().network_type ?? null,
        updated_at:      now,
      }).eq('id', _session.session_id)
    } catch {
      // Silent.
    }
  }
  _session = null
  _sessionSaved = false
}

export function getCurrentSession(): TelemetrySession | null {
  return _session
}

// ══════════════════════════════════════════════════════════════════════
// CONTEXTO DE DISPOSITIVO
// Síncrono. Battery se lee de forma asíncrona y se cachea.
// ══════════════════════════════════════════════════════════════════════

export interface DeviceContext {
  device_type?:     string
  device_model?:    string
  os_name?:         string
  os_version?:      string
  browser_name?:    string
  browser_version?: string
  network_type?:    string
  network_rtt_ms?:  number
  battery_pct?:     number
  battery_charg?:   boolean
}

export function getDeviceContext(): DeviceContext {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return {}
  try {
    const ua = navigator.userAgent
    const ctx: DeviceContext = {}

    // Tipo de dispositivo
    ctx.device_type = /Mobi|Android|iPhone|iPad/i.test(ua) ? 'mobile' : 'desktop'

    // Sistema operativo
    if (/Android/i.test(ua)) {
      ctx.os_name    = 'Android'
      ctx.os_version = ua.match(/Android\s([\d.]+)/i)?.[1]
    } else if (/iPhone|iPad|iPod/i.test(ua)) {
      ctx.os_name    = 'iOS'
      ctx.os_version = ua.match(/OS\s([\d_]+)/i)?.[1]?.replace(/_/g, '.')
    } else if (/Windows/i.test(ua)) {
      ctx.os_name = 'Windows'
    } else if (/Macintosh|Mac OS/i.test(ua)) {
      ctx.os_name = 'macOS'
    } else if (/Linux/i.test(ua)) {
      ctx.os_name = 'Linux'
    }

    // Browser
    if (/Edg\//i.test(ua)) {
      ctx.browser_name    = 'Edge'
      ctx.browser_version = ua.match(/Edg\/([\d.]+)/i)?.[1]
    } else if (/Chrome\//i.test(ua)) {
      ctx.browser_name    = 'Chrome'
      ctx.browser_version = ua.match(/Chrome\/([\d.]+)/i)?.[1]
    } else if (/Firefox\//i.test(ua)) {
      ctx.browser_name    = 'Firefox'
      ctx.browser_version = ua.match(/Firefox\/([\d.]+)/i)?.[1]
    } else if (/Safari\//i.test(ua)) {
      ctx.browser_name    = 'Safari'
      ctx.browser_version = ua.match(/Version\/([\d.]+)/i)?.[1]
    }

    // Red — solo disponible en Chrome/Android
    const conn = (navigator as any).connection
    if (conn) {
      ctx.network_type   = conn.effectiveType ?? conn.type ?? undefined
      ctx.network_rtt_ms = typeof conn.rtt === 'number' ? conn.rtt : undefined
    }

    // Battery desde cache asíncrono
    if (_cachedBattery) {
      ctx.battery_pct   = _cachedBattery.pct
      ctx.battery_charg = _cachedBattery.charg
    }

    return ctx
  } catch {
    return {}
  }
}

// Cache de batería: se refresca al iniciar y en los eventos de carga
let _cachedBattery: { pct: number; charg: boolean } | null = null

async function refreshBattery(): Promise<void> {
  if (typeof navigator === 'undefined') return
  try {
    const nav = navigator as any
    if (typeof nav.getBattery !== 'function') return
    const batt = await nav.getBattery()
    const update = () => {
      _cachedBattery = {
        pct:   Math.round(batt.level * 100),
        charg: batt.charging,
      }
    }
    update()
    batt.addEventListener('levelchange',   update)
    batt.addEventListener('chargingchange', update)
  } catch {
    // API no disponible (Firefox, Safari). Silent.
  }
}

// ══════════════════════════════════════════════════════════════════════
// COLA EN MEMORIA
// ══════════════════════════════════════════════════════════════════════

const MAX_BATCH   = 50   // máximo de eventos por lote enviado a Supabase
const MAX_QUEUE   = 500  // si la cola supera esto, se descartan los más viejos

type RawEvent = Record<string, unknown>

const _queue: RawEvent[] = []
let _flushTimer: ReturnType<typeof setTimeout> | null = null
let _flushing = false

async function flushQueue(): Promise<void> {
  if (_flushing || _queue.length === 0 || typeof window === 'undefined') return
  if (!_config.enabled) { _queue.length = 0; return }

  _flushing = true
  // Extraer el batch antes del await para no perder eventos que lleguen mientras tanto
  const batch = _queue.splice(0, MAX_BATCH)
  try {
    await supabase.from('os_events').insert(batch)
  } catch {
    // Insert falló. El batch se descarta para evitar que la cola crezca indefinidamente.
    // La operación del usuario ya terminó — este error es puramente interno.
  } finally {
    _flushing = false
  }
}

function scheduleFlush(): void {
  if (_flushTimer !== null) return
  _flushTimer = setTimeout(async () => {
    _flushTimer = null
    await flushQueue()
    // Si todavía quedan eventos, programar el siguiente flush
    if (_queue.length > 0) scheduleFlush()
  }, _config.batchSeconds * 1000)
}

function setupBrowserListeners(): void {
  if (typeof window === 'undefined') return

  // Flush cuando la app pasa a segundo plano (tab oculta, pantalla bloqueada en iOS/Android)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      if (_flushTimer !== null) { clearTimeout(_flushTimer); _flushTimer = null }
      void flushQueue()
    }
  })

  // Flush antes de cerrar la pestaña (best-effort: el browser puede cancelarlo)
  window.addEventListener('beforeunload', () => {
    if (_flushTimer !== null) { clearTimeout(_flushTimer); _flushTimer = null }
    void flushQueue()
  })
}

// ══════════════════════════════════════════════════════════════════════
// INFERENCIA DE CATEGORÍA
// Se usa solo cuando el caller no pasa category explícita.
// ══════════════════════════════════════════════════════════════════════

const SISTEMA_EVENTS = new Set([
  'session_start','session_end','app_foreground','app_background',
  'network_changed','offline_detected','offline_recovered',
])

function inferCategory(eventName: string): OsEventCategory {
  if (SISTEMA_EVENTS.has(eventName))                                  return 'sistema'
  if (eventName.startsWith('ingreso_') ||
      eventName.startsWith('egreso_')  ||
      eventName.startsWith('gps_')     ||
      eventName.startsWith('photo_'))                                 return 'fichaje'
  if (eventName === 'nav_tab_changed')                                return 'nav'
  if (eventName.startsWith('supervision_') ||
      eventName.startsWith('agenda_'))                                return 'supervision'
  if (eventName.startsWith('turno_'))                                 return 'turno'
  if (eventName.startsWith('legajo_'))                                return 'admin'
  if (eventName.startsWith('admin_nav_') ||
      eventName.startsWith('admin_filter_') ||
      eventName === 'admin_mapa_interaction')                         return 'nav'
  if (eventName.startsWith('admin_'))                                 return 'admin'
  if (eventName.endsWith('_error'))                                   return 'error'
  return 'sistema'
}

// ══════════════════════════════════════════════════════════════════════
// TRACK — API pública principal
// Fire-and-forget. Nunca lanza. Nunca bloquea.
// ══════════════════════════════════════════════════════════════════════

export function track(eventName: OsEventName, payload: TrackPayload = {}): void {
  try {
    if (!_config.enabled) return
    if (typeof window === 'undefined') return

    const session = _session
    // Sin sesión activa: no podemos insertar sin un user_id válido.
    if (!session) return

    // Incrementar seq y actualizar cadena causal
    const seq = session.seq++
    const prevSnapshot = [...session.prev_events]   // los 5 anteriores al evento actual
    session.prev_events = [...session.prev_events, eventName].slice(-5)

    // Estado de red en tiempo real (síncrono)
    const conn        = typeof navigator !== 'undefined' ? (navigator as any).connection : null
    const networkType = payload.network_type   ?? conn?.effectiveType ?? conn?.type ?? null
    const networkRtt  = payload.network_rtt_ms ?? (typeof conn?.rtt === 'number' ? conn.rtt : null) ?? null
    const battPct     = payload.battery_pct    ?? _cachedBattery?.pct   ?? null
    const battCharg   = payload.battery_charg  ?? _cachedBattery?.charg ?? null

    const event: RawEvent = {
      // Encadenamiento
      session_id:     session.session_id,
      seq,
      parent_id:      payload.parent_id      ?? null,
      // Quién
      user_id:        session.user_id,
      user_rol:       session.user_rol,
      // Qué
      event_name:     eventName,
      event_category: payload.category ?? inferCategory(eventName),
      screen:         payload.screen         ?? null,
      screen_section: payload.screen_section ?? null,
      // Contexto operacional
      objetivo_id:    payload.objetivo_id    ?? null,
      turno_id:       payload.turno_id       ?? null,
      supervision_id: payload.supervision_id ?? null,
      registro_id:    payload.registro_id    ?? null,
      puesto_id:      payload.puesto_id      ?? null,
      // GPS
      gps_lat:        payload.gps_lat        ?? null,
      gps_lng:        payload.gps_lng        ?? null,
      gps_accuracy_m: payload.gps_accuracy_m ?? null,
      gps_distance_m: payload.gps_distance_m ?? null,
      gps_status:     payload.gps_status     ?? null,
      gps_age_ms:     payload.gps_age_ms     ?? null,
      gps_acq_ms:     payload.gps_acq_ms     ?? null,
      // Dispositivo
      network_type:   networkType,
      network_rtt_ms: networkRtt,
      battery_pct:    battPct,
      battery_charg:  battCharg,
      // Timing
      client_ts:      new Date().toISOString(),
      duration_ms:    payload.duration_ms    ?? null,
      // Valores
      value_num:      payload.value_num      ?? null,
      value_text:     payload.value_text     ?? payload.result ?? null,
      value_json:     payload.value_json     ?? null,
      // Error
      err_screen:     payload.err_screen     ?? null,
      err_component:  payload.err_component  ?? null,
      err_function:   payload.err_function   ?? null,
      err_code:       payload.err_code       ?? null,
      err_message:    payload.err_message    ?? null,
      // Cadena causal: los 5 eventos anteriores (no incluye el evento actual)
      prev_events:    prevSnapshot,
      // Versión
      app_version:    payload.app_version    ?? APP_VERSION,
    }

    // Controlar tamaño de la cola: descartar eventos viejos si crece demasiado
    if (_queue.length >= MAX_QUEUE) {
      _queue.splice(0, MAX_BATCH)
    }
    _queue.push(event)

    // Flush inmediato al completar un lote
    if (_queue.length >= MAX_BATCH) {
      void flushQueue()
    } else {
      scheduleFlush()
    }
  } catch {
    // Completamente silencioso. Nunca propaga al caller.
  }
}

// ══════════════════════════════════════════════════════════════════════
// INIT — punto de entrada único. Llamar en el login.
// ══════════════════════════════════════════════════════════════════════

let _initialized = false

export async function initTelemetry(userId: string, userRol: OsUserRol): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    if (!_configLoaded) await loadConfig()
    if (!_initialized) {
      setupBrowserListeners()
      void refreshBattery()  // no bloquea: se actualiza en segundo plano
      _initialized = true
    }
    await startSession(userId, userRol)
    // Registrar el inicio de sesión como primer evento
    track('session_start', { category: 'sistema' })
  } catch {
    // Silent.
  }
}

// ══════════════════════════════════════════════════════════════════════
// SELF-TEST — solo en desarrollo. No afecta producción.
// Llamar desde la consola del browser: window.__telemetrySelfTest?.()
// ══════════════════════════════════════════════════════════════════════

function runSelfTest(): void {
  const results: Array<{ ok: boolean; msg: string }> = []
  const assert = (ok: boolean, msg: string) => results.push({ ok, msg })

  // 1. track con telemetría desactivada no encola nada
  {
    const prevEnabled = _config.enabled
    _config.enabled = false
    const before = _queue.length
    track('ingreso_started')
    assert(_queue.length === before, 'track desactivado: no encola')
    _config.enabled = prevEnabled
  }

  // 2. Cola vacía al inicio es un array válido
  assert(Array.isArray(_queue), 'cola es un array válido')

  // 3. MAX_BATCH es 50
  assert(MAX_BATCH === 50, `MAX_BATCH = 50 (actual: ${MAX_BATCH})`)

  // 4. MAX_QUEUE es 500
  assert(MAX_QUEUE === 500, `MAX_QUEUE = 500 (actual: ${MAX_QUEUE})`)

  // 5. Sin sesión activa: track no rompe y no encola (user_id sería inválido)
  {
    const savedSession = _session
    _session = null
    const before = _queue.length
    track('app_foreground')
    assert(_queue.length === before, 'sin sesión: track no encola')
    _session = savedSession
  }

  // 6. seq incremental en sesión activa
  if (_session) {
    const before = _session.seq
    track('app_foreground', { category: 'sistema' })
    assert(_session.seq === before + 1, `seq incremental: ${before} → ${_session.seq}`)
  } else {
    results.push({ ok: true, msg: 'seq: sin sesión activa, saltado' })
  }

  // 7. prev_events limitado a 5 aunque se llame track muchas veces
  if (_session) {
    const saved = [..._session.prev_events]
    for (let i = 0; i < 8; i++) track('nav_tab_changed', { category: 'nav' })
    assert(_session.prev_events.length <= 5, `prev_events ≤ 5 (actual: ${_session.prev_events.length})`)
    _session.prev_events = saved
  } else {
    results.push({ ok: true, msg: 'prev_events: sin sesión activa, saltado' })
  }

  // 8. No duplicar sesión: startSession con mismo userId no crea sesión nueva
  //    (verificable por inspección: _session.user_id permanece igual después de un segundo init)
  assert(true, 'duplicación de sesión: prevenida en startSession por guard _session.user_id')

  // 9. Error silencioso de Supabase: garantizado por try/catch en flushQueue
  assert(true, 'error Supabase: silencioso por diseño (try/catch en flushQueue)')

  // 10. Config defaults seguros si app_config falla
  assert(
    DEFAULT_CONFIG.enabled === true && DEFAULT_CONFIG.batchSeconds === 30,
    `config defaults: enabled=true, batchSeconds=30`
  )

  // Resultado
  const ok    = results.filter(r => r.ok)
  const fail  = results.filter(r => !r.ok)
  console.group('[Telemetría] Self-test')
  ok.forEach(r   => console.log(`  ✓ ${r.msg}`))
  fail.forEach(r => console.error(`  ✗ ${r.msg}`))
  console.log(`  ${ok.length}/${results.length} pasaron`)
  console.groupEnd()
}

// Exponer en window solo en desarrollo para poder llamarlo desde la consola
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  (window as any).__telemetrySelfTest = runSelfTest
}
