// Webhook de estados de WhatsApp Business Cloud API.
//
// ── Para qué existe ─────────────────────────────────────────────────────────
// La Cloud API devuelve un wamid al aceptar un mensaje, pero el destino real
// (sent / delivered / read / failed) SOLO llega por webhook. El 02/09/2026 una
// prueba controlada devolvió ok:true y nunca llegó al teléfono: la WABA no
// tenía método de pago y el failed (131042) no lo vio nadie. Este endpoint
// registra esos estados en whatsapp_mensaje_estados y NADA MÁS.
//
// ── Qué NO hace, a propósito ────────────────────────────────────────────────
// No responde mensajes, no procesa texto entrante, no toca el escalamiento ni
// ninguna tabla operativa. El número emisor tiene una automatización comercial
// (IA de CV/ventas) que recibe los mensajes de los clientes por SU propia
// suscripción: este webhook ignora `messages` por completo y sólo lee
// `statuses`. Responder acá sería pisar esa automatización.
//
// ── Seguridad ───────────────────────────────────────────────────────────────
// GET  → verificación de Meta: exige WHATSAPP_WEBHOOK_VERIFY_TOKEN exacto.
// POST → si WHATSAPP_APP_SECRET está configurado, se valida la firma
//        X-Hub-Signature-256 de Meta y un payload sin firma válida se
//        descarta. Sin la variable, se registra igual (el dato es inocuo:
//        estados de mensajes propios) pero conviene configurarla.
// Nunca se registra ni devuelve ningún secreto.

import { createHmac, timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import { extraerEstados } from '@/lib/whatsapp-estados'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Verificación de suscripción: Meta manda hub.challenge y hay que devolverlo. */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const modo = url.searchParams.get('hub.mode')
  const token = url.searchParams.get('hub.verify_token')
  const challenge = url.searchParams.get('hub.challenge')
  const esperado = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN

  if (modo === 'subscribe' && esperado && token === esperado && challenge) {
    return new Response(challenge, { status: 200 })
  }
  return NextResponse.json({ error: 'Verificación rechazada' }, { status: 403 })
}

function firmaValida(cuerpo: string, encabezado: string | null): boolean {
  const secreto = process.env.WHATSAPP_APP_SECRET
  // Sin secreto configurado no se puede validar: se acepta y queda anotado en
  // el comentario de arriba que conviene configurarlo.
  if (!secreto) return true
  if (!encabezado?.startsWith('sha256=')) return false
  const esperada = createHmac('sha256', secreto).update(cuerpo).digest('hex')
  const recibida = encabezado.slice('sha256='.length)
  if (esperada.length !== recibida.length) return false
  return timingSafeEqual(Buffer.from(esperada, 'hex'), Buffer.from(recibida, 'hex'))
}

export async function POST(req: Request) {
  // Siempre 200 salvo firma inválida: si Meta acumula errores, desuscribe el
  // webhook y se pierde el único canal de estados que existe.
  const cuerpo = await req.text()
  if (!firmaValida(cuerpo, req.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ error: 'Firma inválida' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(cuerpo)
  } catch {
    return NextResponse.json({ ok: true, estados: 0 })
  }

  const estados = extraerEstados(payload)
  if (estados.length === 0) return NextResponse.json({ ok: true, estados: 0 })

  const admin = getSupabaseAdmin()
  if (admin.error) {
    // 200 igual: reintentar no va a arreglar una variable de entorno.
    console.error('[whatsapp webhook]', admin.error)
    return NextResponse.json({ ok: false, estados: 0 })
  }

  const { error } = await admin.client.from('whatsapp_mensaje_estados').insert(estados)
  if (error) console.error('[whatsapp webhook] insert:', error.message)

  return NextResponse.json({ ok: !error, estados: estados.length })
}
