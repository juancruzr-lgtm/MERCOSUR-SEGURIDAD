// Control de versión al arrancar (06/11/2026).
//
// Un teléfono puede abrir una copia VIEJA de la app: la página guardada por el
// service worker cuando no había señal, o una pestaña restaurada desde la caché
// del navegador. Esa copia corre código viejo hasta que el service worker nuevo
// toma el control y recarga (unos segundos), y mientras tanto ya consultó la
// base con sus reglas viejas. Con cambios de permisos (p. ej. #381 B) eso rompe.
//
// Desde esta versión, ANTES de verificar la sesión o leer datos, la app compara
// su versión con la publicada (`/api/version`, sin caché). Si es vieja, se
// recarga en ese momento: nunca llega a hacer consultas con código viejo.
//  - Sin red o sin respuesta: sigue (no se traba el arranque sin señal).
//  - Una sola recarga por versión publicada y pestaña: si después de recargar
//    sigue vieja (caché intermedia), no entra en bucle.
// No resuelve a las copias ANTERIORES a esta versión (no tienen este código):
// ésas se actualizan solas cuando el service worker nuevo toma el control.

export const VERSION_APP: string = process.env.NEXT_PUBLIC_APP_VERSION || 'dev'

type Almacen = Pick<Storage, 'getItem' | 'setItem'>

/** La versión de esta copia difiere de la publicada (y ambas se conocen). */
export function versionDesactualizada(local: string, publicada: string | null | undefined): boolean {
  if (!publicada || !local || local === 'dev') return false
  return publicada !== local
}

/** Versión publicada en el servidor, o null si no se pudo saber (sin red, timeout, respuesta rara). */
export async function versionPublicada(fetcher: typeof fetch = fetch, timeoutMs = 3000): Promise<string | null> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const t = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await fetcher('/api/version', { cache: 'no-store', signal: ctrl?.signal })
    if (!res.ok) return null
    const j = await res.json() as { version?: unknown }
    return typeof j?.version === 'string' && j.version ? j.version : null
  } catch {
    return null
  } finally {
    if (t) clearTimeout(t)
  }
}

/**
 * Si esta copia es vieja, pide la actualización del service worker y recarga.
 * Devuelve true si va a recargar (el arranque debe detenerse ahí).
 */
export async function recargarSiHayVersionNueva(dep: {
  local?: string
  publicada?: () => Promise<string | null>
  almacen?: Almacen | null
  actualizarWorker?: () => Promise<unknown>
  recargar?: () => void
} = {}): Promise<boolean> {
  const local = dep.local ?? VERSION_APP
  const publicada = await (dep.publicada ?? (() => versionPublicada()))()
  if (!versionDesactualizada(local, publicada)) return false
  let almacen: Almacen | null = null
  try { almacen = dep.almacen !== undefined ? dep.almacen : window.sessionStorage } catch { almacen = null }
  const clave = `mercosur-recarga-version:${publicada}`
  try {
    if (almacen?.getItem(clave)) return false // ya se recargó una vez por esta versión: no insistir
    almacen?.setItem(clave, String(Date.now()))
  } catch { /* sin almacenamiento: se recarga igual una vez; la versión nueva ya no vuelve a entrar acá */ }
  try {
    await (dep.actualizarWorker ?? (async () => {
      const reg = await navigator.serviceWorker?.getRegistration()
      await reg?.update()
    }))()
  } catch { /* la recarga igual trae la versión nueva por red */ }
  ;(dep.recargar ?? (() => window.location.reload()))()
  return true
}
