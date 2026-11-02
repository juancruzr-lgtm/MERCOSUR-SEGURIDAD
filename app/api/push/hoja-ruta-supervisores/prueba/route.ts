// Prueba controlada de la plantilla hoja_ruta_supervisor (02/11/2026).
//
// Existe sólo para comprobar, desde Vercel (donde está el token), si Meta
// acepta la hoja de ruta completa en {{1}} con sus renglones y hasta qué
// largo. No toca la base, el cron ni los envíos generales, y no lee mensajes
// entrantes.
//
//   POST { "accion": "estado" }                 → estado de la plantilla en Meta
//   POST { "accion": "enviar", "texto": "..." } → UN mensaje al número de prueba
//
// Sólo con el secreto del cron. El destino es fijo (el mismo número de la
// prueba controlada del escalamiento): no se puede mandar a otro. El token
// nunca se devuelve ni se registra.

import { NextResponse } from 'next/server'
import { normalizarTelefonoAr } from '@/lib/telefono-ar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PLANTILLA = 'hoja_ruta_supervisor'
const TELEFONO_PRUEBA = '3413914544'

export async function POST(req: Request) {
  const secreto = process.env.push_cron_secret || process.env.CRON_SECRET
  if (!secreto || (req.headers.get('authorization') || '') !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }
  const token = process.env.WHATSAPP_TOKEN
  const phoneId = process.env.WHATSAPP_PHONE_ID
  if (!token || !phoneId) return NextResponse.json({ error: 'WhatsApp sin configurar' }, { status: 503 })
  const version = process.env.WHATSAPP_API_VERSION || 'v21.0'
  const idioma = process.env.WHATSAPP_IDIOMA || 'es_AR'
  const waba = process.env.WHATSAPP_WABA_ID || '1356900682561109'
  const graph = async (path: string, init?: RequestInit) => {
    const res = await fetch(`https://graph.facebook.com/${version}/${path}`, {
      ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    })
    return { status: res.status, json: (await res.json().catch(() => ({}))) as any }
  }

  const body = (await req.json().catch(() => ({}))) as { accion?: string; texto?: string }

  if (body.accion === 'estado') {
    const r = await graph(`${waba}/message_templates?name=${PLANTILLA}&fields=name,status,language,category,components,rejected_reason`)
    return NextResponse.json({
      http: r.status,
      error: r.json?.error?.message ?? null,
      plantillas: (r.json?.data ?? []).map((p: any) => ({
        nombre: p.name, idioma: p.language, categoria: p.category, estado: p.status, rechazo: p.rejected_reason ?? null,
        componentes: (p.components ?? []).map((c: any) => ({ tipo: c.type, texto: c.text ?? null })),
      })),
    })
  }

  if (body.accion === 'enviar' && typeof body.texto === 'string' && body.texto.length > 0) {
    const tel = normalizarTelefonoAr(TELEFONO_PRUEBA)
    if (!tel.e164) return NextResponse.json({ error: 'Teléfono de prueba inválido' }, { status: 500 })
    const r = await graph(`${phoneId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: tel.e164, type: 'template',
        template: { name: PLANTILLA, language: { code: idioma }, components: [{ type: 'body', parameters: [{ type: 'text', text: body.texto }] }] },
      }),
    })
    return NextResponse.json({
      http: r.status,
      aceptado: r.status === 200,
      wamid: r.json?.messages?.[0]?.id ?? null,
      telefonoUltimos4: tel.e164.slice(-4),
      caracteres: Array.from(body.texto).length,
      renglones: body.texto.split('\n').length,
      error: r.json?.error ? { codigo: r.json.error.code, mensaje: r.json.error.message, detalle: r.json.error.error_data?.details ?? null } : null,
    })
  }

  return NextResponse.json({ error: 'accion: "estado" | "enviar" (con texto)' }, { status: 400 })
}
