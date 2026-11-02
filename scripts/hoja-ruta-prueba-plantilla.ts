// Prueba controlada de la plantilla hoja_ruta_supervisor contra la API de
// WhatsApp Cloud. NO toca la base ni el cron; no lee mensajes entrantes.
//
//  1. Consulta en Meta el estado de la plantilla (aprobada, idioma, cuerpo).
//  2. Arma {{1}} con dos hojas REALES de octubre (formato v3):
//       A) 16/10 07–19 Aranda: largo típico (~420 caracteres);
//       B) 20/10 19–07 Aranda: la más larga del mes (~1540).
//  3. Sólo con --enviar: manda A al teléfono indicado; si Meta la acepta,
//     manda B. Nunca más de 2 mensajes. Sin --enviar no manda nada.
//
// Credenciales: sólo por variables de entorno de la terminal (nunca en el
// código ni en el chat): WHATSAPP_TOKEN, WHATSAPP_PHONE_ID; opcionales
// WHATSAPP_WABA_ID, WHATSAPP_API_VERSION, WHATSAPP_IDIOMA.
//
// Uso: npx tsx scripts/hoja-ruta-prueba-plantilla.ts <datos.json> <telefono E.164 sin +> [--enviar]
import { readFileSync } from 'fs'
import { armarHojaRuta, mensajeWhatsApp, PLANTILLA_HOJA_RUTA, type DatosHojaRuta, type PuntoHR } from '../lib/hoja-ruta'
import { ventanaGuardia } from '../lib/hoja-ruta-datos'

const [archivo, telefono] = process.argv.slice(2)
const enviar = process.argv.includes('--enviar')
const token = process.env.WHATSAPP_TOKEN
const phoneId = process.env.WHATSAPP_PHONE_ID
const waba = process.env.WHATSAPP_WABA_ID || '1356900682561109'
const version = process.env.WHATSAPP_API_VERSION || 'v21.0'
const idioma = process.env.WHATSAPP_IDIOMA || 'es_AR'

const iso = (s: number) => new Date(s * 1000).toISOString()

function hoja(g: any, objetivos: any[]): DatosHojaRuta {
  const v = ventanaGuardia({ fecha: g.f, hora_inicio: g.hi, hora_fin: g.hf })
  const nombre = new Map<number, string>(objetivos.map(o => [o[0], o[1]]))
  // Permanencias GPS ya calculadas en SQL → puntos equiespaciados (mismo resultado).
  const puntos: PuntoHR[] = []
  for (const [oi, d, h, n] of g.p ?? []) {
    for (let k = 0; k < n; k++) puntos.push({ ts: iso(n > 1 ? d + Math.round(((h - d) * k) / (n - 1)) : d), precision_m: 10, objetivo_cercano_id: String(oi), objetivo_distancia_m: 0 })
  }
  let i = 0
  return {
    guardia: { id: g.f, supervisor_id: 's', supervisor: g.sup, fecha: g.f, inicio: v.inicio, fin: v.fin, zona: null, reemplaza_a: g.rep ?? null },
    supervisiones: (g.s ?? []).map(([t, oi]: any) => ({ id: `s${i++}`, created_at: iso(t), objetivo_id: String(oi), objetivo: nombre.get(oi) ?? null })),
    novedades: (g.n ?? []).map(([t, oi, texto]: any) => ({ clave: `n${i++}`, created_at: iso(t), objetivo_id: String(oi), objetivo: nombre.get(oi) ?? null, origen: 'x', texto })),
    puntos,
    objetivos: objetivos.map(o => ({ id: String(o[0]), nombre: o[1], radio_metros: o[2] })),
  }
}

async function graph(path: string, init?: RequestInit) {
  const res = await fetch(`https://graph.facebook.com/${version}/${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  return { status: res.status, json: await res.json().catch(() => ({})) as any }
}

async function main() {
  if (!archivo || !telefono || !/^\d{10,15}$/.test(telefono)) throw new Error('Uso: <datos.json> <telefono sólo dígitos, ej. 54934...> [--enviar]')
  const { objetivos, guardias } = JSON.parse(readFileSync(archivo, 'utf8'))
  const mensajes = guardias.map((g: any) => ({ nombre: `${g.f} ${g.hi}-${g.hf} ${g.sup}`, m: mensajeWhatsApp(armarHojaRuta(hoja(g, objetivos)), Infinity) }))

  for (const { nombre, m } of mensajes) {
    console.log('='.repeat(70))
    console.log(`${nombre}: cuerpo renderizado ${m.longitud} caracteres, {{1}} ${Array.from(m.variables[0]).length}`)
    console.log(m.mensaje)
  }
  if (!token || !phoneId) { console.log('\nSin WHATSAPP_TOKEN / WHATSAPP_PHONE_ID: sólo vista previa.'); return }

  console.log('\n=== Plantilla en Meta ===')
  const t = await graph(`${waba}/message_templates?name=${PLANTILLA_HOJA_RUTA}&fields=name,status,language,category,components,rejected_reason`)
  if (t.status !== 200) { console.log('No se pudo consultar:', t.status, t.json?.error?.message); return }
  for (const p of t.json.data ?? []) {
    const body = (p.components ?? []).find((c: any) => c.type === 'BODY')
    console.log(`${p.name} · ${p.language} · ${p.category} · ${p.status}${p.rejected_reason && p.rejected_reason !== 'NONE' ? ` (${p.rejected_reason})` : ''}`)
    console.log(`  cuerpo: ${JSON.stringify(body?.text)}`)
    console.log(`  componentes: ${(p.components ?? []).map((c: any) => c.type).join(', ')}`)
  }
  const aprobada = (t.json.data ?? []).find((p: any) => p.language === idioma && p.status === 'APPROVED')
  if (!aprobada) { console.log(`\nNo hay versión APPROVED en ${idioma}: no se envía nada.`); return }
  if (!enviar) { console.log('\nSin --enviar: no se mandó nada.'); return }

  for (const { nombre, m } of mensajes) {
    console.log(`\n=== Envío: ${nombre} (${m.longitud} caracteres) ===`)
    const r = await graph(`${phoneId}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: telefono, type: 'template',
        template: { name: PLANTILLA_HOJA_RUTA, language: { code: idioma }, components: [{ type: 'body', parameters: m.variables.map(text => ({ type: 'text', text })) }] },
      }),
    })
    if (r.status === 200) console.log(`ACEPTADO por Meta · wamid ${r.json?.messages?.[0]?.id} → revisar en el teléfono que llegue y con renglones`)
    else { console.log(`RECHAZADO ${r.status} · código ${r.json?.error?.code} · ${r.json?.error?.message} · ${r.json?.error?.error_data?.details ?? ''}`); break }
  }
}
main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
