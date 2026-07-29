import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import { sendWebPush, type PushPayload, type PushSubscriptionRow } from '../../_lib/web-push'

export const runtime = 'nodejs'

type TurnoPush = {
  id: string
  guardia_id: string | null
  guardia_original_id: string | null
  objetivo_id: string
  puesto_id: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado: string
}

type UsuarioPush = {
  id: string
  nombre: string
  apellido: string
  rol: string
  estado: string
}

type ObjetivoPush = {
  id: string
  nombre: string
}

type RegistroPush = {
  id: string
  turno_id: string
  guardia_id: string
  hora_entrada_real?: string | null
  alerta_entrada?: string | null
  distancia_ingreso_metros?: number | string | null
  gps_ingreso_estado?: string | null
  created_at?: string | null
}

type SupervisorIntervencionPush = {
  id: string
  turno_id: string
  registro_asistencia_id?: string | null
  tipo_alerta?: string | null
  accion?: string | null
  created_at?: string | null
}

type ObjetivoSupervisionPush = {
  id: string
  nombre: string
  estado?: string | null
  zona_id?: string | null
  frecuencia_supervision_horas?: number | null
}

type ZonaOperativaPush = {
  id: string
  nombre: string
}

type SupervisorZonaPush = {
  supervisor_id: string
  zona_id: string
}

type SupervisionUltimaPush = {
  objetivo_id: string
  created_at: string
}

const TZ = 'America/Argentina/Buenos_Aires'
const SUPERVISOR_ROLES = ['supervisor', 'admin']
const SUPERVISORES_DIURNOS = [
  { nombre: 'Sabino', apellido: 'Aranda' },
  { nombre: 'Sergio', apellido: 'Martínez' },
]
const SUPERVISORES_NOCTURNOS = [
  { nombre: 'Walter', apellido: 'Fulla' },
]
const SUPERVISOR_ALERT_TYPES = {
  tardanza: 'supervisor_tardanza',
  sinFichaje: 'supervisor_sin_fichaje',
  fueraRadio: 'supervisor_fuera_radio',
  puestoDescubierto: 'supervisor_puesto_descubierto',
} as const

// Alertas de supervisiones (vencida / proxima a vencer) por objetivo,
// ruteadas por zona via objetivos.zona_id -> supervisor_zonas. No usan
// turno_id: se deduplican por objetivo_id + tipo (ver migracion
// 20260629_notificaciones_objetivo.sql).
const SUPERVISION_ALERT_TYPES = {
  vencida: 'supervisor_supervision_vencida',
  proxima: 'supervisor_supervision_proxima',
} as const
const SUPERVISION_PROXIMA_PORCENTAJE = 0.25
const FRECUENCIA_SUPERVISION_DEFECTO_HORAS = 24

function localParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value)

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  }
}

function fechaLocal(date = new Date()) {
  const parts = localParts(date)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

function sumarDias(fecha: string, dias: number) {
  const [year, month, day] = fecha.slice(0, 10).split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + dias))
  return date.toISOString().slice(0, 10)
}

function fechaHoraMinutos(fecha: string, hora: string) {
  const [year, month, day] = fecha.slice(0, 10).split('-').map(Number)
  const [hours, minutes] = hora.split(':').map(Number)
  return Date.UTC(year, month - 1, day, hours, minutes) / 60000
}

function ahoraMinutosLocal() {
  const parts = localParts()
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) / 60000
}

function nombreUsuario(usuario?: UsuarioPush | null) {
  return usuario ? `${usuario.apellido}, ${usuario.nombre}` : 'Guardia sin asignar'
}

function horaCorta(hora?: string | null) {
  if (!hora) return '--:--'
  return /^\d{1,2}:\d{2}/.test(hora) ? hora.slice(0, 5) : hora
}

function minutosHora(hora?: string | null) {
  if (!hora) return null
  const [hours, minutes] = hora.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return hours * 60 + minutes
}

function turnoEsDiurno(turno: TurnoPush) {
  const inicio = minutosHora(turno.hora_inicio)
  if (inicio === null) return false
  return inicio >= 6 * 60 && inicio < 18 * 60
}

function normalizarTexto(value?: string | null) {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
}

function coincideSupervisor(usuario: UsuarioPush, esperado: { nombre: string, apellido: string }) {
  const nombre = normalizarTexto(usuario.nombre)
  const apellido = normalizarTexto(usuario.apellido)
  const esperadoNombre = normalizarTexto(esperado.nombre)
  const esperadoApellido = normalizarTexto(esperado.apellido)
  const nombreCompleto = normalizarTexto(`${usuario.nombre} ${usuario.apellido}`)
  const apellidoNombre = normalizarTexto(`${usuario.apellido} ${usuario.nombre}`)
  const esperadoCompleto = normalizarTexto(`${esperado.nombre} ${esperado.apellido}`)
  const esperadoInvertido = normalizarTexto(`${esperado.apellido} ${esperado.nombre}`)

  return (
    nombre === esperadoNombre && apellido === esperadoApellido
  ) || nombreCompleto.includes(esperadoCompleto) || nombreCompleto.includes(esperadoInvertido) || apellidoNombre.includes(esperadoCompleto) || apellidoNombre.includes(esperadoInvertido)
}

function supervisoresAsignados(turno: TurnoPush, usuarios: UsuarioPush[]) {
  const esperados = turnoEsDiurno(turno) ? SUPERVISORES_DIURNOS : SUPERVISORES_NOCTURNOS
  return usuarios
    .filter(usuario => SUPERVISOR_ROLES.includes(usuario.rol))
    .filter(usuario => esperados.some(esperado => coincideSupervisor(usuario, esperado)))
    .map(usuario => usuario.id)
}

function minutosTarde(turno: TurnoPush, registro?: RegistroPush | null) {
  const inicio = minutosHora(turno.hora_inicio)
  let entrada = minutosHora(registro?.hora_entrada_real)
  if (inicio === null || entrada === null) return 0

  if (entrada < inicio && inicio >= 18 * 60) entrada += 24 * 60
  return Math.max(0, entrada - inicio)
}

function esTardanza(turno: TurnoPush, registro?: RegistroPush | null) {
  return Boolean(registro?.hora_entrada_real && (registro.alerta_entrada === 'tarde' || minutosTarde(turno, registro) > 5))
}

function distanciaTexto(value?: number | string | null) {
  const distancia = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(distancia) ? `${Math.round(distancia).toLocaleString('es-AR')} m` : 'sin distancia'
}

function supervisorBody(turno: TurnoPush, guardia: UsuarioPush | undefined | null, objetivoNombre: string, real?: string | null, extra?: string) {
  const partes = [
    `Guardia: ${nombreUsuario(guardia)}`,
    `Objetivo: ${objetivoNombre}`,
    `Programado: ${horaCorta(turno.hora_inicio)}`,
    `Real: ${horaCorta(real)}`,
  ]

  if (extra) partes.push(extra)
  return partes.join(' · ')
}

function minutosDesdeISO(value?: string | null) {
  if (!value) return Number.POSITIVE_INFINITY
  return Math.floor((Date.now() - new Date(value).getTime()) / 60000)
}

function accionNormalizada(accion?: string | null) {
  return accion === 'marcado_cubierto_manual' ? 'confirmar_cubierto' : accion || ''
}

function accionResuelveAlerta(accion?: string | null) {
  return ['confirmar_cubierto', 'reasignacion', 'marcado_descubierto', 'alerta_revisada'].includes(accionNormalizada(accion))
}

function tipoIntervencionDesdePush(tipo: string) {
  if (tipo === SUPERVISOR_ALERT_TYPES.sinFichaje) return 'sin_fichar'
  if (tipo === SUPERVISOR_ALERT_TYPES.tardanza) return 'tardanza'
  if (tipo === SUPERVISOR_ALERT_TYPES.fueraRadio) return 'fuera_radio'
  if (tipo === SUPERVISOR_ALERT_TYPES.puestoDescubierto) return 'descubierto'
  return tipo
}

function alertaResueltaPorIntervencion(
  intervenciones: SupervisorIntervencionPush[],
  turnoId: string,
  tipoPush: string,
  registroId?: string | null,
) {
  const tipoAlerta = tipoIntervencionDesdePush(tipoPush)

  return intervenciones.some(intervencion =>
    intervencion.turno_id === turnoId &&
    intervencion.tipo_alerta === tipoAlerta &&
    accionResuelveAlerta(intervencion.accion) &&
    (!registroId || !intervencion.registro_asistencia_id || intervencion.registro_asistencia_id === registroId)
  )
}

function turnoFueReasignado(turno: TurnoPush) {
  return Boolean(turno.guardia_original_id && turno.guardia_id && turno.guardia_original_id !== turno.guardia_id)
}

function authOk(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) return { ok: false, error: 'Falta CRON_SECRET' }
  const header = req.headers.get('authorization') || ''
  return header === `Bearer ${expected}`
    ? { ok: true }
    : { ok: false, error: 'Cron no autorizado' }
}

async function notificationAlreadySent(client: any, usuarioId: string, turnoId: string, tipo: string) {
  const { data, error } = await client
    .from('notificaciones_enviadas')
    .select('id')
    .eq('usuario_id', usuarioId)
    .eq('turno_id', turnoId)
    .eq('tipo', tipo)
    .maybeSingle()

  if (error) throw error
  return Boolean(data)
}

async function markNotificationSent(client: any, usuarioId: string, turnoId: string, tipo: string, payload: PushPayload) {
  const { error } = await client
    .from('notificaciones_enviadas')
    .insert({
      usuario_id: usuarioId,
      turno_id: turnoId,
      tipo,
      titulo: payload.title,
      mensaje: payload.body,
    })

  if (error && !/duplicate key|notificaciones_enviadas_usuario_turno_tipo_key/i.test(error.message)) throw error
}

async function sendToUsers(
  client: any,
  subscriptions: PushSubscriptionRow[],
  usuarioIds: string[],
  turnoId: string,
  tipo: string,
  payload: PushPayload,
) {
  let sent = 0
  let skipped = 0
  const usuariosUnicos = Array.from(new Set(usuarioIds.filter(Boolean)))

  for (const usuarioId of usuariosUnicos) {
    if (await notificationAlreadySent(client, usuarioId, turnoId, tipo)) {
      skipped += 1
      continue
    }

    const userSubscriptions = subscriptions.filter(subscription => subscription.usuario_id === usuarioId)
    if (userSubscriptions.length === 0) {
      skipped += 1
      continue
    }

    for (const subscription of userSubscriptions) {
      const response = await sendWebPush(subscription, payload)
      if (response.status === 404 || response.status === 410) {
        await client.from('push_subscriptions').update({ activo: false }).eq('id', subscription.id)
      }
    }

    await markNotificationSent(client, usuarioId, turnoId, tipo, payload)
    sent += 1
  }

  return { sent, skipped }
}

async function notificationAlreadySentObjetivo(client: any, usuarioId: string, objetivoId: string, tipo: string) {
  const { data, error } = await client
    .from('notificaciones_enviadas')
    .select('id')
    .eq('usuario_id', usuarioId)
    .eq('objetivo_id', objetivoId)
    .eq('tipo', tipo)
    .maybeSingle()

  if (error) throw error
  return Boolean(data)
}

async function markNotificationSentObjetivo(client: any, usuarioId: string, objetivoId: string, tipo: string, payload: PushPayload) {
  const { error } = await client
    .from('notificaciones_enviadas')
    .insert({
      usuario_id: usuarioId,
      objetivo_id: objetivoId,
      turno_id: null,
      tipo,
      titulo: payload.title,
      mensaje: payload.body,
    })

  if (error && !/duplicate key|notificaciones_enviadas_usuario_objetivo_tipo_key/i.test(error.message)) throw error
}

async function sendToUsersObjetivo(
  client: any,
  subscriptions: PushSubscriptionRow[],
  usuarioIds: string[],
  objetivoId: string,
  tipo: string,
  payload: PushPayload,
) {
  let sent = 0
  let skipped = 0
  const usuariosUnicos = Array.from(new Set(usuarioIds.filter(Boolean)))

  for (const usuarioId of usuariosUnicos) {
    if (await notificationAlreadySentObjetivo(client, usuarioId, objetivoId, tipo)) {
      skipped += 1
      continue
    }

    const userSubscriptions = subscriptions.filter(subscription => subscription.usuario_id === usuarioId)
    if (userSubscriptions.length === 0) {
      skipped += 1
      continue
    }

    for (const subscription of userSubscriptions) {
      const response = await sendWebPush(subscription, payload)
      if (response.status === 404 || response.status === 410) {
        await client.from('push_subscriptions').update({ activo: false }).eq('id', subscription.id)
      }
    }

    await markNotificationSentObjetivo(client, usuarioId, objetivoId, tipo, payload)
    sent += 1
  }

  return { sent, skipped }
}

function supervisoresDeZona(zonaId: string | null | undefined, supervisorZonas: SupervisorZonaPush[], usuarios: UsuarioPush[]) {
  if (!zonaId) return []
  const supervisorIds = new Set(
    supervisorZonas.filter(sz => sz.zona_id === zonaId).map(sz => sz.supervisor_id),
  )

  return usuarios
    .filter(usuario => usuario.rol === 'supervisor' && supervisorIds.has(usuario.id))
    .map(usuario => usuario.id)
}

// Alertas de rondas: persistidas por evaluar_ronda_alertas(); acá solo se
// enrutan por zona y se envían con dedup por (usuario, objetivo, tipo), donde el
// tipo embebe el id de la alerta → una notificación por alerta y supervisor.
type RondaAlertaPush = {
  id: string
  tipo: string
  objetivo_id: string
  guardia_id: string
  ronda: { nombre: string } | { nombre: string }[] | null
  puesto: { nombre: string } | { nombre: string }[] | null
}

function nombreEmbebido(v: { nombre: string } | { nombre: string }[] | null | undefined): string {
  if (!v) return ''
  if (Array.isArray(v)) return v[0]?.nombre ?? ''
  return v.nombre ?? ''
}

// Minutos locales (misma base que fechaHoraMinutos) del inicio de una ejecución.
function isoALocalMin(iso: string): number {
  const p = localParts(new Date(iso))
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) / 60000
}

// HH:MM de un valor en "minutos locales" (base Date.UTC de componentes locales).
function horaDeMin(min: number): string {
  const d = new Date(min * 60000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

export async function GET(req: NextRequest) {
  const auth = authOk(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.error === 'Falta CRON_SECRET' ? 500 : 401 })

  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  // Cerrar turnos que finalizaron sin salida registrada
  let cierreAutomatico: { registros_cerrados: number; detalle: string } | null = null
  try {
    const { data: cierreData, error: cierreError } = await admin.client.rpc('cerrar_turnos_abiertos')
    if (cierreError) {
      console.error('[cron] cerrar_turnos_abiertos error:', cierreError.message)
    } else if (cierreData && (cierreData as any[]).length > 0) {
      cierreAutomatico = (cierreData as any[])[0]
      if (cierreAutomatico && cierreAutomatico.registros_cerrados > 0) {
        console.log('[cron] cierre automático:', cierreAutomatico.detalle)
      }
    }
  } catch (e) {
    console.error('[cron] cerrar_turnos_abiertos excepción:', e)
  }

  const hoy = fechaLocal()
  const ayer = sumarDias(hoy, -1)
  const manana = sumarDias(hoy, 1)
  const ahora = ahoraMinutosLocal()
  const desdeReciente = new Date(Date.now() - 15 * 60000).toISOString()

  const [
    { data: turnosData, error: turnosError },
    { data: usuariosData, error: usuariosError },
    { data: objetivosData, error: objetivosError },
    { data: subscriptionsData, error: subscriptionsError },
    zonasResult,
    supervisorZonasResult,
    ultimasSupervisionesResult,
  ] = await Promise.all([
    admin.client
      .from('turnos')
      .select('id, guardia_id, guardia_original_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin, estado')
      .in('fecha', [ayer, hoy, manana]),
    admin.client
      .from('usuarios')
      .select('id, nombre, apellido, rol, estado')
      .eq('estado', 'activo'),
    admin.client
      .from('objetivos')
      .select('id, nombre, estado, zona_id, frecuencia_supervision_horas'),
    admin.client
      .from('push_subscriptions')
      .select('id, usuario_id, endpoint, p256dh, auth')
      .eq('activo', true),
    admin.client
      .from('zonas_operativas')
      .select('id, nombre'),
    admin.client
      .from('supervisor_zonas')
      .select('supervisor_id, zona_id'),
    admin.client
      .from('supervisiones')
      .select('objetivo_id, created_at')
      .order('created_at', { ascending: false }),
  ])

  if (turnosError || usuariosError || objetivosError || subscriptionsError) {
    return NextResponse.json({ error: turnosError?.message || usuariosError?.message || objetivosError?.message || subscriptionsError?.message }, { status: 500 })
  }

  const zonasErrorIgnorable = zonasResult.error && /zonas_operativas|schema cache|does not exist/i.test(zonasResult.error.message)
  const supervisorZonasErrorIgnorable = supervisorZonasResult.error && /supervisor_zonas|schema cache|does not exist/i.test(supervisorZonasResult.error.message)
  const ultimasSupervisionesErrorIgnorable = ultimasSupervisionesResult.error && /supervisiones|schema cache|does not exist/i.test(ultimasSupervisionesResult.error.message)

  if ((zonasResult.error && !zonasErrorIgnorable) || (supervisorZonasResult.error && !supervisorZonasErrorIgnorable) || (ultimasSupervisionesResult.error && !ultimasSupervisionesErrorIgnorable)) {
    return NextResponse.json({ error: zonasResult.error?.message || supervisorZonasResult.error?.message || ultimasSupervisionesResult.error?.message }, { status: 500 })
  }

  const turnos = (turnosData || []) as TurnoPush[]
  const usuarios = (usuariosData || []) as UsuarioPush[]
  const objetivos = (objetivosData || []) as ObjetivoPush[]
  const objetivosSupervision = (objetivosData || []) as ObjetivoSupervisionPush[]
  const subscriptions = (subscriptionsData || []) as PushSubscriptionRow[]
  const zonasOperativas = (zonasErrorIgnorable ? [] : (zonasResult.data || [])) as ZonaOperativaPush[]
  const supervisorZonas = (supervisorZonasErrorIgnorable ? [] : (supervisorZonasResult.data || [])) as SupervisorZonaPush[]
  const ultimasSupervisiones = (ultimasSupervisionesErrorIgnorable ? [] : (ultimasSupervisionesResult.data || [])) as SupervisionUltimaPush[]
  const turnoIds = turnos.map(turno => turno.id)

  const turnosProcesados = turnos.length
  let candidatos30 = 0
  let candidatos15 = 0
  let candidatosSupervisorTardanza = 0
  let candidatosSupervisorSinFichaje = 0
  let candidatosSupervisorFueraRadio = 0
  let candidatosSupervisorPuestoDescubierto = 0
  let alertasEvaluadas = 0
  let alertasOmitidasPorResueltas = 0
  let alertasEnviadas = 0
  let sent = 0
  let skipped = 0
  let candidatosSupervisionVencida = 0
  let candidatosSupervisionProxima = 0
  let objetivosSinZonaOSinSupervisores = 0

  const sumarResultado = (resultado: { sent: number, skipped: number }) => {
    sent += resultado.sent
    skipped += resultado.skipped
  }

  // ── Alertas de supervisiones por zona (vencida / proxima a vencer) ──
  // Independiente de si hay turnos hoy/manana: se evalua siempre.
  const ultimaPorObjetivo = new Map<string, string>()
  ultimasSupervisiones.forEach(s => {
    if (!ultimaPorObjetivo.has(s.objetivo_id)) ultimaPorObjetivo.set(s.objetivo_id, s.created_at)
  })

  for (const objetivo of objetivosSupervision) {
    if ((objetivo.estado || 'activo') !== 'activo') continue

    const frecuenciaHoras = objetivo.frecuencia_supervision_horas || FRECUENCIA_SUPERVISION_DEFECTO_HORAS
    const ultimaIso = ultimaPorObjetivo.get(objetivo.id) || null
    const horasDesdeUltima = ultimaIso ? (Date.now() - new Date(ultimaIso).getTime()) / 3600000 : null
    const horasFaltantes = horasDesdeUltima === null ? -Infinity : frecuenciaHoras - horasDesdeUltima
    const estadoAgenda: 'vencido' | 'proximo' | 'al_dia' = !ultimaIso || horasFaltantes < 0
      ? 'vencido'
      : horasFaltantes <= frecuenciaHoras * SUPERVISION_PROXIMA_PORCENTAJE
        ? 'proximo'
        : 'al_dia'

    if (estadoAgenda === 'al_dia') continue

    if (!objetivo.zona_id) {
      console.warn(`[cron-push] Objetivo "${objetivo.nombre}" (${objetivo.id}) esta ${estadoAgenda} pero no tiene zona_id asignado. No se puede enrutar la alerta.`)
      objetivosSinZonaOSinSupervisores += 1
      continue
    }

    const supervisorIds = supervisoresDeZona(objetivo.zona_id, supervisorZonas, usuarios)
    if (supervisorIds.length === 0) {
      const zonaNombre = zonasOperativas.find(z => z.id === objetivo.zona_id)?.nombre || objetivo.zona_id
      console.warn(`[cron-push] Objetivo "${objetivo.nombre}" (${objetivo.id}) esta ${estadoAgenda} pero la zona "${zonaNombre}" no tiene supervisores asignados en supervisor_zonas.`)
      objetivosSinZonaOSinSupervisores += 1
      continue
    }

    // Cicla la clave de dedup con la ultima supervision conocida: cuando se
    // registre una supervision nueva, el ciclo cambia y se vuelve a poder
    // alertar para el proximo vencimiento. Mientras no haya supervision
    // nueva, no se reenvia la misma alerta (deduplicacion mantenida).
    const ciclo = ultimaIso || 'nunca'
    const zonaNombre = zonasOperativas.find(z => z.id === objetivo.zona_id)?.nombre || 'Zona sin nombre'

    if (estadoAgenda === 'vencido') {
      candidatosSupervisionVencida += 1
      const detalle = ultimaIso ? `Vencida desde hace ${Math.round(horasDesdeUltima as number)} h` : 'Sin supervision registrada'
      const resultado = await sendToUsersObjetivo(
        admin.client,
        subscriptions,
        supervisorIds,
        objetivo.id,
        `${SUPERVISION_ALERT_TYPES.vencida}:${ciclo}`,
        {
          title: 'Supervisión vencida',
          body: `Objetivo: ${objetivo.nombre} · Zona: ${zonaNombre} · ${detalle}`,
          url: '/dashboard',
          tag: `objetivo-${objetivo.id}-supervision-vencida`,
        },
      )
      sumarResultado(resultado)
      alertasEnviadas += resultado.sent
    } else {
      candidatosSupervisionProxima += 1
      const resultado = await sendToUsersObjetivo(
        admin.client,
        subscriptions,
        supervisorIds,
        objetivo.id,
        `${SUPERVISION_ALERT_TYPES.proxima}:${ciclo}`,
        {
          title: 'Supervisión próxima a vencer',
          body: `Objetivo: ${objetivo.nombre} · Zona: ${zonaNombre} · Quedan ${Math.max(0, Math.round(horasFaltantes))} h`,
          url: '/dashboard',
          tag: `objetivo-${objetivo.id}-supervision-proxima`,
        },
      )
      sumarResultado(resultado)
      alertasEnviadas += resultado.sent
    }
  }

  // ── Alertas de RONDAS (no iniciada / no finalizada) ──────────────────────────
  // Independiente de si hay turnos hoy: una alerta puede corresponder a un turno
  // de ayer. Detecta (idempotente) y rutea por zona reutilizando supervisor_zonas.
  let rondaAlertasPendientes = 0
  let candidatosRondaNoIniciada = 0
  let candidatosRondaNoFinalizada = 0
  let rondaAlertasSinSupervisores = 0

  try {
    const { error: evalError } = await admin.client.rpc('evaluar_ronda_alertas')
    if (evalError && !/evaluar_ronda_alertas|schema cache|does not exist/i.test(evalError.message)) {
      console.error('[cron] evaluar_ronda_alertas error:', evalError.message)
    }
  } catch (e) {
    console.error('[cron] evaluar_ronda_alertas excepción:', e)
  }

  const { data: rondaAlertasData, error: rondaAlertasError } = await admin.client
    .from('ronda_alertas')
    .select('id, tipo, objetivo_id, guardia_id, ronda:rondas_base(nombre), puesto:puestos(nombre)')
    .eq('estado', 'pendiente')

  const rondaAlertasErrorIgnorable = rondaAlertasError && /ronda_alertas|schema cache|does not exist/i.test(rondaAlertasError.message)
  if (rondaAlertasError && !rondaAlertasErrorIgnorable) {
    console.error('[cron] lectura ronda_alertas error:', rondaAlertasError.message)
  }

  const zonaPorObjetivo = new Map<string, string | null>()
  objetivosSupervision.forEach(o => zonaPorObjetivo.set(o.id, o.zona_id ?? null))
  const nombrePorObjetivo = new Map<string, string>()
  objetivos.forEach(o => nombrePorObjetivo.set(o.id, o.nombre))

  const rondaAlertas = (rondaAlertasErrorIgnorable ? [] : (rondaAlertasData || [])) as RondaAlertaPush[]
  rondaAlertasPendientes = rondaAlertas.length

  for (const alerta of rondaAlertas) {
    const zonaId = zonaPorObjetivo.get(alerta.objetivo_id) ?? null
    const supervisorIds = supervisoresDeZona(zonaId, supervisorZonas, usuarios)
    if (supervisorIds.length === 0) {
      rondaAlertasSinSupervisores += 1
      continue
    }

    const esNoIniciada = alerta.tipo === 'no_iniciada'
    if (esNoIniciada) candidatosRondaNoIniciada += 1
    else candidatosRondaNoFinalizada += 1

    const guardia = usuarios.find(u => u.id === alerta.guardia_id)
    const rondaNombre = nombreEmbebido(alerta.ronda) || 'Ronda'
    const puestoNombre = nombreEmbebido(alerta.puesto) || 'Puesto'
    const objetivoNombre = nombrePorObjetivo.get(alerta.objetivo_id) || 'Objetivo'

    const resultado = await sendToUsersObjetivo(
      admin.client,
      subscriptions,
      supervisorIds,
      alerta.objetivo_id,
      `supervisor_ronda_${alerta.tipo}:${alerta.id}`,
      {
        title: esNoIniciada ? 'Ronda no iniciada' : 'Ronda sin finalizar',
        body: `Ronda: ${rondaNombre} · Puesto: ${puestoNombre} · Objetivo: ${objetivoNombre} · Vigilador: ${nombreUsuario(guardia)}`,
        url: '/dashboard',
        tag: `ronda-alerta-${alerta.id}`,
      },
    )
    sumarResultado(resultado)
    alertasEnviadas += resultado.sent
  }

  // ── Recordatorios de ronda al VIGILADOR (15' antes / pendiente) ──────────────
  // Solo al vigilador del turno vigente, con suscripción activa. NO crea
  // ronda_alertas. Dedup por (usuario, turno, tipo) con tipo = aviso:ronda:ventana.
  let avisos15m = 0
  let avisosPendiente = 0
  {
    // Una ronda hecha unos minutos ANTES del inicio de la ventana cuenta como
    // realizada para esa ventana: evita seguir avisando algo ya cumplido.
    const RONDA_AVISO_GRACIA_MIN = 20
    const turnosVigentes = turnos.filter(t => {
      if (!t.guardia_id || !t.puesto_id) return false
      const ini = fechaHoraMinutos(t.fecha, t.hora_inicio)
      const nocturno = (minutosHora(t.hora_fin) ?? 0) <= (minutosHora(t.hora_inicio) ?? 0)
      const fin = fechaHoraMinutos(t.fecha, t.hora_fin) + (nocturno ? 1440 : 0)
      return ahora >= ini && ahora <= fin
    })

    if (turnosVigentes.length > 0) {
      const puestoIds = Array.from(new Set(turnosVigentes.map(t => t.puesto_id).filter(Boolean)))
      const turnoIdsVig = turnosVigentes.map(t => t.id)

      const [rondasVigRes, ejecVigRes] = await Promise.all([
        admin.client.from('rondas_base')
          .select('id, puesto_id, nombre, hora_inicio, intervalo_minutos')
          .in('puesto_id', puestoIds as string[]).eq('activo', true),
        admin.client.from('ronda_ejecuciones')
          .select('ronda_base_id, turno_id, iniciada_at, estado')
          .in('turno_id', turnoIdsVig).in('estado', ['en_curso', 'finalizada']),
      ])

      const rondasVig = (rondasVigRes.data || []) as Array<{ id: string; puesto_id: string; nombre: string; hora_inicio: string | null; intervalo_minutos: number }>
      const ejecMin = ((ejecVigRes.data || []) as Array<{ ronda_base_id: string; turno_id: string; iniciada_at: string }>)
        .map(e => ({ ...e, ini_min: isoALocalMin(e.iniciada_at) }))

      for (const t of turnosVigentes) {
        const tIni = fechaHoraMinutos(t.fecha, t.hora_inicio)
        const nocturno = (minutosHora(t.hora_fin) ?? 0) <= (minutosHora(t.hora_inicio) ?? 0)
        const tFin = fechaHoraMinutos(t.fecha, t.hora_fin) + (nocturno ? 1440 : 0)

        for (const rb of rondasVig.filter(r => r.puesto_id === t.puesto_id)) {
          const interv = rb.intervalo_minutos
          if (!interv || interv <= 0) continue

          let base = rb.hora_inicio ? fechaHoraMinutos(t.fecha, rb.hora_inicio) : tIni
          while (base < tIni) base += 1440

          for (let n = 0; n <= 10000; n++) {
            const vi = base + n * interv
            if (vi >= tFin) break
            const vf = Math.min(vi + interv, tFin)

            const yaIniciada = ejecMin.some(e =>
              e.ronda_base_id === rb.id && e.turno_id === t.id
              && e.ini_min >= vi - RONDA_AVISO_GRACIA_MIN && e.ini_min < vi + interv)
            if (yaIniciada) continue

            const clave = `${rb.id}:${vi}`
            const horaVentana = horaDeMin(vi)
            const url = `/dashboard?ronda=${rb.id}&turno=${t.id}&objetivo=${t.objetivo_id}&ventana=${vi}`

            if (ahora >= vi - 15 && ahora < vi) {
              const r = await sendToUsers(admin.client, subscriptions, [t.guardia_id as string], t.id,
                `ronda_recordatorio_15m:${clave}`, {
                  title: 'Próxima ronda',
                  body: `La ronda ${rb.nombre} está programada para las ${horaVentana}.`,
                  url,
                  tag: `ronda-aviso-15m-${clave}`,
                })
              sumarResultado(r); avisos15m += r.sent
            } else if (ahora >= vi && ahora < vf) {
              const r = await sendToUsers(admin.client, subscriptions, [t.guardia_id as string], t.id,
                `ronda_pendiente:${clave}`, {
                  title: 'Ronda pendiente',
                  body: `Ya corresponde realizar la ronda ${rb.nombre} de las ${horaVentana}.`,
                  url,
                  tag: `ronda-aviso-pend-${clave}`,
                })
              sumarResultado(r); avisosPendiente += r.sent
            }
          }
        }
      }
    }
  }

  if (turnoIds.length === 0) {
    return NextResponse.json({
      ok: true,
      turnosProcesados: 0,
      candidatos30: 0,
      candidatos15: 0,
      alertasSupervisor: { tardanza: 0, sinFichaje: 0, fueraRadio: 0, puestoDescubierto: 0 },
      alertasSupervision: { vencida: candidatosSupervisionVencida, proxima: candidatosSupervisionProxima, sinZonaOSinSupervisores: objetivosSinZonaOSinSupervisores },
      alertasRonda: { noIniciada: candidatosRondaNoIniciada, noFinalizada: candidatosRondaNoFinalizada, pendientes: rondaAlertasPendientes, sinSupervisores: rondaAlertasSinSupervisores },
      recordatoriosVigilador: { aviso15m: avisos15m, pendiente: avisosPendiente },
      alertasEvaluadas,
      alertasOmitidasPorResueltas,
      alertasEnviadas,
      sent,
      skipped,
      cierreAutomatico,
    })
  }

  const [
    { data: registrosData, error: registrosError },
    { data: intervencionesData, error: intervencionesError },
  ] = await Promise.all([
    admin.client
      .from('registros_asistencia')
      .select('id, turno_id, guardia_id, hora_entrada_real, alerta_entrada, distancia_ingreso_metros, gps_ingreso_estado, created_at')
      .in('turno_id', turnoIds),
    admin.client
      .from('supervisor_intervenciones')
      .select('id, turno_id, registro_asistencia_id, tipo_alerta, accion, created_at')
      .in('turno_id', turnoIds),
  ])

  const intervencionesErrorIgnorable = intervencionesError && /supervisor_intervenciones|schema cache|does not exist/i.test(intervencionesError.message)
  if (registrosError || (intervencionesError && !intervencionesErrorIgnorable)) {
    return NextResponse.json({ error: registrosError?.message || intervencionesError?.message }, { status: 500 })
  }

  const registros = (registrosData || []) as RegistroPush[]
  const intervenciones = (intervencionesErrorIgnorable ? [] : (intervencionesData || [])) as SupervisorIntervencionPush[]

  const enviarAlertaSupervisor = async (
    usuarioIds: string[],
    turnoId: string,
    tipo: string,
    payload: PushPayload,
  ) => {
    const resultado = await sendToUsers(admin.client, subscriptions, usuarioIds, turnoId, tipo, payload)
    sumarResultado(resultado)
    alertasEnviadas += resultado.sent
  }

  for (const turno of turnos) {
    const objetivo = objetivos.find(item => item.id === turno.objetivo_id)
    const guardia = usuarios.find(item => item.id === turno.guardia_id)
    const inicio = fechaHoraMinutos(turno.fecha, turno.hora_inicio)
    const minutosHastaInicio = Math.floor(inicio - ahora)
    const minutosDesdeInicio = Math.floor(ahora - inicio)
    const registroEntrada = registros.find(registro => registro.turno_id === turno.id && registro.hora_entrada_real)
    const objetivoNombre = objetivo?.nombre || 'Objetivo sin nombre'
    const supervisoresTurno = supervisoresAsignados(turno, usuarios)

    if (turno.guardia_id && minutosHastaInicio >= 20 && minutosHastaInicio <= 35) {
      candidatos30 += 1
      sumarResultado(await sendToUsers(admin.client, subscriptions, [turno.guardia_id], turno.id, 'guardia_turno_30', {
        title: 'Turno próximo',
        body: `Tiene turno en ${objetivoNombre} a las ${turno.hora_inicio.slice(0, 5)}`,
        url: '/dashboard',
        tag: `turno-${turno.id}-30`,
      }))
    }

    if (turno.guardia_id && minutosHastaInicio >= 5 && minutosHastaInicio <= 20) {
      candidatos15 += 1
      sumarResultado(await sendToUsers(admin.client, subscriptions, [turno.guardia_id], turno.id, 'guardia_turno_15', {
        title: 'Preparar ingreso',
        body: `Recuerde preparar el ingreso y fichar en ${objetivoNombre}`,
        url: '/dashboard',
        tag: `turno-${turno.id}-15`,
      }))
    }

    if (turno.guardia_id && minutosDesdeInicio >= 15 && minutosDesdeInicio <= 20) {
      alertasEvaluadas += 1
      if (registroEntrada || alertaResueltaPorIntervencion(intervenciones, turno.id, SUPERVISOR_ALERT_TYPES.sinFichaje)) {
        alertasOmitidasPorResueltas += 1
      } else {
        candidatosSupervisorSinFichaje += 1
        await enviarAlertaSupervisor(supervisoresTurno, turno.id, SUPERVISOR_ALERT_TYPES.sinFichaje, {
          title: 'Guardia sin fichaje',
          body: supervisorBody(turno, guardia, objetivoNombre, 'sin fichaje'),
          url: '/dashboard',
          tag: `turno-${turno.id}-sin-fichaje`,
        })
      }
    }

    if ((turno.estado === 'descubierto' || !turno.guardia_id) && minutosDesdeInicio >= -5 && minutosDesdeInicio <= 120) {
      alertasEvaluadas += 1
      if (registroEntrada || turno.estado === 'cubierto' || turnoFueReasignado(turno) || alertaResueltaPorIntervencion(intervenciones, turno.id, SUPERVISOR_ALERT_TYPES.puestoDescubierto)) {
        alertasOmitidasPorResueltas += 1
      } else {
        candidatosSupervisorPuestoDescubierto += 1
        await enviarAlertaSupervisor(supervisoresTurno, turno.id, SUPERVISOR_ALERT_TYPES.puestoDescubierto, {
          title: 'Puesto descubierto',
          body: supervisorBody(turno, guardia, objetivoNombre, registroEntrada?.hora_entrada_real || 'sin registro'),
          url: '/dashboard',
          tag: `turno-${turno.id}-descubierto`,
        })
      }
    }
  }

  const registrosTardanza = registros.filter(registro => {
    const turno = turnos.find(item => item.id === registro.turno_id)
    return turno && esTardanza(turno, registro) && minutosDesdeISO(registro.created_at) <= 15
  })

  for (const registro of registrosTardanza) {
    const turno = turnos.find(item => item.id === registro.turno_id)
    if (!turno) continue

    const objetivo = objetivos.find(item => item.id === turno.objetivo_id)
    const guardia = usuarios.find(item => item.id === registro.guardia_id || item.id === turno.guardia_id)
    const objetivoNombre = objetivo?.nombre || 'Objetivo sin nombre'
    const supervisoresTurno = supervisoresAsignados(turno, usuarios)

    alertasEvaluadas += 1
    if (alertaResueltaPorIntervencion(intervenciones, turno.id, SUPERVISOR_ALERT_TYPES.tardanza, registro.id)) {
      alertasOmitidasPorResueltas += 1
      continue
    }

    candidatosSupervisorTardanza += 1
    await enviarAlertaSupervisor(supervisoresTurno, turno.id, SUPERVISOR_ALERT_TYPES.tardanza, {
      title: 'Tardanza registrada',
      body: supervisorBody(turno, guardia, objetivoNombre, registro.hora_entrada_real),
      url: '/dashboard',
      tag: `turno-${turno.id}-tardanza`,
    })
  }

  const registrosFueraRadio = registros.filter(registro =>
    registro.gps_ingreso_estado === 'fuera_radio' &&
    minutosDesdeISO(registro.created_at) <= 15
  )

  for (const registro of registrosFueraRadio) {
    const turno = turnos.find(item => item.id === registro.turno_id)
    if (!turno) continue

    const objetivo = objetivos.find(item => item.id === turno.objetivo_id)
    const guardia = usuarios.find(item => item.id === registro.guardia_id || item.id === turno.guardia_id)
    const objetivoNombre = objetivo?.nombre || 'Objetivo sin nombre'
    const supervisoresTurno = supervisoresAsignados(turno, usuarios)

    alertasEvaluadas += 1
    if (alertaResueltaPorIntervencion(intervenciones, turno.id, SUPERVISOR_ALERT_TYPES.fueraRadio, registro.id)) {
      alertasOmitidasPorResueltas += 1
      continue
    }

    candidatosSupervisorFueraRadio += 1
    await enviarAlertaSupervisor(supervisoresTurno, turno.id, SUPERVISOR_ALERT_TYPES.fueraRadio, {
      title: 'Fichaje fuera de radio',
      body: supervisorBody(turno, guardia, objetivoNombre, registro.hora_entrada_real, `Distancia GPS: ${distanciaTexto(registro.distancia_ingreso_metros)}`),
      url: '/dashboard',
      tag: `turno-${turno.id}-fuera-radio`,
    })
  }

  return NextResponse.json({
    ok: true,
    turnosProcesados,
    candidatos30,
    candidatos15,
    alertasSupervisor: {
      tardanza: candidatosSupervisorTardanza,
      sinFichaje: candidatosSupervisorSinFichaje,
      fueraRadio: candidatosSupervisorFueraRadio,
      puestoDescubierto: candidatosSupervisorPuestoDescubierto,
    },
    alertasSupervision: {
      vencida: candidatosSupervisionVencida,
      proxima: candidatosSupervisionProxima,
      sinZonaOSinSupervisores: objetivosSinZonaOSinSupervisores,
    },
    alertasRonda: {
      noIniciada: candidatosRondaNoIniciada,
      noFinalizada: candidatosRondaNoFinalizada,
      pendientes: rondaAlertasPendientes,
      sinSupervisores: rondaAlertasSinSupervisores,
    },
    recordatoriosVigilador: { aviso15m: avisos15m, pendiente: avisosPendiente },
    alertasEvaluadas,
    alertasOmitidasPorResueltas,
    alertasEnviadas,
    sent,
    skipped,
    cierreAutomatico,
  })
}
