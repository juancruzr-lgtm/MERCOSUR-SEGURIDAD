'use client'
// GPS tracking hook for supervisors.
// Captures route points while the supervisor has an active shift in supervisores_guardia.
// Completely silent on errors — never blocks operational flows.
// Only one watchPosition watcher is active at a time.

import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { track, getCurrentSession, getDeviceContext } from '@/lib/telemetry'

// ── Types ─────────────────────────────────────────────────────────────────────

type EstadoMovimiento = 'UNKNOWN' | 'MOVING' | 'STOPPED' | 'IN_OBJETIVO'

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

// Distance in meters to force a new point regardless of the timer
const MIN_DISTANCIA_M = 100
// Timer between MOVING points (ms)
const INTERVALO_MOVING_MS = 60_000
// Speed threshold (m/s) to consider the supervisor moving
const UMBRAL_VELOCIDAD_MS = 0.5

// ── Pure helpers ───────────────────────────────────────────────────────────────

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const r = Math.PI / 180
  const dLat = (lat2 - lat1) * r
  const dLng = (lng2 - lng1) * r
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
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
  const ultimoPuntoRef  = useRef<{ lat: number; lng: number; ts: number; id: string } | null>(null)
  const objetivoActRef  = useRef<string | null>(null)
  const turnoIdRef      = useRef<string | null>(null)
  const trackingRef     = useRef(false)
  const wasHiddenRef    = useRef(false)
  const gpsEnabledRef   = useRef(true)
  const objetivosRef    = useRef(objetivos)

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
    let mejor: { id: string; distancia: number } | null = null
    for (const obj of objetivosRef.current) {
      if (obj.lat == null || obj.lng == null || !obj.radio_metros) continue
      const d = haversineM(lat, lng, obj.lat, obj.lng)
      if (d <= obj.radio_metros && (!mejor || d < mejor.distancia)) {
        mejor = { id: obj.id, distancia: Math.round(d) }
      }
    }
    return mejor
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
        session_id:                 session?.session_id ?? null,
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
        estadoRef.current    = 'UNKNOWN'
        await insertarPunto('gps_recovered', lat, lng, ts, coords)
        track('supervisor_route_recovered', {
          category: 'supervision',
          gps_lat:  lat,
          gps_lng:  lng,
        })
        // Continue processing so this position also updates the state machine.
      }

      const prevEstado   = estadoRef.current
      const prevObjetivo = objetivoActRef.current
      const anterior     = ultimoPuntoRef.current
      const objCerca     = objetivoCercano(lat, lng)

      // Determine new movement state.
      let nuevoEstado: EstadoMovimiento
      if (objCerca) {
        nuevoEstado = 'IN_OBJETIVO'
      } else {
        let speed = coords.speed ?? null
        if (speed == null && anterior) {
          const d = haversineM(lat, lng, anterior.lat, anterior.lng)
          const t = (ts - anterior.ts) / 1000
          speed = t > 0 ? d / t : 0
        }
        nuevoEstado = (speed ?? 0) >= UMBRAL_VELOCIDAD_MS ? 'MOVING' : 'STOPPED'
      }

      estadoRef.current = nuevoEstado

      // Handle objective exit: leaving an objetivo or entering a different one.
      if (
        prevEstado === 'IN_OBJETIVO' && prevObjetivo &&
        (nuevoEstado !== 'IN_OBJETIVO' || (objCerca && objCerca.id !== prevObjetivo))
      ) {
        objetivoActRef.current = null
        await insertarPunto('objetivo_exit', lat, lng, ts, coords, {
          objetivo_cercano_id: prevObjetivo,
        })
        track('supervisor_objetivo_exit', {
          category:    'supervision',
          objetivo_id: prevObjetivo,
          gps_lat:     lat,
          gps_lng:     lng,
        })
      }

      // State-specific recording rules.
      if (nuevoEstado === 'IN_OBJETIVO' && objCerca) {
        if (prevEstado !== 'IN_OBJETIVO' || prevObjetivo !== objCerca.id) {
          // Entering a new objetivo.
          objetivoActRef.current = objCerca.id
          await insertarPunto('objetivo_enter', lat, lng, ts, coords, {
            objetivo_cercano_id:  objCerca.id,
            objetivo_distancia_m: objCerca.distancia,
          })
          track('supervisor_objetivo_enter', {
            category:    'supervision',
            objetivo_id: objCerca.id,
            gps_lat:     lat,
            gps_lng:     lng,
          })
        } else {
          // Periodic point inside objetivo: only when thresholds exceeded.
          const tiempoDesde = anterior ? ts - anterior.ts : Infinity
          const distDesde   = anterior ? haversineM(lat, lng, anterior.lat, anterior.lng) : Infinity
          if (tiempoDesde >= INTERVALO_MOVING_MS || distDesde >= MIN_DISTANCIA_M) {
            await insertarPunto('objetivo_inside', lat, lng, ts, coords, {
              objetivo_cercano_id:  objCerca.id,
              objetivo_distancia_m: objCerca.distancia,
            })
          }
        }
      } else if (nuevoEstado === 'MOVING') {
        // Record on state change, or when time/distance threshold exceeded.
        const tiempoDesde = anterior ? ts - anterior.ts : Infinity
        const distDesde   = anterior ? haversineM(lat, lng, anterior.lat, anterior.lng) : Infinity
        if (prevEstado !== 'MOVING' || tiempoDesde >= INTERVALO_MOVING_MS || distDesde >= MIN_DISTANCIA_M) {
          await insertarPunto('moving', lat, lng, ts, coords)
        }
      } else if (nuevoEstado === 'STOPPED') {
        // Only record on state change to STOPPED — no periodic points while stopped.
        if (prevEstado !== 'STOPPED') {
          await insertarPunto('stopped', lat, lng, ts, coords)
        }
      }
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
    seqRef.current         = 0
    estadoRef.current      = 'UNKNOWN'
    ultimoPuntoRef.current = null
    objetivoActRef.current = null

    // Continuous watch for state machine.
    watcherRef.current = navigator.geolocation.watchPosition(
      (pos) => void onPosition(pos),
      onGpsError,
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 }
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
