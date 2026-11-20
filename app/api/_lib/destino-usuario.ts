/**
 * Control JERÁRQUICO del usuario DESTINO en las rutas que gestionan cuentas
 * (alta/edición, email, contraseña, accesos, bajas).
 *
 * Las rutas corren con service_role, así que el control de la base que mira
 * auth.uid() no las alcanza: la regla tiene que vivir acá, en el servidor, y
 * leer al destino de la base (nunca de lo que manda el cliente).
 *
 * Jerarquía (de menor a mayor):
 *   Vigilador < Supervisor < Jefe de Supervisores < Dirección Operativa
 *   < Administración < Gerencia
 * Sin puesto, se usa el rol viejo (fallback de lib/capacidades): admin = Gerencia
 * (igual que esGerenciaReal), supervisor = Supervisor, guardia/vigilador = Vigilador.
 *
 * Reglas:
 *  1. Sólo Gerencia real opera sobre una cuenta gerencial: puesto Gerencia (o
 *     admin sin puesto), override acceso_admin_pleno o delegación gerencial vigente.
 *  2. Nadie opera sobre una cuenta de nivel superior al propio.
 *  3. Nadie cambia su propio puesto/rol ni sus permisos especiales.
 *  4. Nadie asigna un puesto/rol que quede por encima del propio; el puesto
 *     Gerencia sólo lo asigna Gerencia.
 *  5. Los permisos especiales (overrides) sólo los toca Gerencia.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { esGerenciaReal, puestoDe, type PuestoOrganizacional, type SujetoAcceso } from '@/lib/capacidades'

export const NIVEL_PUESTO: Record<PuestoOrganizacional, number> = {
  vigilador: 1,
  supervisor: 2,
  jefe_supervisores: 3,
  direccion_operativa: 4,
  administracion: 5,
  gerencia: 6,
}

/** Campos de permisos especiales: sólo Gerencia los otorga o quita. */
export const CAMPOS_OVERRIDE = [
  'acceso_admin_pleno',
  'acceso_interfaz_admin',
  'acceso_gerencia_delegado',
  'acceso_facturacion',
] as const

export type SujetoDestino = SujetoAcceso & { id?: string | null }

export type CambiosDestino = {
  rol?: string | null
  puesto_organizacional?: string | null
  /** Nombres de overrides que el pedido intenta cambiar. */
  overrides?: string[]
}

export type Decision = { ok: boolean; error?: string }

/** Nivel jerárquico; 0 = desconocido (no supera a nadie). */
export function nivelDe(u: SujetoAcceso | null | undefined): number {
  const puesto = puestoDe(u)
  if (puesto) return NIVEL_PUESTO[puesto]
  const rol = String(u?.rol ?? '').trim().toLowerCase()
  if (rol === 'admin') return NIVEL_PUESTO.gerencia
  if (rol === 'supervisor') return NIVEL_PUESTO.supervisor
  if (rol === 'guardia' || rol === 'vigilador') return NIVEL_PUESTO.vigilador
  return 0
}

/** Cuenta gerencial: Gerencia real o con permisos gerenciales sumados. */
export function esCuentaGerencial(u: SujetoAcceso | null | undefined): boolean {
  return esGerenciaReal(u) || u?.acceso_admin_pleno === true || u?.acceso_gerencia_delegado === true
}

const normal = (v: unknown) => String(v ?? '').trim().toLowerCase()

/**
 * Decide si `actor` puede operar sobre `destino` (ya leído de la base) con los
 * `cambios` pedidos. Función pura: es la que cubren los tests.
 */
export function puedeOperarSobre(actor: SujetoDestino, destino: SujetoDestino, cambios: CambiosDestino = {}): Decision {
  const actorGerencia = esGerenciaReal(actor)
  const nivelActor = nivelDe(actor)
  const mismo = Boolean(actor.id && destino.id && actor.id === destino.id)

  if (!actorGerencia && esCuentaGerencial(destino)) {
    return { ok: false, error: 'Sólo Gerencia puede operar sobre una cuenta de Gerencia o con permisos gerenciales' }
  }
  if (!mismo && nivelDe(destino) > nivelActor) {
    return { ok: false, error: 'No podés operar sobre una cuenta de un puesto superior al tuyo' }
  }

  const overrides = cambios.overrides ?? []
  if (overrides.length) {
    if (mismo) return { ok: false, error: 'No podés cambiar tus propios permisos' }
    if (!actorGerencia) return { ok: false, error: 'Sólo Gerencia otorga o quita permisos especiales' }
  }

  const tocaRol = cambios.rol !== undefined && cambios.rol !== null
  const tocaPuesto = cambios.puesto_organizacional !== undefined && cambios.puesto_organizacional !== null && cambios.puesto_organizacional !== ''
  if (tocaRol || tocaPuesto) {
    const resultado: SujetoAcceso = {
      rol: tocaRol ? cambios.rol : destino.rol,
      puesto_organizacional: tocaPuesto ? cambios.puesto_organizacional : destino.puesto_organizacional,
    }
    const cambia = normal(resultado.rol) !== normal(destino.rol)
      || normal(resultado.puesto_organizacional) !== normal(destino.puesto_organizacional)
    if (mismo && cambia) {
      return { ok: false, error: 'No podés cambiar tu propio puesto o rol; lo tiene que hacer otra persona con permiso' }
    }
    if (!actorGerencia && esGerenciaReal(resultado)) {
      return { ok: false, error: 'Sólo Gerencia puede asignar el puesto Gerencia' }
    }
    if (nivelDe(resultado) > nivelActor) {
      return { ok: false, error: 'No podés asignar un puesto superior al tuyo' }
    }
  }
  return { ok: true }
}

/** Overrides presentes en el cuerpo del pedido (aunque la ruta no los escriba). */
export function overridesPedidos(body: unknown): string[] {
  if (!body || typeof body !== 'object') return []
  return CAMPOS_OVERRIDE.filter(c => (body as Record<string, unknown>)[c] !== undefined)
}

const COLUMNAS_DESTINO = 'id, rol, estado, puesto_organizacional, acceso_admin_pleno, acceso_interfaz_admin, acceso_facturacion'

type FilaDestino = SujetoDestino & { estado?: string | null }

/** Ids con delegación gerencial vigente (activa, sin revocar, sin vencer). */
async function delegacionesVigentes(client: SupabaseClient, ids: string[]): Promise<{ ids: Set<string>; error?: string }> {
  if (!ids.length) return { ids: new Set() }
  const { data, error } = await client
    .from('gerencia_delegaciones')
    .select('usuario_id, activo, revocado_at, hasta')
    .in('usuario_id', ids)
    .eq('activo', true)
  if (error) return { ids: new Set(), error: error.message }
  const ahora = Date.now()
  const vigentes = new Set<string>()
  for (const d of (data ?? []) as Array<{ usuario_id: string; activo: boolean; revocado_at: string | null; hasta: string | null }>) {
    if (d.activo && !d.revocado_at && (!d.hasta || new Date(d.hasta).getTime() > ahora)) vigentes.add(d.usuario_id)
  }
  return { ids: vigentes }
}

/** Lee destinos de la base (service role), con la delegación gerencial resuelta. */
export async function cargarDestinos(client: SupabaseClient, ids: string[]): Promise<{ destinos: Map<string, FilaDestino>; error?: string }> {
  const unicos = Array.from(new Set(ids.filter(Boolean)))
  const destinos = new Map<string, FilaDestino>()
  // En tandas: URL acotada y lejos del tope de 1000 filas de PostgREST.
  for (let i = 0; i < unicos.length; i += 100) {
    const tanda = unicos.slice(i, i + 100)
    const { data, error } = await client.from('usuarios').select(COLUMNAS_DESTINO).in('id', tanda)
    if (error) return { destinos: new Map(), error: error.message }
    const deleg = await delegacionesVigentes(client, tanda)
    if (deleg.error) return { destinos: new Map(), error: deleg.error }
    for (const fila of (data ?? []) as FilaDestino[]) {
      destinos.set(String(fila.id), { ...fila, acceso_gerencia_delegado: deleg.ids.has(String(fila.id)) })
    }
  }
  return { destinos }
}

/**
 * Lee al destino y aplica `puedeOperarSobre`. Devuelve null si puede, o la
 * respuesta HTTP (404 / 403 / 500) para devolver tal cual.
 */
export async function verificarDestino(
  client: SupabaseClient,
  actor: SujetoDestino,
  usuarioId: string,
  cambios: CambiosDestino = {},
): Promise<NextResponse | null> {
  const { destinos, error } = await cargarDestinos(client, [usuarioId])
  if (error) return NextResponse.json({ error }, { status: 500 })
  const destino = destinos.get(String(usuarioId))
  if (!destino) return NextResponse.json({ error: 'Empleado no encontrado' }, { status: 404 })
  const decision = puedeOperarSobre(actor, destino, cambios)
  if (!decision.ok) return NextResponse.json({ error: decision.error ?? 'No autorizado' }, { status: 403 })
  return null
}

/**
 * Para operaciones en lote: ids sobre los que el actor SÍ puede operar. Fail
 * closed: si la lectura falla, devuelve error y ningún id.
 */
export async function filtrarOperables(
  client: SupabaseClient,
  actor: SujetoDestino,
  ids: string[],
): Promise<{ permitidos: Set<string>; error?: string }> {
  const { destinos, error } = await cargarDestinos(client, ids)
  if (error) return { permitidos: new Set(), error }
  const permitidos = new Set<string>()
  destinos.forEach((d, id) => { if (puedeOperarSobre(actor, d).ok) permitidos.add(id) })
  return { permitidos }
}

/** Perfil (actor) por id de Auth, para rutas que no usan resolverPerfil. */
export async function perfilPorAuth(client: SupabaseClient, authUserId: string): Promise<SujetoDestino & { estado?: string | null } | null> {
  const { data } = await client
    .from('usuarios')
    .select('id, rol, estado, puesto_organizacional')
    .eq('auth_user_id', authUserId)
    .maybeSingle()
  return (data as (SujetoDestino & { estado?: string | null }) | null) ?? null
}
