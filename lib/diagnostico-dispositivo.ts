/**
 * lib/diagnostico-dispositivo.ts
 *
 * Datos del teléfono para la sección "Diagnóstico" (vigilador y supervisor):
 * conexión, espacio usado, caché del Service Worker, pendientes y versión.
 * Sirve para que soporte entienda por teléfono qué pasa sin pedir capturas.
 *
 * Nada de esto lee datos operativos ni personales.
 */

import { CLAVE_PENDIENTES } from '@/lib/protocolos'
import { appVersion, obtenerDeviceId } from '@/lib/telemetry'
import { listarFotosPendientes, type MetaFotoPendiente } from '@/lib/pendientes-camara'

export const INGRESO_PENDIENTE_KEY = 'mercosur_ingreso_pendiente'

export type Diagnostico = {
  version: string
  dispositivo: string | null
  enLinea: boolean | null
  tipoConexion: string | null
  usoBytes: number | null
  cuotaBytes: number | null
  cacheBytes: number | null
  cacheEntradas: number | null
  cachesSw: string[]
  pendientes: Array<{ etiqueta: string; cantidad: number }>
  /** Fotos sacadas que esperan subirse (IndexedDB). Opcional: sin IndexedDB, vacío. */
  fotosPendientes?: Array<Pick<MetaFotoPendiente, 'flujo' | 'tipo' | 'bytes' | 'creado_ms'>>
  ultimaActualizacion: string | null
  navegador: string | null
  generado: string
}

export function formatearBytes(b: number | null | undefined): string {
  if (b === null || b === undefined || !Number.isFinite(b)) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** Texto plano para "Copiar diagnóstico" (se pega en WhatsApp). */
export function textoDiagnostico(d: Diagnostico): string {
  const lineas = [
    'Diagnóstico Mercosur Seguridad',
    `Versión: ${d.version}`,
    `Dispositivo: ${d.dispositivo ?? '—'}`,
    `Navegador: ${d.navegador ?? '—'}`,
    `Conexión: ${d.enLinea === null ? '—' : d.enLinea ? 'en línea' : 'sin conexión'}${d.tipoConexion ? ` (${d.tipoConexion})` : ''}`,
    `Espacio usado: ${formatearBytes(d.usoBytes)} de ${formatearBytes(d.cuotaBytes)}`,
    `Caché de la app: ${formatearBytes(d.cacheBytes)}${d.cacheEntradas !== null ? ` · ${d.cacheEntradas} archivos` : ''}`,
    `Cachés: ${d.cachesSw.length ? d.cachesSw.join(', ') : 'ninguna'}`,
    `Pendientes: ${d.pendientes.length ? d.pendientes.map(p => `${p.etiqueta} ${p.cantidad}`).join(' · ') : 'ninguno'}`,
    `Fotos sin subir: ${resumenFotosPendientes(d.fotosPendientes)}`,
    `Última actualización: ${d.ultimaActualizacion ?? '—'}`,
    `Generado: ${d.generado}`,
  ]
  return lineas.join('\n')
}

/** "2 · 640.0 KB (ingreso libro 10:02, ronda punto 10:15)" o "ninguna". */
export function resumenFotosPendientes(fotos: Diagnostico['fotosPendientes']): string {
  if (!fotos || fotos.length === 0) return 'ninguna'
  const total = fotos.reduce((s, f) => s + f.bytes, 0)
  const detalle = fotos
    .map(f => `${f.flujo} ${f.tipo} ${new Date(f.creado_ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`)
    .join(', ')
  return `${fotos.length} · ${formatearBytes(total)} (${detalle})`
}

function leerLocal(storage: 'localStorage' | 'sessionStorage', clave: string): string | null {
  try { return (globalThis as any)[storage]?.getItem(clave) ?? null } catch { return null }
}

/** Pendientes que la app guarda en el teléfono y todavía no subió. */
export function pendientesLocales(): Array<{ etiqueta: string; cantidad: number }> {
  const out: Array<{ etiqueta: string; cantidad: number }> = []
  try {
    const cola = JSON.parse(leerLocal('localStorage', CLAVE_PENDIENTES) || '[]')
    out.push({ etiqueta: 'Lecturas de protocolo sin enviar', cantidad: Array.isArray(cola) ? cola.length : 0 })
  } catch {
    out.push({ etiqueta: 'Lecturas de protocolo sin enviar', cantidad: 0 })
  }
  // El intento se guarda en sessionStorage y en localStorage (lib/pendientes-camara).
  const ingreso = leerLocal('sessionStorage', INGRESO_PENDIENTE_KEY) || leerLocal('localStorage', INGRESO_PENDIENTE_KEY)
  out.push({ etiqueta: 'Ingreso guardado para reintentar', cantidad: ingreso ? 1 : 0 })
  return out
}

/** Mide las cachés del Service Worker (cuenta entradas y suma tamaños). */
export async function medirCaches(): Promise<{ nombres: string[]; entradas: number; bytes: number | null }> {
  if (typeof caches === 'undefined') return { nombres: [], entradas: 0, bytes: null }
  const nombres = await caches.keys()
  let entradas = 0
  let bytes = 0
  let medible = true
  for (const n of nombres) {
    const c = await caches.open(n)
    const reqs = await c.keys()
    entradas += reqs.length
    for (const r of reqs) {
      const resp = await c.match(r)
      const largo = Number(resp?.headers.get('content-length'))
      if (Number.isFinite(largo) && largo > 0) { bytes += largo; continue }
      try { bytes += (await resp!.clone().blob()).size } catch { medible = false }
    }
  }
  return { nombres, entradas, bytes: medible ? bytes : null }
}

/** "Liberar espacio": borra SOLO las cachés del Service Worker. */
export async function liberarCaches(): Promise<number> {
  if (typeof caches === 'undefined') return 0
  const nombres = await caches.keys()
  await Promise.all(nombres.map(n => caches.delete(n)))
  return nombres.length
}

export async function recolectarDiagnostico(
  extra: { pendientes?: Array<{ etiqueta: string; cantidad: number }>; ultimaActualizacion?: Date | number | null } = {},
): Promise<Diagnostico> {
  const nav: any = typeof navigator !== 'undefined' ? navigator : null
  let usoBytes: number | null = null
  let cuotaBytes: number | null = null
  try {
    const est = await nav?.storage?.estimate?.()
    if (est) { usoBytes = est.usage ?? null; cuotaBytes = est.quota ?? null }
  } catch { /* no disponible */ }

  let cache = { nombres: [] as string[], entradas: 0, bytes: null as number | null }
  try { cache = await medirCaches() } catch { /* no disponible */ }

  let dispositivo: string | null = null
  try {
    const ua = nav?.userAgentData
    const alto = ua?.getHighEntropyValues ? await ua.getHighEntropyValues(['model', 'platformVersion']) : null
    dispositivo = [ua?.platform, alto?.model].filter(Boolean).join(' ') || null
  } catch { /* UA-CH no disponible */ }

  let fotosPendientes: Diagnostico['fotosPendientes'] = []
  try { fotosPendientes = await listarFotosPendientes() } catch { /* sin IndexedDB */ }

  const ult = extra.ultimaActualizacion
  const ultimaActualizacion = ult ? new Date(ult).toLocaleString('es-AR') : null

  return {
    version: appVersion(),
    dispositivo: dispositivo ? `${dispositivo} · id ${obtenerDeviceId()?.slice(0, 8) ?? '—'}` : `id ${obtenerDeviceId()?.slice(0, 8) ?? '—'}`,
    enLinea: nav ? Boolean(nav.onLine) : null,
    tipoConexion: nav?.connection?.effectiveType ?? null,
    usoBytes,
    cuotaBytes,
    cacheBytes: cache.bytes,
    cacheEntradas: cache.entradas,
    cachesSw: cache.nombres,
    pendientes: [...(extra.pendientes ?? []), ...pendientesLocales()],
    fotosPendientes,
    ultimaActualizacion,
    navegador: nav?.userAgent ? String(nav.userAgent).slice(0, 160) : null,
    generado: new Date().toLocaleString('es-AR'),
  }
}
