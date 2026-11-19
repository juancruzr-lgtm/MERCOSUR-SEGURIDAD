// WhatsApp a los jefes operativos: objetivo nuevo sin protocolo ni rondas.
//
// ── APAGADO ─────────────────────────────────────────────────────────────────
// ENVIO_HABILITADO = false en código. Aunque llegue el cron con su secreto y
// `?enviar=1`, no sale nada hasta que Gerencia:
//   1) apruebe la plantilla `objetivo_nuevo_sin_configurar` en Meta,
//   2) apruebe la migración 20261217120000 (envíos sin turno), y
//   3) cambie esta constante y programe el cron (no hay cron creado).
// Sin `?enviar=1` corre en seco y devuelve a quién y qué se mandaría.

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

const ENVIO_HABILITADO = false as const
const ETAPA = 'wa_objetivo_sin_configurar'
const PLANTILLA = process.env.WHATSAPP_PLANTILLA_OBJETIVO_SIN_CONFIGURAR || PLANTILLA_OBJETIVO_SIN_CONFIGURAR.nombre
/** Desde cuándo rige el aviso: sólo objetivos creados después. Sin valor = no avisa. */
const CORTE = process.env.WHATSAPP_OBJETIVO_SIN_CONFIG_DESDE || null
/** Quiénes son "jefes operativos". */
const PUESTOS_DESTINO = (process.env.WHATSAPP_OBJETIVO_SIN_CONFIG_PUESTOS || 'jefe_supervisores,direccion_operativa').split(',').map(s => s.trim()).filter(Boolean)

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

  // Objetivos activos creados después del corte (acotado).
  const desde = CORTE ?? new Date().toISOString()
  const obj = await client.from('objetivos').select('id, nombre, cliente, direccion, estado, es_prueba, created_at')
    .eq('estado', 'activo').gte('created_at', desde)
  if (obj.error) return NextResponse.json({ error: `objetivos: ${obj.error.message}` }, { status: 502 })
  const objetivos = (obj.data ?? []) as ObjetivoNuevo[]
  const ids = objetivos.map(o => o.id)

  const [prot, ron, jefes] = await Promise.all([
    ids.length ? client.from('protocolo_versiones').select('objetivo_id').in('objetivo_id', ids).eq('estado', 'vigente') : Promise.resolve({ data: [], error: null }),
    ids.length ? client.from('rondas_base').select('objetivo_id').in('objetivo_id', ids).eq('activo', true) : Promise.resolve({ data: [], error: null }),
    client.from('usuarios').select('id, nombre, apellido, telefono').eq('estado', 'activo').in('puesto_organizacional', PUESTOS_DESTINO),
  ])
  // Fail closed: si no se pudo saber si tiene protocolo o rondas, no se avisa.
  if (prot.error || ron.error || jefes.error) {
    return NextResponse.json({ error: 'Fuente con error: no se evalúa', detalle: [prot.error?.message, ron.error?.message, jefes.error?.message].filter(Boolean) }, { status: 502 })
  }

  const { candidatos, descartes } = objetivosSinConfigurar({
    objetivos,
    conProtocolo: new Set((prot.data ?? []).map((x: any) => x.objetivo_id)),
    conRondas: new Set((ron.data ?? []).map((x: any) => x.objetivo_id)),
    corteIso: CORTE,
    ahoraIso: new Date().toISOString(),
  })

  const destinatarios = (jefes.data ?? []).map((u: any) => ({ ...u, tel: normalizarTelefonoAr(u.telefono) }))
  const sinTelefono = destinatarios.filter(u => !u.tel?.e164).map(u => `${u.apellido ?? ''}, ${u.nombre ?? ''}`)
  const proveedor = proveedorPorDefecto()
  const presupuesto = crearPresupuestoCorrida({ maxEnvios: 20, maxMs: 40000 })
  const acciones: any[] = []

  for (const c of candidatos) {
    for (const u of destinatarios) {
      if (!u.tel?.e164) continue
      const variables = variablesAviso(u.nombre ?? '', c)
      if (!enviarDeVerdad) {
        acciones.push({ objetivo: c.nombre, para: `${u.apellido ?? ''}, ${u.nombre ?? ''}`, telefono: u.tel.e164, mensaje: vistaPrevia(variables) })
        continue
      }
      if (!presupuesto.disponible()) { descartes.presupuesto_corrida = (descartes.presupuesto_corrida ?? 0) + 1; continue }
      const reclamo = await reclamarEnvio(client,
        claveEnvioWhatsApp({ etapa: ETAPA, evento: `objetivo:${c.objetivoId}`, destinatarioId: u.id }),
        { objetivo_id: c.objetivoId, nivel: ETAPA, destinatario_id: u.id, telefono: u.tel.e164, plantilla: PLANTILLA, proveedor: proveedor.nombre },
        { maxIntentos: 2, backoffMin: 10, topeDestinatarioDia: 10 },
      )
      if (!reclamo.ok) { descartes[`no_reclamado_${reclamo.motivo}`] = (descartes[`no_reclamado_${reclamo.motivo}`] ?? 0) + 1; continue }
      presupuesto.registrar()
      const r = await proveedor.enviar({ telefono: u.tel.e164, plantilla: PLANTILLA, variables, boton: { urlSuffix: 'objetivos' } })
      acciones.push({ objetivo: c.nombre, para: u.id, ok: r.ok, error: r.error, intento: reclamo.intento })
      await completarEnvio(client, reclamo.id as string, r)
    }
  }

  return NextResponse.json({
    modo: enviarDeVerdad ? 'ENVIO_REAL' : pideEnvio && !ENVIO_HABILITADO ? 'BLOQUEADO_ENVIO_DESHABILITADO' : 'SIMULACION',
    corte: CORTE ?? 'sin corte: no se avisa nada hasta configurarlo',
    meta: configuracionMeta(),
    puestosDestino: PUESTOS_DESTINO,
    destinatarios: destinatarios.length,
    sinTelefono,
    candidatos: candidatos.length,
    descartes,
    acciones,
  })
}
