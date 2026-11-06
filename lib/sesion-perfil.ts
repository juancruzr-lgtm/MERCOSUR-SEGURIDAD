// Verificación de la sesión al arrancar la app y al ingresar (06/11/2026).
//
// PROBLEMA que corrige:
//   Antes, CUALQUIER error al leer el perfil (sin señal, timeout, 500, 42501 de
//   permisos durante un cambio de base) terminaba en `supabase.auth.signOut()`.
//   Ese signOut es GLOBAL por defecto en supabase-js: revoca todas las sesiones
//   de la persona en todos sus dispositivos. Un corte de red en un teléfono
//   sacaba al vigilador de la app también en los demás.
//   Además, si al arrancar no había red para renovar el token, supabase-js
//   conserva la sesión guardada pero getSession() devuelve null, y la app
//   mostraba el login como si la persona no tuviera sesión.
//
// REGLA NUEVA:
//   - Sesión realmente inválida (Auth la rechaza, o la consulta funcionó y no
//     hay perfil): se cierra SÓLO en este dispositivo (scope 'local').
//   - Baja laboral confirmada: se cierran todas sus sesiones (scope 'global'),
//     igual que antes: es una decisión de seguridad, no un error.
//   - No se pudo verificar (red, servidor, permisos): NO se cierra la sesión y
//     NO se entra a la app. Sin perfil verificado no hay privilegios; se
//     reintenta hasta poder verificar.

export type ErrorLike = { code?: string | null; message?: string | null; status?: number | null; name?: string | null } | null | undefined

export type ResultadoSesion =
  | { estado: 'ok'; perfil: Record<string, any> }
  | { estado: 'sin_sesion' }
  | { estado: 'bloqueado' }
  | { estado: 'sin_perfil' }
  | { estado: 'sesion_invalida'; detalle: string }
  | { estado: 'sin_verificar'; detalle: string }

export type ClienteVerificacion = {
  auth: {
    getSession(): Promise<{ data: { session: { user: { id: string } } | null }; error?: ErrorLike }>
    getUser(): Promise<{ data: { user: { id: string } | null }; error?: ErrorLike }>
  }
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: ErrorLike }>
  from(tabla: string): any
}

const texto = (e: unknown): string => {
  if (!e) return 'sin detalle'
  if (typeof e === 'string') return e
  const x = e as { code?: unknown; message?: unknown; status?: unknown }
  return [x.status ? `HTTP ${x.status}` : '', x.code ? String(x.code) : '', x.message ? String(x.message) : ''].filter(Boolean).join(' · ') || 'sin detalle'
}

/**
 * Error al LEER EL PERFIL (PostgREST o red) → qué significa.
 *  - 'token': el JWT fue rechazado (401 / PGRST301-303). Puede ser un token vencido
 *    que supabase-js todavía no renovó: se valida con Auth antes de decidir.
 *  - 'transitorio': red, timeout, 5xx, 403/42501 de permisos, cualquier otro. No
 *    dice nada sobre la validez de la sesión.
 */
export function clasificarErrorConsulta(e: ErrorLike, status?: number | null): 'token' | 'transitorio' {
  if (!e) return 'transitorio'
  const code = String(e.code ?? '')
  if (status === 401 || e.status === 401 || /^PGRST30[123]$/.test(code) || /\bjwt\b/i.test(String(e.message ?? ''))) return 'token'
  return 'transitorio'
}

/** Error de Supabase Auth → la sesión es inválida de verdad (y no un problema de red). */
export function authRechazaSesion(e: ErrorLike): boolean {
  if (!e) return false
  if (e.name === 'AuthSessionMissingError') return true
  if (e.name === 'AuthRetryableFetchError') return false
  const s = Number(e.status ?? 0)
  return e.name === 'AuthApiError' && (s === 400 || s === 401 || s === 403 || s === 404)
}

/**
 * Baja laboral confirmada (mi_acceso_estado). Ante un error responde false: no
 * se puede afirmar una baja que no se verificó, y la base igual bloquea por RLS
 * a una persona dada de baja (su perfil no se lee → sin perfil).
 */
export async function bajaConfirmada(cli: Pick<ClienteVerificacion, 'rpc'>): Promise<boolean> {
  try {
    const r = await cli.rpc('mi_acceso_estado')
    if (r.error) return false
    return Boolean((r.data as { bloqueado?: boolean } | null)?.bloqueado)
  } catch {
    return false
  }
}

async function leerPerfil(cli: ClienteVerificacion, campo: 'auth_user_id' | 'email', valor: string, columnas: string)
  : Promise<{ perfil: Record<string, any> | null; error: ErrorLike; status: number | null }> {
  try {
    const { data, error, status } = await cli.from('usuarios').select(columnas).eq(campo, valor).maybeSingle()
    return { perfil: (data as Record<string, any> | null) ?? null, error: error ?? null, status: status ?? null }
  } catch (e) {
    return { perfil: null, error: { message: texto(e) }, status: null }
  }
}

/** Valida el token contra Auth. `invalida` sólo si Auth la rechaza; `user` si es válida; ninguno si no se pudo saber. */
async function validarConAuth(cli: ClienteVerificacion): Promise<{ invalida: boolean; user: { id: string } | null; error: ErrorLike }> {
  try {
    const { data, error } = await cli.auth.getUser()
    if (error) return { invalida: authRechazaSesion(error), user: null, error }
    return { invalida: !data.user, user: data.user, error: null }
  } catch (e) {
    return { invalida: false, user: null, error: { message: texto(e) } }
  }
}

/** Arranque de la app: sesión guardada → perfil verificado, o por qué no. No cierra sesiones: eso lo decide `cierreDeSesionPara`. */
export async function verificarSesion(cli: ClienteVerificacion, columnas: string): Promise<ResultadoSesion> {
  let sesion: { user: { id: string } } | null
  try {
    const { data, error } = await cli.auth.getSession()
    if (error) {
      // Token vencido y sin red para renovarlo: supabase-js conserva la sesión, no es un cierre.
      if (authRechazaSesion(error)) return { estado: 'sesion_invalida', detalle: texto(error) }
      return { estado: 'sin_verificar', detalle: texto(error) }
    }
    sesion = data.session
  } catch (e) {
    return { estado: 'sin_verificar', detalle: texto(e) }
  }
  if (!sesion) return { estado: 'sin_sesion' }

  if (await bajaConfirmada(cli)) return { estado: 'bloqueado' }

  let r = await leerPerfil(cli, 'auth_user_id', sesion.user.id, columnas)
  if (!r.error) return r.perfil ? { estado: 'ok', perfil: r.perfil } : { estado: 'sin_perfil' }

  if (clasificarErrorConsulta(r.error, r.status) === 'token') {
    const a = await validarConAuth(cli)
    if (a.invalida) return { estado: 'sesion_invalida', detalle: texto(a.error ?? r.error) }
    if (a.user) {
      // Token válido (o recién renovado): un solo reintento, sin bucles.
      r = await leerPerfil(cli, 'auth_user_id', a.user.id, columnas)
      if (!r.error) return r.perfil ? { estado: 'ok', perfil: r.perfil } : { estado: 'sin_perfil' }
    }
  }
  return { estado: 'sin_verificar', detalle: texto(r.error) }
}

/**
 * Después de `signInWithPassword` exitoso. Igual que el arranque, más el respaldo
 * por email para perfiles sin `auth_user_id` vinculado. El respaldo (que ESCRIBE
 * el vínculo) corre sólo si la primera lectura funcionó y no encontró fila:
 * nunca a partir de un error.
 */
export async function perfilTrasIngreso(cli: ClienteVerificacion, user: { id: string; email?: string | null }, columnas: string)
  : Promise<Exclude<ResultadoSesion, { estado: 'sin_sesion' } | { estado: 'sesion_invalida' }>> {
  if (await bajaConfirmada(cli)) return { estado: 'bloqueado' }
  const r = await leerPerfil(cli, 'auth_user_id', user.id, columnas)
  if (r.error) return { estado: 'sin_verificar', detalle: texto(r.error) }
  if (r.perfil) return { estado: 'ok', perfil: r.perfil }
  const email = (user.email ?? '').trim().toLowerCase()
  if (!email) return { estado: 'sin_perfil' }
  const f = await leerPerfil(cli, 'email', email, columnas)
  if (f.error) return { estado: 'sin_verificar', detalle: texto(f.error) }
  if (!f.perfil) return { estado: 'sin_perfil' }
  try {
    await cli.from('usuarios').update({ auth_user_id: user.id }).eq('id', f.perfil.id)
  } catch { /* el vínculo se vuelve a intentar en el próximo ingreso */ }
  return { estado: 'ok', perfil: f.perfil }
}

/** Cierre de sesión que corresponde a cada resultado. Un error de consulta NUNCA cierra la sesión. */
export function cierreDeSesionPara(r: { estado: ResultadoSesion['estado'] }): null | 'local' | 'global' {
  if (r.estado === 'bloqueado') return 'global'
  if (r.estado === 'sin_perfil' || r.estado === 'sesion_invalida') return 'local'
  return null
}

export const MENSAJES_SESION = {
  bloqueado: 'Tu acceso a la app está deshabilitado por una baja laboral. Si es un error, consultá con Administración.',
  sin_perfil: 'Tu usuario no tiene un perfil asignado. Consultá con Administración.',
  sesion_invalida: 'Tu sesión venció o se cerró. Ingresá de nuevo.',
  sin_verificar_ingreso: 'No pudimos verificar tu perfil por un problema de conexión o del servidor. Probá de nuevo en unos segundos.',
} as const
