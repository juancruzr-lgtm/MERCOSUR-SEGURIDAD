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
      auth: { autoRefreshToken: false, persistSession: false },
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

  const { data: perfil } = await supabaseAdmin
    .from('usuarios')
    .select('id, rol')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (perfil?.rol !== 'admin') {
    return NextResponse.json({ error: 'Solo un administrador puede gestionar emails Auth' }, { status: 403 })
  }

  return null
}

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const adminError = await requireAdmin(req, admin.client)
  if (adminError) return adminError

  try {
    const body = await req.json()
    const usuarioId = body?.usuario_id
    const email = body?.email?.trim().toLowerCase()

    if (!usuarioId) return NextResponse.json({ error: 'usuario_id es obligatorio' }, { status: 400 })
    if (!email) return NextResponse.json({ error: 'email es obligatorio' }, { status: 400 })

    const { data: usuario, error: usuarioError } = await admin.client
      .from('usuarios')
      .select('id, auth_user_id')
      .eq('id', usuarioId)
      .maybeSingle()

    if (usuarioError) return NextResponse.json({ error: usuarioError.message }, { status: 500 })
    if (!usuario) return NextResponse.json({ error: 'Empleado no encontrado' }, { status: 404 })

    if (usuario.auth_user_id) {
      const { error: authError } = await admin.client.auth.admin.updateUserById(usuario.auth_user_id, { email })
      if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })
    }

    const { data: actualizado, error: updateError } = await admin.client
      .from('usuarios')
      .update({ email })
      .eq('id', usuarioId)
      .select()
      .single()

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

    return NextResponse.json({ ok: true, user: actualizado, message: 'Email sincronizado correctamente' })
  } catch {
    return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
  }
}
