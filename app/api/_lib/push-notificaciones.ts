/**
 * app/api/_lib/push-notificaciones.ts
 *
 * TODO el envío de notificaciones del sistema, en un solo lugar.
 *
 * Lo consumen dos rutas y ninguna reimplementa nada:
 *   · /api/push/notificaciones — solo esto. Es la que dispara pg_cron.
 *   · /api/push/cron           — esto MÁS cerrar_turnos_abiertos().
 *
 * Esta función NO escribe en turnos, ni en registros_asistencia, ni recalcula
 * horas, ni llama a cerrar_turnos_abiertos(). Lo único que escribe es
 * notificaciones_enviadas —su propio registro de envío— y push_subscriptions
 * cuando el servicio push responde 404/410 y hay que dar de baja un endpoint
 * muerto.
 *
 * Tampoco llama a evaluar_ronda_alertas(): esa función ya corre cada 10 minutos
 * por pg_cron y es la única fuente de las alertas de ronda. Acá solo se LEE
 * ronda_alertas.
 */
import { sendWebPush, type PushPayload, type PushSubscriptionRow } from './web-push'
import {
  TEXTO_EGRESO_PENDIENTE,
  TIPO_EGRESO_PENDIENTE,
  debeAvisarEgresoPendiente,
} from '@/lib/notificaciones-push'
import { calcularMinutosTardanzaRegistro } from '@/lib/revision-operativa'
import { objetivoEstaOperativo, turnoSinCoberturaOperativa } from '@/lib/turnos'
// LA resolución de responsables operativos: guardia efectiva → responsable
// único de zona → nadie (sin elegir arbitrariamente). La misma que usan las
// pantallas; acá no se reimplementa nada.
import { resolverResponsablesOperativos } from '@/lib/responsables-operativos'
import type { GuardiaOperativa } from '@/lib/responsables-operativos'
import {
  FRECUENCIA_SUPERVISION_DEFECTO_HORAS,
  estadoSupervision,
  horasParaVencimiento,
  indexarUltimaSupervision,
  supervisionProximaAVencer,
} from '@/lib/supervisiones'

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
  // La consulta ya lo traía; faltaba declararlo. Sin esto el filtro de objetivo
  // pausado compilaría igual y no filtraría nada.
  estado?: string | null
}

type RegistroPush = {
  id: string
  turno_id: string
  guardia_id: string
  hora_entrada_real?: string | null
  hora_entrada_final?: string | null
  alerta_entrada?: string | null
  distancia_ingreso_metros?: number | string | null
  gps_ingreso_estado?: string | null
  created_at?: string | null
  // Solo lectura, para saber si ya marcó la salida. Nunca se escriben acá.
  hora_salida_real?: string | null
  hora_salida_final?: string | null
  cierre_automatico?: boolean | null
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

function esTardanza(turno: TurnoPush, registro?: RegistroPush | null) {
  return Boolean((registro?.hora_entrada_final || registro?.hora_entrada_real) && calcularMinutosTardanzaRegistro(turno, registro) > 5)
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
  return ['confirmar_cubierto', 'reasignacion', 'marcado_descubierto', 'alerta_revisada', 'confirmar_asistencia'].includes(accionNormalizada(accion))
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

/**
 * Envía a cada usuario una sola vez por (usuario, turno, tipo).
 *
 * `enviar` se puede inyectar para poder probar la deduplicación y el
 * aislamiento por suscripción sin salir a la red. En producción es sendWebPush.
 */
export async function sendToUsers(
  client: any,
  subscriptions: PushSubscriptionRow[],
  usuarioIds: string[],
  turnoId: string,
  tipo: string,
  payload: PushPayload,
  enviar: (s: PushSubscriptionRow, p: PushPayload) => Promise<{ status: number }> = sendWebPush,
) {
  let sent = 0
  let skipped = 0
  let fallos = 0
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

    let entregadoAAlguno = false
    for (const subscription of userSubscriptions) {
      // Aislado por suscripción: un endpoint caído no puede dejar sin aviso al
      // resto. Antes cualquier error distinto de 404/410 subía y cortaba la
      // corrida entera.
      try {
        const response = await enviar(subscription, payload)
        if (response.status === 404 || response.status === 410) {
          await client.from('push_subscriptions').update({ activo: false }).eq('id', subscription.id)
        } else {
          entregadoAAlguno = true
        }
      } catch (e) {
        fallos += 1
        console.error('[push] suscripción', subscription.id, e instanceof Error ? e.message : e)
      }
    }

    // Sin ninguna entrega no se marca como enviada: así el próximo ciclo lo
    // reintenta en vez de darlo por hecho.
    if (!entregadoAAlguno) { skipped += 1; continue }

    await markNotificationSent(client, usuarioId, turnoId, tipo, payload)
    sent += 1
  }

  return { sent, skipped, fallos }
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
  let fallosObj = 0
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

    let entregadoAAlgunoObj = false
    for (const subscription of userSubscriptions) {
      try {
        const response = await sendWebPush(subscription, payload)
        if (response.status === 404 || response.status === 410) {
          await client.from('push_subscriptions').update({ activo: false }).eq('id', subscription.id)
        } else {
          entregadoAAlgunoObj = true
        }
      } catch (e) {
        fallosObj += 1
        console.error('[push] suscripción', subscription.id, e instanceof Error ? e.message : e)
      }
    }

    if (!entregadoAAlgunoObj) { skipped += 1; continue }

    await markNotificationSentObjetivo(client, usuarioId, objetivoId, tipo, payload)
    sent += 1
  }

  return { sent, skipped, fallos: fallosObj }
}

// Alertas de rondas: persistidas por evaluar_ronda_alertas(); acá solo se
// enrutan por zona y se envían con dedup por (usuario, objetivo, tipo), donde el
// tipo embebe el id de la alerta → una notificación por alerta y supervisor.
type RondaAlertaPush = {
  id: string
  tipo: string
  objetivo_id: string
  guardia_id: string
  motivo_vigilador: string | null
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

/**
 * Envío controlado a un solo destinatario, para la prueba previa a encender el
 * cron. `soloUsuarioId` restringe la corrida entera a ese usuario.
 *
 * POR QUÉ ALCANZA CON FILTRAR LAS SUSCRIPCIONES
 * Todo el envío pasa por sendToUsers / sendToUsersObjetivo, y las dos leen sus
 * destinatarios del mismo arreglo `subscriptions`. Para cualquier otro usuario
 * ese arreglo queda vacío, y ambas cortan con `continue` ANTES de
 * markNotificationSent*: no se le manda nada y tampoco se le escribe fila en
 * notificaciones_enviadas. No hace falta tocar los diez puntos de llamada —que
 * es justo donde uno se olvida de uno y termina notificando a un tercero.
 *
 * Lo que NO cambia son las reglas: no se fabrica un aviso. Sale el que
 * correspondía por las reglas existentes, o no sale ninguno. Y la fila de
 * deduplicación del usuario probado se escribe normalmente, que es lo que
 * permite comprobar que la segunda corrida no repite.
 *
 * Las suscripciones de los demás no se modifican: sólo quedan fuera de esta
 * consulta.
 */
export interface OpcionesEnvio {
  soloUsuarioId?: string | null
}

export async function enviarNotificaciones(client: any, opciones: OpcionesEnvio = {}) {
  const admin = { client }
  const soloUsuarioId = opciones.soloUsuarioId || null

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
    supervisoresGuardiaResult,
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
    (() => {
      const q = admin.client
        .from('push_subscriptions')
        .select('id, usuario_id, endpoint, p256dh, auth')
        .eq('activo', true)
      // Único punto donde se restringe la prueba controlada. Ver OpcionesEnvio.
      return soloUsuarioId ? q.eq('usuario_id', soloUsuarioId) : q
    })(),
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
    // Guardias efectivas para resolver responsables. Desde anteayer porque una
    // nocturna arranca un día y cubre la madrugada del siguiente, y los turnos
    // procesados llegan hasta mañana.
    admin.client
      .from('supervisores_guardia')
      .select('supervisor_id, zona, fecha, hora_inicio, hora_fin, estado, tipo_evento, rol_operativo')
      .gte('fecha', sumarDias(ayer, -1))
      .lte('fecha', manana),
  ])

  if (turnosError || usuariosError || objetivosError || subscriptionsError) {
    return { ok: false, error: turnosError?.message || usuariosError?.message || objetivosError?.message || subscriptionsError?.message }
  }

  const zonasErrorIgnorable = zonasResult.error && /zonas_operativas|schema cache|does not exist/i.test(zonasResult.error.message)
  const supervisorZonasErrorIgnorable = supervisorZonasResult.error && /supervisor_zonas|schema cache|does not exist/i.test(supervisorZonasResult.error.message)
  const ultimasSupervisionesErrorIgnorable = ultimasSupervisionesResult.error && /supervisiones|schema cache|does not exist/i.test(ultimasSupervisionesResult.error.message)
  // Sin la tabla o sin las columnas de excepciones (migración no corrida), la
  // resolución degrada al fallback por zona en lugar de tirar la corrida.
  const supervisoresGuardiaErrorIgnorable = supervisoresGuardiaResult.error && /supervisores_guardia|tipo_evento|schema cache|does not exist|column/i.test(supervisoresGuardiaResult.error.message)

  if ((zonasResult.error && !zonasErrorIgnorable) || (supervisorZonasResult.error && !supervisorZonasErrorIgnorable) || (ultimasSupervisionesResult.error && !ultimasSupervisionesErrorIgnorable) || (supervisoresGuardiaResult.error && !supervisoresGuardiaErrorIgnorable)) {
    return { ok: false, error: zonasResult.error?.message || supervisorZonasResult.error?.message || ultimasSupervisionesResult.error?.message || supervisoresGuardiaResult.error?.message }
  }

  const turnos = (turnosData || []) as TurnoPush[]
  const usuarios = (usuariosData || []) as UsuarioPush[]
  const objetivos = (objetivosData || []) as ObjetivoPush[]
  const objetivosSupervision = (objetivosData || []) as ObjetivoSupervisionPush[]
  const subscriptions = (subscriptionsData || []) as PushSubscriptionRow[]
  const zonasOperativas = (zonasErrorIgnorable ? [] : (zonasResult.data || [])) as ZonaOperativaPush[]
  const supervisorZonas = (supervisorZonasErrorIgnorable ? [] : (supervisorZonasResult.data || [])) as SupervisorZonaPush[]
  const ultimasSupervisiones = (ultimasSupervisionesErrorIgnorable ? [] : (ultimasSupervisionesResult.data || [])) as SupervisionUltimaPush[]
  const guardiasOperativas = (supervisoresGuardiaErrorIgnorable ? [] : (supervisoresGuardiaResult.data || [])) as GuardiaOperativa[]
  const turnoIds = turnos.map(turno => turno.id)

  // ── Resolución de responsables ────────────────────────────────────────────
  //
  // Guardia efectiva (zona + instante, con nocturnos y excepciones) →
  // responsable único de supervisor_zonas → nadie. El ROL NO FILTRA: un admin
  // asignado operativamente (Sergio) recibe igual; `usuarios` ya viene sólo
  // con activos. Puede devolver VARIOS (Rosario diurno: Sabino + Sergio) y se
  // les manda a todos: la deduplicación por (usuario, turno/objetivo, tipo)
  // evita el doble envío al mismo destinatario.
  const zonaPorObjetivo = new Map<string, string | null>()
  objetivosSupervision.forEach(o => zonaPorObjetivo.set(o.id, o.zona_id ?? null))

  let alertasSinResponsable = 0
  let alertasVariosSinGuardia = 0
  let responsablesSinDispositivo = 0

  const destinatariosOperativos = (zonaId: string | null | undefined, fecha: string, hora: string, contexto: string): string[] => {
    const resolucion = resolverResponsablesOperativos({
      zonaId: zonaId ?? null,
      fecha,
      hora,
      guardias: guardiasOperativas,
      supervisorZonas,
      zonas: zonasOperativas,
      usuarios,
    })

    if (resolucion.responsables.length === 0) {
      if (resolucion.origen === 'multiples_sin_guardia') {
        alertasVariosSinGuardia += 1
        console.warn(`[push] ${contexto}: falta definir la guardia (${resolucion.candidatosZona.length} responsables posibles, no se elige uno).`)
      } else {
        alertasSinResponsable += 1
        console.warn(`[push] ${contexto}: sin responsable (${resolucion.origen}).`)
      }
      return []
    }

    // Responsable correcto pero sin dispositivo: es un problema de ENTREGA,
    // no de resolución. Se registra aparte para no confundirlo con "sin
    // supervisor asignado". En la prueba controlada las suscripciones vienen
    // filtradas a un usuario, así que ahí no se mide.
    if (!soloUsuarioId) {
      const sinDispositivo = resolucion.responsables.filter(id => !subscriptions.some(s => s.usuario_id === id))
      if (sinDispositivo.length > 0) {
        responsablesSinDispositivo += sinDispositivo.length
        console.warn(`[push] ${contexto}: responsable encontrado · sin dispositivo push registrado (${sinDispositivo.length} de ${resolucion.responsables.length}).`)
      }
    }

    return resolucion.responsables
  }

  // Instante local "ahora", para las alertas que no tienen un turno que les dé
  // fecha y hora (supervisiones vencidas, rondas).
  const horaAhora = horaDeMin(ahora)

  // El instante de una alerta de turno es el INICIO del turno: un turno de
  // 06:00 le corresponde a quien cubre las 06:00, aunque la alerta salga a las
  // 06:20. Se llama sólo cuando hay alerta que mandar, para no llenar el log
  // con turnos que no alertan.
  const destinatariosParaTurno = (turno: TurnoPush, contexto: string) =>
    destinatariosOperativos(
      zonaPorObjetivo.get(turno.objetivo_id),
      turno.fecha,
      turno.hora_inicio.slice(0, 5),
      `${contexto} (turno ${turno.fecha} ${turno.hora_inicio.slice(0, 5)})`,
    )

  const turnosProcesados = turnos.length
  let candidatos30 = 0
  let candidatosEgreso = 0
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
  // Vigencia: unica definicion, en lib/supervisiones.ts. No interviene el mes.
  const ultimaPorObjetivo = indexarUltimaSupervision(ultimasSupervisiones)

  for (const objetivo of objetivosSupervision) {
    if ((objetivo.estado || 'activo') !== 'activo') continue

    const frecuenciaHoras = objetivo.frecuencia_supervision_horas || FRECUENCIA_SUPERVISION_DEFECTO_HORAS
    const ultimaIso = ultimaPorObjetivo.get(objetivo.id) || null
    const estado = estadoSupervision(ultimaIso, frecuenciaHoras)
    // 'nunca' y 'vencida' comparten el mismo aviso: hay que ir a supervisar.
    const estadoAgenda: 'vencido' | 'proximo' | 'al_dia' = estado !== 'vigente'
      ? 'vencido'
      : supervisionProximaAVencer(ultimaIso, frecuenciaHoras)
        ? 'proximo'
        : 'al_dia'

    if (estadoAgenda === 'al_dia') continue

    if (!objetivo.zona_id) {
      console.warn(`[cron-push] Objetivo "${objetivo.nombre}" (${objetivo.id}) esta ${estadoAgenda} pero no tiene zona_id asignado. No se puede enrutar la alerta.`)
      objetivosSinZonaOSinSupervisores += 1
      continue
    }

    const supervisorIds = destinatariosOperativos(objetivo.zona_id, hoy, horaAhora, `supervisión ${estadoAgenda} de "${objetivo.nombre}"`)
    if (supervisorIds.length === 0) {
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
      // horasDesdeUltima nunca existió: la línea que la definía falta desde el
      // origen. Nadie lo notó porque esta ruta jamás llegó a ejecutarse, y el
      // `as number` silenciaba al compilador. Al correr, tiraba ReferenceError
      // y mataba la corrida entera —no sólo esta alerta—, porque esto está
      // fuera del try/catch por suscripción.
      //
      // horasParaVencimiento devuelve las horas que FALTAN, negativas cuando ya
      // venció; se invierte el signo. Se usa esa función y no una cuenta propia
      // porque la vigencia tiene una sola definición, en lib/supervisiones.
      const horasVencida = horasParaVencimiento(ultimaIso, frecuenciaHoras)
      const detalle = horasVencida !== null
        ? `Vencida desde hace ${Math.max(0, Math.round(-horasVencida))} h`
        : 'Sin supervision registrada'
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
      // horasFaltantes no existía: el gemelo exacto del bug de horasDesdeUltima
      // de la rama de vencidas (ver arriba). Nunca explotó porque ningún
      // objetivo caía en 'proximo'… hasta el 14/08/2026 ~18:40, cuando el
      // primero entró en ese estado: desde ahí CADA corrida moría acá con
      // ReferenceError —esta sección es la primera— y rondas, turnos y avisos
      // al vigilador no se ejecutaban más. El 500 con cuerpo vacío de pg_net
      // era esto, no un timeout. Misma fuente única que la rama de vencidas:
      // horasParaVencimiento, positivas mientras sigue vigente.
      const horasFaltantes = horasParaVencimiento(ultimaIso, frecuenciaHoras)
      const resultado = await sendToUsersObjetivo(
        admin.client,
        subscriptions,
        supervisorIds,
        objetivo.id,
        `${SUPERVISION_ALERT_TYPES.proxima}:${ciclo}`,
        {
          title: 'Supervisión próxima a vencer',
          body: `Objetivo: ${objetivo.nombre} · Zona: ${zonaNombre} · Quedan ${horasFaltantes !== null ? Math.max(0, Math.round(horasFaltantes)) : '?'} h`,
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
  let candidatosRondaSuspendida = 0
  let rondaAlertasSinSupervisores = 0

  // evaluar_ronda_alertas() NO se llama acá. La ejecuta pg_cron cada 10 minutos
  // (migración 20260810180000) y es la única fuente de ronda_alertas. Llamarla
  // también desde acá era duplicar la generación: se leen las alertas y nada más.

  const { data: rondaAlertasData, error: rondaAlertasError } = await admin.client
    .from('ronda_alertas')
    .select('id, tipo, objetivo_id, guardia_id, motivo_vigilador, ronda:rondas_base(nombre), puesto:puestos(nombre)')
    .eq('estado', 'pendiente')

  const rondaAlertasErrorIgnorable = rondaAlertasError && /ronda_alertas|schema cache|does not exist/i.test(rondaAlertasError.message)
  if (rondaAlertasError && !rondaAlertasErrorIgnorable) {
    console.error('[cron] lectura ronda_alertas error:', rondaAlertasError.message)
  }

  const nombrePorObjetivo = new Map<string, string>()
  objetivos.forEach(o => nombrePorObjetivo.set(o.id, o.nombre))

  const rondaAlertas = (rondaAlertasErrorIgnorable ? [] : (rondaAlertasData || [])) as RondaAlertaPush[]
  rondaAlertasPendientes = rondaAlertas.length

  // Una alerta de ronda se avisa UNA sola vez: a los responsables del momento
  // en que se detectó. La deduplicación de sendToUsersObjetivo es por
  // (usuario, objetivo, tipo), correcta por persona — pero el conjunto de
  // responsables cambia con la hora. Verificado en producción el 18/08/2026:
  // cada alerta nocturna se le mandaba a Fulla al detectarse y, a las 07:00,
  // se le volvía a mandar a Aranda y a Martínez cuando entraban de guardia:
  // el turno diurno arrancaba con 10 push acumuladas de la noche. Si nadie la
  // atendió, el que entra la ve en su bandeja de pendientes; no se le reenvía.
  //
  // Se consulta de una vez qué alertas ya tienen algún envío registrado, para
  // cualquier destinatario, y esas se saltan antes de resolver responsables.
  let rondaAlertasYaAvisadas = 0
  const tiposRonda = rondaAlertas.map(a => `supervisor_ronda_${a.tipo}:${a.id}`)
  const yaAvisadas = new Set<string>()
  if (tiposRonda.length > 0) {
    const { data: enviadasData } = await admin.client
      .from('notificaciones_enviadas')
      .select('tipo')
      .in('tipo', tiposRonda)
    for (const fila of (enviadasData || []) as Array<{ tipo: string }>) yaAvisadas.add(fila.tipo)
  }

  for (const alerta of rondaAlertas) {
    if (yaAvisadas.has(`supervisor_ronda_${alerta.tipo}:${alerta.id}`)) {
      rondaAlertasYaAvisadas += 1
      continue
    }

    const zonaId = zonaPorObjetivo.get(alerta.objetivo_id) ?? null
    const supervisorIds = destinatariosOperativos(zonaId, hoy, horaAhora, `ronda ${alerta.tipo} en "${nombrePorObjetivo.get(alerta.objetivo_id) || alerta.objetivo_id}"`)
    if (supervisorIds.length === 0) {
      rondaAlertasSinSupervisores += 1
      continue
    }

    const guardia = usuarios.find(u => u.id === alerta.guardia_id)
    const rondaNombre = nombreEmbebido(alerta.ronda) || 'Ronda'
    const puestoNombre = nombreEmbebido(alerta.puesto) || 'Puesto'
    const objetivoNombre = nombrePorObjetivo.get(alerta.objetivo_id) || 'Objetivo'

    let title: string
    let body: string
    if (alerta.tipo === 'suspendida') {
      candidatosRondaSuspendida += 1
      title = 'Ronda suspendida'
      body = `${nombreUsuario(guardia)} suspendió la ronda ${rondaNombre} (${puestoNombre} · ${objetivoNombre}). Motivo: ${alerta.motivo_vigilador || 'sin detalle'}`
    } else if (alerta.tipo === 'no_iniciada') {
      candidatosRondaNoIniciada += 1
      title = 'Ronda no iniciada'
      body = `Ronda: ${rondaNombre} · Puesto: ${puestoNombre} · Objetivo: ${objetivoNombre} · Vigilador: ${nombreUsuario(guardia)}`
    } else {
      candidatosRondaNoFinalizada += 1
      title = 'Ronda sin finalizar'
      body = `Ronda: ${rondaNombre} · Puesto: ${puestoNombre} · Objetivo: ${objetivoNombre} · Vigilador: ${nombreUsuario(guardia)}`
    }

    const resultado = await sendToUsersObjetivo(
      admin.client,
      subscriptions,
      supervisorIds,
      alerta.objetivo_id,
      `supervisor_ronda_${alerta.tipo}:${alerta.id}`,
      { title, body, url: '/dashboard', tag: `ronda-alerta-${alerta.id}` },
    )
    sumarResultado(resultado)
    alertasEnviadas += resultado.sent
  }

  // ── Recordatorios de ronda al VIGILADOR (15' antes / pendiente) ──────────────
  // Solo al vigilador del turno vigente, con suscripción activa. NO crea
  // ronda_alertas. Dedup por (usuario, turno, tipo) con tipo = aviso:ronda:ventana.
  let avisos15m = 0
  let avisosPendiente = 0
  let avisosOmitidosPorPausa = 0
  {
    // Una ronda hecha unos minutos ANTES del inicio de la ventana cuenta como
    // realizada para esa ventana: evita seguir avisando algo ya cumplido.
    const RONDA_AVISO_GRACIA_MIN = 15
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

      const [rondasVigRes, ejecVigRes, pausasRes] = await Promise.all([
        admin.client.from('rondas_base')
          .select('id, puesto_id, nombre, hora_inicio, intervalo_minutos')
          .in('puesto_id', puestoIds as string[]).eq('activo', true),
        admin.client.from('ronda_ejecuciones')
          .select('ronda_base_id, turno_id, iniciada_at, estado')
          .in('turno_id', turnoIdsVig).in('estado', ['en_curso', 'finalizada']),
        admin.client.from('ronda_pausas')
          .select('ronda_base_id, pausada_at, hasta_at')
          .eq('activa', true),
      ])

      const rondasVig = (rondasVigRes.data || []) as Array<{ id: string; puesto_id: string; nombre: string; hora_inicio: string | null; intervalo_minutos: number }>
      const ejecMin = ((ejecVigRes.data || []) as Array<{ ronda_base_id: string; turno_id: string; iniciada_at: string }>)
        .map(e => ({ ...e, ini_min: isoALocalMin(e.iniciada_at) }))

      // Pausas de supervisor vigentes: cubren las ventanas cuyo inicio cae dentro
      // del período de pausa. Mismo criterio temporal que evaluar_ronda_alertas().
      const pausasMin = ((pausasRes.data || []) as Array<{ ronda_base_id: string; pausada_at: string; hasta_at: string | null }>)
        .map(p => ({
          ronda_base_id: p.ronda_base_id,
          desde_min: isoALocalMin(p.pausada_at),
          hasta_min: p.hasta_at ? isoALocalMin(p.hasta_at) : null,
        }))
        .filter(p => p.hasta_min === null || p.hasta_min > ahora)
      const ventanaPausada = (rondaBaseId: string, ventanaInicioMin: number) =>
        pausasMin.some(p => p.ronda_base_id === rondaBaseId
          && ventanaInicioMin >= p.desde_min
          && (p.hasta_min === null || ventanaInicioMin < p.hasta_min))

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

            // Cada ejecución satisface UNA sola ventana: [vi - gracia, vi + interv - gracia).
            // Los rangos de ventanas contiguas no se solapan, así una ejecución no se
            // reutiliza para dos ventanas; una hecha hasta 15' antes cuenta para esta.
            const yaIniciada = ejecMin.some(e =>
              e.ronda_base_id === rb.id && e.turno_id === t.id
              && e.ini_min >= vi - RONDA_AVISO_GRACIA_MIN
              && e.ini_min < vi + interv - RONDA_AVISO_GRACIA_MIN)
            if (yaIniciada) continue
            if (ventanaPausada(rb.id, vi)) { avisosOmitidosPorPausa += 1; continue }

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
    return ({
      ok: true,
      turnosProcesados: 0,
      candidatos30: 0,
      candidatos15: 0,
      alertasSupervisor: { tardanza: 0, sinFichaje: 0, fueraRadio: 0, puestoDescubierto: 0 },
      alertasSupervision: { vencida: candidatosSupervisionVencida, proxima: candidatosSupervisionProxima, sinZonaOSinSupervisores: objetivosSinZonaOSinSupervisores },
      alertasRonda: { noIniciada: candidatosRondaNoIniciada, noFinalizada: candidatosRondaNoFinalizada, suspendida: candidatosRondaSuspendida, pendientes: rondaAlertasPendientes, sinSupervisores: rondaAlertasSinSupervisores, yaAvisadas: rondaAlertasYaAvisadas },
      recordatoriosVigilador: { aviso15m: avisos15m, pendiente: avisosPendiente, omitidosPorPausa: avisosOmitidosPorPausa },
    egresoPendiente: candidatosEgreso,
      alertasEvaluadas,
      alertasOmitidasPorResueltas,
      alertasEnviadas,
      // "Sin responsable" y "responsable sin dispositivo" son problemas
      // distintos: el primero es de asignación, el segundo de entrega.
      resolucionResponsables: {
        sinResponsable: alertasSinResponsable,
        variosSinGuardia: alertasVariosSinGuardia,
        responsablesSinDispositivo,
      },
      sent,
      skipped,
    })
  }

  const [
    { data: registrosData, error: registrosError },
    { data: intervencionesData, error: intervencionesError },
  ] = await Promise.all([
    admin.client
      .from('registros_asistencia')
      .select('id, turno_id, guardia_id, hora_entrada_real, hora_entrada_final, alerta_entrada, distancia_ingreso_metros, gps_ingreso_estado, created_at, hora_salida_real, hora_salida_final, cierre_automatico')
      .in('turno_id', turnoIds),
    admin.client
      .from('supervisor_intervenciones')
      .select('id, turno_id, registro_asistencia_id, tipo_alerta, accion, created_at')
      .in('turno_id', turnoIds),
  ])

  const intervencionesErrorIgnorable = intervencionesError && /supervisor_intervenciones|schema cache|does not exist/i.test(intervencionesError.message)
  if (registrosError || (intervencionesError && !intervencionesErrorIgnorable)) {
    return { ok: false, error: registrosError?.message || intervencionesError?.message }
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

    // Objetivo pausado: sus turnos se conservan pero no generan obligación. Las
    // cuatro alertas de este bucle —recordatorio 30', recordatorio 15', sin
    // fichaje y puesto descubierto— derivan todas de que el objetivo esté
    // operativo, así que ninguna corresponde. Mismo criterio que aplican
    // rondas_ventanas_programadas y asignar_vigilador_turnos en el servidor.
    if (!objetivoEstaOperativo(objetivo)) continue

    const guardia = usuarios.find(item => item.id === turno.guardia_id)
    const inicio = fechaHoraMinutos(turno.fecha, turno.hora_inicio)
    const minutosHastaInicio = Math.floor(inicio - ahora)
    const minutosDesdeInicio = Math.floor(ahora - inicio)
    const registroEntrada = registros.find(registro => registro.turno_id === turno.id && registro.hora_entrada_real)
    const objetivoNombre = objetivo?.nombre || 'Objetivo sin nombre'

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

    // ── Recordatorio de egreso ────────────────────────────────────────────────
    // Entre 5 y 20 minutos después del fin del turno, si fichó la entrada y
    // todavía no marcó la salida. La regla y el cruce de medianoche viven en
    // lib/notificaciones-push, con tests propios.
    //
    // Este aviso NO marca la salida, NO cierra la asistencia, NO calcula horas
    // y NO toca liquidación: solo avisa.
    if (turno.guardia_id) {
      const registroTurno = registros.find(r => r.turno_id === turno.id)
      const avisarEgreso = debeAvisarEgresoPendiente({
        inicioAbsMin: inicio,
        horaInicio: turno.hora_inicio,
        horaFin: turno.hora_fin,
        tieneEntrada: Boolean(registroTurno?.hora_entrada_final || registroTurno?.hora_entrada_real),
        tieneSalida: Boolean(registroTurno?.hora_salida_final || registroTurno?.hora_salida_real),
        cierreAutomatico: Boolean(registroTurno?.cierre_automatico),
        ahoraMin: ahora,
      })
      if (avisarEgreso) {
        candidatosEgreso += 1
        sumarResultado(await sendToUsers(
          admin.client, subscriptions, [turno.guardia_id], turno.id, TIPO_EGRESO_PENDIENTE, {
            title: 'Marcá la salida',
            body: TEXTO_EGRESO_PENDIENTE(objetivoNombre),
            url: '/dashboard',
            tag: `turno-${turno.id}-egreso`,
          }))
      }
    }

    if (turno.guardia_id && minutosDesdeInicio >= 15 && minutosDesdeInicio <= 20) {
      alertasEvaluadas += 1
      if (registroEntrada || alertaResueltaPorIntervencion(intervenciones, turno.id, SUPERVISOR_ALERT_TYPES.sinFichaje)) {
        alertasOmitidasPorResueltas += 1
      } else {
        candidatosSupervisorSinFichaje += 1
        await enviarAlertaSupervisor(destinatariosParaTurno(turno, 'sin fichaje'), turno.id, SUPERVISOR_ALERT_TYPES.sinFichaje, {
          title: 'Guardia sin fichaje',
          body: supervisorBody(turno, guardia, objetivoNombre, 'sin fichaje'),
          url: '/dashboard',
          tag: `turno-${turno.id}-sin-fichaje`,
        })
      }
    }

    if (turnoSinCoberturaOperativa(turno) && minutosDesdeInicio >= -5 && minutosDesdeInicio <= 120) {
      alertasEvaluadas += 1
      if (registroEntrada || turno.estado === 'cubierto' || turnoFueReasignado(turno) || alertaResueltaPorIntervencion(intervenciones, turno.id, SUPERVISOR_ALERT_TYPES.puestoDescubierto)) {
        alertasOmitidasPorResueltas += 1
      } else {
        candidatosSupervisorPuestoDescubierto += 1
        await enviarAlertaSupervisor(destinatariosParaTurno(turno, 'puesto descubierto'), turno.id, SUPERVISOR_ALERT_TYPES.puestoDescubierto, {
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

    alertasEvaluadas += 1
    if (alertaResueltaPorIntervencion(intervenciones, turno.id, SUPERVISOR_ALERT_TYPES.tardanza, registro.id)) {
      alertasOmitidasPorResueltas += 1
      continue
    }

    candidatosSupervisorTardanza += 1
    await enviarAlertaSupervisor(destinatariosParaTurno(turno, 'tardanza'), turno.id, SUPERVISOR_ALERT_TYPES.tardanza, {
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

    alertasEvaluadas += 1
    if (alertaResueltaPorIntervencion(intervenciones, turno.id, SUPERVISOR_ALERT_TYPES.fueraRadio, registro.id)) {
      alertasOmitidasPorResueltas += 1
      continue
    }

    candidatosSupervisorFueraRadio += 1
    await enviarAlertaSupervisor(destinatariosParaTurno(turno, 'fuera de radio'), turno.id, SUPERVISOR_ALERT_TYPES.fueraRadio, {
      title: 'Fichaje fuera de radio',
      body: supervisorBody(turno, guardia, objetivoNombre, registro.hora_entrada_real, `Distancia GPS: ${distanciaTexto(registro.distancia_ingreso_metros)}`),
      url: '/dashboard',
      tag: `turno-${turno.id}-fuera-radio`,
    })
  }

  return ({
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
      suspendida: candidatosRondaSuspendida,
      pendientes: rondaAlertasPendientes,
      sinSupervisores: rondaAlertasSinSupervisores,
      yaAvisadas: rondaAlertasYaAvisadas,
    },
    recordatoriosVigilador: { aviso15m: avisos15m, pendiente: avisosPendiente, omitidosPorPausa: avisosOmitidosPorPausa },
    alertasEvaluadas,
    alertasOmitidasPorResueltas,
    alertasEnviadas,
    resolucionResponsables: {
      sinResponsable: alertasSinResponsable,
      variosSinGuardia: alertasVariosSinGuardia,
      responsablesSinDispositivo,
    },
    sent,
    skipped,
    // Sólo en la prueba controlada: deja constancia de a quién se limitó y a
    // cuántos dispositivos suyos podía llegar.
    ...(soloUsuarioId
      ? { pruebaControlada: { usuarioId: soloUsuarioId, dispositivos: subscriptions.length } }
      : {}),
  })
}

// ── Resumen de Cierre Operativo ──────────────────────────────────────────────
//
// UN aviso por responsable y por día, no uno por incidencia. El resto de este
// módulo avisa hecho por hecho mientras la jornada pasa; el cierre es el
// resumen de lo que quedó sin decidir, y mandarlo fragmentado lo volvería
// indistinguible del ruido que ya recibe.
//
// La deduplicación va por `tipo`, que lleva la fecha adentro
// ("cierre_operativo:2026-08-25"): sin turno ni objetivo al que colgarse, la
// unicidad es (usuario, día). Se registra igual en notificaciones_enviadas,
// que es donde se puede auditar qué salió.

/** La clave del día. Es también el `tipo` con el que se deduplica. */
export function claveCierreOperativo(fecha: string): string {
  return `cierre_operativo:${fecha}`
}

async function resumenCierreYaEnviado(client: any, usuarioId: string, clave: string) {
  const { data, error } = await client
    .from('notificaciones_enviadas')
    .select('id')
    .eq('usuario_id', usuarioId)
    .eq('tipo', clave)
    .is('turno_id', null)
    .is('objetivo_id', null)
    .maybeSingle()

  if (error) throw error
  return Boolean(data)
}

/**
 * Manda el resumen a cada responsable. Una sola vez por día y por persona.
 *
 * `enviar` se inyecta en los tests, igual que en sendToUsers: la selección y la
 * deduplicación se prueban sin salir a la red.
 */
export async function enviarResumenCierre(
  client: any,
  subscriptions: PushSubscriptionRow[],
  destinatarios: Array<{ usuarioId: string; payload: PushPayload }>,
  fecha: string,
  enviar: (s: PushSubscriptionRow, p: PushPayload) => Promise<{ status: number }> = sendWebPush,
) {
  const clave = claveCierreOperativo(fecha)
  let sent = 0
  let skipped = 0
  let fallos = 0

  const vistos = new Set<string>()
  for (const { usuarioId, payload } of destinatarios) {
    if (!usuarioId || vistos.has(usuarioId)) continue
    vistos.add(usuarioId)

    if (await resumenCierreYaEnviado(client, usuarioId, clave)) { skipped += 1; continue }

    const suyas = subscriptions.filter(s => s.usuario_id === usuarioId)
    if (suyas.length === 0) { skipped += 1; continue }

    let entregado = false
    for (const subscription of suyas) {
      try {
        const response = await enviar(subscription, payload)
        if (response.status === 404 || response.status === 410) {
          await client.from('push_subscriptions').update({ activo: false }).eq('id', subscription.id)
        } else {
          entregado = true
        }
      } catch (e) {
        fallos += 1
        console.error('[push] cierre, suscripción', subscription.id, e instanceof Error ? e.message : e)
      }
    }

    // Sin ninguna entrega no se marca: el próximo intento lo reintenta en vez
    // de darlo por hecho.
    if (!entregado) { skipped += 1; continue }

    const { error } = await client.from('notificaciones_enviadas').insert({
      usuario_id: usuarioId,
      turno_id: null,
      objetivo_id: null,
      tipo: clave,
      titulo: payload.title,
      mensaje: payload.body,
    })
    if (error && !/duplicate key/i.test(error.message)) throw error
    sent += 1
  }

  return { sent, skipped, fallos }
}
