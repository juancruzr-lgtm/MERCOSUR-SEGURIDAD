/**
 * DNI, teléfono y CUIL en las respuestas de las rutas con service_role.
 *
 * Las rutas leen la fila completa con la clave de servicio, pero lo que devuelven
 * al navegador sigue la misma regla que la base aplica en
 * `usuarios_datos_personales(p_ids)`: se le pregunta a la base CON LA SESIÓN de
 * quien llama (su Bearer) qué campos puede ver de cada persona, y se quitan los
 * demás. Así hay una sola regla (la de la base) y no una copia en TypeScript:
 *  · dni y teléfono: la propia fila; alcance 'todas' → todas; supervisor → las
 *    personas con turno en objetivos de sus zonas; vigilador → sólo la propia.
 *  · cuil: la propia fila o Administración/Gerencia/delegación gerencial.
 * Si la consulta falla, se quitan los tres campos (nunca se entrega de más).
 * Quitar un campo no lo borra en la pantalla: el cliente fusiona las respuestas
 * parciales sin pisar lo que ya tenía (lib/usuarios-edicion).
 */
import { clienteDelUsuario } from './cliente-usuario'

export const CAMPOS_DATOS_PERSONALES = ['dni', 'telefono', 'cuil'] as const
export type CampoDatoPersonal = (typeof CAMPOS_DATOS_PERSONALES)[number]
export type VisiblesPorId = Map<string, Set<CampoDatoPersonal>>

type ClienteRpc = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
}

/** Campos que la sesión puede ver de cada persona (según la base). Error → mapa vacío. */
export async function camposVisibles(cliente: ClienteRpc | null | undefined, ids: ReadonlyArray<string | null | undefined> | null): Promise<VisiblesPorId> {
  const out: VisiblesPorId = new Map()
  const lista = ids == null ? null : Array.from(new Set(ids.filter((x): x is string => typeof x === 'string' && x !== '')))
  if (!cliente || (lista && lista.length === 0)) return out
  try {
    const { data, error } = await cliente.rpc('usuarios_datos_personales', { p_ids: lista })
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) return out
    for (const [id, v] of Object.entries(data as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue
      const campos = new Set<CampoDatoPersonal>()
      for (const c of CAMPOS_DATOS_PERSONALES) if (Object.prototype.hasOwnProperty.call(v, c)) campos.add(c)
      out.set(id, campos)
    }
  } catch { /* sin respuesta: no se entrega ningún dato personal */ }
  return out
}

/** Con el Bearer de quien llama. Sin token o sin configuración → mapa vacío. */
export async function visiblesDeLaSesion(token: string | null | undefined, ids: ReadonlyArray<string | null | undefined> | null): Promise<VisiblesPorId> {
  const cliente = token ? clienteDelUsuario(token) : null
  return camposVisibles(cliente as ClienteRpc | null, ids)
}

/** Quita de la fila los datos personales que la sesión no puede ver. */
export function recortarDatosPersonales<T>(fila: T, visibles: VisiblesPorId): T {
  if (!fila || typeof fila !== 'object' || Array.isArray(fila)) return fila
  const id = (fila as { id?: unknown }).id
  const permitidos = typeof id === 'string' ? visibles.get(id) : undefined
  const out: Record<string, unknown> = { ...(fila as Record<string, unknown>) }
  for (const c of CAMPOS_DATOS_PERSONALES) if (c in out && !permitidos?.has(c)) delete out[c]
  return out as T
}

export function recortarListaDatosPersonales<T>(filas: T[] | null | undefined, visibles: VisiblesPorId): T[] {
  return (filas ?? []).map(f => recortarDatosPersonales(f, visibles))
}

/** Atajo para una fila o una lista: consulta la base y recorta. */
export async function recortarParaLaSesion<T>(token: string | null | undefined, filas: T[]): Promise<T[]> {
  const ids = filas.map(f => (f && typeof f === 'object' ? (f as { id?: unknown }).id : null)).filter((x): x is string => typeof x === 'string')
  if (ids.length === 0) return filas.map(f => recortarDatosPersonales(f, new Map()))
  // Muchas filas: una sola consulta con p_ids nulo (todas las visibles).
  const visibles = await visiblesDeLaSesion(token, ids.length > 200 ? null : ids)
  return recortarListaDatosPersonales(filas, visibles)
}
