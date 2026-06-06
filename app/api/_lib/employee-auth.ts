import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

export type UsuarioEmpleado = {
  id: string
  nombre?: string | null
  apellido?: string | null
  dni?: string | null
  email?: string | null
  rol?: string | null
  estado?: string | null
  auth_user_id?: string | null
}

type AdminClientResult =
  | { client: SupabaseClient, error?: never }
  | { client?: never, error: string }

export type EmployeeAuthResult =
  | { action: 'creado' | 'actualizado' | 'vinculado', user: UsuarioEmpleado }
  | { action: 'omitido', reason: string }
  | { action: 'error', error: string }

export function normalizeEmail(email?: string | null) {
  return email?.trim().toLowerCase() || ''
}

export function normalizeDni(dni?: string | null) {
  return dni?.replace(/\s+/g, '') || ''
}

export function nombreEmpleado(usuario: UsuarioEmpleado): string {
  return [usuario.apellido, usuario.nombre].filter(Boolean).join(', ') || usuario.id
}

export function getSupabaseAdmin(): AdminClientResult {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) return { error: 'Falta NEXT_PUBLIC_SUPABASE_URL' }
  if (!serviceRoleKey) return { error: 'Falta SUPABASE_SERVICE_ROLE_KEY' }

  return {
    client: createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }),
  }
}

export function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim()
}

export async function requireRole(
  req: NextRequest,
  supabaseAdmin: SupabaseClient,
  roles: string[],
  message = 'Sesion requerida',
) {
  const token = getBearerToken(req)
  if (!token) return NextResponse.json({ error: message }, { status: 401 })

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !authData.user) return NextResponse.json({ error: 'Sesion invalida' }, { status: 401 })

  const { data: perfil, error: perfilError } = await supabaseAdmin
    .from('usuarios')
    .select('id, rol')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (perfilError) return NextResponse.json({ error: perfilError.message }, { status: 500 })
  if (!perfil || !roles.includes(perfil.rol)) {
    return NextResponse.json({ error: `Acceso restringido a: ${roles.join(', ')}` }, { status: 403 })
  }

  return null
}

export async function findAuthUserByEmail(supabaseAdmin: SupabaseClient, email: string) {
  const emailNormalizado = normalizeEmail(email)
  const perPage = 1000

  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage })
    if (error) return { user: null, error }

    const found = data.users.find(user => normalizeEmail(user.email) === emailNormalizado)
    if (found) return { user: found, error: null }
    if (data.users.length < perPage) break
  }

  return { user: null, error: null }
}

export async function authUserDisponible(
  supabaseAdmin: SupabaseClient,
  usuario: UsuarioEmpleado,
  authUserId: string,
) {
  const { data, error } = await supabaseAdmin
    .from('usuarios')
    .select('id, nombre, apellido')
    .eq('auth_user_id', authUserId)
    .neq('id', usuario.id)
    .maybeSingle()

  if (error) return { error: error.message }
  if (data) return { error: 'El usuario Auth ya esta vinculado a otro empleado' }
  return { error: null }
}

export async function ensureEmployeeAuth(
  supabaseAdmin: SupabaseClient,
  usuario: UsuarioEmpleado,
  options: { allowAdmin?: boolean } = {},
): Promise<EmployeeAuthResult> {
  if (usuario.rol === 'admin' && !options.allowAdmin) {
    return { action: 'omitido', reason: 'omitido: admin' }
  }

  const dni = normalizeDni(usuario.dni)
  const email = normalizeEmail(usuario.email)

  if (!email) return { action: 'omitido', reason: 'omitido: falta email real' }
  if (!dni) return { action: 'omitido', reason: 'omitido: falta DNI' }
  if (dni.length < 6) return { action: 'omitido', reason: 'omitido: DNI con menos de 6 caracteres' }

  let authUserId = usuario.auth_user_id || null
  let action: 'creado' | 'actualizado' | 'vinculado' = authUserId ? 'actualizado' : 'vinculado'

  if (authUserId) {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(authUserId)

    if (error || !data.user) {
      console.error('AUTH getUserById error', { usuario_id: usuario.id, auth_user_id: authUserId, error: error?.message })
      authUserId = null
    }
  }

  if (!authUserId) {
    const { user, error } = await findAuthUserByEmail(supabaseAdmin, email)
    if (error) return { action: 'error', error: error.message }

    if (user) {
      const disponible = await authUserDisponible(supabaseAdmin, usuario, user.id)
      if (disponible.error) return { action: 'error', error: disponible.error }

      authUserId = user.id
      action = 'vinculado'
    }
  }

  if (!authUserId) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: dni,
      email_confirm: true,
      user_metadata: {
        usuario_id: usuario.id,
        nombre: usuario.nombre,
        apellido: usuario.apellido,
        rol: usuario.rol,
      },
    })

    if (error || !data.user) {
      console.error('AUTH createUser error', { usuario_id: usuario.id, email, error: error?.message })
      return { action: 'error', error: error?.message || 'No se pudo crear el usuario Auth' }
    }

    authUserId = data.user.id
    action = 'creado'
  }

  const { data: currentAuth, error: currentAuthError } = await supabaseAdmin.auth.admin.getUserById(authUserId)
  if (currentAuthError || !currentAuth.user) {
    console.error('AUTH getUserById before update error', { usuario_id: usuario.id, auth_user_id: authUserId, error: currentAuthError?.message })
    return { action: 'error', error: currentAuthError?.message || 'No se pudo cargar el usuario Auth' }
  }

  const authEmail = normalizeEmail(currentAuth.user.email)
  const payload: Record<string, unknown> = {
    password: dni,
    email_confirm: true,
    user_metadata: {
      usuario_id: usuario.id,
      nombre: usuario.nombre,
      apellido: usuario.apellido,
      rol: usuario.rol,
    },
  }

  if (authEmail !== email) payload.email = email

  const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(authUserId, payload)
  if (updateAuthError) {
    console.error('AUTH updateUserById error', { usuario_id: usuario.id, auth_user_id: authUserId, email, error: updateAuthError.message })
    return { action: 'error', error: updateAuthError.message }
  }

  const { data: actualizado, error: updateUsuarioError } = await supabaseAdmin
    .from('usuarios')
    .update({ auth_user_id: authUserId, email })
    .eq('id', usuario.id)
    .select('id, nombre, apellido, dni, email, telefono, legajo, rol, estado, foto_url, auth_user_id, created_at')
    .single()

  if (updateUsuarioError) return { action: 'error', error: updateUsuarioError.message }
  return { action, user: actualizado }
}
