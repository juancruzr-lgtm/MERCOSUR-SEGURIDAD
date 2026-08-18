/**
 * POST /api/push/prueba — manda una Web Push REAL de prueba al dispositivo
 * actual del usuario logueado.
 *
 * Es el mismo circuito que las alertas operativas: misma clave VAPID, mismo
 * cifrado, mismo Service Worker que muestra la notificación con la app
 * cerrada (sendWebPush). No es un toast ni una simulación: si esto llega al
 * sistema operativo del teléfono, las alertas también van a llegar.
 *
 * Body: { endpoint } — la suscripción actual del navegador. Sólo se envía a
 * esa fila (tiene que pertenecer al usuario y estar activa): la prueba es de
 * ESTE dispositivo, no de "algún dispositivo del usuario".
 *
 * Se registra en notificaciones_enviadas con tipo `prueba_dispositivo:<ts>`
 * para poder auditarla, sin chocar con la deduplicación de alertas reales.
 * Un 404/410 del servicio push da de baja la fila, igual que en el cron.
 */
import { NextRequest, NextResponse } from 'next/server'
import { perfilDesdeRequest } from '../_usuario'
import { sendWebPush, type PushSubscriptionRow } from '../../_lib/web-push'
import { tipoPruebaDispositivo } from '@/lib/push-estado'

export const runtime = 'nodejs'
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await perfilDesdeRequest(req)
  if (auth.ok === false) return auth.response
  const { client, perfil } = auth

  const body = await req.json().catch(() => null)
  const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : null
  if (!endpoint) {
    return NextResponse.json({ ok: false, resultado: 'sin_dispositivo', error: 'Falta el endpoint de la suscripción actual del navegador.' }, { status: 400 })
  }

  const { data: sub, error } = await client
    .from('push_subscriptions')
    .select('id, usuario_id, endpoint, p256dh, auth, activo')
    .eq('usuario_id', perfil.id)
    .eq('endpoint', endpoint)
    .maybeSingle()

  if (error) return NextResponse.json({ ok: false, resultado: 'error', error: error.message }, { status: 500 })
  if (!sub) {
    return NextResponse.json({ ok: false, resultado: 'sin_dispositivo', error: 'Este dispositivo no está registrado para el usuario. Tocá "Activar notificaciones" primero.' }, { status: 404 })
  }
  if (!sub.activo) {
    return NextResponse.json({ ok: false, resultado: 'suscripcion_invalida', error: 'La suscripción de este dispositivo fue dada de baja por el servicio push. Volvé a activar las notificaciones.' }, { status: 409 })
  }

  const ahora = new Date()
  const payload = {
    title: 'Prueba de notificaciones · MERCOSUR',
    body: `Este dispositivo recibe alertas correctamente (${ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })}). Podés cerrar la app: las alertas van a llegar igual.`,
    url: '/dashboard',
    tag: 'prueba-dispositivo',
  }

  try {
    const response = await sendWebPush(sub as PushSubscriptionRow, payload)

    if (response.status === 404 || response.status === 410) {
      await client.from('push_subscriptions').update({ activo: false }).eq('id', sub.id)
      return NextResponse.json({
        ok: false,
        resultado: 'suscripcion_invalida',
        status: response.status,
        error: 'El servicio push rechazó la suscripción (ya no existe en el teléfono). Se dio de baja; volvé a activar las notificaciones.',
      }, { status: 410 })
    }

    await client.from('notificaciones_enviadas').insert({
      usuario_id: perfil.id,
      turno_id: null,
      objetivo_id: null,
      tipo: tipoPruebaDispositivo(ahora),
      titulo: payload.title,
      mensaje: payload.body,
    })

    return NextResponse.json({ ok: true, resultado: 'enviado', status: response.status, enviado_en: ahora.toISOString() })
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, resultado: 'envio_rechazado', error: mensaje }, { status: 502 })
  }
}
