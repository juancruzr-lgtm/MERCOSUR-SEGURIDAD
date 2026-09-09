// Carga/confirmación del propio teléfono del vigilador.
//
// El vigilador NO puede actualizar usuarios.telefono por RLS (sólo admin /
// gestión). Este endpoint permite que actualice ÚNICAMENTE su propio teléfono:
// valida la sesión, resuelve su usuario por auth_user_id y guarda el número ya
// normalizado. Nada más se toca. No inventa ni importa números.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import { normalizarTelefonoAr, mostrarTelefono } from '@/lib/telefono-ar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })
  const client = admin.client

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!token) return NextResponse.json({ error: 'Sesión requerida' }, { status: 401 })

  const { data: authData, error: authError } = await client.auth.getUser(token)
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })
  }

  let body: any = {}
  try { body = await req.json() } catch { body = {} }
  const tel = normalizarTelefonoAr(body?.telefono)
  if (!tel.e164) {
    return NextResponse.json(
      { error: 'Número inválido', motivo: tel.motivo },
      { status: 400 },
    )
  }

  // El usuario propio, por su vínculo de auth. Sólo se actualiza esa fila.
  const { data: usuario, error: uErr } = await client.from('usuarios')
    .select('id, estado').eq('auth_user_id', authData.user.id).maybeSingle()
  if (uErr || !usuario) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 })

  const { error: updErr } = await client.from('usuarios')
    .update({ telefono: tel.e164 }).eq('id', usuario.id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, telefono: tel.e164, telefonoLegible: mostrarTelefono(tel.e164) })
}
