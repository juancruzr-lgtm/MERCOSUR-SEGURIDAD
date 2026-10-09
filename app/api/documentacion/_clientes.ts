/**
 * Clientes de Supabase para las rutas de documentación del legajo.
 *
 * Sin caché de fetch de Next 14: con la caché, una lectura podía devolver
 * datos viejos (ya pasó con la deduplicación de push).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'
import { getBearerToken } from '@/app/api/_lib/employee-auth'

const sinCache: typeof fetch = (url, init) => fetch(url, { ...init, cache: 'no-store' })

export const SIN_CACHE = { 'Cache-Control': 'private, no-store, max-age=0' }

export interface Clientes {
  /** Con la identidad de quien llama: RLS y auth.uid() son los suyos. */
  usuario: SupabaseClient
  /** service_role: sólo para Storage y las RPC reservadas al servidor. */
  admin: SupabaseClient
  authUserId: string
}

export async function clientesDelPedido(req: NextRequest): Promise<Clientes | { status: number; error: string }> {
  const token = getBearerToken(req)
  if (!token) return { status: 401, error: 'Sesión requerida' }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const servicio = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anon || !servicio) return { status: 500, error: 'Configuración incompleta' }

  const opciones = { auth: { persistSession: false, autoRefreshToken: false } }
  const usuario = createClient(url, anon, {
    ...opciones,
    global: { fetch: sinCache, headers: { Authorization: `Bearer ${token}` } },
  })
  const { data, error } = await usuario.auth.getUser(token)
  if (error || !data?.user) return { status: 401, error: 'Sesión inválida' }
  const admin = createClient(url, servicio, { ...opciones, global: { fetch: sinCache } })
  return { usuario, admin, authUserId: data.user.id }
}
