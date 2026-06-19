const CACHE_NAME = 'mercosur-seguridad-v1'
const APP_SHELL = ['/', '/dashboard', '/manifest.webmanifest']

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
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

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone()
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy))
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
