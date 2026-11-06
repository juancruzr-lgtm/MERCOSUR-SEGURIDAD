/**
 * Cliente Supabase que actúa CON LA SESIÓN DEL USUARIO (su Bearer), no con la
 * clave de servicio: auth.uid() es quien llama y la base aplica sus permisos.
 * Las rutas lo usan para pedir la autorización a la base antes de tocar
 * Storage/Auth con la clave de servicio.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { fetchSinCache } from './employee-auth'

export function clienteDelUsuario(token: string): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  return createClient(url, anon, {
    global: { fetch: fetchSinCache, headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
