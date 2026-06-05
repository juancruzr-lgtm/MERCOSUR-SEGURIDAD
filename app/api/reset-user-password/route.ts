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
  auth_user_id?: string | null
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

async function requireAdminOrSupervisor(req: NextRequest, supabaseAdmin: SupabaseClient) {
  const token = getBearerToken(req)
  if (!token) {
    return NextResponse.json({ error: 'Sesion de administrador o supervisor requerida' }, { status: 401 })
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Sesion invalida' }, { status: 401 })
  }

  const { data: perfil, error: perfilError } = await supabaseAdmin
    .from('usuarios')
    .select('id, rol')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (perfilError) return NextResponse.json({ error: perfilError.message }, { status: 500 })

  if (perfil?.rol !== 'admin' && perfil?.rol !== 'supervisor') {
    return NextResponse.json({ error: 'Solo admin o supervisor puede resetear accesos' }, { status: 403 })
  }

  return null
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

async function assertAuthUserDisponible(supabaseAdmin: SupabaseClient, usuario: UsuarioEmpleado, authUserId: string) {
  const { data: vinculado, error } = await supabaseAdmin
    .from('usuarios')
    .select('id, nombre, apellido')
    .eq('auth_user_id', authUserId)
    .neq('id', usuario.id)
    .maybeSingle()

  if (error) return { error: error.message }
  if (vinculado) return { error: 'El usuario Auth ya esta vinculado a otro empleado' }

  return { error: null }
}

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const roleError = await requireAdminOrSupervisor(req, admin.client)
  if (roleError) return roleError

  try {
    const body = await req.json()
    const usuarioId = body?.usuario_id

    if (!usuarioId) {
      return NextResponse.json({ error: 'usuario_id es obligatorio' }, { status: 400 })
    }

    const { data: usuario, error: usuarioError } = await admin.client
      .from('usuarios')
      .select('id, nombre, apellido, dni, email, rol, auth_user_id')
      .eq('id', usuarioId)
      .maybeSingle()

    if (usuarioError) return NextResponse.json({ error: usuarioError.message }, { status: 500 })
    if (!usuario) return NextResponse.json({ error: 'Empleado no encontrado' }, { status: 404 })

    const dni = usuario.dni?.trim()
    let email = usuario.email?.trim().toLowerCase() || null

    if (!dni) {
      return NextResponse.json({ error: 'No se puede resetear: falta DNI del empleado' }, { status: 400 })
    }

    if (dni.length < 6) {
      return NextResponse.json({ error: 'No se puede resetear: el DNI debe tener al menos 6 caracteres' }, { status: 400 })
    }

    let authUserId = usuario.auth_user_id || null
    let accion: 'actualizado' | 'vinculado' | 'creado' = authUserId ? 'actualizado' : 'vinculado'

    if (authUserId) {
      const { data: authData, error: authLookupError } = await admin.client.auth.admin.getUserById(authUserId)
      if (authLookupError || !authData.user) {
        authUserId = null
      } else if (!email && authData.user.email) {
        email = authData.user.email.trim().toLowerCase()
      }
    }

    if (!email) {
      return NextResponse.json({ error: 'No se puede resetear: falta email real del empleado' }, { status: 400 })
    }

    if (!authUserId) {
      const { user: authExistente, error: lookupError } = await findAuthUserByEmail(admin.client, email)
      if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 })

      if (authExistente) {
        const disponible = await assertAuthUserDisponible(admin.client, usuario, authExistente.id)
        if (disponible.error) return NextResponse.json({ error: disponible.error }, { status: 409 })

        authUserId = authExistente.id
        accion = 'vinculado'
      }
    }

    if (!authUserId) {
      const { data: authData, error: createError } = await admin.client.auth.admin.createUser({
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

      if (createError || !authData.user) {
        return NextResponse.json({ error: createError?.message || 'No se pudo crear el usuario Auth' }, { status: 400 })
      }

      authUserId = authData.user.id
      accion = 'creado'
    }

    const { error: updateAuthError } = await admin.client.auth.admin.updateUserById(authUserId, {
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

    if (updateAuthError) {
      return NextResponse.json({ error: updateAuthError.message }, { status: 400 })
    }

    const { data: actualizado, error: updateUsuarioError } = await admin.client
      .from('usuarios')
      .update({ auth_user_id: authUserId, email })
      .eq('id', usuario.id)
      .select()
      .single()

    if (updateUsuarioError) {
      return NextResponse.json({ error: updateUsuarioError.message }, { status: 500 })
    }

    const detalle =
      accion === 'creado'
        ? 'Acceso Auth creado y contraseña reseteada al DNI'
        : accion === 'vinculado'
          ? 'Acceso Auth vinculado y contraseña reseteada al DNI'
          : 'Contraseña reseteada al DNI'

    return NextResponse.json({
      ok: true,
      user: actualizado,
      action: accion,
      message: detalle,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error interno del servidor'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
