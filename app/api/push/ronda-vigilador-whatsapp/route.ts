// WhatsApp de refuerzo al VIGILADOR por ronda pendiente (a +10 min del inicio).
//
// ── Separado a propósito ────────────────────────────────────────────────────
// NO comparte ruta ni lógica con el escalamiento a supervisores
// (/api/push/escalamiento-whatsapp). Tampoco toca el push, ni ronda_alertas, ni
// Cumplimiento. El push al vigilador (15' antes + "pendiente" desde el inicio)
// sigue igual; esto sólo agrega UN WhatsApp de refuerzo si a los 10 minutos del
// inicio de la ventana la ronda no arrancó.
//
// El mensaje NO ejecuta acciones: lleva a la ronda en la app (deep link) y ahí
// el vigilador inicia o suspende (con motivo). Botón URL, nunca quick-reply, así
// no genera mensajes entrantes que choquen con la IA comercial del número.
//
// ── Modo por defecto: NO ENVÍA ──────────────────────────────────────────────
// Sin `?enviar=1` corre en seco. El envío real sólo lo dispara el cron con su
// secreto; una sesión de navegador jamás produce un WhatsApp real.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import { normalizarTelefonoAr } from '@/lib/telefono-ar'
import { configuracionMeta, proveedorPorDefecto, proveedorSimulado } from '@/lib/whatsapp'
import {
  seleccionarCandidatosRondaVigilador, minutosAbs,
} from '@/lib/ronda-vigilador-wa'
import type {
  TurnoVigente, RondaBaseVig, EjecucionMin, PausaMin, ObjetivoVig,
} from '@/lib/ronda-vigilador-wa'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Sin esto la lectura de dedup/ejecuciones puede servirse del caché de Next.
export const fetchCache = 'force-no-store'
// Envíos a Meta en serie: 60 s de margen, igual criterio que las otras rutas.
export const maxDuration = 60

const TZ = 'America/Argentina/Buenos_Aires'
const NIVEL_RONDA_VIG = 'wa_ronda_pendiente_vigilador'
const PLANTILLA = process.env.WHATSAPP_PLANTILLA_RONDA_VIGILADOR || 'ronda_pendiente_vigilador'
const AVISO_MIN = Number(process.env.WHATSAPP_RONDA_VIG_AVISO_MIN || '10')
const DEEP_LINK_BASE = process.env.WHATSAPP_DEEPLINK_BASE
  || 'https://mercosur-seguridad.vercel.app/dashboard'

/** Un timestamptz → minutos absolutos en hora de la operación (misma base que minutosAbs). */
function isoALocalMin(iso?: string | null): number | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const g = (t: string) => partes.find(p => p.type === t)?.value ?? '00'
  const hh = g('hour') === '24' ? '00' : g('hour')
  return minutosAbs(`${g('year')}-${g('month')}-${g('day')}`, `${hh}:${g('minute')}`)
}

/** {fecha,hora} local de ahora, para calcular ahoraMin con la misma base. */
function ahoraLocal(d: Date): { fecha: string; hora: string } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const g = (t: string) => partes.find(p => p.type === t)?.value ?? '00'
  const hh = g('hour') === '24' ? '00' : g('hour')
  return { fecha: `${g('year')}-${g('month')}-${g('day')}`, hora: `${hh}:${g('minute')}` }
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const enviarDeVerdad = url.searchParams.get('enviar') === '1'

  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })
  const client = admin.client

  // ── Autorización (igual criterio que el escalamiento) ─────────────────────
  const secreto = process.env.push_cron_secret || process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const esCron = Boolean(secreto) && auth === `Bearer ${secreto}`
  if (!esCron) {
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token) return NextResponse.json({ error: 'Sesión requerida' }, { status: 401 })
    const { data: authData, error: authError } = await client.auth.getUser(token)
    if (authError || !authData.user) {
      return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })
    }
    const { data: usuario } = await client.from('usuarios')
      .select('id, rol, estado').eq('auth_user_id', authData.user.id).maybeSingle()
    if (!usuario || usuario.estado !== 'activo' || usuario.rol !== 'admin') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
    if (enviarDeVerdad) {
      return NextResponse.json(
        { error: 'El envío real sólo se dispara desde el cron con su secreto' },
        { status: 403 },
      )
    }
  }

  const ahora = new Date()
  const local = ahoraLocal(ahora)
  const ahoraMin = minutosAbs(local.fecha, local.hora)
  const hoy = local.fecha
  const ayer = ahoraLocal(new Date(ahora.getTime() - 86400000)).fecha

  // ── Lecturas ACOTADAS (Issue #166: nada sin filtro que pueda truncarse) ────
  // 1) Turnos de ayer/hoy con guardia y puesto (rango de fechas → chico).
  const turnosRes = await client.from('turnos')
    .select('id, guardia_id, puesto_id, objetivo_id, fecha, hora_inicio, hora_fin')
    .in('fecha', [ayer, hoy])
    .not('guardia_id', 'is', null)
    .not('puesto_id', 'is', null)
  // FAIL CLOSED también acá: si la consulta de turnos falló, `data` viene vacío y
  // sería indistinguible de "no hay turnos" → devolvería 200 sin señal. Un error
  // de la fuente base se reporta y aborta antes del early-return.
  if (turnosRes.error) {
    return NextResponse.json({
      modo: enviarDeVerdad ? 'ABORTADO_POR_ERROR_DE_FUENTE' : 'SIMULACION_CON_ERROR',
      FUENTES_CON_ERROR: [`turnos: ${turnosRes.error.message}`],
      turnosEvaluados: 0, candidatos: 0, enviados: 0, acciones: [], descartes: {},
    }, { status: enviarDeVerdad ? 502 : 200 })
  }
  const turnos = (turnosRes.data ?? []) as TurnoVigente[]

  if (turnos.length === 0) {
    return NextResponse.json({
      modo: enviarDeVerdad ? 'ENVIO_REAL' : 'SIMULACION',
      meta: configuracionMeta(), avisoMin: AVISO_MIN,
      turnos: 0, candidatos: 0, acciones: [], descartes: {},
    })
  }

  const turnoIds = Array.from(new Set(turnos.map(t => t.id)))
  const puestoIds = Array.from(new Set(turnos.map(t => t.puesto_id)))
  const objetivoIds = Array.from(new Set(turnos.map(t => t.objetivo_id)))
  const guardiaIds = Array.from(new Set(turnos.map(t => t.guardia_id)))

  // 2) rondas_base de esos puestos (bounded). Se lee primero para poder acotar
  //    ronda_puntos y ronda_pausas por sus ids (nunca sin filtro → Issue #166).
  const rondasRes = await client.from('rondas_base')
    .select('id, puesto_id, nombre, hora_inicio, intervalo_minutos, created_at, activo')
    .in('puesto_id', puestoIds).eq('activo', true)
  const rondaIdsArr = Array.from(new Set(((rondasRes.data ?? []) as any[]).map(r => r.id)))

  // 3) Resto acotado por ids.
  const [puntosRes, ejecRes, pausasRes, objRes, usuariosRes, suspRes] = await Promise.all([
    rondaIdsArr.length
      ? client.from('ronda_puntos').select('ronda_base_id').eq('activo', true).in('ronda_base_id', rondaIdsArr)
      : Promise.resolve({ data: [] as any[], error: null }),
    client.from('ronda_ejecuciones')
      .select('ronda_base_id, turno_id, iniciada_at, estado')
      .in('turno_id', turnoIds).in('estado', ['en_curso', 'finalizada']),
    rondaIdsArr.length
      ? client.from('ronda_pausas').select('ronda_base_id, pausada_at, hasta_at').eq('activa', true).in('ronda_base_id', rondaIdsArr)
      : Promise.resolve({ data: [] as any[], error: null }),
    client.from('objetivos').select('id, nombre, estado, es_prueba').in('id', objetivoIds),
    client.from('usuarios').select('id, nombre, apellido, telefono, estado').in('id', guardiaIds),
    // Suspensiones declaradas por el vigilador (no crean pausa): si hay una
    // pendiente para (ronda, turno), NO se manda WhatsApp de esa ronda.
    client.from('ronda_alertas').select('ronda_base_id, turno_id')
      .in('turno_id', turnoIds).eq('tipo', 'suspendida').eq('estado', 'pendiente'),
  ])

  const fuentesConError = [
    ['turnos', turnosRes], ['rondas_base', rondasRes], ['ronda_puntos', puntosRes],
    ['ronda_ejecuciones', ejecRes], ['ronda_pausas', pausasRes], ['objetivos', objRes],
    ['usuarios', usuariosRes], ['ronda_alertas_suspendida', suspRes],
  ].filter(([, r]: any) => r?.error).map(([n, r]: any) => `${n}: ${r.error.message}`)

  // FAIL CLOSED: si una fuente crítica falló, la foto está incompleta y podría
  // hacernos mandar por una ronda ya iniciada/suspendida (o a un objetivo que no
  // corresponde). Ante error, NO se envía nada.
  if (fuentesConError.length > 0) {
    return NextResponse.json({
      modo: enviarDeVerdad ? 'ABORTADO_POR_ERROR_DE_FUENTE' : 'SIMULACION_CON_ERROR',
      FUENTES_CON_ERROR: fuentesConError,
      turnosEvaluados: turnos.length, candidatos: 0, enviados: 0, acciones: [], descartes: {},
    }, { status: enviarDeVerdad ? 502 : 200 })
  }

  const suspendidasClaves = new Set(
    ((suspRes.data ?? []) as any[]).map(a => `${a.ronda_base_id}:${a.turno_id}`),
  )

  // ronda_puntos puede acercarse a muchas filas, pero acá sólo interesa el
  // conjunto de ronda_base con al menos un punto activo (bounded por rondas).
  const rondaIds = new Set((rondasRes.data ?? []).map((r: any) => r.id))
  const conPuntos = new Set(
    ((puntosRes.data ?? []) as any[]).map(p => p.ronda_base_id).filter(id => rondaIds.has(id)),
  )
  const rondasBase: RondaBaseVig[] = ((rondasRes.data ?? []) as any[])
    .filter(r => conPuntos.has(r.id))
    .map(r => ({
      id: r.id, puesto_id: r.puesto_id, nombre: r.nombre,
      hora_inicio: r.hora_inicio, intervalo_minutos: r.intervalo_minutos,
    }))

  const rondaCreadaMin: Record<string, number> = {}
  for (const r of (rondasRes.data ?? []) as any[]) {
    const m = isoALocalMin(r.created_at)
    if (m != null) rondaCreadaMin[r.id] = m
  }

  const ejecuciones: EjecucionMin[] = ((ejecRes.data ?? []) as any[])
    .map(e => ({ ronda_base_id: e.ronda_base_id, turno_id: e.turno_id, iniciadaMin: isoALocalMin(e.iniciada_at) }))
    .filter(e => e.iniciadaMin != null) as EjecucionMin[]

  const pausas: PausaMin[] = ((pausasRes.data ?? []) as any[])
    .map(p => ({ ronda_base_id: p.ronda_base_id, desdeMin: isoALocalMin(p.pausada_at), hastaMin: isoALocalMin(p.hasta_at) }))
    .filter(p => p.desdeMin != null) as PausaMin[]

  const objetivos = (objRes.data ?? []) as ObjetivoVig[]
  const usuarios = (usuariosRes.data ?? []) as any[]
  const userDe = (id: string) => usuarios.find(u => u.id === id)

  // ── Selección pura de candidatos a +10 min ────────────────────────────────
  const candidatos = seleccionarCandidatosRondaVigilador({
    ahoraMin, turnosVigentes: turnos, rondasBase, ejecuciones, pausas, objetivos,
    avisoMin: AVISO_MIN, rondaCreadaMin, suspendidasClaves,
  })

  const descartes: Record<string, number> = {}
  const acciones: any[] = []
  const filasAuditoria: any[] = []

  const proveedor = enviarDeVerdad ? proveedorPorDefecto() : proveedorSimulado()

  // En dry-run no se reclama nada: sólo se lee qué claves ya están avisadas para
  // reportarlas. En envío real la deduplicación es ATÓMICA (ver abajo).
  const yaAvisadosDry = new Set<string>()
  if (!enviarDeVerdad && candidatos.length > 0) {
    const enviadosRes = await client.from('notificaciones_enviadas')
      .select('tipo').in('tipo', candidatos.map(c => c.clave_dedup))
    for (const n of (enviadosRes.data ?? []) as any[]) yaAvisadosDry.add(n.tipo)
  }

  for (const c of candidatos) {
    const u = userDe(c.guardia_id)
    if (!u || u.estado !== 'activo') { descartes.vigilador_invalido = (descartes.vigilador_invalido ?? 0) + 1; continue }

    const tel = normalizarTelefonoAr(u.telefono)
    if (!tel.e164) {
      // No se reclama la clave: si más tarde carga el teléfono, el próximo ciclo
      // dentro de la misma ventana todavía puede avisar.
      const clave = tel.motivo === 'vacio' ? 'sin_telefono' : 'telefono_invalido'
      descartes[clave] = (descartes[clave] ?? 0) + 1
      acciones.push({
        ronda: c.ronda_nombre, objetivo: c.objetivo_nombre,
        vigilador: `${u.apellido}, ${u.nombre}`,
        descartado: tel.motivo === 'vacio' ? 'SIN_TELEFONO' : 'TELEFONO_INVALIDO',
      })
      continue
    }

    const urlSuffix = `ronda=${c.ronda_base_id}&turno=${c.turno_id}&objetivo=${c.objetivo_id}&ventana=${c.ventana_inicio_min}`

    if (!enviarDeVerdad || !proveedor.configurado) {
      if (yaAvisadosDry.has(c.clave_dedup)) { descartes.ya_avisada = (descartes.ya_avisada ?? 0) + 1; continue }
      acciones.push({
        ronda: c.ronda_nombre, objetivo: c.objetivo_nombre, horario: c.horario,
        vigilador: `${u.apellido}, ${u.nombre}`, telefono: tel.e164,
        plantilla: PLANTILLA, deepLink: `${DEEP_LINK_BASE}?${urlSuffix}`, enviaria: true,
      })
      continue
    }

    // ── Deduplicación ATÓMICA (claim-first) ──────────────────────────────────
    // Insertar la fila de dedup ANTES de enviar. La constraint única
    // (usuario_id, turno_id, tipo) hace que dos corridas simultáneas del cron no
    // puedan reclamar la misma ventana: la segunda choca (23505) y se saltea.
    // Un select-then-insert no alcanzaría porque ambas leerían "no enviado".
    const claim = await client.from('notificaciones_enviadas')
      .insert({ usuario_id: c.guardia_id, turno_id: c.turno_id, tipo: c.clave_dedup })
    if (claim.error) {
      // 23505 = ya reclamada por otra corrida / ya enviada. Cualquier otro error
      // de escritura: no arriesgamos un doble envío, se saltea.
      descartes.ya_avisada = (descartes.ya_avisada ?? 0) + 1
      continue
    }

    const r = await proveedor.enviar({
      telefono: tel.e164, plantilla: PLANTILLA,
      variables: [c.objetivo_nombre, c.ronda_nombre, c.horario],
      boton: { urlSuffix },
    })
    acciones.push({
      ronda: c.ronda_nombre, objetivo: c.objetivo_nombre,
      vigilador: `${u.apellido}, ${u.nombre}`, telefono: tel.e164,
      ok: r.ok, error: r.error, idProveedor: r.idProveedor,
    })
    filasAuditoria.push({
      turno_id: c.turno_id, objetivo_id: c.objetivo_id, guardia_id: c.guardia_id,
      nivel: NIVEL_RONDA_VIG, destinatario_id: c.guardia_id, telefono: tel.e164,
      plantilla: PLANTILLA, resultado: r.ok ? 'enviado' : 'fallido',
      id_proveedor: r.idProveedor, proveedor: proveedor.nombre, error: r.error,
    })

    // Si el proveedor rechazó, se LIBERA la reserva para que la próxima corrida
    // reintente (mismo criterio de reintento que el resto del canal).
    if (!r.ok) {
      await client.from('notificaciones_enviadas')
        .delete().eq('usuario_id', c.guardia_id).eq('turno_id', c.turno_id).eq('tipo', c.clave_dedup)
        .then(() => {}, () => {})
    }
  }

  if (enviarDeVerdad && filasAuditoria.length > 0) {
    await client.from('escalamiento_whatsapp_envios').insert(filasAuditoria)
      .then(() => {}, (e: any) => console.error('[ronda-vig] auditoría', e?.message))
  }

  return NextResponse.json({
    modo: enviarDeVerdad ? (proveedor.configurado ? 'ENVIO_REAL' : 'SIN_PROVEEDOR_NO_ENVIA') : 'SIMULACION',
    meta: configuracionMeta(),
    avisoMin: AVISO_MIN,
    ...(fuentesConError.length > 0 ? { FUENTES_CON_ERROR: fuentesConError } : {}),
    proveedor: proveedor.nombre,
    turnosEvaluados: turnos.length,
    candidatos: candidatos.length,
    enviados: acciones.filter(a => a.enviaria || a.ok).length,
    descartes,
    acciones,
  })
}
