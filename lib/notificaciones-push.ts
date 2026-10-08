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

/**
 * Con cuánta anticipación se pide presentarse al puesto: el tiempo de recibir
 * el puesto y las novedades del servicio con el relevo.
 *
 * ── Es un recordatorio, NO una medición ──────────────────────────────────────
 * Gerencia (08/10/2026): no se puede contar como impuntualidad llegar dentro de
 * esos 15 minutos, aunque el Estatuto Interno pida la presentación anticipada.
 * Puntualidad sigue midiendo contra la hora de inicio (lib/cumplimiento.ts) y
 * esto no lo toca: sólo cambia lo que dicen los avisos previos al turno.
 *
 * Por la misma razón el texto no habla de faltas ni de sanciones: la cláusula
 * del Estatuto está pendiente de revisión legal.
 */
export const MINUTOS_PRESENTACION_SUGERIDA = 15

/** "07:00" → "06:45". Cruza medianoche: "00:10" → "23:55". */
export function horaDePresentacion(horaInicio: string, anticipacion = MINUTOS_PRESENTACION_SUGERIDA): string | null {
  const m = minutosDeHora(horaInicio)
  if (m === null) return null
  const t = (((m - anticipacion) % 1440) + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

export interface AvisoPush { title: string; body: string }

/** Primer aviso (entre 35 y 20 minutos antes): cuándo presentarse. */
export function avisoTurnoProximo(objetivo: string, horaInicio: string): AvisoPush {
  const inicio = horaInicio.slice(0, 5)
  const presentarse = horaDePresentacion(inicio)
  return {
    title: 'Turno próximo',
    body: presentarse
      ? `Tiene turno en ${objetivo} a las ${inicio}. Preséntese a las ${presentarse} para recibir `
        + 'el puesto y las novedades del servicio.'
      : `Tiene turno en ${objetivo} a las ${inicio}`,
  }
}

/** Segundo aviso (entre 20 y 5 minutos antes): ya es el momento de estar ahí. */
export function avisoPrepararIngreso(objetivo: string, horaInicio: string): AvisoPush {
  return {
    title: 'Preparar ingreso',
    body: `Su turno en ${objetivo} empieza a las ${horaInicio.slice(0, 5)}. Es momento de estar `
      + 'en el puesto para recibir las novedades y fichar el ingreso.',
  }
}
