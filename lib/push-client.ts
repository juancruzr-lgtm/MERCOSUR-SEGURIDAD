'use client'

import { supabase } from './supabase'

type PushActivationResult =
  | { ok: true, message: string }
  | { ok: false, message: string }

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const output = new Uint8Array(rawData.length)

  for (let index = 0; index < rawData.length; index += 1) {
    output[index] = rawData.charCodeAt(index)
  }

  return output
}

export async function activarNotificacionesPush(): Promise<PushActivationResult> {
  if (typeof window === 'undefined') return { ok: false, message: 'Las notificaciones solo se activan desde el navegador.' }
  if (!('serviceWorker' in navigator)) return { ok: false, message: 'Este navegador no soporta Service Worker.' }
  if (!('PushManager' in window)) return { ok: false, message: 'Este dispositivo no soporta notificaciones push.' }
  if (!('Notification' in window)) return { ok: false, message: 'Este navegador no soporta notificaciones.' }

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!publicKey) return { ok: false, message: 'Falta configurar NEXT_PUBLIC_VAPID_PUBLIC_KEY.' }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, message: 'Permiso de notificaciones denegado.' }
  }

  const registration = await navigator.serviceWorker.ready
  const subscription = await registration.pushManager.getSubscription()
    || await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })

  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return { ok: false, message: 'Sesión no disponible para guardar la suscripción.' }

  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ subscription }),
  })

  const result = await response.json().catch(() => ({}))
  if (!response.ok) {
    return { ok: false, message: result?.error || 'No se pudo guardar la suscripción push.' }
  }

  return { ok: true, message: result?.message || 'Notificaciones activadas.' }
}
