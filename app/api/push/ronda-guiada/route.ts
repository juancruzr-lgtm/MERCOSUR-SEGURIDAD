// Ronda guiada: (1) avisa a supervisores de la zona y jefes cuando un vigilador
// deja una ronda PROPUESTA y (2) activa las que cumplieron 24 h sin cambios.
//
// ── APAGADO ─────────────────────────────────────────────────────────────────
// HABILITADO = false en código: sin aprobación no se activa ninguna ronda ni
// sale ningún WhatsApp. Requiere la migración 20261218120000, la plantilla
// `ronda_guiada_propuesta` aprobada en Meta, la migración 20261217120000
// (envíos sin turno) y programar el cron (no hay cron creado).
// Sin `?enviar=1` corre en seco: devuelve qué activaría y a quién avisaría.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import { normalizarTelefonoAr } from '@/lib/telefono-ar'
import { proveedorPorDefecto } from '@/lib/whatsapp'
import { claveEnvioWhatsApp, completarEnvio, crearPresupuestoCorrida, reclamarEnvio } from '@/lib/whatsapp-envio-seguro'
import { PLANTILLA_RONDA_GUIADA_PROPUESTA, variablesRondaPropuesta, vistaPreviaRondaPropuesta } from '@/lib/configuracion-guiada'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

const HABILITADO = false as const
const ETAPA = 'wa_ronda_guiada_propuesta'
const PLANTILLA = process.env.WHATSAPP_PLANTILLA_RONDA_GUIADA || PLANTILLA_RONDA_GUIADA_PROPUESTA.nombre
const PUESTOS_JEFES = (process.env.WHATSAPP_OBJETIVO_SIN_CONFIG_PUESTOS || 'jefe_supervisores,direccion_operativa').split(',').map(s => s.trim()).filter(Boolean)

interface Persona { id: string; nombre: string | null; apellido: string | null; telefono: string | null }

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

  const g = await client.from('ronda_guiada').select('id, objetivo_id, distancia_metros, activa_desde').eq('estado', 'propuesta')
  if (g.error) return NextResponse.json({ error: `ronda_guiada: ${g.error.message} (¿migración 20261218120000 aplicada?)` }, { status: 502 })
  const propuestas = (g.data ?? []) as { id: string; objetivo_id: string; distancia_metros: number | null; activa_desde: string }[]
  const objIds = Array.from(new Set(propuestas.map(x => x.objetivo_id)))

  const obj = objIds.length ? await client.from('objetivos').select('id, nombre, zona_id').in('id', objIds) : { data: [], error: null }
  const jefes = await client.from('usuarios').select('id, nombre, apellido, telefono').eq('estado', 'activo').in('puesto_organizacional', PUESTOS_JEFES)
  const supZona = await client.from('supervisor_zonas').select('supervisor_id, zona_id')
  if (obj.error || jefes.error || supZona.error) return NextResponse.json({ error: 'Fuente con error: no se evalúa' }, { status: 502 })
  const zonas = (supZona.data ?? []) as { supervisor_id: string; zona_id: string }[]
  const supIds = Array.from(new Set(zonas.map(z => z.supervisor_id)))
  const sups = supIds.length ? await client.from('usuarios').select('id, nombre, apellido, telefono').eq('estado', 'activo').in('id', supIds) : { data: [], error: null }
  const persona = new Map<string, Persona>()
  for (const u of [...((jefes.data ?? []) as Persona[]), ...((sups.data ?? []) as Persona[])]) persona.set(u.id, u)

  const proveedor = proveedorPorDefecto()
  const presupuesto = crearPresupuestoCorrida({ maxEnvios: 20, maxMs: 30000 })
  const avisos: Record<string, unknown>[] = []

  for (const p of propuestas) {
    const o = ((obj.data ?? []) as { id: string; nombre: string; zona_id: string | null }[]).find(x => x.id === p.objetivo_id)
    const destinos = new Set<string>([
      ...((jefes.data ?? []) as Persona[]).map(u => u.id),
      ...zonas.filter(z => z.zona_id === o?.zona_id).map(z => z.supervisor_id),
    ])
    for (const id of Array.from(destinos)) {
      const u = persona.get(id)
      const tel = normalizarTelefonoAr(u?.telefono)
      if (!u || !tel.e164) { avisos.push({ objetivo: o?.nombre, para: id, omitido: 'sin_telefono' }); continue }
      const variables = variablesRondaPropuesta(u.nombre ?? '', o?.nombre ?? 'objetivo', Number(p.distancia_metros ?? 0), p.activa_desde)
      if (!deVerdad) { avisos.push({ objetivo: o?.nombre, para: `${u.apellido ?? ''}, ${u.nombre ?? ''}`, mensaje: vistaPreviaRondaPropuesta(variables) }); continue }
      if (!presupuesto.disponible()) break
      const rec = await reclamarEnvio(client, claveEnvioWhatsApp({ etapa: ETAPA, evento: `ronda_guiada:${p.id}`, destinatarioId: id }),
        { objetivo_id: p.objetivo_id, nivel: ETAPA, destinatario_id: id, telefono: tel.e164, plantilla: PLANTILLA, proveedor: proveedor.nombre },
        { maxIntentos: 2, backoffMin: 10, topeDestinatarioDia: 10 })
      if (!rec.ok) continue
      presupuesto.registrar()
      const r = await proveedor.enviar({ telefono: tel.e164, plantilla: PLANTILLA, variables, boton: { urlSuffix: 'configuracion_guiada' } })
      avisos.push({ objetivo: o?.nombre, para: id, ok: r.ok, error: r.error })
      await completarEnvio(client, rec.id as string, r)
    }
  }

  let activacion: unknown
  if (deVerdad) {
    const a = await client.rpc('ronda_guiada_activar_vencidas')
    activacion = a.error ? { error: a.error.message } : a.data
  } else {
    activacion = { simulacion: true, seActivarian: propuestas.filter(p => p.activa_desde && Date.parse(p.activa_desde) <= Date.now()).length }
  }

  return NextResponse.json({ modo: deVerdad ? 'REAL' : pideEnvio ? 'BLOQUEADO_DESHABILITADO' : 'SIMULACION', propuestas: propuestas.length, avisos, activacion })
}
