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
export const COLUMNAS_USUARIO =
  'id, nombre, apellido, dni, telefono, legajo, rol, estado, foto_url, auth_user_id, created_at, email, cuil, legajo_visual, es_prueba, puesto_organizacional, acceso_interfaz_admin, acceso_admin_pleno, excluir_pago_banco, acceso_bloqueado, acceso_bloqueado_motivo, acceso_bloqueado_at, acceso_bloqueado_por, acceso_auth_bloqueado_at'

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
