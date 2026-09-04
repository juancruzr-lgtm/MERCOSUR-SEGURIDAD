// Suscribe la WABA productiva a esta app para que los webhooks de estado
// (sent / delivered / read / failed) empiecen a llegar de verdad.
//
// ── Por qué existe ──────────────────────────────────────────────────────────
// Configurar el callback y los campos del webhook a nivel de la app NO alcanza:
// además hay que suscribir la CUENTA de WhatsApp Business concreta a la app
// (POST /{WABA}/subscribed_apps). Sin ese enganche, Meta acepta y entrega los
// mensajes pero no manda ningún webhook, y whatsapp_mensaje_estados queda vacío.
//
// Es una utilidad de administración de un solo uso, disparada con el secreto
// de servidor. El token sale de process.env y NUNCA se devuelve ni se registra.
// No cambia número, plantillas, pago ni permisos; sólo engancha la WABA al
// webhook. No toca la automatización comercial/CV (esa tiene su propia app).

import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WABA_ID = process.env.WHATSAPP_WABA_ID || '1356900682561109'

function autorizado(req: Request): boolean {
  const secreto = process.env.push_cron_secret || process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  return Boolean(secreto) && auth === `Bearer ${secreto}`
}

export async function POST(req: Request) {
  if (!autorizado(req)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  const token = process.env.WHATSAPP_TOKEN
  if (!token) {
    return NextResponse.json({ error: 'WHATSAPP_TOKEN sin configurar' }, { status: 503 })
  }
  const version = process.env.WHATSAPP_API_VERSION || 'v21.0'
  const base = `https://graph.facebook.com/${version}/${WABA_ID}/subscribed_apps`

  // 1. Suscribir esta app a la WABA.
  const post = await fetch(base, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const postJson: any = await post.json().catch(() => ({}))

  // 2. Leer la lista de apps suscritas, para confirmar (sin exponer el token).
  const get = await fetch(base, { headers: { Authorization: `Bearer ${token}` } })
  const getJson: any = await get.json().catch(() => ({}))

  return NextResponse.json({
    waba: WABA_ID,
    suscripcion: {
      ok: post.ok,
      resultado: postJson?.success ?? postJson,
      error: post.ok ? null : (postJson?.error?.message || `HTTP ${post.status}`),
    },
    appsSuscritas: get.ok
      ? (getJson?.data ?? []).map((a: any) => ({
          id: a?.whatsapp_business_api_data?.id ?? a?.id ?? null,
          nombre: a?.whatsapp_business_api_data?.name ?? null,
        }))
      : { error: getJson?.error?.message || `HTTP ${get.status}` },
  }, { status: post.ok ? 200 : 502 })
}
