/**
 * lib/auth-mensajes.ts
 *
 * Validaciones y mensajes de autenticación compartidos por el login, el cambio
 * de contraseña y la recuperación por email. Funciones puras (testeables).
 * Los mensajes nunca confirman si un email existe ni exponen detalles internos.
 */

export const PASSWORD_MIN = 6

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function textoDeError(error: unknown): { mensaje: string; codigo: string } {
  if (!error) return { mensaje: '', codigo: '' }
  if (typeof error === 'string') return { mensaje: error, codigo: '' }
  if (typeof error === 'object') {
    const e = error as { message?: unknown; code?: unknown }
    return { mensaje: String(e.message ?? ''), codigo: String(e.code ?? '') }
  }
  return { mensaje: String(error), codigo: '' }
}

export function validarEmail(email: string): string | null {
  const limpio = email.trim()
  if (!limpio) return 'Ingresá tu email.'
  if (!EMAIL_RE.test(limpio)) return 'El email no tiene un formato válido.'
  return null
}

export function validarCredencialesLogin(email: string, password: string): string | null {
  const errorEmail = validarEmail(email)
  if (errorEmail && !password.trim()) return 'Ingresá tu email y tu contraseña.'
  if (errorEmail) return errorEmail
  if (!password.trim()) return 'Ingresá tu contraseña.'
  return null
}

export function validarNuevaPassword(nueva: string, confirmar: string): string | null {
  if (!nueva) return 'Ingresá la nueva contraseña.'
  if (nueva !== nueva.trim()) return 'La contraseña no puede empezar ni terminar con espacios.'
  if (nueva.length < PASSWORD_MIN) return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`
  if (nueva !== confirmar) return 'Las contraseñas no coinciden.'
  return null
}

const ES_RED = /failed to fetch|network|load failed|timeout|fetch/i

/** Errores de login y recuperación por email. */
export function mensajeErrorAuth(error: unknown, accion: string): string {
  const { mensaje, codigo } = textoDeError(error)

  if (codigo === 'invalid_credentials' || /invalid login credentials/i.test(mensaje)) return 'Email o contraseña incorrectos.'
  if (codigo === 'user_banned' || /banned/i.test(mensaje)) return 'Tu acceso a la app está deshabilitado. Si es un error, consultá con Administración.'
  if (codigo === 'email_not_confirmed' || /email not confirmed/i.test(mensaje)) return 'Tu email todavía no fue confirmado. Consultá con Administración.'
  if (codigo === 'over_email_send_rate_limit' || codigo === 'over_request_rate_limit' || /rate limit|too many/i.test(mensaje)) {
    return 'Se hicieron demasiados intentos. Esperá unos minutos y volvé a probar.'
  }
  if (codigo === 'validation_failed') return 'Revisá los datos ingresados.'
  if (/redirect/i.test(mensaje)) return `No se pudo generar el enlace de ${accion}. Avisá a Administración.`
  if (/smtp|sending|send email|mail/i.test(mensaje)) return `No se pudo enviar el email de ${accion}. Avisá a Administración.`
  if (ES_RED.test(mensaje)) return 'No hay conexión con el servidor. Revisá tu conexión e intentá de nuevo.'
  return `No se pudo completar ${accion}. Intentá de nuevo.`
}

/** Errores de supabase.auth.updateUser({ password }). */
export function mensajeErrorCambioPassword(error: unknown): string {
  const { mensaje, codigo } = textoDeError(error)

  if (codigo === 'same_password' || /different from the old/i.test(mensaje)) return 'La nueva contraseña tiene que ser distinta de la actual.'
  if (codigo === 'weak_password' || /weak|at least|characters/i.test(mensaje)) return `La contraseña es demasiado débil. Usá al menos ${PASSWORD_MIN} caracteres.`
  if (codigo === 'reauthentication_needed' || /reauthenticat/i.test(mensaje)) return 'Por seguridad, cerrá sesión, volvé a ingresar y repetí el cambio.'
  if (codigo === 'session_not_found' || /session/i.test(mensaje)) return 'Tu sesión venció. Volvé a ingresar o pedí un nuevo enlace de recuperación.'
  if (ES_RED.test(mensaje)) return 'No hay conexión con el servidor. Revisá tu conexión e intentá de nuevo.'
  return 'No se pudo cambiar la contraseña. Intentá de nuevo.'
}
