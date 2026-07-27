// v2: deja de cachear las llamadas a la API. Cambiar el nombre del cache
// tambien purga las respuestas de Supabase guardadas por la version anterior.
const CACHE_NAME = 'mercosur-seguridad-v2'
const APP_SHELL = ['/', '/dashboard', '/manifest.webmanifest']

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
]

function esSolicitudDeDatos(request) {
  let url

  try {
    url = new URL(request.url)
  } catch {
    return true
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return true
  if (url.hostname.endsWith('.supabase.co')) return true

  return RUTAS_SIN_CACHE.some(ruta => url.pathname.includes(ruta))
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(APP_SHELL.map(url => cache.add(url))))
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return

  // Datos, sesion y storage van siempre a la red, sin cache ni fallback.
  // Sin respondWith(), el navegador maneja la request de forma nativa.
  if (esSolicitudDeDatos(event.request)) return

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone()
        caches.open(CACHE_NAME)
          .then(cache => cache.put(event.request, copy))
          .catch(() => {})
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
