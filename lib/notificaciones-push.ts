/**
 * lib/notificaciones-push.ts
 *
 * Reglas de CUÁNDO corresponde cada aviso al vigilador. Puro: no consulta
 * Supabase, no envía nada, no sabe de suscripciones. Solo decide.
 *
 * Existe para que las ventanas de tiempo —que son lo fácil de romper y lo
 * imposible de probar dentro de una ruta— tengan tests propios. El envío, la
 * deduplicación y las suscripciones viven en app/api/_lib/push-notificaciones.
 */

/** Minutos desde medianoche. null si la hora no se puede interpretar. */
export function minutosDeHora(hora?: string | null): number | null {
  if (!hora) return null
  const [h, m] = hora.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

/**
 * Un turno es nocturno cuando termina antes o a la misma hora en que empieza:
 * cruza la medianoche. Misma regla que usa el resto del sistema.
 */
export function esNocturno(horaInicio: string, horaFin: string): boolean {
  const i = minutosDeHora(horaInicio)
  const f = minutosDeHora(horaFin)
  if (i === null || f === null) return false
  return f <= i
}

/**
 * Minutos transcurridos desde que terminó el turno.
 *
 * `ahoraMin` y el turno se expresan en minutos absolutos desde una época común
 * (lo que arma fechaHoraMinutos en la ruta), así que el cruce de medianoche se
 * resuelve sumando un día al fin cuando el turno es nocturno.
 *
 * Negativo = el turno todavía no terminó.
 */
export function minutosDesdeFinDeTurno(params: {
  inicioAbsMin: number
  horaInicio: string
  horaFin: string
  ahoraMin: number
}): number | null {
  const i = minutosDeHora(params.horaInicio)
  const f = minutosDeHora(params.horaFin)
  if (i === null || f === null) return null

  // El fin, medido desde el inicio del turno: dura (fin - inicio), y si es
  // nocturno se le suma un día entero.
  const duracion = esNocturno(params.horaInicio, params.horaFin)
    ? f + 1440 - i
    : f - i

  return params.ahoraMin - (params.inicioAbsMin + duracion)
}

// ── Recordatorio de egreso ───────────────────────────────────────────────────

/**
 * Ventana del aviso "marcá la salida", en minutos después del fin del turno.
 *
 * Arranca a los 5 para no apurar a nadie que está justo cerrando, y termina a
 * los 20 porque el cierre automático actúa a los 30: quedan 10 minutos de
 * margen para que marque él antes de que se lo cierre el sistema.
 */
export const EGRESO_AVISO_DESDE_MIN = 5
export const EGRESO_AVISO_HASTA_MIN = 20

export interface ContextoEgreso {
  /** Minutos absolutos del inicio del turno. */
  inicioAbsMin: number
  horaInicio: string
  horaFin: string
  /** El vigilador fichó la entrada. */
  tieneEntrada: boolean
  /** Ya registró la salida (real o reconocida). */
  tieneSalida: boolean
  /** El registro fue cerrado por el sistema: no corresponde pedirle nada. */
  cierreAutomatico?: boolean
  ahoraMin: number
}

/**
 * ¿Corresponde avisarle que marque la salida?
 *
 * No cierra nada ni toca horas: sólo decide si mandar el aviso. La
 * deduplicación (una sola vez por turno) la resuelve `notificaciones_enviadas`
 * con el tipo `guardia_egreso_pendiente`.
 */
export function debeAvisarEgresoPendiente(c: ContextoEgreso): boolean {
  if (!c.tieneEntrada) return false
  if (c.tieneSalida) return false
  if (c.cierreAutomatico) return false

  const desdeFin = minutosDesdeFinDeTurno({
    inicioAbsMin: c.inicioAbsMin,
    horaInicio: c.horaInicio,
    horaFin: c.horaFin,
    ahoraMin: c.ahoraMin,
  })
  if (desdeFin === null) return false

  return desdeFin >= EGRESO_AVISO_DESDE_MIN && desdeFin <= EGRESO_AVISO_HASTA_MIN
}

export const TEXTO_EGRESO_PENDIENTE = (objetivo: string) =>
  `Terminó tu turno en ${objetivo}. Marcá la salida en la aplicación.`

export const TIPO_EGRESO_PENDIENTE = 'guardia_egreso_pendiente'

// ── Recordatorios de turno ───────────────────────────────────────────────────

/**
 * Cuál de los dos recordatorios previos corresponde, según cuántos minutos
 * faltan para el inicio. Son las ventanas que ya usaba la ruta; se extraen para
 * poder probarlas y para que no queden como números sueltos en un `if`.
 */
export function recordatorioDeTurno(minutosHastaInicio: number): '30' | '15' | null {
  if (minutosHastaInicio >= 20 && minutosHastaInicio <= 35) return '30'
  if (minutosHastaInicio >= 5 && minutosHastaInicio <= 20) return '15'
  return null
}
