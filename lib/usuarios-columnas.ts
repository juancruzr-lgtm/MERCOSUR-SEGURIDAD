// Columnas de `usuarios` que puede leer cualquier perfil con sesión (según RLS).
//
// `cuenta_bancaria` (CBU / cuenta de acreditación) NO está: es información
// económica y sólo la leen Administración y Gerencia, por la RPC
// `usuarios_cuentas_bancarias()` (con gate en la base). Auditoría 05/11/2026,
// hallazgo V2: con `select('*')` cualquier supervisor recibía los CBU de toda la
// plantilla por /rest/v1/usuarios.
//
// Después del deploy de este cambio, la base revoca SELECT de esa columna a
// `authenticated` (migración 20261207100100). Desde ahí, un `select('*')` o un
// `.select()` sin columnas sobre `usuarios` desde el navegador FALLA (42501), por
// eso todo lector usa esta lista. tests/usuarios-sin-cbu.test.ts lo controla.
//
// `dni`, `telefono` y `cuil` tampoco están (F-06): se leen por la RPC
// `usuarios_datos_personales()` con `cargarDatosPersonales` (abajo), que entrega
// sólo lo que la sesión puede ver. tests/usuarios-datos-personales.test.ts lo controla.
export const COLUMNAS_USUARIO =
  'id, nombre, apellido, legajo, rol, estado, foto_url, auth_user_id, created_at, email, legajo_visual, es_prueba, puesto_organizacional, acceso_interfaz_admin, acceso_admin_pleno, acceso_facturacion, excluir_pago_banco, excluir_visual, acceso_bloqueado, acceso_bloqueado_motivo, acceso_bloqueado_at, acceso_bloqueado_por, acceso_auth_bloqueado_at'

/** Quita `cuenta_bancaria` de una fila (respuestas de API a quien no tiene capacidad económica). */
export function sinCuentaBancaria<T extends Record<string, unknown> | null | undefined>(fila: T): T {
  if (!fila || typeof fila !== 'object') return fila
  const { cuenta_bancaria: _omitida, ...resto } = fila as Record<string, unknown>
  return resto as T
}

type ClienteRpc = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>
}

/**
 * CBU / cuenta por usuario, sólo para Administración y Gerencia (la RPC corta
 * con 42501 a cualquier otro perfil). Devuelve un mapa id → cuenta con las
 * cuentas cargadas; las personas sin cuenta no aparecen.
 */
export async function cargarCuentasBancarias(client: ClienteRpc): Promise<{ porId: Map<string, string>; error: string | null }> {
  const { data, error } = await client.rpc('usuarios_cuentas_bancarias', {})
  if (error) return { porId: new Map(), error: error.message }
  const porId = new Map<string, string>()
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [id, cuenta] of Object.entries(data as Record<string, unknown>)) {
      if (typeof cuenta === 'string' && cuenta !== '') porId.set(id, cuenta)
    }
  }
  return { porId, error: null }
}

// ── DNI, teléfono y CUIL por RPC con permiso (F-06) ─────────────────────────

/**
 * Lo que la base entrega de una persona. Una clave AUSENTE significa "la sesión
 * no puede verlo" (no "vacío"): `cuil` sólo viene en la fila propia o para
 * Administración/Gerencia/delegación; `dni` y `telefono`, según el alcance.
 */
export type DatosPersonalesUsuario = { dni?: string | null; telefono?: string | null; cuil?: string | null }

type ClienteRpcOpcional = { rpc?: ClienteRpc['rpc'] }

const CAMPOS_PERSONALES = ['dni', 'telefono', 'cuil'] as const

const textoONulo = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/**
 * DNI/teléfono/CUIL por usuario desde `usuarios_datos_personales(p_ids)`. Con `ids`
 * nulo pide todas las personas que la sesión puede ver. La RPC devuelve un único
 * objeto, sin el tope de 1000 filas de PostgREST. Las personas que la sesión no
 * puede ver no aparecen en el mapa.
 */
export async function cargarDatosPersonales(
  client: ClienteRpcOpcional | null | undefined,
  ids?: ReadonlyArray<string | null | undefined> | null,
): Promise<{ porId: Map<string, DatosPersonalesUsuario>; error: string | null }> {
  const porId = new Map<string, DatosPersonalesUsuario>()
  const lista = ids == null ? null : Array.from(new Set(ids.filter((x): x is string => typeof x === 'string' && x !== '')))
  if (lista && lista.length === 0) return { porId, error: null }
  if (!client || typeof client.rpc !== 'function') return { porId, error: 'RPC no disponible' }
  const { data, error } = await client.rpc('usuarios_datos_personales', { p_ids: lista })
  if (error) return { porId, error: error.message }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [id, v] of Object.entries(data as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const x = v as Record<string, unknown>
      const fila: DatosPersonalesUsuario = {}
      for (const c of CAMPOS_PERSONALES) if (Object.prototype.hasOwnProperty.call(x, c)) fila[c] = textoONulo(x[c])
      porId.set(id, fila)
    }
  }
  return { porId, error: null }
}

/**
 * Agrega a cada fila los campos que vinieron en el mapa. Lo que no vino (sin
 * permiso o RPC caída) queda como estaba: no se inventa ni se borra un dato que
 * ya estaba en pantalla.
 */
export function conDatosPersonales<T extends { id: string }>(filas: T[], porId: Map<string, DatosPersonalesUsuario>): T[] {
  if (porId.size === 0) return filas
  return filas.map(f => {
    const x = porId.get(f.id)
    return x ? { ...f, ...x } : f
  })
}

/**
 * Perfil de la sesión con su propio DNI/teléfono/CUIL. Si la RPC falla, devuelve
 * el perfil sin esas claves (quien lo usa distingue "no se sabe" de "vacío").
 */
export async function conDatosPersonalesPropios<T>(client: ClienteRpcOpcional | null | undefined, perfil: T): Promise<T> {
  const id = (perfil as { id?: unknown } | null | undefined)?.id
  if (!perfil || typeof id !== 'string' || id === '') return perfil
  try {
    const { porId } = await cargarDatosPersonales(client, [id])
    const x = porId.get(id)
    return x ? ({ ...(perfil as object), ...x } as T) : perfil
  } catch {
    return perfil
  }
}
