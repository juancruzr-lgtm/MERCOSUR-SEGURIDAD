import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin, resolverPerfil } from '../../_lib/employee-auth'
import {
  esHostDeMapaPermitido, extraerCoordenadasDeUrl, pareceUrl, parsearCoordenadasPegadas,
} from '@/lib/coordenadas-mapa'

export const runtime = 'nodejs'

/**
 * Convierte lo que el usuario pegó o escribió en coordenadas:
 *  - "lat, lng"                        → directo
 *  - link de Google Maps (corto/largo) → se sigue la redirección y se lee el pin
 *  - texto libre (dirección)           → búsqueda en OpenStreetMap (Nominatim)
 *
 * Devuelve { resultados: [{ lat, lng, etiqueta }] }. No guarda nada: el punto
 * se guarda recién con "Guardar punto".
 */

const MAX_TEXTO = 2000
const MAX_SALTOS = 6
const TIMEOUT_MS = 8000

interface Resultado { lat: number; lng: number; etiqueta: string }

async function conTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const control = new AbortController()
  const timer = setTimeout(() => control.abort(), TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, signal: control.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timer)
  }
}

async function resolverLinkMapa(link: string): Promise<Resultado | null> {
  let actual = link.trim()
  for (let salto = 0; salto <= MAX_SALTOS; salto++) {
    const directas = extraerCoordenadasDeUrl(actual)
    if (directas) return { ...directas, etiqueta: 'Ubicación del link de Google Maps' }

    let url: URL
    try {
      url = new URL(actual)
    } catch {
      return null
    }
    if (url.protocol !== 'https:' || !esHostDeMapaPermitido(url.hostname)) return null

    const res = await conTimeout(url.toString(), {
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; rondas/1.0)' },
    })
    const destino = res.headers.get('location')
    if (res.status >= 300 && res.status < 400 && destino) {
      actual = new URL(destino, url).toString()
      continue
    }
    // Sin redirección: a veces la página trae el pin en el HTML.
    if (res.ok) {
      const html = (await res.text()).slice(0, 500_000)
      const enHtml = extraerCoordenadasDeUrl(html)
      if (enHtml) return { ...enHtml, etiqueta: 'Ubicación del link de Google Maps' }
    }
    return null
  }
  return null
}

async function buscarDireccion(texto: string): Promise<Resultado[]> {
  const params = new URLSearchParams({
    q: texto,
    format: 'jsonv2',
    limit: '5',
    countrycodes: 'ar,uy,py,br,cl,bo',
    'accept-language': 'es',
  })
  const res = await conTimeout(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { 'User-Agent': 'rondas-app/1.0' },
  })
  if (!res.ok) return []
  const lista = await res.json() as Array<{ lat: string; lon: string; display_name: string }>
  return lista
    .map(item => ({ lat: Number(item.lat), lng: Number(item.lon), etiqueta: item.display_name }))
    .filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng))
}

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })
  const acceso = await resolverPerfil(req, admin.client)
  if ('respuesta' in acceso) return acceso.respuesta

  let texto = ''
  try {
    const body = await req.json()
    texto = typeof body?.texto === 'string' ? body.texto.trim() : ''
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }
  if (!texto) return NextResponse.json({ error: 'Escribí una dirección, un link o coordenadas.' }, { status: 400 })
  if (texto.length > MAX_TEXTO) return NextResponse.json({ error: 'Texto demasiado largo.' }, { status: 400 })

  const coords = parsearCoordenadasPegadas(texto)
  if (coords) return NextResponse.json({ resultados: [{ ...coords, etiqueta: 'Coordenadas ingresadas' }] })

  // Un link puede venir con texto alrededor (lo que se copia de WhatsApp).
  const link = texto.match(/https?:\/\/\S+/i)?.[0]
  try {
    if (link || pareceUrl(texto)) {
      const r = await resolverLinkMapa(link ?? texto)
      if (r) return NextResponse.json({ resultados: [r] })
      return NextResponse.json({
        error: 'No pude leer la ubicación de ese link. En Google Maps mantené apretado el punto, copiá las coordenadas y pegalas acá.',
      }, { status: 422 })
    }
    const resultados = await buscarDireccion(texto)
    if (resultados.length === 0) {
      return NextResponse.json({ error: 'No encontré esa dirección. Probá agregando la ciudad o la provincia.' }, { status: 404 })
    }
    return NextResponse.json({ resultados })
  } catch {
    return NextResponse.json({ error: 'El servicio de mapas no respondió. Probá de nuevo en unos segundos.' }, { status: 502 })
  }
}
