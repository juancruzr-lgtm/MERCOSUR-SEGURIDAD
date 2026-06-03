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
    return NextResponse.json({ error: 'Solo un administrador puede sincronizar emails Auth' }, { status: 403 })
  }

  return null
}

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const adminError = await requireAdmin(req, admin.client)
  if (adminError) return adminError

  const { data: usuarios, error: usuariosError } = await admin.client
    .from('usuarios')
    .select('*')
    .not('auth_user_id', 'is', null)

  if (usuariosError) return NextResponse.json({ error: usuariosError.message }, { status: 500 })

  const actualizados = []

  for (const usuario of usuarios || []) {
    const { data: authData, error: authError } = await admin.client.auth.admin.getUserById(usuario.auth_user_id)
    const authEmail = authData?.user?.email?.trim().toLowerCase()

    if (authError || !authEmail) {
      actualizados.push(usuario)
      continue
    }

    if ((usuario.email || '').trim().toLowerCase() === authEmail) {
      actualizados.push(usuario)
      continue
    }

    const { data: actualizado, error: updateError } = await admin.client
      .from('usuarios')
      .update({ email: authEmail })
      .eq('id', usuario.id)
      .select()
      .single()

    actualizados.push(updateError || !actualizado ? usuario : actualizado)
  }

  return NextResponse.json({
    ok: true,
    users: actualizados,
    message: 'Emails Auth sincronizados correctamente',
  })
}
