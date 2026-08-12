//
// Lectura del GPS de un registro de asistencia.
//
// POR QUÉ EXISTE ESTE ARCHIVO
//
// `registros_asistencia` tiene DOS juegos de columnas GPS conviviendo:
//
//   lat_entrada / lng_entrada        (esquema original)
//   latitud_ingreso / longitud_ingreso  (agregadas en 20260616)
//
// Los registros viejos tienen el primero, los nuevos el segundo. Leer una sola
// nomenclatura devuelve null en la mitad de la tabla, sin error y sin aviso.
// `gpsRegistroAsistencia()` es el único lugar que resuelve esa ambigüedad.
//
// Estas funciones vivían dentro de app/dashboard/AppClient.tsx. Se movieron acá
// —sin cambiarles una línea— para que la Página GPS use exactamente el mismo
// código y no aparezca una segunda interpretación de las mismas columnas.
//
// Son funciones PURAS de lectura y formato. No deciden nada operativo: el
// veredicto GPS (`gps_ingreso_estado`, `distancia_ingreso_metros`) lo calcula el
// servidor al fichar y acá sólo se lee.
//

import type { RegistroAsistencia } from '@/lib/supabase'

/** Precisión GPS por encima de la cual el fichaje se considera impreciso. */
export const GPS_PRECISION_MAX_METROS = 100

export function numeroGps(value: unknown): number | null {
  const numero = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(numero) ? numero : null
}

/**
 * Coordenada capturada al fichar, resolviendo las dos nomenclaturas.
 * Devuelve null si el registro no tiene GPS.
 */
export function gpsRegistroAsistencia(registro: RegistroAsistencia | any, tipo: 'ingreso' | 'egreso') {
  const lat = tipo === 'ingreso'
    ? numeroGps(registro?.latitud_ingreso ?? registro?.lat_entrada)
    : numeroGps(registro?.latitud_egreso ?? registro?.lat_salida)
  const lng = tipo === 'ingreso'
    ? numeroGps(registro?.longitud_ingreso ?? registro?.lng_entrada)
    : numeroGps(registro?.longitud_egreso ?? registro?.lng_salida)
  const precision = tipo === 'ingreso'
    ? numeroGps(registro?.precision_ingreso)
    : numeroGps(registro?.precision_egreso)

  return lat !== null && lng !== null ? { lat, lng, precision } : null
}

export function metrosGpsTexto(valor?: unknown): string {
  const metros = numeroGps(valor)
  return metros !== null ? `${Math.round(metros).toLocaleString('es-AR')} m` : '—'
}

export function estadoGpsRegistro(registro: RegistroAsistencia | any, tipo: 'ingreso' | 'egreso'): string | null | undefined {
  return tipo === 'ingreso' ? registro?.gps_ingreso_estado : registro?.gps_egreso_estado
}

export function distanciaGpsRegistro(registro: RegistroAsistencia | any, tipo: 'ingreso' | 'egreso'): number | null {
  return numeroGps(tipo === 'ingreso' ? registro?.distancia_ingreso_metros : registro?.distancia_egreso_metros)
}

export function coordenadasGpsTexto(registro: RegistroAsistencia | any, tipo: 'ingreso' | 'egreso'): string {
  const gps = gpsRegistroAsistencia(registro, tipo)
  if (!gps) return '—'
  return `${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)}`
}

export function estadoGpsTexto(registro: RegistroAsistencia | any, tipo: 'ingreso' | 'egreso'): string {
  const estado = estadoGpsRegistro(registro, tipo)
  if (estado === 'dentro_radio') return 'Dentro del radio'
  if (estado === 'fuera_radio') return 'Fuera del radio'
  if (estado === 'objetivo_sin_gps') return 'Objetivo sin GPS'
  if (estado === 'gps_no_disponible') return 'GPS no disponible'
  return gpsRegistroAsistencia(registro, tipo) ? 'GPS registrado' : 'Sin GPS'
}

// ── Supervisiones ────────────────────────────────────────────────────────────
// `supervisiones` NO guarda distancia ni dentro/fuera: se derivan comparando la
// coordenada registrada contra la del objetivo. Esta derivación ya existía en
// AppClient y se movió acá tal cual, para que la Página GPS no estrene una
// cuarta implementación de Haversine.

/** Haversine en metros. Misma fórmula que `rondas_distancia_metros` en el servidor. */
export function distanciaMetrosCoordenadas(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radioTierra = 6371000
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
    Math.sin(dLng / 2) ** 2

  return 2 * radioTierra * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

type SupervisionGps = { lat: unknown; lng: unknown; precision_gps: unknown }
type ObjetivoGps = { lat?: unknown; lng?: unknown; radio_metros?: unknown } | null | undefined

export function auditoriaSupervisionGps(supervision: SupervisionGps, objetivo?: ObjetivoGps) {
  const lat = numeroGps(supervision.lat)
  const lng = numeroGps(supervision.lng)
  const precision = numeroGps(supervision.precision_gps)
  const objetivoLat = numeroGps(objetivo?.lat)
  const objetivoLng = numeroGps(objetivo?.lng)
  const radio = numeroGps(objetivo?.radio_metros)
  const distancia = lat !== null && lng !== null && objetivoLat !== null && objetivoLng !== null
    ? distanciaMetrosCoordenadas(lat, lng, objetivoLat, objetivoLng)
    : null
  const dentroRadio = distancia !== null && radio !== null && radio > 0
    ? distancia <= radio
    : null

  return {
    lat,
    lng,
    precision,
    gpsImpreciso: precision !== null && precision > GPS_PRECISION_MAX_METROS,
    objetivoLat,
    objetivoLng,
    radio,
    distancia_objetivo_metros: distancia,
    dentro_radio: dentroRadio,
  }
}
