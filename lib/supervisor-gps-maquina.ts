/**
 * lib/supervisor-gps-maquina.ts
 *
 * Máquina de estados del recorrido GPS del supervisor, pura (sin navegador ni
 * Supabase) para poder probarla y simularla sobre puntos reales.
 *
 * Problema (auditoría PWA oct-2026): con una sola lectura alcanzaba para pasar
 * de MOVING a STOPPED, o para entrar/salir de un objetivo. El ruido del GPS
 * (±20–60 m parado en una vereda, velocidad calculada entre dos lecturas
 * ruidosas) hacía oscilar el estado y cada oscilación era un INSERT: picos de
 * 70–122 puntos por hora y batería. Además, al volver de segundo plano el
 * estado se reiniciaba y se registraba OTRA entrada al mismo objetivo.
 *
 * Histéresis:
 *   - Entrada a un objetivo: una lectura bien adentro (radio − 25 m) o dos
 *     lecturas seguidas dentro del radio. Una visita real siempre la cumple.
 *   - Salida: dos lecturas seguidas fuera de radio + 25 m, o una sola muy
 *     lejos (radio + 100 m). Nunca se pierde: se registra apenas se confirma.
 *   - MOVING ⇄ STOPPED fuera de objetivos: dos lecturas seguidas que coincidan.
 *   - Volver de segundo plano NO borra el objetivo actual: si sigue adentro,
 *     no hay una entrada duplicada.
 *   - Intervalos sin cambios: 60 s / 100 m mientras se mueve o está adentro
 *     (el mapa del legajo une puntos separados ≤ 300 s).
 */

export type EstadoMovimiento = 'UNKNOWN' | 'MOVING' | 'STOPPED' | 'IN_OBJETIVO'

export type TipoPuntoMaquina = 'moving' | 'stopped' | 'objetivo_enter' | 'objetivo_inside' | 'objetivo_exit'

export interface ObjetivoGeoMaquina {
  id: string
  lat?: number | null
  lng?: number | null
  radio_metros?: number | null
}

export interface Lectura {
  lat: number
  lng: number
  ts: number
  /** coords.speed del navegador (m/s) o null. */
  speed: number | null
}

export interface EstadoMaquina {
  estado: EstadoMovimiento
  /** Objetivo confirmado en el que está. */
  objetivoId: string | null
  candMov: 'MOVING' | 'STOPPED' | null
  candMovN: number
  candObj: string | null
  candObjN: number
  candSalidaN: number
  /** Último punto insertado (para intervalos y velocidad calculada). */
  ultimo: { lat: number; lng: number; ts: number } | null
}

export interface AccionPunto {
  tipo: TipoPuntoMaquina
  objetivoId?: string
  distancia?: number
}

export const MARGEN_OBJETIVO_M = 25
export const SALIDA_LEJOS_M = 100
export const LECTURAS_CONFIRMACION = 2
export const INTERVALO_MOVING_MS = 60_000
export const MIN_DISTANCIA_M = 100
export const UMBRAL_VELOCIDAD_MS = 0.5

export function estadoInicial(): EstadoMaquina {
  return { estado: 'UNKNOWN', objetivoId: null, candMov: null, candMovN: 0, candObj: null, candObjN: 0, candSalidaN: 0, ultimo: null }
}

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const r = Math.PI / 180
  const dLat = (lat2 - lat1) * r
  const dLng = (lng2 - lng1) * r
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/** Objetivo más cercano cuyo radio contiene la lectura. */
export function objetivoCercano(lat: number, lng: number, objetivos: readonly ObjetivoGeoMaquina[]): { id: string; distancia: number; radio: number } | null {
  let mejor: { id: string; distancia: number; radio: number } | null = null
  for (const obj of objetivos) {
    if (obj.lat == null || obj.lng == null || !obj.radio_metros) continue
    const d = haversineM(lat, lng, Number(obj.lat), Number(obj.lng))
    if (d <= obj.radio_metros && (!mejor || d < mejor.distancia)) mejor = { id: obj.id, distancia: Math.round(d), radio: obj.radio_metros }
  }
  return mejor
}

/** "Bien adentro": a más de 25 m del borde (o en la mitad interior si el radio es chico). */
export function bienAdentro(distancia: number, radio: number): boolean {
  return radio > 2 * MARGEN_OBJETIVO_M ? distancia <= radio - MARGEN_OBJETIVO_M : distancia <= radio / 2
}

/** Volver de segundo plano: la lectura puede ser vieja, pero el objetivo se conserva. */
export function trasRecuperacion(est: EstadoMaquina): EstadoMaquina {
  if (est.objetivoId) return { ...est, candSalidaN: 0, candObj: null, candObjN: 0 }
  return { ...est, estado: 'UNKNOWN', candMov: null, candMovN: 0, candObj: null, candObjN: 0 }
}

/**
 * Procesa una lectura. Devuelve el estado nuevo y los puntos a insertar (en
 * orden). `ultimo` se actualiza con cada punto insertado.
 */
export function procesarLectura(
  est0: EstadoMaquina,
  l: Lectura,
  objetivos: readonly ObjetivoGeoMaquina[],
): { estado: EstadoMaquina; acciones: AccionPunto[] } {
  const est: EstadoMaquina = { ...est0 }
  const acciones: AccionPunto[] = []
  const insertar = (a: AccionPunto) => { acciones.push(a); est.ultimo = { lat: l.lat, lng: l.lng, ts: l.ts } }
  const cerca = objetivoCercano(l.lat, l.lng, objetivos)
  const porIntervalo = () => {
    const u = est.ultimo
    if (!u) return true
    return l.ts - u.ts >= INTERVALO_MOVING_MS || haversineM(l.lat, l.lng, u.lat, u.lng) >= MIN_DISTANCIA_M
  }

  // ── Adentro de un objetivo confirmado ──────────────────────────────────────
  if (est.objetivoId) {
    const actual = objetivos.find(o => o.id === est.objetivoId)
    const dActual = actual && actual.lat != null && actual.lng != null
      ? haversineM(l.lat, l.lng, Number(actual.lat), Number(actual.lng))
      : Infinity
    const radio = actual?.radio_metros ?? 0
    // Cambio directo a otro objetivo (vecinos): sólo con la lectura bien adentro del otro.
    const otro = cerca && cerca.id !== est.objetivoId && dActual > radio && bienAdentro(cerca.distancia, cerca.radio)
    const fuera = dActual > radio + MARGEN_OBJETIVO_M
    if (!fuera && !otro) {
      est.candSalidaN = 0
      if (porIntervalo()) insertar({ tipo: 'objetivo_inside', objetivoId: est.objetivoId, distancia: Math.round(dActual) })
      return { estado: est, acciones }
    }
    est.candSalidaN += 1
    if (!otro && est.candSalidaN < LECTURAS_CONFIRMACION && dActual <= radio + SALIDA_LEJOS_M) {
      return { estado: est, acciones } // salida sin confirmar: espera otra lectura
    }
    insertar({ tipo: 'objetivo_exit', objetivoId: est.objetivoId })
    est.objetivoId = null
    est.candSalidaN = 0
    est.estado = 'UNKNOWN'
    est.candMov = null
    est.candMovN = 0
    if (otro && cerca) {
      est.objetivoId = cerca.id
      est.estado = 'IN_OBJETIVO'
      insertar({ tipo: 'objetivo_enter', objetivoId: cerca.id, distancia: cerca.distancia })
      return { estado: est, acciones }
    }
  }

  // ── Fuera: ¿entra a un objetivo? ───────────────────────────────────────────
  if (cerca) {
    const confirma = bienAdentro(cerca.distancia, cerca.radio)
      || (est.candObj === cerca.id && est.candObjN + 1 >= LECTURAS_CONFIRMACION)
    if (confirma) {
      est.objetivoId = cerca.id
      est.estado = 'IN_OBJETIVO'
      est.candObj = null; est.candObjN = 0; est.candMov = null; est.candMovN = 0
      insertar({ tipo: 'objetivo_enter', objetivoId: cerca.id, distancia: cerca.distancia })
      return { estado: est, acciones }
    }
    est.candObjN = est.candObj === cerca.id ? est.candObjN + 1 : 1
    est.candObj = cerca.id
  } else {
    est.candObj = null
    est.candObjN = 0
  }

  // ── Movimiento ─────────────────────────────────────────────────────────────
  let speed = l.speed
  if (speed == null && est.ultimo) {
    const d = haversineM(l.lat, l.lng, est.ultimo.lat, est.ultimo.lng)
    const t = (l.ts - est.ultimo.ts) / 1000
    speed = t > 0 ? d / t : 0
  }
  const crudo: 'MOVING' | 'STOPPED' = (speed ?? 0) >= UMBRAL_VELOCIDAD_MS ? 'MOVING' : 'STOPPED'

  if (est.estado === 'UNKNOWN' || est.estado === 'IN_OBJETIVO') {
    est.estado = crudo
    est.candMov = null; est.candMovN = 0
    insertar({ tipo: crudo === 'MOVING' ? 'moving' : 'stopped' })
    return { estado: est, acciones }
  }
  if (crudo === est.estado) {
    est.candMov = null; est.candMovN = 0
  } else {
    est.candMovN = est.candMov === crudo ? est.candMovN + 1 : 1
    est.candMov = crudo
    if (est.candMovN >= LECTURAS_CONFIRMACION) {
      est.estado = crudo
      est.candMov = null; est.candMovN = 0
      insertar({ tipo: crudo === 'MOVING' ? 'moving' : 'stopped' })
      return { estado: est, acciones }
    }
  }
  if (est.estado === 'MOVING' && porIntervalo()) insertar({ tipo: 'moving' })
  return { estado: est, acciones }
}
