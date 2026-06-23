import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import { sendWebPush, type PushPayload, type PushSubscriptionRow } from '../../_lib/web-push'

export const runtime = 'nodejs'

type TurnoPush = {
  id: string
  guardia_id: string | null
  objetivo_id: string
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

export async function GET(req: NextRequest) {
  const auth = authOk(req)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.error === 'Falta CRON_SECRET' ? 500 : 401 })

  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const hoy = fechaLocal()
  const manana = sumarDias(hoy, 1)
  const ahora = ahoraMinutosLocal()
  const desdeReciente = new Date(Date.now() - 15 * 60000).toISOString()

  const [{ data: turnosData, error: turnosError }, { data: usuariosData, error: usuariosError }, { data: objetivosData, error: objetivosError }] = await Promise.all([
    admin.client
      .from('turnos')
      .select('id, guardia_id, objetivo_id, fecha, hora_inicio, hora_fin, estado')
      .in('fecha', [hoy, manana]),
    admin.client
      .from('usuarios')
      .select('id, nombre, apellido, rol, estado')
      .eq('estado', 'activo'),
    admin.client
      .from('objetivos')
      .select('id, nombre'),
  ])

  if (turnosError || usuariosError || objetivosError) {
    return NextResponse.json({ error: turnosError?.message || usuariosError?.message || objetivosError?.message }, { status: 500 })
  }

  const turnos = (turnosData || []) as TurnoPush[]
  const usuarios = (usuariosData || []) as UsuarioPush[]
  const objetivos = (objetivosData || []) as ObjetivoPush[]
  const turnoIds = turnos.map(turno => turno.id)

  if (turnoIds.length === 0) {
    return NextResponse.json({
      ok: true,
      turnosProcesados: 0,
      candidatos30: 0,
      candidatos15: 0,
      alertasSupervisor: { tardanza: 0, sinFichaje: 0, fueraRadio: 0, puestoDescubierto: 0 },
      sent: 0,
      skipped: 0,
    })
  }

  const [{ data: registrosData, error: registrosError }, { data: subscriptionsData, error: subscriptionsError }] = await Promise.all([
    admin.client
      .from('registros_asistencia')
      .select('id, turno_id, guardia_id, hora_entrada_real, alerta_entrada, distancia_ingreso_metros, gps_ingreso_estado, created_at')
      .in('turno_id', turnoIds),
    admin.client
      .from('push_subscriptions')
      .select('id, usuario_id, endpoint, p256dh, auth')
      .eq('activo', true),
  ])

  if (registrosError || subscriptionsError) {
    return NextResponse.json({ error: registrosError?.message || subscriptionsError?.message }, { status: 500 })
  }

  const registros = (registrosData || []) as RegistroPush[]
  const subscriptions = (subscriptionsData || []) as PushSubscriptionRow[]
  const turnosProcesados = turnos.length
  let candidatos30 = 0
  let candidatos15 = 0
  let candidatosSupervisorTardanza = 0
  let candidatosSupervisorSinFichaje = 0
  let candidatosSupervisorFueraRadio = 0
  let candidatosSupervisorPuestoDescubierto = 0
  let sent = 0
  let skipped = 0

  const sumarResultado = (resultado: { sent: number, skipped: number }) => {
    sent += resultado.sent
    skipped += resultado.skipped
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

    if (turno.guardia_id && !registroEntrada && minutosDesdeInicio >= 15 && minutosDesdeInicio <= 20) {
      candidatosSupervisorSinFichaje += 1
      sumarResultado(await sendToUsers(admin.client, subscriptions, supervisoresTurno, turno.id, SUPERVISOR_ALERT_TYPES.sinFichaje, {
        title: 'Guardia sin fichaje',
        body: supervisorBody(turno, guardia, objetivoNombre, 'sin fichaje'),
        url: '/dashboard',
        tag: `turno-${turno.id}-sin-fichaje`,
      }))
    }

    if (turno.estado === 'descubierto' && minutosDesdeInicio >= -5 && minutosDesdeInicio <= 120) {
      candidatosSupervisorPuestoDescubierto += 1
      sumarResultado(await sendToUsers(admin.client, subscriptions, supervisoresTurno, turno.id, SUPERVISOR_ALERT_TYPES.puestoDescubierto, {
        title: 'Puesto descubierto',
        body: supervisorBody(turno, guardia, objetivoNombre, registroEntrada?.hora_entrada_real || 'sin registro'),
        url: '/dashboard',
        tag: `turno-${turno.id}-descubierto`,
      }))
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

    candidatosSupervisorTardanza += 1
    sumarResultado(await sendToUsers(admin.client, subscriptions, supervisoresTurno, turno.id, SUPERVISOR_ALERT_TYPES.tardanza, {
      title: 'Tardanza registrada',
      body: supervisorBody(turno, guardia, objetivoNombre, registro.hora_entrada_real),
      url: '/dashboard',
      tag: `turno-${turno.id}-tardanza`,
    }))
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

    candidatosSupervisorFueraRadio += 1
    sumarResultado(await sendToUsers(admin.client, subscriptions, supervisoresTurno, turno.id, SUPERVISOR_ALERT_TYPES.fueraRadio, {
      title: 'Fichaje fuera de radio',
      body: supervisorBody(turno, guardia, objetivoNombre, registro.hora_entrada_real, `Distancia GPS: ${distanciaTexto(registro.distancia_ingreso_metros)}`),
      url: '/dashboard',
      tag: `turno-${turno.id}-fuera-radio`,
    }))
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
    sent,
    skipped,
  })
}
