/**
 * lib/auth-recuperacion.ts
 *
 * Recuperación de contraseña por email. El enlace de Supabase vuelve a
 * /dashboard con `#...type=recovery` (flujo implícito) y supabase-js abre la
 * sesión solo. Para que esa sesión NO entre al panel hasta fijar la contraseña
 * nueva, se guarda en localStorage el session_id de ESA sesión (sobrevive
 * recargas y otras pestañas) y AppShell muestra el formulario obligatorio
 * mientras la sesión actual sea esa. No es un control del servidor.
 *
 * `capturarEnlaceAuth` se ejecuta en lib/supabase.ts ANTES de crear el
 * cliente, porque supabase-js limpia el hash de la URL al procesarlo.
 */

export const CLAVE_RECUPERACION = 'ms_recuperacion_pendiente'

// session_id (claim del JWT) de la sesión abierta por el enlace de recuperación.
let sesionEnMemoria: string | null = null
// access_token que trajo el enlace en esta carga de página (sólo en memoria).
let tokenEnlace: string | null = null
let errorEnlace: string | null = null
let invitacionEnlace = false

export type EnlaceAuth = { recuperacion: boolean; invitacion: boolean; error: string | null }

export function leerEnlaceAuth(hash: string, search: string): EnlaceAuth {
  const p = new URLSearchParams((hash || '').replace(/^#/, ''))
  const q = new URLSearchParams((search || '').replace(/^\?/, ''))
  const dato = (k: string) => p.get(k) ?? q.get(k)

  const codigo = dato('error_code') || ''
  const hayError = Boolean(dato('error') || codigo)
  let error: string | null = null
  if (hayError) {
    error = codigo === 'otp_expired'
      ? 'El enlace venció o ya fue usado. Pedí uno nuevo con "Olvidé mi contraseña".'
      : 'El enlace no es válido. Pedí uno nuevo con "Olvidé mi contraseña".'
  }
  // Invitación de alta (type=invite): la persona todavía no tiene contraseña.
  // Se trata igual que una recuperación: no entra al panel hasta crearla.
  const tipo = dato('type')
  const invitacion = !hayError && tipo === 'invite'
  return { recuperacion: !hayError && (tipo === 'recovery' || invitacion), invitacion, error }
}

function storage(): Storage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}

/** session_id del JWT (estable entre refrescos de la misma sesión). */
export function sessionIdDe(accessToken: string | null | undefined): string | null {
  try {
    const parte = String(accessToken || '').split('.')[1]
    if (!parte) return null
    const json = JSON.parse(atob(parte.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof json?.session_id === 'string' && json.session_id ? json.session_id : null
  } catch {
    return null
  }
}

/** Marca como pendiente la sesión de recuperación (por su session_id). */
export function marcarRecuperacionPendiente(sessionId: string | null): void {
  if (!sessionId) return
  try { storage()?.setItem(CLAVE_RECUPERACION, sessionId) } catch { /* sin storage: queda en memoria */ }
  sesionEnMemoria = sessionId
}

export function limpiarRecuperacionPendiente(): void {
  try { storage()?.removeItem(CLAVE_RECUPERACION) } catch { /* noop */ }
  sesionEnMemoria = null
}

/**
 * ¿La sesión actual es la que abrió un enlace de recuperación válido?
 * Sólo cuenta si Supabase validó el enlace: el access_token de la sesión es el
 * mismo que trajo la URL (o lo confirmó el evento PASSWORD_RECOVERY). Una
 * sesión abierta por login normal, Magic Link o un enlace inválido NUNCA queda
 * tratada como recuperación, aunque haya una marca vieja en el navegador.
 *
 * Es una barrera de interfaz, no de seguridad: la sesión de recuperación es
 * una sesión válida para el servidor (quien abre el enlace demostró controlar
 * el email). Las APIs y RLS no la distinguen.
 */
export function recuperacionPendientePara(accessToken: string | null | undefined): boolean {
  const sid = sessionIdDe(accessToken)
  if (!sid) return false
  if (tokenEnlace && accessToken === tokenEnlace) marcarRecuperacionPendiente(sid)
  tokenEnlace = null
  let guardada = sesionEnMemoria
  try { guardada = storage()?.getItem(CLAVE_RECUPERACION) ?? sesionEnMemoria } catch { /* noop */ }
  if (!guardada) return false
  if (guardada !== sid) { limpiarRecuperacionPendiente(); return false }
  return true
}

export function capturarEnlaceAuth(): void {
  if (typeof window === 'undefined') return
  const enlace = leerEnlaceAuth(window.location.hash, window.location.search)
  const p = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  tokenEnlace = enlace.recuperacion ? p.get('access_token') : null
  // Un enlace de ingreso que no es recuperación (Magic Link, invitación) abre
  // otra sesión: cualquier marca de recuperación anterior deja de aplicar.
  if (!enlace.recuperacion && !enlace.error && p.get('access_token')) limpiarRecuperacionPendiente()
  errorEnlace = enlace.error
  invitacionEnlace = enlace.invitacion
}

/** ¿La página se abrió desde una invitación de alta? (texto de bienvenida) */
export function enlaceFueInvitacion(): boolean {
  return invitacionEnlace
}

/** Error del enlace de email (vencido/usado), una sola vez; limpia la URL. */
export function tomarErrorEnlace(): string | null {
  const e = errorEnlace
  errorEnlace = null
  if (e && typeof window !== 'undefined') {
    try { window.history.replaceState(null, '', window.location.pathname) } catch { /* noop */ }
  }
  return e
}
