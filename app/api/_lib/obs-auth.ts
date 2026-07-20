import { NextRequest } from 'next/server'
import { getBearerToken, getSupabaseAdmin } from './employee-auth'

export interface ObsAuthOk {
  client: ReturnType<typeof getSupabaseAdmin>['client']
  userId: string
}

export interface ObsAuthErr {
  error: string
  status: number
}

export type ObsAuthResult = ObsAuthOk | ObsAuthErr

export function isObsAuthErr(r: ObsAuthResult): r is ObsAuthErr {
  return 'error' in r
}

/**
 * Verifica Bearer token y rol admin.
 * Compartido por todas las rutas de /api/obs/*.
 */
export async function requireAdmin(req: NextRequest): Promise<ObsAuthResult> {
  const admin = getSupabaseAdmin()
  if (admin.error) return { error: String(admin.error), status: 500 }

  const token = getBearerToken(req)
  if (!token) return { error: 'Sesion requerida', status: 401 }

  const { data: authData, error: authError } = await admin.client.auth.getUser(token)
  if (authError || !authData.user) return { error: 'Sesion invalida', status: 401 }

  const { data: usuario } = await admin.client
    .from('usuarios')
    .select('id, rol')
    .eq('auth_user_id', authData.user.id)
    .eq('rol', 'admin')
    .single()

  if (!usuario) return { error: 'No autorizado', status: 403 }
  return { client: admin.client, userId: usuario.id }
}
