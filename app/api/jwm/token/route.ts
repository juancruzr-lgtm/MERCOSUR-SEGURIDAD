// POST /api/jwm/token  — admin guarda un nuevo token JWM manualmente.
// GET  /api/jwm/token  — admin consulta estado del token (sin exponer el valor).

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin, requireRole } from '../../_lib/employee-auth'

export async function GET(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if ('error' in admin) return NextResponse.json({ error: admin.error }, { status: 500 })

  const authError = await requireRole(req, admin.client, ['admin'])
  if (authError) return authError

  const { data } = await admin.client
    .from('jwm_tokens')
    .select('expires_at, obtenido_por, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return NextResponse.json({ token_activo: false })

  const expired = new Date(data.expires_at) <= new Date()
  return NextResponse.json({
    token_activo: !expired,
    expires_at: data.expires_at,
    obtenido_por: data.obtenido_por,
    updated_at: data.created_at,
  })
}

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if ('error' in admin) return NextResponse.json({ error: admin.error }, { status: 500 })

  const authError = await requireRole(req, admin.client, ['admin'])
  if (authError) return authError

  const body = await req.json().catch(() => ({}))
  const token: string = body?.token

  if (!token || typeof token !== 'string' || !token.startsWith('eyJ')) {
    return NextResponse.json({ error: 'Token inválido. Debe ser un JWT (empieza con eyJ).' }, { status: 400 })
  }

  // Decodificar exp del JWT (sin verificar firma — solo para mostrar cuándo vence)
  let expiresAt: string
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
    expiresAt = new Date(payload.exp * 1000).toISOString()
  } catch {
    // Si no se puede decodificar, asumir 24h
    expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  }

  const { error } = await admin.client.from('jwm_tokens').insert({
    token_value: token,
    expires_at: expiresAt,
    obtenido_por: 'manual',
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, expires_at: expiresAt })
}
