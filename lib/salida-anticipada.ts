// Cuánto falta para que termine un turno, para avisar antes de una salida
// claramente prematura.
//
// ── El caso que lo motivó ───────────────────────────────────────────────────
// Un vigilador con turno 07:00–19:00 fichó la salida a las 08:14, una hora y
// cuarto después de entrar. El turno quedó cerrado el resto del día. Cuando
// Administración lo vio, ya habían pasado las 3 horas y la ventana de 30
// minutos para anular el egreso desde la app estaba vencida: hubo que
// corregirlo directamente en la base.
//
// El botón de salida está al lado del de rondas y se toca sin querer. Un turno
// de doce horas no se cierra a la hora y cuarto.
//
// ── Lo que NO hace ──────────────────────────────────────────────────────────
// Impedir la salida. Una salida anticipada real existe —un relevo, una
// emergencia, una licencia a mitad de turno— y tiene que poder registrarse sin
// pedirle permiso a nadie. Esto sólo pregunta.

/** Un turno de doce horas no se cierra a la hora y cuarto; a la undécima, sí. */
export const MINUTOS_AVISO_SALIDA_ANTICIPADA = 60

export interface TurnoConHorario {
  hora_inicio?: string | null
  hora_fin?: string | null
}

const aMinutos = (hhmm?: string | null): number | null => {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

/**
 * Minutos que faltan para el fin del turno. Negativo si ya terminó, `null` si
 * el horario no se puede leer — y ahí no se avisa nada: no se molesta a nadie
 * por un dato que falta.
 *
 * Los turnos NOCTURNOS (fin <= inicio) terminan al día siguiente, así que el
 * fin se corre 24 horas. Sin esto, alguien con turno 19:00–07:00 que ficha la
 * salida a las 06:00 vería el aviso todas las noches, con el resultado
 * previsible de que nadie lo lee más.
 */
export function minutosHastaFinDeTurno(
  turno: TurnoConHorario,
  ahora: Date = new Date(),
): number | null {
  const inicio = aMinutos(turno.hora_inicio)
  const fin = aMinutos(turno.hora_fin)
  if (fin === null) return null

  const ahoraMin = ahora.getHours() * 60 + ahora.getMinutes()
  const nocturno = inicio !== null && fin <= inicio

  if (!nocturno) return fin - ahoraMin

  // Nocturno: antes de medianoche falta hasta el fin del día siguiente; después
  // de medianoche ya estamos en el tramo final y falta lo que queda del día.
  return ahoraMin >= inicio ? fin + 24 * 60 - ahoraMin : fin - ahoraMin
}

/**
 * El aviso de cualquier salida anterior al fin del servicio, aunque falte un
 * minuto.
 *
 * Decisión de Gerencia del 08/10/2026: llegar antes no autoriza a irse antes y
 * la tolerancia administrativa de 15 minutos no es un permiso. El aviso NO
 * bloquea —una salida autorizada o una emergencia tienen que poder
 * registrarse, y el registro tiene que reflejar lo que pasó—, pero tampoco deja
 * que alguien se vaya creyendo que la app lo habilitó.
 *
 * `null` cuando no falta nada o el horario no se puede leer.
 */
export function textoAvisoSalidaAnticipada(
  turno: TurnoConHorario,
  ahora: Date = new Date(),
): string | null {
  const faltan = minutosHastaFinDeTurno(turno, ahora)
  if (faltan === null || faltan <= 0) return null
  const fin = (turno.hora_fin || '').slice(0, 5)
  const h = Math.floor(faltan / 60)
  const m = faltan % 60
  const cuanto = h > 0 ? `${h} h ${m} min` : `${m} min`
  return `Tu servicio termina a las ${fin} y todavía faltan ${cuanto}.\n\n`
    + 'Llegar antes no te autoriza a retirarte antes. Sólo podés retirarte antes '
    + 'con autorización expresa de tu supervisor o de un superior.\n\n'
    + 'Si registrás la salida ahora, quedará como salida anticipada y Supervisión la va a revisar. '
    + 'Retirarse antes sin autorización es una falta grave.\n\n'
    + '¿Registrar la salida igual?'
}

/** ¿Corresponde preguntar antes de registrar esta salida? */
export function esSalidaMuyAnticipada(
  turno: TurnoConHorario,
  ahora: Date = new Date(),
): boolean {
  const faltan = minutosHastaFinDeTurno(turno, ahora)
  return faltan !== null && faltan > MINUTOS_AVISO_SALIDA_ANTICIPADA
}
