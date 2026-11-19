/**
 * Leer coordenadas desde un link de mapa (Google Maps y similares).
 *
 * El supervisor manda la ubicación por WhatsApp como link
 * (https://maps.app.goo.gl/...). Los links cortos no traen coordenadas: hay que
 * seguir la redirección en el servidor (/api/geo/ubicar). Una vez expandido, el
 * link largo sí las trae, y eso es lo que lee este módulo — función pura, sin red.
 */

export interface Coordenadas {
  lat: number
  lng: number
}

function enRango(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    && !(lat === 0 && lng === 0)
}

function par(a: string | undefined, b: string | undefined): Coordenadas | null {
  if (a === undefined || b === undefined) return null
  const lat = Number(a)
  const lng = Number(b)
  return enRango(lat, lng) ? { lat, lng } : null
}

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)'

/**
 * Extrae lat/lng de una URL de mapa ya expandida. Orden de preferencia:
 *  1. `!3d<lat>!4d<lng>`: la posición del pin (lo más exacto).
 *  2. `q=` / `query=` / `ll=` / `destination=` / `center=` con "lat,lng".
 *  3. `/place/<lat>,<lng>` y `/search/<lat>,<lng>`.
 *  4. `@<lat>,<lng>`: el centro de la vista (último recurso).
 */
export function extraerCoordenadasDeUrl(texto: string): Coordenadas | null {
  let url: string
  try {
    url = decodeURIComponent(texto.trim())
  } catch {
    url = texto.trim()
  }
  if (!url) return null

  const pin = url.match(new RegExp(`!3d${NUM}!4d${NUM}`))
  const desdePin = pin && par(pin[1], pin[2])
  if (desdePin) return desdePin

  const parametro = url.match(new RegExp(`[?&](?:q|query|ll|destination|center|daddr)=(?:loc:)?${NUM}\\s*,\\s*\\+?${NUM}`))
  const desdeParametro = parametro && par(parametro[1], parametro[2])
  if (desdeParametro) return desdeParametro

  const lugar = url.match(new RegExp(`/(?:place|search|dir)/${NUM}\\s*,\\s*\\+?${NUM}`))
  const desdeLugar = lugar && par(lugar[1], lugar[2])
  if (desdeLugar) return desdeLugar

  const vista = url.match(new RegExp(`@${NUM},${NUM}`))
  const desdeVista = vista && par(vista[1], vista[2])
  if (desdeVista) return desdeVista

  return null
}

/**
 * Coordenadas pegadas como un solo texto: "-32.9468, -60.6393".
 *
 * Es lo que sale de "Copiar coordenadas" en Google Maps y de casi cualquier
 * mapa. Acepta coma o espacio como separador y tolera el paréntesis que agregan
 * algunas apps. Devuelve null si no son dos números dentro del rango
 * geográfico válido: no se guarda una coordenada que no se pudo leer.
 */
export function parsearCoordenadasPegadas(texto: string): Coordenadas | null {
  const dms = parsearGradosMinutosSegundos(texto)
  if (dms) return dms

  const limpio = texto.replace(/[()\[\]]/g, ' ').trim()
  if (!limpio) return null

  const partes = limpio.split(/\s*[,;]\s*|\s+/).filter(Boolean)
  if (partes.length !== 2) return null

  const lat = Number(partes[0])
  const lng = Number(partes[1])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null

  return { lat, lng }
}

/**
 * Grados/minutos/segundos, como los muestra Google Maps al tocar un punto:
 * `30°56'35.0"S 61°32'28.1"W`. Acepta segundos o minutos omitidos, coma
 * decimal, comillas tipográficas y "O" (oeste). Sur y Oeste son negativos.
 */
export function parsearGradosMinutosSegundos(texto: string): Coordenadas | null {
  const patron = /(\d{1,3}(?:[.,]\d+)?)\s*°\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*['′’]\s*)?(?:(\d{1,2}(?:[.,]\d+)?)\s*(?:"|″|”|''|′′)\s*)?([NSEWO])\b/gi
  const partes = Array.from(texto.matchAll(patron))
  if (partes.length !== 2) return null

  let lat: number | null = null
  let lng: number | null = null
  for (const m of partes) {
    const num = (v: string | undefined) => (v ? Number(v.replace(',', '.')) : 0)
    const minutos = num(m[2])
    const segundos = num(m[3])
    if (minutos >= 60 || segundos >= 60) return null
    let valor = num(m[1]) + minutos / 60 + segundos / 3600
    const hemisferio = m[4].toUpperCase()
    if (hemisferio === 'S' || hemisferio === 'W' || hemisferio === 'O') valor = -valor
    if (hemisferio === 'N' || hemisferio === 'S') {
      if (lat !== null) return null
      lat = valor
    } else {
      if (lng !== null) return null
      lng = valor
    }
  }
  if (lat === null || lng === null || !enRango(lat, lng)) return null
  return { lat: Number(lat.toFixed(7)), lng: Number(lng.toFixed(7)) }
}

/** Hosts a los que el servidor acepta seguir redirecciones (anti-SSRF). */
export function esHostDeMapaPermitido(host: string): boolean {
  const h = host.toLowerCase()
  return h === 'maps.app.goo.gl'
    || h === 'goo.gl'
    || h === 'g.co'
    || /^(?:[a-z0-9-]+\.)*google\.(?:com|com\.[a-z]{2}|co\.[a-z]{2}|[a-z]{2})$/.test(h)
}

export function pareceUrl(texto: string): boolean {
  return /^https?:\/\//i.test(texto.trim())
}
