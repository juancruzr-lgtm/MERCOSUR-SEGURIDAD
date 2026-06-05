import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    return NextResponse.json({ error: 'Falta NEXT_PUBLIC_SUPABASE_URL' }, { status: 500 })
  }

  if (!serviceRoleKey) {
    return NextResponse.json({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })

  const emailsExcluidos = new Set([
    'admin@mercosur.com',
    'juancruz@mercosur.com',
    'info@mercosurseguridad.com.ar',
  ])

  const { data: usuarios, error } = await supabase
    .from('usuarios')
    .select('id, apellido, nombre, email, dni, rol, auth_user_id')
    .not('auth_user_id', 'is', null)
    .not('dni', 'is', null)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const resultados = []
  let actualizados = 0
  let saltados = 0
  let errores = 0

  for (const u of usuarios ?? []) {
    const email = String(u.email || '').trim().toLowerCase()
    const dni = String(u.dni || '').trim()
    const nombre = `${u.apellido ?? ''} ${u.nombre ?? ''}`.trim()

    if (emailsExcluidos.has(email)) {
      saltados++
      resultados.push({
        usuario: nombre,
        email,
        ok: true,
        saltado: true,
        motivo: 'Email excluido manualmente',
      })
      continue
    }

    if (!dni || dni.length < 6) {
      errores++
      resultados.push({
        usuario: nombre,
        email,
        ok: false,
        error: 'DNI inválido',
      })
      continue
    }

    const { error: updateError } = await supabase.auth.admin.updateUserById(
      u.auth_user_id,
      {
        password: dni,
      }
    )

    if (updateError) {
      errores++
      resultados.push({
        usuario: nombre,
        email,
        ok: false,
        error: updateError.message,
      })
      continue
    }

    actualizados++
    resultados.push({
      usuario: nombre,
      email,
      ok: true,
      password: 'DNI',
    })
  }

  return NextResponse.json({
    ok: errores === 0,
    totalEncontrados: usuarios?.length ?? 0,
    actualizados,
    saltados,
    errores,
    resultados,
  })
}
