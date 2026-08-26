// Entrenador Operativo — de la incidencia a la instrucción.
//
// El Cumplimiento Operativo ya sabe qué le correspondía hacer a cada persona y
// qué hizo. Este módulo usa ESO —no otra fuente— para decirle qué corregir y
// cómo. No hay una segunda medición: si acá dice "quedaron 2 rondas sin
// completar", ese 2 es el mismo que muestra la ficha.
//
// ── Lo que este módulo NO hace ─────────────────────────────────────────────
// No decide si una incidencia ocurrió. Eso ya está decidido, con hechos
// determinísticos, antes de llegar acá. Un modelo de lenguaje podría reescribir
// mejor un texto, pero no puede agregar, quitar ni matizar un hecho: la
// instrucción que recibe una persona sobre su trabajo no puede salir de algo
// que no se pueda auditar.
//
// No muestra el X/10, ni la nota de ninguna dimensión, ni una categoría. El
// vigilador todavía no ve su puntaje. Sí puede recibir una instrucción
// concreta, que es exactamente lo que sale de acá:
//
//   NO   "Sacaste 5,8 / 10."
//   SÍ   "Tus registros de salida están incompletos en varias jornadas.
//         Recordá marcar la salida al terminar el turno."
//
// No toca liquidación, ni horas, ni fichajes, ni el puntaje. Un mensaje no
// cambia ningún dato: sólo se guarda que se mandó.

import type { ClaveDimension } from '@/lib/cumplimiento'

export const CLAVES_ENTRENAMIENTO = [
  'asistencia', 'puntualidad', 'procedimiento_registro',
  'rondas', 'uniforme', 'libro_guardia', 'calidad_evidencias',
] as const
export type ClaveEntrenamiento = typeof CLAVES_ENTRENAMIENTO[number]

/**
 * A quién se le enseña primero cuando falla en varias cosas.
 *
 * El 1 queda libre a propósito: es el lugar de una falla de seguridad o de un
 * incumplimiento crítico, que hoy este módulo no mide. Dejarlo vacío es más
 * honesto que correr todo hacia arriba y hacer creer que "asistencia" es lo más
 * grave que el sistema puede detectar.
 */
export const PRIORIDAD: Record<ClaveEntrenamiento, number> = {
  asistencia:             2,
  puntualidad:            3,
  procedimiento_registro: 4,
  rondas:                 5,
  uniforme:               6,
  libro_guardia:          7,
  calidad_evidencias:     8,
}

export const DIMENSION_DE: Record<ClaveEntrenamiento, ClaveDimension> = {
  asistencia:             'asistencia',
  puntualidad:            'puntualidad',
  procedimiento_registro: 'procedimiento',
  rondas:                 'rondas',
  uniforme:               'uniforme',
  libro_guardia:          'libro_guardia',
  calidad_evidencias:     'evidencias',
}

/**
 * Cuánto pesa lo que pasó.
 *
 *   aislada        una vez. Se registra y se puede ver en la app, pero NO se
 *                  notifica: mandarle un aviso a alguien por un error único es
 *                  la forma más rápida de que deje de leer los avisos.
 *   reincidencia   volvió a pasar. Ahí sí corresponde recordarlo.
 *   patron         pasa seguido o en una proporción alta de sus requerimientos.
 *                  Además de avisarle, el supervisor lo ve.
 */
export type Severidad = 'aislada' | 'reincidencia' | 'patron'

export const UMBRAL = {
  /** A partir de acá deja de ser un error suelto. */
  reincidencia: 2,
  /** Cantidad que ya es patrón, sin mirar proporción. */
  patron: 4,
  /** O bien esta proporción de sus requerimientos… */
  proporcionPatron: 0.3,
  /** …siempre que haya suficientes requerimientos como para que signifique algo. */
  minimoParaProporcion: 5,
}

export function severidadDe(incidencias: number, requeridos: number): Severidad | null {
  if (incidencias <= 0) return null
  if (incidencias >= UMBRAL.patron) return 'patron'
  if (requeridos >= UMBRAL.minimoParaProporcion
      && incidencias / requeridos >= UMBRAL.proporcionPatron) return 'patron'
  if (incidencias >= UMBRAL.reincidencia) return 'reincidencia'
  return 'aislada'
}

/** Días que tienen que pasar antes de repetir el MISMO entrenamiento. */
export const COOLDOWN_DIAS: Record<Severidad, number> = {
  // No se notifica, así que no tiene ventana: queda en la app.
  aislada:      0,
  reincidencia: 21,
  patron:       14,
}

export interface Ensenanza {
  clave: ClaveEntrenamiento
  dimension: ClaveDimension
  prioridad: number
  severidad: Severidad
  /** Por qué se disparó. Para el supervisor, no para el vigilador. */
  motivo: string
  /** El mensaje, tal como lo lee el vigilador. Accionable, sin puntaje. */
  texto: string
  /** Los datos que lo sustentan. Sin esto no se puede auditar el mensaje. */
  hechos: string[]
  incidencias: number
  requeridos: number
  notificar: boolean
  cooldownDias: number
  /** `entrenamiento_operativo:<clave>:<periodo>`. Es también la llave de dedupe. */
  clavePush: string
  periodo: string
}

export const PREFIJO_PUSH = 'entrenamiento_operativo'

export function clavePush(clave: ClaveEntrenamiento, periodo: string): string {
  return `${PREFIJO_PUSH}:${clave}:${periodo}`
}

// ── La entrada ──────────────────────────────────────────────────────────────

/**
 * Los hechos, ya medidos. Este módulo no consulta nada.
 *
 * Cada bloque trae incidencias y requeridos porque la enseñanza tiene que poder
 * decir "2 de 20", no "2". Un mensaje que dice sólo "2 rondas sin completar" es
 * el mismo para quien tenía 3 y para quien tenía 60.
 */
export interface EntradaEntrenador {
  periodo: string
  asistencia?: { ausencias: number; jornadas: number }
  puntualidad?: {
    impuntuales: number
    evaluadas: number
    /** El turno donde más llegó tarde. Sin esto el mensaje no puede ser concreto. */
    objetivo?: string | null
    horaInicio?: string | null
    /** Cuántas de esas tardanzas pasaron los 30 minutos. */
    graves?: number
  }
  procedimiento?: { incidencias: number; jornadas: number; sinRegistro: number; entradaSinSalida: number }
  rondas?: { incidencias: number; requeridos: number }
  uniforme?: { confirmadas: number; revisadas: number }
  libroGuardia?: { confirmadas: number; revisadas: number }
  calidad?: { noEvaluables: number; total: number }
  /** Ventanas de ronda pausadas por falta de capacitación. Genera enseñanza propia. */
  rondasSinCapacitacion?: number
}

// ── Los textos ──────────────────────────────────────────────────────────────
//
// Nunca genéricos. Cada uno dice qué pasó, con qué números, y qué hacer la
// próxima vez. "Tu desempeño es bajo" no le sirve a nadie: no dice qué cambiar.

const HORA_PREVIA_MIN = 15

function restarMinutos(hora: string, minutos: number): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hora)
  if (!m) return hora
  const total = (Number(m[1]) * 60 + Number(m[2]) - minutos + 1440) % 1440
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

const plural = (n: number, uno: string, varios: string) => (n === 1 ? uno : varios)

/**
 * Todas las enseñanzas que corresponden, de mayor a menor prioridad.
 *
 * Devuelve TODAS —incluidas las aisladas, que no se notifican— porque el
 * supervisor tiene que poder ver el cuadro completo. Quién recibe un aviso lo
 * decide `ensenanzaPrioritaria` más abajo.
 */
export function ensenanzasDeCumplimiento(e: EntradaEntrenador): Ensenanza[] {
  const out: Ensenanza[] = []

  const agregar = (
    clave: ClaveEntrenamiento,
    incidencias: number,
    requeridos: number,
    motivo: string,
    texto: string,
    hechos: string[],
  ) => {
    const severidad = severidadDe(incidencias, requeridos)
    if (!severidad) return
    out.push({
      clave,
      dimension: DIMENSION_DE[clave],
      prioridad: PRIORIDAD[clave],
      severidad,
      motivo,
      texto,
      hechos,
      incidencias,
      requeridos,
      // Una incidencia aislada NO dispara aviso. Se ve en la app y punto.
      notificar: severidad !== 'aislada',
      cooldownDias: COOLDOWN_DIAS[severidad],
      clavePush: clavePush(clave, e.periodo),
      periodo: e.periodo,
    })
  }

  // ── Asistencia ────────────────────────────────────────────────────────────
  if (e.asistencia && e.asistencia.ausencias > 0) {
    const { ausencias, jornadas } = e.asistencia
    agregar(
      'asistencia', ausencias, jornadas,
      `${ausencias} ausencia(s) confirmada(s) sobre ${jornadas} jornadas`,
      `Registramos ${ausencias} ${plural(ausencias, 'ausencia', 'ausencias')} en tus `
        + `${jornadas} ${plural(jornadas, 'jornada', 'jornadas')} del período. Si no vas a poder `
        + 'cubrir un turno, avisá con la mayor anticipación posible para que se pueda '
        + 'reasignar a tiempo.',
      [`${ausencias} de ${jornadas} jornadas`],
    )
  }

  // ── Puntualidad ───────────────────────────────────────────────────────────
  //
  // Sin ingresos propios evaluables NO se dice nada. Si no fichó él, no sabemos
  // a qué hora llegó, y "llegaste tarde" sería una acusación inventada.
  if (e.puntualidad && e.puntualidad.evaluadas > 0 && e.puntualidad.impuntuales > 0) {
    const p = e.puntualidad
    const hora = p.horaInicio ?? null
    const donde = p.objetivo ? ` en ${p.objetivo}` : ''
    const cuando = hora
      ? `Tu turno${donde} comienza a las ${hora}. Podés fichar desde las ${restarMinutos(hora, HORA_PREVIA_MIN)}. `
        + `Las entradas posteriores a las ${hora} cuentan como ingreso fuera de horario.`
      : 'Varios de tus ingresos quedaron registrados después de la hora de inicio del turno. '
        + `Podés fichar desde ${HORA_PREVIA_MIN} minutos antes del inicio.`
    agregar(
      'puntualidad', p.impuntuales, p.evaluadas,
      `${p.impuntuales} de ${p.evaluadas} ingresos posteriores al horario programado`
        + (p.graves ? `, ${p.graves} de más de 30 minutos` : ''),
      `${p.impuntuales} de tus ${p.evaluadas} ingresos quedaron registrados después del horario. ${cuando}`,
      [
        `${p.impuntuales} de ${p.evaluadas} ingresos`,
        ...(hora ? [`turno ${hora}${donde}`] : []),
        ...(p.graves ? [`${p.graves} de más de 30 minutos`] : []),
      ],
    )
  }

  // ── Procedimiento / uso de la app ─────────────────────────────────────────
  if (e.procedimiento && e.procedimiento.incidencias > 0) {
    const p = e.procedimiento
    const detalle: string[] = []
    if (p.sinRegistro > 0) {
      detalle.push(`${p.sinRegistro} ${plural(p.sinRegistro, 'jornada trabajada', 'jornadas trabajadas')} sin registro propio`)
    }
    if (p.entradaSinSalida > 0) {
      detalle.push(`${p.entradaSinSalida} ${plural(p.entradaSinSalida, 'entrada', 'entradas')} sin salida registrada`)
    }
    agregar(
      'procedimiento_registro', p.incidencias, p.jornadas,
      detalle.join(' y '),
      `En ${p.incidencias} de tus ${p.jornadas} ${plural(p.jornadas, 'jornada', 'jornadas')} tu asistencia `
        + 'tuvo que ser confirmada por el supervisor porque el registro quedó incompleto. '
        + 'Marcá la entrada al llegar y la salida al terminar el turno: si no marcás la salida, '
        + 'el sistema cierra el registro solo y tu jornada queda sin tu propio dato.',
      detalle,
    )
  }

  // ── Rondas ────────────────────────────────────────────────────────────────
  if (e.rondas && e.rondas.incidencias > 0) {
    const r = e.rondas
    agregar(
      'rondas', r.incidencias, r.requeridos,
      `${r.incidencias} de ${r.requeridos} rondas requeridas sin completar`,
      `Tenías ${r.requeridos} ${plural(r.requeridos, 'ronda requerida', 'rondas requeridas')} y `
        + `${plural(r.incidencias, 'quedó 1 sin completar', `quedaron ${r.incidencias} sin completar`)}. `
        + 'Recordá iniciar la ronda desde la app dentro de su horario y registrar cada punto indicado '
        + 'hasta finalizarla. Si un punto no te toma la ubicación, avisá al supervisor antes de terminar el turno.',
      [`${r.incidencias} de ${r.requeridos} rondas requeridas`],
    )
  }

  // Rondas pausadas porque falta enseñarlas. No es incumplimiento del
  // vigilador y aun así es exactamente el caso donde hay que enseñar.
  if (e.rondasSinCapacitacion && e.rondasSinCapacitacion > 0) {
    out.push({
      clave: 'rondas',
      dimension: 'rondas',
      prioridad: PRIORIDAD.rondas,
      severidad: 'patron',
      motivo: `${e.rondasSinCapacitacion} ventanas de ronda pausadas por falta de capacitación`,
      texto: 'Tus rondas están pausadas porque todavía falta enseñarte a hacerlas. '
        + 'Coordiná con tu supervisor una recorrida guiada: se inicia la ronda desde la app, '
        + 'se recorre cada punto indicado y se registra en el orden en que aparecen.',
      hechos: [`${e.rondasSinCapacitacion} ventanas pausadas por capacitación`],
      incidencias: 0,
      requeridos: e.rondasSinCapacitacion,
      notificar: true,
      cooldownDias: COOLDOWN_DIAS.patron,
      clavePush: clavePush('rondas', e.periodo),
      periodo: e.periodo,
    })
  }

  // ── Uniforme ──────────────────────────────────────────────────────────────
  //
  // Sólo lo CONFIRMADO por una persona. Una observación de la IA sin revisar no
  // es una falta, y no puede convertirse en un mensaje que le diga a alguien
  // que se vistió mal.
  if (e.uniforme && e.uniforme.confirmadas > 0) {
    const u = e.uniforme
    agregar(
      'uniforme', u.confirmadas, u.revisadas,
      `${u.confirmadas} de ${u.revisadas} evidencias con observación de uniforme confirmada por una persona`,
      `En ${u.confirmadas} de tus ${u.revisadas} evidencias revisadas se verificó una observación `
        + 'sobre el uniforme. Al ingresar, asegurate de que se vea claramente la vestimenta '
        + 'reglamentaria completa y de que la foto esté bien iluminada y encuadrada.',
      [`${u.confirmadas} de ${u.revisadas} evidencias revisadas`],
    )
  }

  // ── Libro de guardia ──────────────────────────────────────────────────────
  if (e.libroGuardia && e.libroGuardia.confirmadas > 0) {
    const l = e.libroGuardia
    agregar(
      'libro_guardia', l.confirmadas, l.revisadas,
      `${l.confirmadas} de ${l.revisadas} registros de libro con observación confirmada por una persona`,
      `En ${l.confirmadas} de tus ${l.revisadas} registros del libro de guardia revisados se verificó `
        + 'una observación. Antes de sacar la foto comprobá que estén la fecha, el horario, '
        + 'las novedades y la firma, y que todo se lea con claridad.',
      [`${l.confirmadas} de ${l.revisadas} registros revisados`],
    )
  }

  // ── Calidad de la evidencia ───────────────────────────────────────────────
  if (e.calidad && e.calidad.noEvaluables > 0) {
    const c = e.calidad
    agregar(
      'calidad_evidencias', c.noEvaluables, c.total,
      `${c.noEvaluables} de ${c.total} fotos no permitieron evaluar lo que mostraban`,
      `${c.noEvaluables} de tus ${c.total} fotos no permitieron verificar lo que mostraban. `
        + 'Sacá la foto con buena luz, sin movimiento y con lo que se pide completo dentro del cuadro. '
        + 'Si sale oscura o borrosa, repetila antes de continuar.',
      [`${c.noEvaluables} de ${c.total} fotos`],
    )
  }

  return out.sort((a, b) => a.prioridad - b.prioridad)
}

// ── A quién se le manda, y cuándo ───────────────────────────────────────────

export interface EnvioPrevio {
  clave: string
  periodo: string
  /** ISO. Cuándo se le mandó. */
  enviadoEn: string
}

const DIA_MS = 24 * 60 * 60 * 1000

/**
 * ¿Corresponde notificar ESTA enseñanza ahora?
 *
 * Tres cortes, en orden:
 *   1. Una incidencia aislada nunca se notifica.
 *   2. El mismo entrenamiento del mismo período no se manda dos veces, aunque
 *      el cooldown ya haya pasado. El período ya está cerrado en su mensaje.
 *   3. El mismo entrenamiento de otro período espera su cooldown.
 */
export function correspondeNotificar(
  e: Ensenanza, previos: EnvioPrevio[], ahora: Date,
): boolean {
  if (!e.notificar) return false

  for (const p of previos) {
    if (p.clave !== e.clave) continue
    if (p.periodo === e.periodo) return false
    const cuando = Date.parse(p.enviadoEn)
    if (!Number.isFinite(cuando)) continue
    if (ahora.getTime() - cuando < e.cooldownDias * DIA_MS) return false
  }
  return true
}

/**
 * UNA sola enseñanza por vez. La más prioritaria que corresponda notificar.
 *
 * Alguien con cinco problemas no recibe cinco mensajes: recibe el que más
 * importa. Cinco avisos el mismo día no enseñan cinco cosas — enseñan a
 * silenciar las notificaciones.
 */
export function ensenanzaPrioritaria(
  ensenanzas: Ensenanza[], previos: EnvioPrevio[], ahora: Date,
): Ensenanza | null {
  const elegibles = ensenanzas
    .filter(e => correspondeNotificar(e, previos, ahora))
    .sort((a, b) => a.prioridad - b.prioridad)
  return elegibles[0] ?? null
}

// ── El momento del envío ────────────────────────────────────────────────────

export const CLAVE_DIA_ENVIO = 'entrenamiento_dia_semana'
export const CLAVE_HORA_ENVIO = 'entrenamiento_hora_envio'

/** Lunes a la mañana. Configurable, y con un default explícito. */
export const ENVIO_POR_DEFECTO = { dia: 1, hora: '10:00' }

/** Ventana en la que el cron puede disparar, desde la hora configurada. */
export const VENTANA_ENVIO_MIN = 60

export interface ContextoMomento {
  /** 0 = domingo. Hora local de la operación, no del proceso. */
  diaSemana: number
  horaLocal: string
  diaConfigurado?: number | null
  horaConfigurada?: string | null
  /** Está en turno ahora mismo. */
  trabajando: boolean
}

function aMinutos(hora: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hora)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

/**
 * ¿Es momento de mandar?
 *
 * Nunca mientras la persona está trabajando: un aviso sobre cómo debería haber
 * hecho la ronda del mes pasado, en mitad de su turno, es una distracción en un
 * puesto de vigilancia. Se manda fuera de horario, el día configurado.
 *
 * El día y la hora salen de `app_config`, con default explícito. No hay ningún
 * nombre ni horario particular escrito en el código.
 */
export function esMomentoDeEnviar(c: ContextoMomento): boolean {
  if (c.trabajando) return false

  const dia = Number.isFinite(Number(c.diaConfigurado)) && c.diaConfigurado !== null
    ? Number(c.diaConfigurado) : ENVIO_POR_DEFECTO.dia
  if (c.diaSemana !== dia) return false

  const desde = aMinutos(String(c.horaConfigurada ?? ENVIO_POR_DEFECTO.hora))
  const ahora = aMinutos(c.horaLocal)
  if (desde === null || ahora === null) return false

  return ahora >= desde && ahora < desde + VENTANA_ENVIO_MIN
}

// ── ¿Sirvió? ────────────────────────────────────────────────────────────────

export type SentidoEvolucion = 'mejora' | 'empeora' | 'igual' | 'sin_datos'

export interface Evolucion {
  antes: number | null
  despues: number | null
  delta: number | null
  sentido: SentidoEvolucion
  texto: string
}

/**
 * Cómo le fue después del mensaje. Sobre la MISMA métrica, no sobre el X/10.
 *
 * Deliberadamente no produce una "nota por aprendizaje". Convertir la mejora en
 * puntaje haría que a quien nunca falló le convenga haber fallado antes para
 * poder mejorar, y castigaría a quien ya venía bien. Esto describe, no puntúa.
 */
export function evolucion(antes: number | null, despues: number | null): Evolucion {
  if (antes === null || despues === null) {
    return { antes, despues, delta: null, sentido: 'sin_datos', texto: 'Todavía sin período posterior para comparar' }
  }
  const delta = Math.round((despues - antes) * 100) / 100
  const sentido: SentidoEvolucion = delta > 0.05 ? 'mejora' : delta < -0.05 ? 'empeora' : 'igual'
  const coma = (v: number) => v.toFixed(1).replace('.', ',')
  const texto =
    sentido === 'mejora'  ? `Mejoró: ${coma(antes)} → ${coma(despues)}`
    : sentido === 'empeora' ? `Empeoró: ${coma(antes)} → ${coma(despues)}`
    :                         `Sin cambio: ${coma(antes)}`
  return { antes, despues, delta, sentido, texto }
}

export const ETIQUETA_SEVERIDAD: Record<Severidad, string> = {
  aislada:      'Incidencia aislada',
  reincidencia: 'Reincidencia',
  patron:       'Patrón persistente',
}

export const ETIQUETA_ENTRENAMIENTO: Record<ClaveEntrenamiento, string> = {
  asistencia:             'Asistencia',
  puntualidad:            'Puntualidad',
  procedimiento_registro: 'Registro de entrada y salida',
  rondas:                 'Rondas',
  uniforme:               'Uniforme',
  libro_guardia:          'Libro de guardia',
  calidad_evidencias:     'Calidad de las fotos',
}
