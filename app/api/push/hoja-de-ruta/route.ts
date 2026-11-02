// Hoja de ruta del supervisor por WhatsApp, al terminar cada turno.
//
// ── Separado a propósito ────────────────────────────────────────────────────
// No comparte ruta, tabla ni topes con los avisos de puestos descubiertos ni de
// rondas. Formato y reglas: lib/hoja-de-ruta.ts y
// docs/auditoria-2026-10/hoja_de_ruta_supervisores.md.
//
// ── Apagado por defecto ─────────────────────────────────────────────────────
// HOJA_DE_RUTA_WHATSAPP: sin valor → apagado (no lee nada); 'dry-run' → arma los
// mensajes y los devuelve, sin escribir ni enviar; 'activo' → envía, y sólo si
// lo dispara el cron con su secreto. Una sesión de navegador nunca envía.
//
// Envío seguro (mismo patrón que la migración 20261121130000): se reclama la
// fila (turno, destinatario) en la base ANTES de llamar a Meta; si ya existe,
// no se envía. Cualquier error de lectura o de la RPC = no enviar.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import { normalizarTelefonoAr } from '@/lib/telefono-ar'
import { enviarTextoMeta, esFueraDeVentana24h } from '@/lib/whatsapp'
import { crearPresupuestoCorrida } from '@/lib/whatsapp-envio-seguro'
import {
  construirMensajeHojaDeRuta, excedeLimite, modoHojaDeRuta, turnosDeSupervisor, turnosTerminados,
  type GuardiaSupervisor, type VisitaSupervision,
} from '@/lib/hoja-de-ruta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

const TZ = 'America/Argentina/Buenos_Aires'
const VENTANA_HORAS = Number(process.env.HOJA_DE_RUTA_VENTANA_HORAS || '6')

const fechaLocal = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

export async function GET(req: Request) {
  const modo = modoHojaDeRuta()
  if (modo === 'apagado') return NextResponse.json({ modo, enviados: 0 })

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
    const { data: usuario } = await client.from('usuarios')
      .select('id, rol, estado').eq('auth_user_id', authData.user.id).maybeSingle()
    if (!usuario || usuario.estado !== 'activo' || usuario.rol !== 'admin') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
  }
  const enviar = modo === 'activo' && esCron

  const ahora = new Date()
  const hoy = fechaLocal(ahora)
  const ayer = fechaLocal(new Date(ahora.getTime() - 86_400_000))

  // ── Lecturas acotadas; cualquier error corta sin enviar (fail-closed) ─────
  const guardiasRes = await client.from('supervisores_guardia')
    .select('id, supervisor_id, fecha, hora_inicio, hora_fin, estado, tipo_evento')
    .in('fecha', [ayer, hoy])
  if (guardiasRes.error) return NextResponse.json({ error: guardiasRes.error.message }, { status: 500 })
  const turnos = turnosTerminados(turnosDeSupervisor((guardiasRes.data || []) as GuardiaSupervisor[]), ahora, VENTANA_HORAS)
  if (turnos.length === 0) return NextResponse.json({ modo, turnos: 0, enviados: 0 })

  const destRes = await client.from('hoja_ruta_destinatarios').select('usuario_id, descripcion').eq('activo', true)
  if (destRes.error) return NextResponse.json({ error: destRes.error.message }, { status: 500 })
  const destinatarios = (destRes.data || []) as { usuario_id: string, descripcion: string }[]
  if (destinatarios.length === 0) return NextResponse.json({ modo, turnos: turnos.length, enviados: 0, motivo: 'sin_destinatarios' })

  const supervisorIds = Array.from(new Set(turnos.map(t => t.supervisorId)))
  const desde = new Date(Math.min(...turnos.map(t => t.desde.getTime()))).toISOString()
  const hasta = new Date(Math.max(...turnos.map(t => t.hasta.getTime()))).toISOString()
  const visitasRes = await client.from('supervisiones')
    .select('id, objetivo_id, supervisor_id, created_at, observaciones')
    .in('supervisor_id', supervisorIds).gte('created_at', desde).lte('created_at', hasta)
    .order('created_at', { ascending: true }).limit(1000)
  if (visitasRes.error) return NextResponse.json({ error: visitasRes.error.message }, { status: 500 })
  const visitas = (visitasRes.data || []) as VisitaSupervision[]
  // Tope de PostgREST: si se llegó a 1000 no hay garantía de tener todas las visitas.
  if (visitas.length >= 1000) return NextResponse.json({ error: 'Demasiadas visitas en la ventana: no se arma una hoja incompleta' }, { status: 500 })

  const objetivoIds = Array.from(new Set(visitas.map(v => v.objetivo_id)))
  const usuarioIds = Array.from(new Set([...supervisorIds, ...destinatarios.map(d => d.usuario_id)]))
  const [objRes, usrRes] = await Promise.all([
    objetivoIds.length ? client.from('objetivos').select('id, nombre').in('id', objetivoIds) : Promise.resolve({ data: [], error: null }),
    client.from('usuarios').select('id, nombre, apellido, telefono, estado').in('id', usuarioIds),
  ])
  if (objRes.error) return NextResponse.json({ error: objRes.error.message }, { status: 500 })
  if (usrRes.error) return NextResponse.json({ error: usrRes.error.message }, { status: 500 })
  const objetivos = new Map(((objRes.data || []) as { id: string, nombre: string }[]).map(o => [o.id, o.nombre]))
  const usuarios = new Map(((usrRes.data || []) as any[]).map(u => [u.id, u]))

  const presupuesto = crearPresupuestoCorrida()
  const acciones: Record<string, unknown>[] = []
  for (const turno of turnos) {
    const sup = usuarios.get(turno.supervisorId)
    const mensaje = construirMensajeHojaDeRuta({
      turno,
      supervisorNombre: sup ? `${sup.nombre} ${sup.apellido}`.trim() : 'Sin nombre',
      visitas,
      nombreObjetivo: id => objetivos.get(id) || 'Objetivo sin nombre',
    })
    const excede = excedeLimite(mensaje)
    for (const d of destinatarios) {
      const u = usuarios.get(d.usuario_id)
      const tel = normalizarTelefonoAr(u?.estado === 'activo' ? u?.telefono : null)
      const base = { turno: turno.clave, destinatario: d.descripcion, caracteres: Array.from(mensaje).length }
      if (!tel.e164) {
        // No se reclama: si se carga el teléfono dentro de la ventana, todavía sale.
        acciones.push({ ...base, resultado: 'sin_telefono' })
        continue
      }
      if (!enviar) {
        acciones.push({ ...base, resultado: excede ? 'excede_limite' : 'dry_run', mensaje })
        continue
      }
      if (!presupuesto.disponible()) { acciones.push({ ...base, resultado: 'pospuesto_por_tiempo' }); continue }
      const fila = {
        clave_turno: turno.clave, supervisor_id: turno.supervisorId, guardia_ids: turno.guardiaIds,
        turno_desde: turno.desde.toISOString(), turno_hasta: turno.hasta.toISOString(),
        destinatario_id: d.usuario_id, telefono: tel.e164, mensaje, caracteres: base.caracteres,
        resultado: excede ? 'excede_limite' : 'reclamado',
      }
      const rec = await client.rpc('reclamar_hoja_ruta_envio', { p_fila: fila })
      if (rec.error || !rec.data?.ok) {
        acciones.push({ ...base, resultado: rec.error ? 'error_rpc' : rec.data?.motivo || 'no_reclamado' })
        continue
      }
      presupuesto.registrar()
      const r = await enviarTextoMeta(tel.e164, mensaje)
      const fin = await client.rpc('completar_hoja_ruta_envio', {
        p_id: rec.data.id, p_ok: r.ok, p_id_proveedor: r.idProveedor ?? null, p_error: r.error ?? null,
        p_fuera_de_ventana: !r.ok && esFueraDeVentana24h(r.error),
      })
      if (fin.error) console.error('[hoja-de-ruta] no se pudo completar el envío', rec.data.id, fin.error.message)
      acciones.push({ ...base, resultado: r.ok ? 'enviado' : esFueraDeVentana24h(r.error) ? 'fuera_de_ventana' : 'fallido' })
    }
  }

  return NextResponse.json({
    modo, envioReal: enviar, turnos: turnos.length,
    enviados: acciones.filter(a => a.resultado === 'enviado').length, acciones,
  })
}
