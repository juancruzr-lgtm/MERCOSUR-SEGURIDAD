// Vigilancia de la sesión mientras la app está abierta.
//
// Caso real (Sabino Aranda, 22/11/2026): la sesión se cerró a las 10:24 pero la
// app del celular siguió abierta con la sesión vieja en memoria. Mostraba las
// pantallas y dejaba completar supervisiones, pero todo lo que enviaba volvía
// con 401 y nunca le avisó: perdió la mañana sin saber qué pasaba.
//
// Regla: si la sesión SE PERDIÓ (cerrada, vencida, revocada) se lleva a la
// persona al inicio de sesión con un aviso. Un problema de red NO cuenta como
// sesión perdida: sin señal no se echa a nadie.

/** Error de Supabase Auth: alcanza con status / code / message. */
export interface ErrorAuth { status?: number; code?: string; message?: string; name?: string }

const CODIGOS_SESION_PERDIDA = new Set([
  'session_not_found',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'session_expired',
  'bad_jwt',
  'user_not_found',
  'user_banned',
])

/** ¿Este error dice que la sesión ya no existe? (No: red caída, servidor, timeout.) */
export function esSesionPerdida(error: ErrorAuth | null | undefined): boolean {
  if (!error) return false
  if (error.code && CODIGOS_SESION_PERDIDA.has(error.code)) return true
  // Sin sesión guardada en este dispositivo (supabase-js: AuthSessionMissingError).
  if (error.name === 'AuthSessionMissingError') return true
  if (error.status === 401 || error.status === 403) return true
  const m = (error.message ?? '').toLowerCase()
  return m.includes('refresh token not found')
    || m.includes('invalid refresh token')
    || m.includes('session not found')
    || m.includes('jwt expired')
}

interface ClienteAuth {
  auth: {
    onAuthStateChange: (cb: (evento: string, sesion: unknown) => void) => { data: { subscription: { unsubscribe: () => void } } }
    getUser: () => Promise<{ data: { user: unknown } | null; error: ErrorAuth | null }>
    signOut: (o?: { scope?: 'local' | 'global' | 'others' }) => Promise<unknown>
  }
}

/**
 * Escucha la sesión y avisa UNA vez cuando se pierde:
 *  - evento SIGNED_OUT de supabase-js (cierre en otra pestaña o refresh rechazado);
 *  - al volver a la app (pantalla visible / vuelve la red) se pregunta al
 *    servidor si la sesión sigue viva; sólo un rechazo de sesión la da por perdida.
 * Devuelve la función para dejar de escuchar.
 */
export function vigilarSesion(cliente: ClienteAuth, alPerderse: () => void, entorno: {
  documento?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>
  ventana?: Pick<Window, 'addEventListener' | 'removeEventListener'>
} = {}): () => void {
  let avisado = false
  const perder = () => {
    if (avisado) return
    avisado = true
    // Limpia la sesión vieja de este dispositivo; si no hay red, igual se avisa.
    void Promise.resolve(cliente.auth.signOut({ scope: 'local' })).catch(() => {})
    alPerderse()
  }

  const { data } = cliente.auth.onAuthStateChange(evento => {
    if (evento === 'SIGNED_OUT') perder()
  })

  const comprobar = async () => {
    if (avisado) return
    try {
      const { data: d, error } = await cliente.auth.getUser()
      if (esSesionPerdida(error) || (!error && !d?.user)) perder()
    } catch {
      // Red caída: no se decide nada.
    }
  }
  const doc = entorno.documento ?? (typeof document !== 'undefined' ? document : undefined)
  const win = entorno.ventana ?? (typeof window !== 'undefined' ? window : undefined)
  const alVolver = () => { if (!doc || doc.visibilityState === 'visible') void comprobar() }
  doc?.addEventListener('visibilitychange', alVolver)
  win?.addEventListener('online', alVolver)
  win?.addEventListener('focus', alVolver)

  return () => {
    data.subscription.unsubscribe()
    doc?.removeEventListener('visibilitychange', alVolver)
    win?.removeEventListener('online', alVolver)
    win?.removeEventListener('focus', alVolver)
  }
}
