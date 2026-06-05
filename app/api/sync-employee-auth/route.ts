import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

type AdminClientResult =
  | { client: SupabaseClient, error?: never }
  | { client?: never, error: string }

type UsuarioEmpleado = {
  id: string
  nombre?: string | null
  apellido?: string | null
  dni?: string | null
  email?: string | null
  rol?: string | null
  estado?: string | null
  auth_user_id?: string | null
}

type SyncResumen = {
  creados: number
  actualizados: number
  vinculados: number
  omitidos: number
  errores: Array<{ usuario_id: string, empleado: string, error: string }>
}

function getSupabaseAdmin(): AdminClientResult {
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

function getBearerToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim()
}

async function requireAdmin(req: NextRequest, supabaseAdmin: SupabaseClient) {
  const token = getBearerToken(req)
  if (!token) return NextResponse.json({ error: 'Sesion de administrador requerida' }, { status: 401 })

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !authData.user) return NextResponse.json({ error: 'Sesion invalida' }, { status: 401 })

  const { data: perfil, error: perfilError } = await supabaseAdmin
    .from('usuarios')
    .select('id, rol')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (perfilError) return NextResponse.json({ error: perfilError.message }, { status: 500 })

  if (perfil?.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo un administrador puede sincronizar accesos empleados' }, { status: 403 })
  }

  return null
}

function nombreEmpleado(usuario: UsuarioEmpleado): string {
  return [usuario.apellido, usuario.nombre].filter(Boolean).join(', ') || usuario.id
}

function validarDni(usuario: UsuarioEmpleado): { dni: string } | { error: string } {
  const dni = usuario.dni?.trim()

  if (!dni) return { error: 'omitido: falta DNI' }
  if (dni.length < 6) return { error: 'omitido: DNI con menos de 6 caracteres' }

  return { dni }
}

async function findAuthUserByEmail(supabaseAdmin: SupabaseClient, email: string) {
  const emailNormalizado = email.trim().toLowerCase()
  const perPage = 1000

  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage })
    if (error) return { user: null, error }

    const found = data.users.find(user => user.email?.toLowerCase() === emailNormalizado)
    if (found) return { user: found, error: null }
    if (data.users.length < perPage) break
  }

  return { user: null, error: null }
}

async function authUserVinculadoAOtro(supabaseAdmin: SupabaseClient, usuario: UsuarioEmpleado, authUserId: string) {
  const { data, error } = await supabaseAdmin
    .from('usuarios')
    .select('id, nombre, apellido')
    .eq('auth_user_id', authUserId)
    .neq('id', usuario.id)
    .maybeSingle()

  if (error) return { error: error.message, ocupado: false }
  if (data) return { error: 'Auth ya vinculado a otro empleado', ocupado: true }

  return { error: null, ocupado: false }
}

async function sincronizarEmpleado(supabaseAdmin: SupabaseClient, usuario: UsuarioEmpleado) {
  const validacion = validarDni(usuario)
  if ('error' in validacion) return { action: 'omitido' as const, error: validacion.error }

  const { dni } = validacion
  let email = usuario.email?.trim().toLowerCase() || null
  let authUserId = usuario.auth_user_id || null
  let action: 'creado' | 'actualizado' | 'vinculado' = authUserId ? 'actualizado' : 'vinculado'

  if (authUserId) {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(authUserId)
    if (error || !data.user) {
      authUserId = null
    } else if (!email && data.user.email) {
      email = data.user.email.trim().toLowerCase()
    }
  }

  if (!email) return { action: 'omitido' as const, error: 'omitido: falta email real' }

  if (!authUserId) {
    const { user, error } = await findAuthUserByEmail(supabaseAdmin, email)
    if (error) return { action: 'error' as const, error: error.message }

    if (user) {
      const ocupado = await authUserVinculadoAOtro(supabaseAdmin, usuario, user.id)
      if (ocupado.error) return { action: 'error' as const, error: ocupado.error }

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

    if (error || !data.user) return { action: 'error' as const, error: error?.message || 'No se pudo crear Auth' }

    authUserId = data.user.id
    action = 'creado'
  }

  const { error: updateAuthError } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
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

  if (updateAuthError) return { action: 'error' as const, error: updateAuthError.message }

  const { data: actualizado, error: updateUsuarioError } = await supabaseAdmin
    .from('usuarios')
    .update({ auth_user_id: authUserId, email })
    .eq('id', usuario.id)
    .select()
    .single()

  if (updateUsuarioError) return { action: 'error' as const, error: updateUsuarioError.message }

  return { action, user: actualizado }
}

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const adminError = await requireAdmin(req, admin.client)
  if (adminError) return adminError

  const { data: usuarios, error: usuariosError } = await admin.client
    .from('usuarios')
    .select('id, nombre, apellido, dni, email, rol, estado, auth_user_id')
    .in('rol', ['admin', 'supervisor', 'guardia', 'vigilador'])
    .order('apellido')

  if (usuariosError) return NextResponse.json({ error: usuariosError.message }, { status: 500 })

  const resumen: SyncResumen = {
    creados: 0,
    actualizados: 0,
    vinculados: 0,
    omitidos: 0,
    errores: [],
  }
  const users = []

  for (const usuario of (usuarios || []) as UsuarioEmpleado[]) {
    const resultado = await sincronizarEmpleado(admin.client, usuario)

    if (resultado.action === 'creado') resumen.creados += 1
    if (resultado.action === 'actualizado') resumen.actualizados += 1
    if (resultado.action === 'vinculado') resumen.vinculados += 1
    if (resultado.action === 'omitido') resumen.omitidos += 1

    if (resultado.action === 'error') {
      resumen.errores.push({
        usuario_id: usuario.id,
        empleado: nombreEmpleado(usuario),
        error: resultado.error,
      })
    }

    if ('user' in resultado && resultado.user) users.push(resultado.user)
    else users.push(usuario)
  }

  const message = `Accesos sincronizados: ${resumen.creados} creados, ${resumen.actualizados} actualizados, ${resumen.vinculados} vinculados, ${resumen.omitidos} omitidos, ${resumen.errores.length} errores.`

  return NextResponse.json({
    ok: true,
    summary: resumen,
    users,
    message,
  })
}
