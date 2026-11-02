'use client'
// GPS tracking hook for supervisors.
// Captures route points while the supervisor has an active shift in supervisores_guardia.
// Completely silent on errors — never blocks operational flows.
// Only one watchPosition watcher is active at a time.

import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { track, getCurrentSession, getDeviceContext } from '@/lib/telemetry'
import {
  estadoInicial, haversineM, objetivoCercano as objetivoCercanoPuro, procesarLectura, trasRecuperacion,
  type EstadoMaquina, type EstadoMovimiento,
} from '@/lib/supervisor-gps-maquina'

// ── Types ─────────────────────────────────────────────────────────────────────

type TipoPunto =
  | 'session_start' | 'moving' | 'stopped'
  | 'objetivo_enter' | 'objetivo_inside' | 'supervision' | 'objetivo_exit'
  | 'session_end' | 'gps_recovered' | 'gps_error'

export interface ObjetivoGeo {
  id: string
  lat?: number | null
  lng?: number | null
  radio_metros?: number | null
}

export interface TurnoSupervisorRow {
  id: string
  supervisor_id: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

// Umbrales, intervalos e histéresis: lib/supervisor-gps-maquina.ts (pura y
// probada). Antes una sola lectura ruidosa alcanzaba para cambiar de estado.

// Opciones de watchPosition. maximumAge 60 s (antes 30 s): el navegador puede
// devolver una posición reciente sin despertar el GPS en cada callback.
export const OPCIONES_WATCH_GPS: PositionOptions = { enableHighAccuracy: true, maximumAge: 60_000, timeout: 20_000 }

// ── Pure helpers ───────────────────────────────────────────────────────────────

/**
 * session_id del punto: la sesión de telemetría si existe (SupervisorMobile la
 * inicia: así registran todos los supervisores, sin cambios). Si no existe
 * —vista de Administración—, un id propio por recorrido, generado una vez.
 */
export function idSesionPunto(
  sesionTelemetria: string | null | undefined,
  respaldo: { current: string | null },
): string {
  if (sesionTelemetria) return sesionTelemetria
  if (!respaldo.current) respaldo.current = crypto.randomUUID()
  return respaldo.current
}

/**
 * ¿Registrar el GPS mientras usa la vista de Administración? Sólo quien
 * además es supervisor (puesto supervisor o jefe de supervisores): hoy, Sergio
 * Martínez. En la vista Supervisor ya registra SupervisorMobile (no se duplica).
 * El recorrido arranca y para con su guardia programada, igual que los demás.
 */
export function registraGpsEnVistaAdmin(u: { puesto_organizacional?: string | null } | null | undefined): boolean {
  const p = u?.puesto_organizacional
  return p === 'supervisor' || p === 'jefe_supervisores'
}

// Returns the supervisor's own active shift for userId, or null.
// Handles night shifts that cross midnight (same logic as fechaHoraEnRango in SupervisorMobile).
function turnoActivoSupervisor(
  rows: TurnoSupervisorRow[],
  userId: string
): TurnoSupervisorRow | null {
  const ahora = new Date()
  for (const sg of rows) {
    if (sg.supervisor_id !== userId || sg.estado === 'inactivo') continue
    const [fy, fm, fd] = sg.fecha.slice(0, 10).split('-').map(Number)
    const [hi, mi]     = sg.hora_inicio.split(':').map(Number)
    const [hf, mf]     = sg.hora_fin.split(':').map(Number)
    const inicio = new Date(fy, fm - 1, fd, hi, mi, 0)
    const fin    = new Date(fy, fm - 1, fd, hf, mf, 0)
    if (fin <= inicio) fin.setDate(fin.getDate() + 1)   // cross-midnight shift
    if (ahora >= inicio && ahora < fin) return sg
  }
  return null
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSupervisorGps(
  userId: string,
  supervisoresGuardia: TurnoSupervisorRow[],
  objetivos: ObjetivoGeo[]
) {
  // All mutable state lives in refs — no re-renders triggered by GPS activity.
  const watcherRef      = useRef<number | null>(null)
  const seqRef          = useRef(0)
  const estadoRef       = useRef<EstadoMovimiento>('UNKNOWN')
  // Estado completo de la máquina (con candidatos de la histéresis).
  const maquinaRef      = useRef<EstadoMaquina>(estadoInicial())
  const ultimoPuntoRef  = useRef<{ lat: number; lng: number; ts: number; id: string } | null>(null)
  const objetivoActRef  = useRef<string | null>(null)
  const turnoIdRef      = useRef<string | null>(null)
  const trackingRef     = useRef(false)
  const wasHiddenRef    = useRef(false)
  const gpsEnabledRef   = useRef(true)
  const objetivosRef    = useRef(objetivos)
  // Respaldo de session_id (NOT NULL) para cuando no hay sesión de telemetría:
  // la vista de Administración no la inicia (Sergio). Con sesión, no se usa.
  const sesionRespaldoRef = useRef<string | null>(null)

  useEffect(() => { objetivosRef.current = objetivos }, [objetivos])

  // Load supervisor_gps_enabled feature flag once on mount.
  useEffect(() => {
    supabase
      .from('app_config')
      .select('value')
      .eq('key', 'supervisor_gps_enabled')
      .single()
      .then(({ data }) => { if (data?.value === 'false') gpsEnabledRef.current = false })
      .catch(() => {})
  }, [])

  // ── Helpers ────────────────────────────────────────────────────────────────

  function objetivoCercano(lat: number, lng: number): { id: string; distancia: number } | null {
    return objetivoCercanoPuro(lat, lng, objetivosRef.current)
  }

  async function insertarPunto(
    tipo: TipoPunto,
    lat: number,
    lng: number,
    ts: number,
    coords: { accuracy: number | null; speed: number | null; heading: number | null; altitude: number | null },
    extras: Record<string, unknown> = {}
  ): Promise<void> {
    try {
      const session  = getCurrentSession()
      const ctx      = getDeviceContext()
      const anterior = ultimoPuntoRef.current
      const rowId    = crypto.randomUUID()

      const distancia = anterior ? Math.round(haversineM(lat, lng, anterior.lat, anterior.lng)) : null
      const segundos  = anterior ? Math.round((ts - anterior.ts) / 1000) : null

      const row = {
        id:                         rowId,
        session_id:                 idSesionPunto(session?.session_id, sesionRespaldoRef),
        supervisor_id:              userId,
        client_ts:                  new Date(ts).toISOString(),
        latitud:                    lat,
        longitud:                   lng,
        precision_m:                coords.accuracy != null ? Math.round(coords.accuracy) : null,
        velocidad_m_s:              coords.speed ?? null,
        rumbo_grados:               coords.heading ?? null,
        altitud_m:                  coords.altitude ?? null,
        tipo_punto:                 tipo,
        estado_movimiento:          estadoRef.current,
        seq:                        seqRef.current++,
        punto_anterior_id:          anterior?.id ?? null,
        distancia_desde_anterior_m: distancia,
        segundos_desde_anterior:    segundos,
        battery_pct:                ctx.battery_pct   ?? null,
        battery_charging:           ctx.battery_charg ?? null,
        network_type:               ctx.network_type  ?? null,
        turno_supervisor_id:        turnoIdRef.current,
        ...extras,
      }

      ultimoPuntoRef.current = { lat, lng, ts, id: rowId }

      await supabase.from('supervisor_route_points').insert(row)
    } catch {
      // Silent — GPS tracking never blocks the operational flow.
    }
  }

  // ── State machine ──────────────────────────────────────────────────────────

  async function onPosition(pos: GeolocationPosition): Promise<void> {
    try {
      if (!trackingRef.current) return

      const { coords } = pos
      const lat = coords.latitude
      const lng = coords.longitude
      const ts  = pos.timestamp

      // App returned to foreground after potential GPS suspension.
      if (wasHiddenRef.current) {
        wasHiddenRef.current = false
        // Antes: estado UNKNOWN y objetivo olvidado → una entrada duplicada al
        // mismo objetivo en cada vuelta a primer plano. Ahora se conserva.
        maquinaRef.current = trasRecuperacion(maquinaRef.current)
        estadoRef.current  = maquinaRef.current.estado
        await insertarPunto('gps_recovered', lat, lng, ts, coords)
        track('supervisor_route_recovered', {
          category: 'supervision',
          gps_lat:  lat,
          gps_lng:  lng,
        })
        // Continue processing so this position also updates the state machine.
      }

      // Intervalos y velocidad calculada contra el último punto insertado de
      // cualquier tipo (session_start, gps_recovered, supervision), como antes.
      const u = ultimoPuntoRef.current
      const { estado, acciones } = procesarLectura(
        { ...maquinaRef.current, ultimo: u ? { lat: u.lat, lng: u.lng, ts: u.ts } : null },
        { lat, lng, ts, speed: coords.speed ?? null },
        objetivosRef.current,
      )
      maquinaRef.current     = estado
      objetivoActRef.current = estado.objetivoId

      for (const a of acciones) {
        // estado_movimiento del punto: el de la máquina en ese momento.
        estadoRef.current = a.tipo === 'objetivo_exit' ? 'UNKNOWN'
          : a.tipo === 'objetivo_enter' || a.tipo === 'objetivo_inside' ? 'IN_OBJETIVO'
          : estado.estado
        if (a.tipo === 'objetivo_exit') {
          await insertarPunto('objetivo_exit', lat, lng, ts, coords, { objetivo_cercano_id: a.objetivoId })
          track('supervisor_objetivo_exit', { category: 'supervision', objetivo_id: a.objetivoId, gps_lat: lat, gps_lng: lng })
        } else if (a.tipo === 'objetivo_enter') {
          await insertarPunto('objetivo_enter', lat, lng, ts, coords, { objetivo_cercano_id: a.objetivoId, objetivo_distancia_m: a.distancia })
          track('supervisor_objetivo_enter', { category: 'supervision', objetivo_id: a.objetivoId, gps_lat: lat, gps_lng: lng })
        } else if (a.tipo === 'objetivo_inside') {
          await insertarPunto('objetivo_inside', lat, lng, ts, coords, { objetivo_cercano_id: a.objetivoId, objetivo_distancia_m: a.distancia })
        } else {
          await insertarPunto(a.tipo, lat, lng, ts, coords)
        }
      }
      estadoRef.current = estado.estado
    } catch {
      // Silent.
    }
  }

  function onGpsError(err: GeolocationPositionError): void {
    if (!trackingRef.current) return
    try {
      // Can't insert to supervisor_route_points without coordinates (lat/lng NOT NULL).
      // Record in os_events only.
      track('supervisor_route_error', {
        category:    'error',
        err_code:    String(err.code),
        err_message: err.message,
      })
    } catch {
      // Silent.
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  function iniciarRecorrido(turno: TurnoSupervisorRow): void {
    if (watcherRef.current !== null) return          // guard: only one watcher
    if (typeof navigator === 'undefined') return
    if (!navigator.geolocation) {
      track('supervisor_route_error', { category: 'error', err_code: 'geolocation_unavailable' })
      return
    }

    trackingRef.current    = true
    turnoIdRef.current     = turno.id
    sesionRespaldoRef.current = null   // un id de respaldo por recorrido (sólo si no hay telemetría)
    seqRef.current         = 0
    estadoRef.current      = 'UNKNOWN'
    maquinaRef.current     = estadoInicial()
    ultimoPuntoRef.current = null
    objetivoActRef.current = null

    // Continuous watch for state machine.
    watcherRef.current = navigator.geolocation.watchPosition(
      (pos) => void onPosition(pos),
      onGpsError,
      OPCIONES_WATCH_GPS
    )

    // First fix for session_start point.
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (!trackingRef.current) return
        estadoRef.current = 'UNKNOWN'
        await insertarPunto('session_start', pos.coords.latitude, pos.coords.longitude, pos.timestamp, pos.coords)
        track('supervisor_route_started', {
          category: 'supervision',
          turno_id: turno.id,
          gps_lat:  pos.coords.latitude,
          gps_lng:  pos.coords.longitude,
        })
      },
      () => {
        track('supervisor_route_error', { category: 'error', err_code: 'start_gps_unavailable' })
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 5_000 }
    )
  }

  function detenerRecorrido(): void {
    if (!trackingRef.current) return
    trackingRef.current = false

    if (watcherRef.current !== null && typeof navigator !== 'undefined') {
      navigator.geolocation.clearWatch(watcherRef.current)
      watcherRef.current = null
    }

    // Best-effort session_end point using last known position.
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          await insertarPunto('session_end', pos.coords.latitude, pos.coords.longitude, pos.timestamp, pos.coords)
          track('supervisor_route_stopped', { category: 'supervision' })
        },
        () => {
          track('supervisor_route_stopped', { category: 'supervision' })
        },
        { enableHighAccuracy: false, timeout: 5_000, maximumAge: 60_000 }
      )
    } else {
      track('supervisor_route_stopped', { category: 'supervision' })
    }

    estadoRef.current      = 'UNKNOWN'
    maquinaRef.current     = estadoInicial()
    ultimoPuntoRef.current = null
    objetivoActRef.current = null
    turnoIdRef.current     = null
  }

  // Start or stop tracking when the supervisor's shift status changes.
  useEffect(() => {
    if (!userId || typeof window === 'undefined') return
    if (!gpsEnabledRef.current) return

    const turno = turnoActivoSupervisor(supervisoresGuardia, userId)

    if (turno && !trackingRef.current) {
      iniciarRecorrido(turno)
    } else if (!turno && trackingRef.current) {
      detenerRecorrido()
    }
  }, [supervisoresGuardia, userId])   // eslint-disable-line react-hooks/exhaustive-deps

  // Stop tracking on unmount (logout, navigation).
  useEffect(() => {
    return () => { detenerRecorrido() }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // Track foreground/background transitions for gps_recovered detection.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') wasHiddenRef.current = true
      // On 'visible': the next GPS position from watchPosition will detect wasHiddenRef
      // and insert a gps_recovered point before resuming normal state tracking.
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  // ── Public API ─────────────────────────────────────────────────────────────

  // Call this after a supervision is successfully saved to record its GPS point.
  async function notificarSupervision(
    supervisionId: string,
    lat: number,
    lng: number
  ): Promise<void> {
    if (!trackingRef.current) return
    try {
      const objCerca = objetivoCercano(lat, lng)
      await insertarPunto(
        'supervision', lat, lng, Date.now(),
        { accuracy: null, speed: null, heading: null, altitude: null },
        {
          supervision_id:       supervisionId,
          objetivo_cercano_id:  objCerca?.id   ?? objetivoActRef.current ?? null,
          objetivo_distancia_m: objCerca?.distancia ?? null,
        }
      )
    } catch {
      // Silent.
    }
  }

  return { notificarSupervision }
}
