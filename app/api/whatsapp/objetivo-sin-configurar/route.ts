// WhatsApp: objetivo nuevo al que le falta protocolo o ronda (plantilla
// `objetivo_nuevo_sin_configurar`, aprobada en Meta el 19/11/2026).
// Destinatarios: Gerencia, Director técnico y Jefe de supervisores
// (ronda_guiada_config.avisar_usuarios) + el supervisor de la zona del objetivo.
//
// ── APAGADO ─────────────────────────────────────────────────────────────────
// ENVIO_HABILITADO = false en código. Requiere las migraciones 20261217120000
// y 20261218120000, la fecha de inicio WHATSAPP_OBJETIVO_SIN_CONFIG_DESDE y
// programar el cron (no hay cron creado). Sin `?enviar=1` corre en seco.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import { normalizarTelefonoAr } from '@/lib/telefono-ar'
import { configuracionMeta, proveedorPorDefecto } from '@/lib/whatsapp'
import { claveEnvioWhatsApp, completarEnvio, crearPresupuestoCorrida, reclamarEnvio } from '@/lib/whatsapp-envio-seguro'
import { objetivosSinConfigurar, PLANTILLA_OBJETIVO_SIN_CONFIGURAR, variablesAviso, vistaPrevia, type ObjetivoNuevo } from '@/lib/objetivo-sin-configurar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

const ENVIO_HABILITADO = true as const
const ETAPA = 'wa_objetivo_sin_configurar'
const PLANTILLA = process.env.WHATSAPP_PLANTILLA_OBJETIVO_SIN_CONFIGURAR || PLANTILLA_OBJETIVO_SIN_CONFIGURAR.nombre
/** Desde cuándo rige el aviso: sólo objetivos creados después. Sin valor = no avisa. */
const CORTE = process.env.WHATSAPP_OBJETIVO_SIN_CONFIG_DESDE || null

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
    const { data: authData, error: authError } = await client.auth.getUser(token)
    if (authError || !authData.user) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })
    const { data: usuario } = await client.from('usuarios').select('id, rol, estado').eq('auth_user_id', authData.user.id).maybeSingle()
    if (!usuario || usuario.estado !== 'activo' || usuario.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    if (pideEnvio) return NextResponse.json({ error: 'El envío real sólo se dispara desde el cron con su secreto' }, { status: 403 })
  }
  const enviarDeVerdad = pideEnvio && esCron && ENVIO_HABILITADO

  const desde = CORTE ?? new Date().toISOString()
  const obj = await client.from('objetivos').select('id, nombre, cliente, estado, es_prueba, created_at, zona_id').eq('estado', 'activo').gte('created_at', desde)
  if (obj.error) return NextResponse.json({ error: `objetivos: ${obj.error.message}` }, { status: 502 })
  const objetivos = (obj.data ?? []) as ObjetivoNuevo[]
  const ids = objetivos.map(o => o.id)

  const vacio = Promise.resolve({ data: [] as any[], error: null })
  const [prot, ron, cfg, zonas] = await Promise.all([
    ids.length ? client.from('protocolo_versiones').select('objetivo_id').in('objetivo_id', ids).eq('estado', 'vigente') : vacio,
    ids.length ? client.from('rondas_base').select('objetivo_id').in('objetivo_id', ids).eq('activo', true) : vacio,
    client.from('ronda_guiada_config').select('avisar_usuarios').maybeSingle(),
    client.from('supervisor_zonas').select('supervisor_id, zona_id'),
  ])
  // Fail closed: si no se puede saber qué falta o a quién avisar, no se avisa.
  if (prot.error || ron.error || cfg.error || zonas.error) {
    return NextResponse.json({ error: 'Fuente con error: no se evalúa', detalle: [prot.error?.message, ron.error?.message, cfg.error?.message, zonas.error?.message].filter(Boolean) }, { status: 502 })
  }

  const { candidatos, descartes } = objetivosSinConfigurar({
    objetivos,
    conProtocolo: new Set((prot.data ?? []).map((x: any) => x.objetivo_id)),
    conRondas: new Set((ron.data ?? []).map((x: any) => x.objetivo_id)),
    corteIso: CORTE,
    ahoraIso: new Date().toISOString(),
  })

  const fijos: string[] = (cfg.data as any)?.avisar_usuarios ?? []
  const supDeZona = (z: string | null) => ((zonas.data ?? []) as { supervisor_id: string; zona_id: string }[]).filter(x => x.zona_id === z).map(x => x.supervisor_id)
  const todos = Array.from(new Set([...fijos, ...candidatos.flatMap(c => supDeZona(c.zonaId))]))
  const us = todos.length ? await client.from('usuarios').select('id, nombre, apellido, telefono').eq('estado', 'activo').in('id', todos) : { data: [], error: null }
  const persona = new Map(((us.data ?? []) as Persona[]).map(u => [u.id, u]))

  const proveedor = proveedorPorDefecto()
  const presupuesto = crearPresupuestoCorrida({ maxEnvios: 20, maxMs: 40000 })
  const acciones: Record<string, unknown>[] = []
  const sinTelefono: string[] = []

  for (const c of candidatos) {
    for (const id of Array.from(new Set([...fijos, ...supDeZona(c.zonaId)]))) {
      const u = persona.get(id)
      const tel = normalizarTelefonoAr(u?.telefono)
      if (!u || !tel.e164) { sinTelefono.push(u ? `${u.apellido ?? ''}, ${u.nombre ?? ''}` : id); continue }
      const variables = variablesAviso(u.nombre ?? '', c)
      if (!enviarDeVerdad) { acciones.push({ objetivo: c.nombre, falta: c.falta, para: `${u.apellido ?? ''}, ${u.nombre ?? ''}`, mensaje: vistaPrevia(variables) }); continue }
      if (!presupuesto.disponible()) { descartes.presupuesto_corrida = (descartes.presupuesto_corrida ?? 0) + 1; continue }
      const reclamo = await reclamarEnvio(client,
        claveEnvioWhatsApp({ etapa: ETAPA, evento: `objetivo:${c.objetivoId}`, destinatarioId: id }),
        { objetivo_id: c.objetivoId, nivel: ETAPA, destinatario_id: id, telefono: tel.e164, plantilla: PLANTILLA, proveedor: proveedor.nombre },
        { maxIntentos: 2, backoffMin: 10, topeDestinatarioDia: 10 })
      if (!reclamo.ok) { descartes[`no_reclamado_${reclamo.motivo}`] = (descartes[`no_reclamado_${reclamo.motivo}`] ?? 0) + 1; continue }
      presupuesto.registrar()
      const r = await proveedor.enviar({ telefono: tel.e164, plantilla: PLANTILLA, variables, boton: { urlSuffix: PLANTILLA_OBJETIVO_SIN_CONFIGURAR.boton } })
      acciones.push({ objetivo: c.nombre, para: id, ok: r.ok, error: r.error, intento: reclamo.intento })
      await completarEnvio(client, reclamo.id as string, r)
    }
  }

  return NextResponse.json({
    modo: enviarDeVerdad ? 'ENVIO_REAL' : pideEnvio ? 'BLOQUEADO_ENVIO_DESHABILITADO' : 'SIMULACION',
    corte: CORTE ?? 'sin corte: no se avisa nada hasta configurarlo',
    meta: configuracionMeta(),
    destinatariosFijos: fijos.length,
    sinTelefono,
    candidatos: candidatos.length,
    descartes,
    acciones,
  })
}
