import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, getSupabaseAdmin } from '../../_lib/employee-auth'

export const runtime = 'nodejs'

type BrowserPushSubscription = {
  endpoint?: string
  keys?: {
    p256dh?: string
    auth?: string
  }
}

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: `Error API subscribe: ${admin.error}` }, { status: 500 })

  const token = getBearerToken(req)
  if (!token) return NextResponse.json({ error: 'Sesión requerida para guardar la suscripción push.' }, { status: 401 })

  const { data: authData, error: authError } = await admin.client.auth.getUser(token)
  if (authError || !authData.user) {
    return NextResponse.json({ error: authError?.message || 'Sesión inválida para guardar la suscripción push.' }, { status: 401 })
  }

  const { data: perfil, error: perfilError } = await admin.client
    .from('usuarios')
    .select('id, rol, estado')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (perfilError) return NextResponse.json({ error: perfilError.message }, { status: 500 })
  if (!perfil) return NextResponse.json({ error: 'Usuario sin perfil operativo asociado al login actual.' }, { status: 404 })
  if (perfil.estado !== 'activo') return NextResponse.json({ error: 'Usuario inactivo: no puede registrar notificaciones.' }, { status: 403 })

  const body = await req.json().catch(() => null)
  if (!body) {
    return NextResponse.json({ error: 'Body JSON inválido para registrar la suscripción push.' }, { status: 400 })
  }

  const subscription = body?.subscription as BrowserPushSubscription | undefined
  const endpoint = subscription?.endpoint
  const p256dh = subscription?.keys?.p256dh
  const auth = subscription?.keys?.auth

  if (!endpoint) return NextResponse.json({ error: 'Suscripción push inválida: falta endpoint.' }, { status: 400 })
  if (!p256dh) return NextResponse.json({ error: 'Suscripción push inválida: falta clave p256dh.' }, { status: 400 })
  if (!auth) return NextResponse.json({ error: 'Suscripción push inválida: falta clave auth.' }, { status: 400 })

  const { error } = await admin.client
    .from('push_subscriptions')
    .upsert({
      usuario_id: perfil.id,
      endpoint,
      p256dh,
      auth,
      user_agent: req.headers.get('user-agent'),
      activo: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'endpoint' })

  if (error) return NextResponse.json({ error: `No se pudo guardar en push_subscriptions: ${error.message}` }, { status: 500 })

  return NextResponse.json({ ok: true, message: 'Notificaciones activadas.' })
}
