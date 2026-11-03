/**
 * lib/auth-recuperacion.ts
 *
 * Recuperación de contraseña por email. El enlace de Supabase vuelve a
 * /dashboard con `#...type=recovery` (flujo implícito) y supabase-js abre la
 * sesión solo. Para que esa sesión NO entre al panel hasta fijar la contraseña
 * nueva, se marca "recuperación pendiente" en localStorage (sobrevive recargas
 * y otras pestañas) y AppShell muestra el formulario obligatorio mientras siga.
 *
 * `capturarEnlaceAuth` se ejecuta en lib/supabase.ts ANTES de crear el
 * cliente, porque supabase-js limpia el hash de la URL al procesarlo.
 */

export const CLAVE_RECUPERACION = 'ms_recuperacion_pendiente'

let enMemoria = false
let errorEnlace: string | null = null

export type EnlaceAuth = { recuperacion: boolean; error: string | null }

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
  return { recuperacion: !hayError && dato('type') === 'recovery', error }
}

function storage(): Storage | null {
  try { return typeof window !== 'undefined' ? window.localStorage : null } catch { return null }
}

export function marcarRecuperacionPendiente(): void {
  try { storage()?.setItem(CLAVE_RECUPERACION, '1') } catch { /* sin storage: queda el flag en memoria */ }
  enMemoria = true
}

export function limpiarRecuperacionPendiente(): void {
  try { storage()?.removeItem(CLAVE_RECUPERACION) } catch { /* noop */ }
  enMemoria = false
}

export function recuperacionPendiente(): boolean {
  if (enMemoria) return true
  try { return storage()?.getItem(CLAVE_RECUPERACION) === '1' } catch { return false }
}

export function capturarEnlaceAuth(): void {
  if (typeof window === 'undefined') return
  const enlace = leerEnlaceAuth(window.location.hash, window.location.search)
  if (enlace.recuperacion) marcarRecuperacionPendiente()
  errorEnlace = enlace.error
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
