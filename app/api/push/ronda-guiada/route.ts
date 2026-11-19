// Avisos de la ronda guiada.
//  - Ronda ACTIVA recién configurada → Gerencia, Director técnico, Jefe de
//    supervisores (ronda_guiada_config.avisar_usuarios) y el supervisor de la
//    zona: push + WhatsApp (plantilla `ronda_configurada_activa`, aprobada).
//  - Configuración que NO se pudo validar (requiere revisión) → los mismos,
//    por push (no hay plantilla de WhatsApp para esto).
// Un aviso por ronda y persona: push con reclamo atómico en
// notificaciones_enviadas; WhatsApp con reclamar_envio_whatsapp.
//
// ── APAGADO ─────────────────────────────────────────────────────────────────
// HABILITADO = false en código. Requiere las migraciones 20261217120000 y
// 20261218120000 y programar el cron (no hay cron creado). Sin `?enviar=1`
// corre en seco y devuelve a quién y qué se mandaría.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import { enviarAvisoClaimFirst } from '../../_lib/push-notificaciones'
import { normalizarTelefonoAr } from '@/lib/telefono-ar'
import { proveedorPorDefecto } from '@/lib/whatsapp'
import { claveEnvioWhatsApp, completarEnvio, crearPresupuestoCorrida, reclamarEnvio } from '@/lib/whatsapp-envio-seguro'
import { MOTIVOS_PROBLEMA, PLANTILLA_RONDA_CONFIGURADA, textoFrecuencia, variablesRondaConfigurada, vistaPrevia, type MotivoProblema } from '@/lib/configuracion-guiada'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

const HABILITADO = true as const
const ETAPA = 'wa_ronda_configurada_activa'
const PLANTILLA = process.env.WHATSAPP_PLANTILLA_RONDA_CONFIGURADA || PLANTILLA_RONDA_CONFIGURADA.nombre
const URL_APP = process.env.WHATSAPP_DEEPLINK_BASE || 'https://mercosur-seguridad.vercel.app/dashboard'

interface Persona { id: string; nombre: string | null; apellido: string | null; telefono: string | null }
interface Guiada { id: string; objetivo_id: string; estado: string; distancia_metros: number | null; frecuencia_minutos: number | null; activada_at: string | null; capturada_por: string | null; motivo_revision: string | null; revision_at: string | null }

export async function GET(req: Request) {
  const url = new URL(req.url)
  const pideEnvio = url.searchParams.get('enviar') === '1'
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })
  const client = admin.client

  const secreto = process.env.push_cron_secret || process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const esCron = Boolean(secreto) && auth === `Bearer ${secreto}`
  if (!esCron) {
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token) return NextResponse.json({ error: 'Sesión requerida' }, { status: 401 })
    const { data: a, error: e } = await client.auth.getUser(token)
    if (e || !a.user) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })
    const { data: u } = await client.from('usuarios').select('rol, estado').eq('auth_user_id', a.user.id).maybeSingle()
    if (!u || u.estado !== 'activo' || u.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    if (pideEnvio) return NextResponse.json({ error: 'El envío real sólo se dispara desde el cron con su secreto' }, { status: 403 })
  }
  const deVerdad = pideEnvio && esCron && HABILITADO

  const [cfg, gs] = await Promise.all([
    client.from('ronda_guiada_config').select('avisar_usuarios').maybeSingle(),
    client.from('ronda_guiada').select('id, objetivo_id, estado, distancia_metros, frecuencia_minutos, activada_at, capturada_por, motivo_revision, revision_at')
      .is('avisado_at', null).in('estado', ['activa', 'requiere_revision']),
  ])
  if (cfg.error || gs.error) return NextResponse.json({ error: `¿Migración 20261218120000 aplicada? ${cfg.error?.message ?? gs.error?.message}` }, { status: 502 })
  const fijos: string[] = cfg.data?.avisar_usuarios ?? []
  const guiadas = (gs.data ?? []) as Guiada[]
  if (guiadas.length === 0) return NextResponse.json({ modo: deVerdad ? 'REAL' : 'SIMULACION', pendientes: 0 })

  const objIds = Array.from(new Set(guiadas.map(g => g.objetivo_id)))
  const [obj, zonas] = await Promise.all([
    client.from('objetivos').select('id, nombre, zona_id').in('id', objIds),
    client.from('supervisor_zonas').select('supervisor_id, zona_id'),
  ])
  if (obj.error || zonas.error) return NextResponse.json({ error: 'Fuente con error: no se evalúa' }, { status: 502 })
  const objetivo = new Map(((obj.data ?? []) as { id: string; nombre: string; zona_id: string | null }[]).map(o => [o.id, o]))
  const supDeZona = (zonaId: string | null) => ((zonas.data ?? []) as { supervisor_id: string; zona_id: string }[]).filter(z => z.zona_id === zonaId).map(z => z.supervisor_id)

  const ids = Array.from(new Set([...fijos, ...guiadas.flatMap(g => supDeZona(objetivo.get(g.objetivo_id)?.zona_id ?? null)), ...guiadas.map(g => g.capturada_por).filter(Boolean) as string[]]))
  const [us, subs] = await Promise.all([
    client.from('usuarios').select('id, nombre, apellido, telefono').in('id', ids),
    client.from('push_subscriptions').select('id, usuario_id, endpoint, p256dh, auth').eq('activo', true).in('usuario_id', ids),
  ])
  const persona = new Map(((us.data ?? []) as Persona[]).map(u => [u.id, u]))
  const nombre = (id: string | null) => { const u = id ? persona.get(id) : null; return u ? `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim() : 'vigilador' }

  const proveedor = proveedorPorDefecto()
  const presupuesto = crearPresupuestoCorrida({ maxEnvios: 30, maxMs: 40000 })
  const salida: Record<string, unknown>[] = []

  for (const g of guiadas) {
    const o = objetivo.get(g.objetivo_id)
    const destinos = Array.from(new Set([...fijos, ...supDeZona(o?.zona_id ?? null)]))
    const activa = g.estado === 'activa'
    const titulo = activa ? `Ronda activa · ${o?.nombre ?? 'objetivo'}` : `Ronda sin configurar · ${o?.nombre ?? 'objetivo'}`
    const cuerpo = activa
      ? `${nombre(g.capturada_por)} configuró la ronda: ${Math.round(Number(g.distancia_metros ?? 0))} m entre puntos, ${textoFrecuencia(g.frecuencia_minutos ?? 120)}. RONDA ACTIVA.`
      : `${nombre(g.capturada_por)} no pudo configurar la ronda: ${MOTIVOS_PROBLEMA[(g.motivo_revision ?? 'otro') as MotivoProblema] ?? g.motivo_revision}. Revisalo desde Configurar objetivos.`
    let todoOk = true
    for (const id of destinos) {
      const u = persona.get(id)
      const tel = normalizarTelefonoAr(u?.telefono)
      const variables = activa ? variablesRondaConfigurada({ destinatario: u?.nombre ?? '', objetivo: o?.nombre ?? 'objetivo', vigilador: nombre(g.capturada_por), activadaIso: g.activada_at ?? new Date().toISOString(), distancia: Number(g.distancia_metros ?? 0), frecuenciaMin: g.frecuencia_minutos ?? 120 }) : null
      if (!deVerdad) {
        salida.push({ objetivo: o?.nombre, para: nombre(id), push: `${titulo} — ${cuerpo}`, whatsapp: variables && tel.e164 ? vistaPrevia(PLANTILLA_RONDA_CONFIGURADA.cuerpo, variables) : (activa ? 'sin teléfono válido' : 'sólo push') })
        continue
      }
      // Push (dedup atómico por ronda y persona)
      const tipo = activa ? `ronda_guiada_activa:${g.id}` : `ronda_guiada_revision:${g.id}:${g.revision_at}`
      const pr = await enviarAvisoClaimFirst(client, (subs.data ?? []) as any[], id, g.objetivo_id, tipo, { title: titulo, body: cuerpo, url: `${URL_APP}?page=configuracion_guiada`, tag: `ronda-guiada-${g.id}` })
      // WhatsApp sólo para la ronda activa (plantilla aprobada)
      let wa: string = 'no corresponde'
      if (activa && variables && tel.e164 && presupuesto.disponible()) {
        const rec = await reclamarEnvio(client, claveEnvioWhatsApp({ etapa: ETAPA, evento: `ronda_guiada:${g.id}`, destinatarioId: id }),
          { objetivo_id: g.objetivo_id, nivel: ETAPA, destinatario_id: id, telefono: tel.e164, plantilla: PLANTILLA, proveedor: proveedor.nombre },
          { maxIntentos: 2, backoffMin: 10, topeDestinatarioDia: 20 })
        if (rec.ok) {
          presupuesto.registrar()
          const r = await proveedor.enviar({ telefono: tel.e164, plantilla: PLANTILLA, variables, boton: { urlSuffix: PLANTILLA_RONDA_CONFIGURADA.boton } })
          await completarEnvio(client, rec.id as string, r)
          wa = r.ok ? 'enviado' : `error: ${r.error}`
          if (!r.ok) todoOk = false
        } else wa = `no reclamado: ${rec.motivo}`
      }
      salida.push({ objetivo: o?.nombre, para: id, push: pr, whatsapp: wa })
    }
    if (deVerdad && todoOk) await client.from('ronda_guiada').update({ avisado_at: new Date().toISOString() }).eq('id', g.id)
  }

  return NextResponse.json({ modo: deVerdad ? 'REAL' : pideEnvio ? 'BLOQUEADO_DESHABILITADO' : 'SIMULACION', pendientes: guiadas.length, avisos: salida })
}
