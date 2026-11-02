// ── Versión y caché ─────────────────────────────────────────────────────────
// La versión llega en la URL del registro (/sw.js?v=<version+commit>, ver
// PwaRegister y next.config.js). Cada deploy cambia la URL, el navegador
// instala este worker de nuevo y `activate` borra toda caché que no sea la de
// esta versión. Antes el nombre era fijo ('mercosur-seguridad-v3'): nunca se
// purgaba nada y la caché crecía con cada chunk, imagen y mosaico de mapa.
// public/sw-version.js lo genera next.config.js en cada build: como el worker
// lo importa, el navegador lo compara byte a byte en cada update() y detecta
// el deploy nuevo aunque la página siga abierta con el código viejo.
try { importScripts('/sw-version.js') } catch (e) { /* sin archivo: se usa ?v= */ }
const VERSION = self.SW_VERSION || new URL(self.location.href).searchParams.get('v') || 'v4'
const PREFIJO_CACHE = 'mercosur-seguridad-'
const CACHE_NAME = PREFIJO_CACHE + VERSION
const APP_SHELL = ['/', '/dashboard', '/manifest.webmanifest']
// Tope de entradas: alcanza para el app-shell, íconos y fuentes propias.
const MAX_ENTRADAS = 40

// Rutas que NUNCA deben cachearse: datos operativos, sesion y archivos privados.
// Servir una respuesta vieja de estas rutas muestra informacion incorrecta
// (por ejemplo, una lista de turnos vacia con HTTP 200 y sin error).
const RUTAS_SIN_CACHE = [
  '/rest/v1/',
  '/auth/v1/',
  '/storage/v1/',
  '/realtime/v1/',
  '/functions/v1/',
  '/api/',
  // Archivos con hash: ya los guarda la caché HTTP del navegador (immutable).
  // Duplicarlos acá sólo ocupaba espacio y no se borraba nunca.
  '/_next/static/',
  // Imágenes optimizadas: varían por tamaño/calidad; cada variante era una entrada más.
  '/_next/image',
  '/_next/data/',
]

function esSolicitudSinCache(request) {
  let url

  try {
    url = new URL(request.url)
  } catch {
    return true
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true
  // Sólo el propio origen: Supabase, mosaicos de OpenStreetMap, CDNs y
  // cualquier otro host van directo a la red, sin pasar por esta caché.
  if (url.origin !== self.location.origin) return true
  if (url.hostname.endsWith('.supabase.co')) return true

  return RUTAS_SIN_CACHE.some(ruta => url.pathname.includes(ruta))
}

async function recortarCache(cache) {
  const claves = await cache.keys()
  // keys() devuelve en orden de inserción: se borran las más viejas, pero
  // nunca el app-shell.
  const sobrantes = claves.length - MAX_ENTRADAS
  if (sobrantes <= 0) return
  let borradas = 0
  for (const req of claves) {
    if (borradas >= sobrantes) break
    const ruta = new URL(req.url).pathname
    if (APP_SHELL.includes(ruta)) continue
    await cache.delete(req)
    borradas += 1
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(APP_SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  )
})

// Permite que el cliente fuerce la activacion del worker nuevo sin esperar a
// que se cierren todas las pestañas.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      // Borra TODA caché distinta de la actual: versiones viejas de este worker
      // ('mercosur-seguridad-v3', '-<commit>' anteriores) y cualquier otra.
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return

  // Datos, sesion, storage, chunks con hash, imágenes optimizadas y todo lo
  // de otro origen van siempre a la red. Sin respondWith(), el navegador
  // maneja la request de forma nativa (incluida su caché HTTP).
  if (esSolicitudSinCache(event.request)) return

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Sólo respuestas completas y propias: un 404/500 o una redirección
        // guardada se serviría después como si fuera la página.
        if (response.status === 200 && response.type === 'basic') {
          const copy = response.clone()
          caches.open(CACHE_NAME)
            .then(cache => cache.put(event.request, copy).then(() => recortarCache(cache)))
            .catch(() => {})
        }
        return response
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('/dashboard')))
  )
})

self.addEventListener('push', event => {
  let data = {}

  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Mercosur Seguridad', body: event.data ? event.data.text() : 'Nueva notificación operativa' }
  }

  const title = data.title || 'Mercosur Seguridad'
  const options = {
    body: data.body || 'Nueva notificación operativa',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'mercosur-seguridad',
    data: {
      url: data.url || '/dashboard',
    },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/dashboard'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => {
        for (const client of clients) {
          if ('focus' in client && client.url.includes(targetUrl)) return client.focus()
        }

        return self.clients.openWindow(targetUrl)
      })
  )
})
