// Resultado de la intervención en alertas de ronda (auditoría de octubre 2026).
//
// Funciones PURAS: no consultan ni escriben. Las usan el formulario de
// intervención, el cartel del supervisor móvil y los recordatorios al vigilador.
//
// La regla (migración 20261115120000):
//   · Intervenir exige elegir un RESULTADO —resuelto / seguimiento / no
//     resuelto— y un MOTIVO. "Llamé al vigilador" sin resultado dejaba la alerta
//     pendiente para siempre: 328 de 386 alertas de octubre seguían abiertas.
//   · 'seguimiento' deja la alerta pendiente con plazo (máx. 4 h). Vencido el
//     plazo, la alerta vuelve a pedir un resultado definitivo.
//   · Una alerta por EPISODIO de ronda+turno: las ventanas siguientes se cuentan
//     en la misma alerta en lugar de generar avisos nuevos.

export type ResultadoIntervencion = 'resuelto' | 'seguimiento' | 'no_resuelto'
export type MotivoIntervencion =
  | 'ronda_realizada'
  | 'error_tecnico'
  | 'administrativa'
  | 'incumplimiento'
  | 'otro'

export const RESULTADOS_INTERVENCION: readonly ResultadoIntervencion[] = ['resuelto', 'seguimiento', 'no_resuelto']

export function etiquetaResultadoIntervencion(r: ResultadoIntervencion): string {
  switch (r) {
    case 'resuelto':    return 'Resuelto'
    case 'seguimiento': return 'Seguimiento'
    case 'no_resuelto': return 'No resuelto'
  }
}

export function ayudaResultadoIntervencion(r: ResultadoIntervencion): string {
  switch (r) {
    case 'resuelto':    return 'Cierra la alerta.'
    case 'seguimiento': return 'Sigue pendiente hasta el plazo; después pide un resultado definitivo.'
    case 'no_resuelto': return 'Cierra la alerta como incumplimiento confirmado.'
  }
}

export function etiquetaMotivoIntervencion(m: MotivoIntervencion): string {
  switch (m) {
    case 'ronda_realizada': return 'Ronda realizada'
    case 'error_tecnico':   return 'Error técnico'
    case 'administrativa':  return 'Administrativa'
    case 'incumplimiento':  return 'Incumplimiento'
    case 'otro':            return 'Otro'
  }
}

/**
 * Motivos que tienen sentido para cada resultado. Las mismas combinaciones que
 * acepta el servidor (resolver_ronda_alerta devuelve 'combinacion_invalida' con
 * las demás): un incumplimiento no se "resuelve", y un "no resuelto" sólo puede
 * ser incumplimiento u otro.
 */
export function motivosParaResultado(r: ResultadoIntervencion): MotivoIntervencion[] {
  switch (r) {
    case 'resuelto':    return ['ronda_realizada', 'error_tecnico', 'administrativa', 'otro']
    case 'seguimiento': return ['error_tecnico', 'administrativa', 'incumplimiento', 'otro']
    case 'no_resuelto': return ['incumplimiento', 'otro']
  }
}

/** Plazos de seguimiento ofrecidos (minutos). El servidor acepta 15 a 240. */
export const PLAZOS_SEGUIMIENTO_MIN: readonly number[] = [30, 60, 120, 240]
export const PLAZO_SEGUIMIENTO_DEFECTO_MIN = 120

export interface FormularioIntervencion {
  resultado: ResultadoIntervencion | null
  motivo: MotivoIntervencion | null
  comentario: string
  /** Acción registrada (qué hizo): llamada, solicitud, justificación, cierre. */
  accion: string
  seguimientoMin?: number | null
}

/**
 * ¿Qué falta para poder registrar? `null` = listo. Mismo criterio que el
 * servidor, para no hacer un viaje que se sabe rechazado.
 */
export function faltaParaRegistrar(f: FormularioIntervencion): string | null {
  if (!f.resultado) return 'Elegí el resultado.'
  if (!f.motivo) return 'Elegí el motivo.'
  if (!motivosParaResultado(f.resultado).includes(f.motivo)) return 'Ese motivo no corresponde a ese resultado.'
  if (f.accion === 'justificacion' && f.resultado !== 'resuelto') return 'Una justificación sólo puede dar la alerta por resuelta.'
  if (f.accion === 'resuelta' && f.resultado !== 'resuelto') return 'Elegí "Resuelto" para marcarla resuelta.'
  if (f.accion === 'cierre_administrativo') {
    if (f.resultado === 'seguimiento') return 'El cierre administrativo es definitivo: no admite seguimiento.'
    if (f.comentario.trim().length < 10) return 'El cierre administrativo requiere un comentario de al menos 10 caracteres.'
  }
  if (f.motivo === 'otro' && f.comentario.trim().length === 0) return 'Con motivo "Otro" el comentario es obligatorio.'
  if (f.resultado === 'seguimiento') {
    const m = f.seguimientoMin ?? PLAZO_SEGUIMIENTO_DEFECTO_MIN
    if (m < 15 || m > 240) return 'El seguimiento puede durar entre 15 minutos y 4 horas.'
  }
  return null
}

/** Lo mínimo de una alerta que necesitan estas reglas. */
export interface AlertaIntervenible {
  estado: string
  intervenciones?: number | null
  resultado_intervencion?: ResultadoIntervencion | null
  motivo_intervencion?: MotivoIntervencion | null
  seguimiento_hasta?: string | null
  seguimiento_vencido?: boolean | null
}

/** ¿El seguimiento de esta alerta ya venció? */
export function seguimientoVencido(a: AlertaIntervenible, ahora: number = Date.now()): boolean {
  if (a.estado !== 'pendiente') return false
  if (typeof a.seguimiento_vencido === 'boolean') return a.seguimiento_vencido
  if (a.resultado_intervencion !== 'seguimiento' || !a.seguimiento_hasta) return false
  const t = Date.parse(a.seguimiento_hasta)
  return Number.isFinite(t) && t <= ahora
}

/**
 * ¿La alerta espera una acción del supervisor? Lo que cuenta el cartel.
 *
 * Antes contaba toda pendiente, también las ya intervenidas: el supervisor que
 * llamaba al vigilador seguía viendo "N alertas esperando tu intervención".
 * Ahora: pendiente SIN intervención, o en seguimiento con el plazo vencido.
 * Una pendiente con intervenciones viejas sin resultado (historial previo al
 * cambio) también cuenta: nadie decidió todavía qué pasó.
 */
export function alertaEsperaIntervencion(a: AlertaIntervenible, ahora: number = Date.now()): boolean {
  if (a.estado !== 'pendiente') return false
  if (a.resultado_intervencion === 'seguimiento') return seguimientoVencido(a, ahora)
  return true
}

/** "Seguimiento hasta las 14:30" / "Seguimiento vencido". */
export function etiquetaSeguimiento(a: AlertaIntervenible, horaDe: (iso: string) => string, ahora: number = Date.now()): string | null {
  if (a.estado !== 'pendiente' || a.resultado_intervencion !== 'seguimiento' || !a.seguimiento_hasta) return null
  return seguimientoVencido(a, ahora)
    ? 'Seguimiento vencido: falta el resultado definitivo'
    : `En seguimiento hasta las ${horaDe(a.seguimiento_hasta)}`
}

/** Alerta con lo necesario para decidir si se le sigue recordando al vigilador. */
export interface AlertaRondaTurno extends AlertaIntervenible {
  ronda_base_id: string
  turno_id: string
  tipo: string
  /** Toda intervención deja su acción en la alerta: alcanza para saber si la hubo. */
  accion?: string | null
}

/**
 * Claves `${ronda_base_id}:${turno_id}` en las que ya NO hay que recordarle la
 * ronda al vigilador (push 15'/pendiente y WhatsApp +10'):
 *   · hay una alerta pendiente con intervención (el supervisor ya está en el
 *     tema: el seguimiento es suyo, no del recordatorio automático);
 *   · el episodio se cerró como 'no_resuelto' (incumplimiento confirmado) o
 *     'resuelto' por un motivo que cubre el turno (error técnico,
 *     administrativa, otro).
 * Un 'resuelto' por ronda realizada NO silencia: la próxima ronda se recuerda.
 */
export function clavesRondaTurnoSilenciadas(alertas: AlertaRondaTurno[]): Set<string> {
  const claves = new Set<string>()
  for (const a of alertas) {
    if (a.tipo !== 'no_iniciada' && a.tipo !== 'no_finalizada') continue
    const intervenida = (a.intervenciones ?? 0) > 0 || a.accion != null || a.resultado_intervencion != null
    const silencia = a.estado === 'pendiente'
      ? intervenida
      : a.resultado_intervencion === 'no_resuelto'
        || (a.resultado_intervencion === 'resuelto' && a.motivo_intervencion !== 'ronda_realizada')
    if (silencia) claves.add(`${a.ronda_base_id}:${a.turno_id}`)
  }
  return claves
}
