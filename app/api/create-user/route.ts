import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

type AdminClientResult =
  | { client: SupabaseClient, error?: never }
  | { client?: never, error: string }

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
  if (!token) {
    return NextResponse.json({ error: 'Sesión de administrador requerida' }, { status: 401 })
  }

  const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token)
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })
  }

  const { data: perfil, error: perfilError } = await supabaseAdmin
    .from('usuarios')
    .select('id, rol')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (perfilError || perfil?.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo un administrador puede gestionar usuarios Auth' }, { status: 403 })
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

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const adminError = await requireAdmin(req, admin.client)
  if (adminError) return adminError

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

    if (usuarioError) {
      return NextResponse.json({ error: usuarioError.message }, { status: 500 })
    }

    if (!usuario) {
      return NextResponse.json({ error: 'Empleado no encontrado' }, { status: 404 })
    }

    if (usuario.auth_user_id) {
      return NextResponse.json({ ok: true, user: usuario, message: 'El empleado ya tiene usuario Auth vinculado' })
    }

    const dni = usuario.dni?.trim()
    const email = usuario.email?.trim().toLowerCase()

    if (!dni) {
      return NextResponse.json({ error: 'No se puede crear Auth: falta DNI del empleado' }, { status: 400 })
    }

    if (dni.length < 6) {
      return NextResponse.json({ error: 'No se puede crear Auth: el DNI debe tener al menos 6 caracteres' }, { status: 400 })
    }

    if (!email) {
      return NextResponse.json({ error: 'No se puede crear Auth: falta email del empleado' }, { status: 400 })
    }

    const { user: authExistente, error: lookupError } = await findAuthUserByEmail(admin.client, email)
    if (lookupError) {
      return NextResponse.json({ error: lookupError.message }, { status: 500 })
    }

    if (authExistente) {
      const { data: vinculado } = await admin.client
        .from('usuarios')
        .select('id, nombre, apellido')
        .eq('auth_user_id', authExistente.id)
        .neq('id', usuario.id)
        .maybeSingle()

      if (vinculado) {
        return NextResponse.json(
          { error: 'El email ya existe en Auth y está vinculado a otro empleado' },
          { status: 409 }
        )
      }

      const { data: actualizado, error: updateError } = await admin.client
        .from('usuarios')
        .update({ auth_user_id: authExistente.id, email })
        .eq('id', usuario.id)
        .select()
        .single()

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 })
      }

      return NextResponse.json({
        ok: true,
        user: actualizado,
        message: 'El email ya existía en Auth; empleado vinculado correctamente',
      })
    }

    const { data: authData, error: authError } = await admin.client.auth.admin.createUser({
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

    if (authError || !authData.user) {
      return NextResponse.json({ error: authError?.message || 'No se pudo crear el usuario Auth' }, { status: 400 })
    }

    const { data: actualizado, error: updateError } = await admin.client
      .from('usuarios')
      .update({ auth_user_id: authData.user.id, email })
      .eq('id', usuario.id)
      .select()
      .single()

    if (updateError) {
      await admin.client.auth.admin.deleteUser(authData.user.id)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({
      ok: true,
      user: actualizado,
      message: 'Usuario Auth creado correctamente',
    })
  } catch {
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
