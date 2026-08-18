'use client'

import { supabase } from './supabase'
import { evaluarEstadoPush } from './push-estado'
import type { EstadoPush, PermisoNotificaciones } from './push-estado'

type PushActivationResult =
  | { ok: true, message: string }
  | { ok: false, message: string }

const SERVICE_WORKER_TIMEOUT_MS = 15000
const PUSH_SUBSCRIBE_TIMEOUT_MS = 20000
const API_TIMEOUT_MS = 15000

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

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Error desconocido'
}

function errorName(error: unknown) {
  return error instanceof DOMException || error instanceof Error ? error.name : ''
}

function withTimeout<T>(operation: Promise<T>, ms: number, message: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms)
  })

  return Promise.race([operation, timeout]).finally(() => clearTimeout(timeoutId))
}

function isIosDevice() {
  const nav = navigator as Navigator & { standalone?: boolean }
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) || nav.standalone === true
}

function isStandalonePwa() {
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true
}

function getApplicationServerKey(publicKey: string) {
  try {
    const key = urlBase64ToUint8Array(publicKey.trim())

    if (key.byteLength !== 65 || key[0] !== 4) {
      throw new Error('La clave pública VAPID no tiene formato P-256 válido.')
    }

    return key
  } catch (error) {
    throw new Error(`VAPID inválida: revisar NEXT_PUBLIC_VAPID_PUBLIC_KEY en Vercel. ${errorMessage(error)}`)
  }
}

function normalizarErrorPush(error: unknown) {
  const name = errorName(error)
  const message = errorMessage(error)

  if (/VAPID|applicationServerKey|InvalidAccess/i.test(`${name} ${message}`)) {
    return `VAPID inválida: revisar NEXT_PUBLIC_VAPID_PUBLIC_KEY en Vercel. Detalle: ${message}`
  }

  if (/NotAllowedError|Permission denied|permission/i.test(`${name} ${message}`)) {
    return `Permiso denegado: habilitá notificaciones para Mercosur Seguridad desde Ajustes/Notificaciones y volvé a intentar. Detalle: ${message}`
  }

  if (/Service Worker/i.test(message)) return message
  if (/PushManager/i.test(message)) return message
  if (/API subscribe/i.test(message)) return message

  return `No se pudo activar notificaciones. Detalle: ${message}`
}

async function pedirPermisoNotificaciones() {
  if (Notification.permission === 'denied') {
    throw new Error('Permiso denegado: el navegador ya tiene bloqueadas las notificaciones.')
  }

  if (Notification.permission === 'granted') return 'granted'

  const permission = await withTimeout(
    Notification.requestPermission(),
    PUSH_SUBSCRIBE_TIMEOUT_MS,
    'Permiso de notificaciones sin respuesta. Cerrá y abrí la PWA, y volvé a intentar.',
  )

  if (permission !== 'granted') {
    throw new Error('Permiso denegado: no se autorizó el envío de notificaciones.')
  }

  return permission
}

async function obtenerServiceWorker() {
  let registration = await withTimeout(
    navigator.serviceWorker.getRegistration('/'),
    SERVICE_WORKER_TIMEOUT_MS,
    'Service Worker no registrado: no se pudo verificar el registro actual.',
  )

  if (!registration) {
    registration = await withTimeout(
      navigator.serviceWorker.register('/sw.js', { scope: '/' }),
      SERVICE_WORKER_TIMEOUT_MS,
      'Service Worker no registrado: el registro de /sw.js no terminó a tiempo.',
    )
  }

  const ready = await withTimeout(
    navigator.serviceWorker.ready,
    SERVICE_WORKER_TIMEOUT_MS,
    'Service Worker no registrado: /sw.js no quedó activo a tiempo.',
  )

  if (!ready.pushManager) {
    throw new Error('PushManager no soportado: el Service Worker activo no permite suscripciones push.')
  }

  return ready
}

async function guardarSuscripcion(token: string, subscription: PushSubscription) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS)

  try {
    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ subscription }),
      signal: controller.signal,
    })

    const result = await response.json().catch(() => ({}))
    if (!response.ok) {
      const detalle = result?.error || result?.message || response.statusText || 'Sin detalle'
      throw new Error(`Error API subscribe (${response.status}): ${detalle}`)
    }

    return result?.message || 'Notificaciones activadas.'
  } catch (error) {
    if (errorName(error) === 'AbortError') {
      throw new Error('Error API subscribe: la solicitud tardó demasiado y fue cancelada.')
    }

    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

// ── Diagnóstico del dispositivo ──────────────────────────────────────────────
//
// Junta lo que sabe el navegador (permiso, Service Worker, suscripción actual)
// con lo que sabe el servidor (endpoints guardados, último envío) y lo evalúa
// con lib/push-estado. La suscripción del navegador se compara contra las
// guardadas: "tener alguna suscripción histórica" no es estar suscripto.

export interface DiagnosticoPushDispositivo {
  estado: EstadoPush
  endpointNavegador: string | null
  ultimoEnvio: string | null
  ultimoEnvioTitulo: string | null
}

async function tokenSesion(): Promise<string | null> {
  const { data } = await withTimeout(supabase.auth.getSession(), API_TIMEOUT_MS, 'Sesión no disponible.')
  return data.session?.access_token ?? null
}

export async function diagnosticarPushDispositivo(): Promise<DiagnosticoPushDispositivo> {
  const contextoSeguro = typeof window !== 'undefined' && window.isSecureContext
  const pushSoportado = typeof window !== 'undefined' && 'PushManager' in window
  const permiso: PermisoNotificaciones = typeof Notification === 'undefined'
    ? 'no_soportado'
    : (Notification.permission as PermisoNotificaciones)

  let serviceWorkerActivo = false
  let endpointNavegador: string | null = null
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await withTimeout(navigator.serviceWorker.getRegistration('/'), SERVICE_WORKER_TIMEOUT_MS, 'SW')
      serviceWorkerActivo = Boolean(reg?.active)
      if (reg?.pushManager) {
        const sub = await withTimeout(reg.pushManager.getSubscription(), SERVICE_WORKER_TIMEOUT_MS, 'sub')
        endpointNavegador = sub?.endpoint ?? null
      }
    } catch {
      // Sin SW disponible: el estado lo dice.
    }
  }

  let endpointsGuardados: string[] = []
  let fechaSuscripcion: string | null = null
  let ultimoEnvio: string | null = null
  let ultimoEnvioTitulo: string | null = null
  try {
    const token = await tokenSesion()
    if (token) {
      const res = await fetch('/api/push/estado', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        const subs = (data.suscripciones || []) as Array<{ endpoint: string; activo: boolean; updated_at: string }>
        endpointsGuardados = subs.filter(s => s.activo).map(s => s.endpoint)
        fechaSuscripcion = subs.find(s => s.endpoint === endpointNavegador)?.updated_at ?? null
        ultimoEnvio = data.ultimo_envio?.created_at ?? null
        ultimoEnvioTitulo = data.ultimo_envio?.titulo ?? null
      }
    }
  } catch {
    // Sin servidor no se puede comparar: quedará como no suscripto.
  }

  const estado = evaluarEstadoPush({
    permiso,
    serviceWorkerActivo,
    pushSoportado,
    contextoSeguro,
    endpointNavegador,
    endpointsGuardados,
    esIos: isIosDevice(),
    esPwaInstalada: isStandalonePwa(),
    fechaSuscripcion,
    ultimoEnvio,
  })

  return { estado: { ...estado }, endpointNavegador, ultimoEnvio, ultimoEnvioTitulo }
}

export type ResultadoPruebaPush =
  | { ok: true; resultado: 'enviado'; enviado_en: string }
  | { ok: false; resultado: 'sin_dispositivo' | 'suscripcion_invalida' | 'envio_rechazado' | 'error'; error: string }

/** Manda una Web Push real de prueba al dispositivo actual (mismo circuito que las alertas). */
export async function enviarPushDePrueba(): Promise<ResultadoPruebaPush> {
  try {
    const reg = await withTimeout(navigator.serviceWorker.getRegistration('/'), SERVICE_WORKER_TIMEOUT_MS, 'Service Worker no disponible.')
    const sub = reg?.pushManager ? await reg.pushManager.getSubscription() : null
    if (!sub) return { ok: false, resultado: 'sin_dispositivo', error: 'Este navegador no tiene suscripción push. Tocá "Activar notificaciones".' }

    const token = await tokenSesion()
    if (!token) return { ok: false, resultado: 'error', error: 'Sesión no disponible.' }

    const res = await fetch('/api/push/prueba', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    })
    const data = await res.json().catch(() => ({}))
    if (data?.ok) return { ok: true, resultado: 'enviado', enviado_en: data.enviado_en }
    return { ok: false, resultado: data?.resultado || 'error', error: data?.error || `HTTP ${res.status}` }
  } catch (e) {
    return { ok: false, resultado: 'error', error: errorMessage(e) }
  }
}

export async function activarNotificacionesPush(): Promise<PushActivationResult> {
  try {
    if (typeof window === 'undefined') return { ok: false, message: 'Las notificaciones solo se activan desde el navegador.' }
    if (!window.isSecureContext) return { ok: false, message: 'Las notificaciones push requieren HTTPS.' }
    if (!('serviceWorker' in navigator)) return { ok: false, message: 'Service Worker no registrado: este navegador no soporta Service Worker.' }
    if (!('PushManager' in window)) return { ok: false, message: 'PushManager no soportado: este dispositivo/navegador no permite Web Push.' }
    if (!('Notification' in window)) return { ok: false, message: 'Este navegador no soporta notificaciones.' }
    if (isIosDevice() && !isStandalonePwa()) {
      return { ok: false, message: 'iOS Safari solo permite Web Push desde la PWA instalada y abierta desde el icono de la pantalla de inicio.' }
    }

    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!publicKey) return { ok: false, message: 'Falta configurar NEXT_PUBLIC_VAPID_PUBLIC_KEY.' }

    const applicationServerKey = getApplicationServerKey(publicKey)

    await pedirPermisoNotificaciones()

    const registration = await obtenerServiceWorker()
    const existingSubscription = await withTimeout(
      registration.pushManager.getSubscription(),
      SERVICE_WORKER_TIMEOUT_MS,
      'No se pudo consultar la suscripción push existente.',
    )

    const subscription = existingSubscription || await withTimeout(
      registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      }),
      PUSH_SUBSCRIBE_TIMEOUT_MS,
      'No se pudo crear la suscripción push: la operación tardó demasiado.',
    )

    const { data, error } = await withTimeout(
      supabase.auth.getSession(),
      API_TIMEOUT_MS,
      'Sesión no disponible: Supabase tardó demasiado en responder.',
    )

    if (error) return { ok: false, message: `Sesión no disponible para guardar la suscripción. ${error.message}` }

    const token = data.session?.access_token
    if (!token) return { ok: false, message: 'Sesión no disponible para guardar la suscripción.' }

    const message = await guardarSuscripcion(token, subscription)

    return { ok: true, message }
  } catch (error) {
    return { ok: false, message: normalizarErrorPush(error) }
  }
}
