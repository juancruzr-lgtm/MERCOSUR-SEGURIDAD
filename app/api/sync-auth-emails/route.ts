import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseAdmin, nombreEmpleado, normalizeEmail, requireCapacidad, type UsuarioEmpleado } from '../_lib/employee-auth'

// Copia a usuarios.email el email de Auth cuando difieren. Se dispara SÓLO desde el botón
// «Sincronizar emails Auth» de Guardias (antes corría al abrir la pantalla: F-14).
// Auth se lee en lote (listUsers paginado, ~1 pedido cada 1000 cuentas) en vez de un
// getUserById por empleado (~100 pedidos, 16 s). Lo que se sincroniza no cambia.

const POR_PAGINA = 1000
const MAX_PAGINAS = 50

/** Email de Auth por id de cuenta. null si listUsers falla (se cae al modo uno por uno). */
async function emailsAuthEnLote(client: SupabaseClient): Promise<Map<string, string | null> | null> {
  const emails = new Map<string, string | null>()
  for (let page = 1; page <= MAX_PAGINAS; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: POR_PAGINA })
    if (error) return null
    for (const u of data.users) emails.set(u.id, normalizeEmail(u.email) || null)
    if (data.users.length < POR_PAGINA) return emails
  }
  return null // más cuentas que el tope: mejor el modo uno por uno que un mapa incompleto
}

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const adminError = await requireCapacidad(req, admin.client, 'configurar_sistema', 'Sesion de administrador requerida')
  if (adminError) return adminError

  const { data: usuarios, error: usuariosError } = await admin.client
    .from('usuarios')
    .select('id, nombre, apellido, dni, email, telefono, legajo, rol, estado, foto_url, auth_user_id, created_at')
    .not('auth_user_id', 'is', null)
    .order('apellido')

  if (usuariosError) return NextResponse.json({ error: usuariosError.message }, { status: 500 })

  const actualizados: UsuarioEmpleado[] = []
  const errores: Array<{ usuario_id: string, empleado: string, error: string }> = []
  let sincronizados = 0
  let sinAuth = 0

  const enLote = await emailsAuthEnLote(admin.client)

  for (const usuario of (usuarios || []) as UsuarioEmpleado[]) {
    // Cuenta que no vino en el lote (o lote no disponible): se consulta sola, como antes,
    // para conservar el mismo error/«sin Auth».
    let authError: { message: string } | null = null
    let authEmail: string | null | undefined
    if (enLote?.has(usuario.auth_user_id!)) {
      authEmail = enLote.get(usuario.auth_user_id!)
    } else {
      const { data: authData, error } = await admin.client.auth.admin.getUserById(usuario.auth_user_id!)
      authError = error
      authEmail = normalizeEmail(authData?.user?.email)
    }

    if (authError || !authEmail) {
      sinAuth += 1
      if (authError) {
        errores.push({
          usuario_id: usuario.id,
          empleado: nombreEmpleado(usuario),
          error: authError.message,
        })
      }
      actualizados.push(usuario)
      continue
    }

    if (normalizeEmail(usuario.email) === authEmail) {
      actualizados.push(usuario)
      continue
    }

    const { data: actualizado, error: updateError } = await admin.client
      .from('usuarios')
      .update({ email: authEmail })
      .eq('id', usuario.id)
      .select('id, nombre, apellido, dni, email, telefono, legajo, rol, estado, foto_url, auth_user_id, created_at')
      .single()

    if (updateError || !actualizado) {
      errores.push({
        usuario_id: usuario.id,
        empleado: nombreEmpleado(usuario),
        error: updateError?.message || 'No se pudo actualizar usuarios.email',
      })
      actualizados.push(usuario)
    } else {
      sincronizados += 1
      actualizados.push(actualizado)
    }
  }

  return NextResponse.json({
    ok: true,
    summary: {
      sincronizados,
      sin_auth: sinAuth,
      errores: errores.length,
    },
    errores,
    users: actualizados,
    message: `Emails Auth sincronizados: ${sincronizados}. Sin Auth: ${sinAuth}. Errores: ${errores.length}.`,
  })
}
