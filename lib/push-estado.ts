/**
 * lib/push-estado.ts
 *
 * Diagnóstico del dispositivo para notificaciones push: qué le pasa a ESTE
 * teléfono, dicho en una frase que el supervisor o el vigilador pueda
 * entender y, si hay algo que arreglar, qué tiene que tocar.
 *
 * Es lógica pura sobre lo que reporta el navegador (permiso, Service Worker,
 * suscripción del PushManager, plataforma) y lo que dice el servidor (qué
 * endpoints tiene guardados este usuario, cuándo se le mandó algo por última
 * vez). No toca la red: la usan la sección "Estado de notificaciones" de las
 * apps y sus tests.
 *
 * Decisión clave: "suscripto" significa que la suscripción activa DE ESTE
 * NAVEGADOR coincide con una fila guardada. Que el usuario tenga alguna
 * suscripción histórica en la base no alcanza: si el navegador rotó el
 * endpoint, la fila vieja sigue `activo=true` hasta que un envío dé 410 y
 * mientras tanto las push van a un endpoint muerto.
 */

export type PermisoNotificaciones = 'granted' | 'denied' | 'default' | 'no_soportado'

export interface EntradaEstadoPush {
  /** Notification.permission, o 'no_soportado' si no existe la API. */
  permiso: PermisoNotificaciones
  /** navigator.serviceWorker existe y hay una registration activa. */
  serviceWorkerActivo: boolean
  /** 'PushManager' in window. */
  pushSoportado: boolean
  /** Contexto seguro (HTTPS o localhost). */
  contextoSeguro: boolean
  /** Endpoint de la suscripción actual del navegador, o null si no hay. */
  endpointNavegador: string | null
  /** Endpoints activos guardados en push_subscriptions para este usuario. */
  endpointsGuardados: string[]
  esIos: boolean
  esPwaInstalada: boolean
  /** ISO de updated_at de la fila que coincide con el endpoint del navegador. */
  fechaSuscripcion?: string | null
  /** ISO del último envío registrado en notificaciones_enviadas para el usuario. */
  ultimoEnvio?: string | null
}

export type CodigoEstadoPush =
  | 'funcionando'
  | 'permiso_bloqueado'
  | 'permiso_sin_solicitar'
  | 'sin_service_worker'
  | 'sin_soporte_push'
  | 'sin_https'
  | 'ios_sin_pwa'
  | 'dispositivo_no_suscripto'
  | 'endpoint_distinto'

export interface EstadoPush {
  codigo: CodigoEstadoPush
  ok: boolean
  titulo: string
  detalle: string
  /** Qué tiene que hacer la persona; null si no hay acción posible/necesaria. */
  accion: string | null
  /** El botón "Activar notificaciones" tiene sentido en este estado. */
  puedeActivar: boolean
  /** El botón "Enviar prueba" tiene sentido (hay a dónde mandarla). */
  puedeProbar: boolean
  permisoTexto: 'Permitido' | 'Bloqueado' | 'Sin solicitar' | 'No disponible'
  serviceWorkerTexto: 'Activo' | 'No disponible'
  suscriptoTexto: 'Sí' | 'No'
}

export const INSTRUCCION_PERMISO_BLOQUEADO_ANDROID =
  'El permiso está bloqueado en el teléfono, no se puede corregir desde la app. En Android: Ajustes → Aplicaciones → Chrome (o la app MERCOSUR si está instalada) → Notificaciones → Permitir. Después volvé acá y tocá "Activar notificaciones".'

export const INSTRUCCION_PERMISO_BLOQUEADO_IOS =
  'El permiso está bloqueado en el iPhone, no se puede corregir desde la app. En iOS: Ajustes → Notificaciones → MERCOSUR Seguridad → Permitir notificaciones. Después volvé acá y tocá "Activar notificaciones".'

export const INSTRUCCION_IOS_SIN_PWA =
  'En iPhone las notificaciones con la app cerrada sólo funcionan si MERCOSUR está instalada en la pantalla de inicio. En Safari: botón Compartir → "Agregar a inicio". Después abrí MERCOSUR desde ese ícono y activá las notificaciones ahí.'

export function permisoTexto(permiso: PermisoNotificaciones): EstadoPush['permisoTexto'] {
  if (permiso === 'granted') return 'Permitido'
  if (permiso === 'denied') return 'Bloqueado'
  if (permiso === 'default') return 'Sin solicitar'
  return 'No disponible'
}

/**
 * Evalúa el estado del dispositivo. El orden de los chequeos importa: se
 * informa el PRIMER problema que impide recibir push, porque es el que hay que
 * resolver primero (sin HTTPS no hay Service Worker; sin PWA en iOS no hay
 * permiso que valga; con permiso bloqueado no tiene sentido pedir suscripción).
 */
export function evaluarEstadoPush(e: EntradaEstadoPush): EstadoPush {
  const base = {
    permisoTexto: permisoTexto(e.permiso),
    serviceWorkerTexto: (e.serviceWorkerActivo ? 'Activo' : 'No disponible') as EstadoPush['serviceWorkerTexto'],
  }
  const coincide = Boolean(e.endpointNavegador && e.endpointsGuardados.includes(e.endpointNavegador))
  const suscriptoTexto: EstadoPush['suscriptoTexto'] = coincide ? 'Sí' : 'No'

  if (!e.contextoSeguro) {
    return { ...base, suscriptoTexto, codigo: 'sin_https', ok: false, titulo: 'Notificaciones no disponibles', detalle: 'La app no está abierta por HTTPS: el navegador no permite Service Worker ni push.', accion: 'Abrí MERCOSUR desde su dirección https:// habitual.', puedeActivar: false, puedeProbar: false }
  }

  if (e.esIos && !e.esPwaInstalada) {
    return { ...base, suscriptoTexto, codigo: 'ios_sin_pwa', ok: false, titulo: 'Falta instalar la app en el iPhone', detalle: 'MERCOSUR está abierta en Safari, no como app instalada. Así el iPhone no entrega notificaciones con la app cerrada.', accion: INSTRUCCION_IOS_SIN_PWA, puedeActivar: false, puedeProbar: false }
  }

  if (!e.pushSoportado) {
    return { ...base, suscriptoTexto, codigo: 'sin_soporte_push', ok: false, titulo: 'Este navegador no soporta push', detalle: 'El navegador no tiene Web Push. Probá con Chrome (Android) o con la app instalada (iPhone).', accion: null, puedeActivar: false, puedeProbar: false }
  }

  if (e.permiso === 'denied') {
    return { ...base, suscriptoTexto, codigo: 'permiso_bloqueado', ok: false, titulo: 'Notificaciones bloqueadas en el teléfono', detalle: 'El teléfono tiene bloqueadas las notificaciones de MERCOSUR. La app no puede volver a pedir el permiso: hay que habilitarlo en la configuración.', accion: e.esIos ? INSTRUCCION_PERMISO_BLOQUEADO_IOS : INSTRUCCION_PERMISO_BLOQUEADO_ANDROID, puedeActivar: false, puedeProbar: false }
  }

  if (!e.serviceWorkerActivo) {
    return { ...base, suscriptoTexto, codigo: 'sin_service_worker', ok: false, titulo: 'La app todavía no terminó de instalarse', detalle: 'El componente que recibe las notificaciones (Service Worker) no está activo en este navegador.', accion: 'Cerrá y volvé a abrir MERCOSUR. Si sigue igual, tocá "Activar notificaciones".', puedeActivar: true, puedeProbar: false }
  }

  if (e.permiso === 'default') {
    return { ...base, suscriptoTexto, codigo: 'permiso_sin_solicitar', ok: false, titulo: 'Notificaciones sin activar', detalle: 'Todavía no se pidió permiso a este teléfono.', accion: 'Tocá "Activar notificaciones" y aceptá el permiso cuando el teléfono lo pregunte.', puedeActivar: true, puedeProbar: false }
  }

  // Permiso concedido y SW activo: ahora importa si ESTE navegador está suscripto.
  if (!e.endpointNavegador) {
    return { ...base, suscriptoTexto, codigo: 'dispositivo_no_suscripto', ok: false, titulo: 'Este dispositivo no está suscripto', detalle: 'El permiso está dado pero este teléfono no tiene una suscripción push registrada.', accion: 'Tocá "Activar notificaciones".', puedeActivar: true, puedeProbar: false }
  }

  if (!coincide) {
    return { ...base, suscriptoTexto, codigo: 'endpoint_distinto', ok: false, titulo: 'Suscripción desactualizada', detalle: e.endpointsGuardados.length > 0 ? 'El teléfono cambió su dirección de notificaciones y el sistema todavía tiene registrada la anterior: las alertas se están mandando a una dirección que ya no existe.' : 'El teléfono tiene una suscripción pero el sistema no la tiene registrada.', accion: 'Tocá "Activar notificaciones" para registrar la suscripción actual.', puedeActivar: true, puedeProbar: false }
  }

  return { ...base, suscriptoTexto, codigo: 'funcionando', ok: true, titulo: 'Notificaciones funcionando', detalle: 'Este dispositivo está registrado y puede recibir alertas con la app cerrada.', accion: null, puedeActivar: false, puedeProbar: true }
}

/** Texto amigable del último envío. */
export function textoUltimoEnvio(iso: string | null | undefined, ahora: Date = new Date()): string {
  if (!iso) return 'Sin envíos registrados'
  const min = Math.floor((ahora.getTime() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'hace menos de un minuto'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.floor(h / 24)} días`
}

/** Tipo con el que se registra la prueba en notificaciones_enviadas: nunca choca con alertas reales. */
export function tipoPruebaDispositivo(ahora: Date = new Date()): string {
  return `prueba_dispositivo:${ahora.toISOString()}`
}
