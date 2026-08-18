/**
 * Resuelve el perfil operativo del usuario logueado a partir del bearer token,
 * igual que hace /api/push/subscribe. Compartido por subscribe, estado y
 * prueba para que las tres rutas autentiquen exactamente igual.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, getSupabaseAdmin } from '../_lib/employee-auth'

export type PerfilPush = { id: string; rol: string; estado: string }

export async function perfilDesdeRequest(req: NextRequest): Promise<
  | { ok: true; client: any; perfil: PerfilPush }
  | { ok: false; response: NextResponse }
> {
  const admin = getSupabaseAdmin()
  if (admin.error) return { ok: false, response: NextResponse.json({ error: admin.error }, { status: 500 }) }

  const token = getBearerToken(req)
  if (!token) return { ok: false, response: NextResponse.json({ error: 'Sesión requerida.' }, { status: 401 }) }

  const { data: authData, error: authError } = await admin.client.auth.getUser(token)
  if (authError || !authData.user) {
    return { ok: false, response: NextResponse.json({ error: authError?.message || 'Sesión inválida.' }, { status: 401 }) }
  }

  const { data: perfil, error: perfilError } = await admin.client
    .from('usuarios')
    .select('id, rol, estado')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (perfilError) return { ok: false, response: NextResponse.json({ error: perfilError.message }, { status: 500 }) }
  if (!perfil) return { ok: false, response: NextResponse.json({ error: 'Usuario sin perfil operativo.' }, { status: 404 }) }
  if (perfil.estado !== 'activo') return { ok: false, response: NextResponse.json({ error: 'Usuario inactivo.' }, { status: 403 }) }

  return { ok: true, client: admin.client, perfil: perfil as PerfilPush }
}
