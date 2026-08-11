// app/api/ia/_lib/auth.ts
//
// Autenticación y alcance para las rutas de Referencias IA.
//
// Todas estas rutas usan service_role, que OMITE RLS. Por lo tanto el alcance
// se valida acá, explícitamente, en cada pedido. No alcanza con que la tabla
// tenga policies: las policies protegen al cliente directo, no a estas rutas.

import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getBearerToken, getSupabaseAdmin } from '../../_lib/employee-auth'

export type UsuarioIA = { id: string, rol: string, estado: string }

export type ContextoIA =
  | { ok: true, client: SupabaseClient, usuario: UsuarioIA }
  | { ok: false, respuesta: NextResponse }

async function resolverContexto(req: NextRequest, rolesPermitidos: string[]): Promise<ContextoIA> {
  const admin = getSupabaseAdmin()
  if (admin.error) {
    return { ok: false, respuesta: NextResponse.json({ error: admin.error }, { status: 500 }) }
  }

  const token = getBearerToken(req)
  if (!token) {
    return { ok: false, respuesta: NextResponse.json({ error: 'Sesión requerida' }, { status: 401 }) }
  }

  const { data: authData, error: authError } = await admin.client.auth.getUser(token)
  if (authError || !authData.user) {
    return { ok: false, respuesta: NextResponse.json({ error: 'Sesión inválida' }, { status: 401 }) }
  }

  const { data: usuario, error: usuarioError } = await admin.client
    .from('usuarios')
    .select('id, rol, estado')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (usuarioError) {
    return { ok: false, respuesta: NextResponse.json({ error: 'No se pudo resolver el usuario' }, { status: 500 }) }
  }
  if (!usuario || usuario.estado !== 'activo' || !rolesPermitidos.includes(usuario.rol ?? '')) {
    return { ok: false, respuesta: NextResponse.json({ error: 'No autorizado' }, { status: 403 }) }
  }

  return { ok: true, client: admin.client, usuario: usuario as UsuarioIA }
}

/** Sólo administración. Toda escritura de referencias pasa por acá. */
export function requireAdminIA(req: NextRequest): Promise<ContextoIA> {
  return resolverContexto(req, ['admin'])
}

/** Administración o supervisor. Lectura y firma de URLs. */
export function requireOperadorIA(req: NextRequest): Promise<ContextoIA> {
  return resolverContexto(req, ['admin', 'supervisor'])
}

/**
 * ¿Este usuario alcanza a este objetivo?
 *
 * Réplica en TypeScript de public.puede_administrar_rondas_objetivo(uuid):
 * admin ve todo; supervisor sólo objetivos de sus zonas asignadas. Se duplica
 * la lógica porque estas rutas corren con service_role y la función SQL, al
 * ejecutarse sin sesión de usuario, devolvería false para todos.
 */
export async function alcanzaObjetivo(
  client: SupabaseClient,
  usuario: UsuarioIA,
  objetivoId: string,
): Promise<boolean> {
  if (usuario.rol === 'admin') return true
  if (usuario.rol !== 'supervisor') return false

  const { data: objetivo } = await client
    .from('objetivos')
    .select('zona_id')
    .eq('id', objetivoId)
    .maybeSingle()

  if (!objetivo?.zona_id) return false

  const { data: zona } = await client
    .from('supervisor_zonas')
    .select('supervisor_id')
    .eq('zona_id', objetivo.zona_id)
    .eq('supervisor_id', usuario.id)
    .maybeSingle()

  return Boolean(zona)
}

/** Objetivo de un punto de ronda: punto → rondas_base → objetivo_id. */
export async function objetivoDePunto(
  client: SupabaseClient,
  rondaPuntoId: string,
): Promise<string | null> {
  const { data: punto } = await client
    .from('ronda_puntos')
    .select('ronda_base_id')
    .eq('id', rondaPuntoId)
    .maybeSingle()

  if (!punto?.ronda_base_id) return null

  const { data: base } = await client
    .from('rondas_base')
    .select('objetivo_id')
    .eq('id', punto.ronda_base_id)
    .maybeSingle()

  return base?.objetivo_id ?? null
}
