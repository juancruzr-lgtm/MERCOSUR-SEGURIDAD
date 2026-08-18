/**
 * GET /api/push/estado — lo que el SERVIDOR sabe del usuario logueado para
 * el diagnóstico de dispositivo: qué endpoints tiene guardados (activos e
 * inactivos, sin exponer claves) y cuándo se le mandó algo por última vez.
 *
 * Lo que sabe el NAVEGADOR (permiso, Service Worker, suscripción actual) lo
 * junta el cliente; la evaluación combinada vive en lib/push-estado.
 */
import { NextRequest, NextResponse } from 'next/server'
import { perfilDesdeRequest } from '../_usuario'

export const runtime = 'nodejs'
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await perfilDesdeRequest(req)
  if (auth.ok === false) return auth.response
  const { client, perfil } = auth

  const [subsRes, ultimoRes] = await Promise.all([
    client
      .from('push_subscriptions')
      .select('endpoint, activo, updated_at, created_at')
      .eq('usuario_id', perfil.id)
      .order('updated_at', { ascending: false }),
    client
      .from('notificaciones_enviadas')
      .select('created_at, tipo, titulo')
      .eq('usuario_id', perfil.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (subsRes.error) return NextResponse.json({ error: subsRes.error.message }, { status: 500 })

  const suscripciones = (subsRes.data || []) as Array<{ endpoint: string; activo: boolean; updated_at: string; created_at: string }>

  return NextResponse.json({
    // El endpoint completo es necesario para que el cliente lo compare con
    // el suyo. No es un secreto (sin p256dh/auth no sirve para nada), pero no
    // se devuelven las claves.
    suscripciones: suscripciones.map(s => ({
      endpoint: s.endpoint,
      activo: s.activo,
      updated_at: s.updated_at,
      created_at: s.created_at,
    })),
    ultimo_envio: ultimoRes.data
      ? { created_at: ultimoRes.data.created_at, tipo: ultimoRes.data.tipo, titulo: ultimoRes.data.titulo }
      : null,
  })
}
