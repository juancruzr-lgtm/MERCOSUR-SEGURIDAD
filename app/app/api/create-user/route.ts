import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
)

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { nombre, apellido, email, password, rol, dni, legajo } = body

    if (!nombre?.trim()) return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 })
    if (!apellido?.trim()) return NextResponse.json({ error: 'El apellido es obligatorio' }, { status: 400 })
    if (!email?.trim()) return NextResponse.json({ error: 'El email es obligatorio' }, { status: 400 })
    if (!password || password.length < 6) return NextResponse.json({ error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 })
    if (!rol) return NextResponse.json({ error: 'El rol es obligatorio' }, { status: 400 })

    const emailNormalizado = email.trim().toLowerCase()

    const { data: existente } = await supabaseAdmin
      .from('usuarios')
      .select('id')
      .eq('email', emailNormalizado)
      .maybeSingle()

    if (existente) {
      return NextResponse.json(
        { error: 'Ya existe un empleado con ese email' },
        { status: 409 }
      )
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: emailNormalizado,
      password,
      email_confirm: true,
      user_metadata: {
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        rol,
      },
    })

    if (authError) {
      return NextResponse.json(
        { error: authError.message },
        { status: 400 }
      )
    }

    const authUserId = authData.user.id

    const { data: usuarioData, error: usuarioError } = await supabaseAdmin
      .from('usuarios')
      .insert({
        nombre: nombre.trim().toUpperCase(),
        apellido: apellido.trim().toUpperCase(),
        email: emailNormalizado,
        rol,
        estado: 'activo',
        auth_user_id: authUserId,
        dni: dni?.trim() || null,
        legajo: legajo?.trim() || null,
      })
      .select()
      .single()

    if (usuarioError) {
      await supabaseAdmin.auth.admin.deleteUser(authUserId)

      return NextResponse.json(
        { error: 'Error al crear perfil: ' + usuarioError.message },
        { status: 500 }
      )
    }

    return NextResponse.json({
      ok: true,
      user: usuarioData,
    })
  } catch (e) {
    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    )
  }
}
