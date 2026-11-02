/**
 * lib/validacion-turnos.ts
 *
 * Validación pura de la carga de un vigilador al crear o editar un turno.
 *
 * Una sola regla bloquea: la SUPERPOSICIÓN (el mismo vigilador en dos turnos a
 * la vez). Su espejo en la base es el trigger `turnos_validar_superposicion`
 * (migración 20261121120000), que es la autoridad: esto sólo evita el viaje.
 *
 * El resto son ADVERTENCIAS que se muestran y se pueden aceptar:
 *   · traslado_insuficiente — turnos seguidos en objetivos distintos sin el
 *     tiempo de traslado configurado entre el fin de uno y el inicio del otro
 *     (caso Eduardo Martínez 29/10: SRT 07–15 y Lotuf 15–23, 0 minutos).
 *   · jornada_excedida — turnos encadenados (pausa menor a la configurada) que
 *     suman más horas que el máximo de una jornada: un doble turno.
 *   · horas_diarias_excedidas — horas programadas del DÍA DE INICIO por encima
 *     del máximo. Un turno nocturno pertenece entero al día en que empieza.
 *   · descanso_insuficiente — entre dos jornadas hay menos descanso que el
 *     mínimo configurado.
 *
 * Fechas: se trabaja con minutos absolutos calculados desde la fecha y la hora
 * del turno, sin `Date` local. Las horas de los turnos ya son hora Argentina, y
 * así el resultado no depende de la zona horaria del navegador.
 */

import { ESTADOS_TURNO_SIN_OBLIGACION_COBERTURA } from '@/lib/turnos'

export interface TurnoCarga {
  id?: string | null
  guardia_id?: string | null
  objetivo_id?: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado?: string | null
}

export interface ConfigValidacionTurnos {
  /** Minutos mínimos entre turnos seguidos en objetivos distintos. */
  minutosTraslado: number
  /** Pausa máxima entre dos turnos para considerarlos la misma jornada. */
  minutosPausaMismaJornada: number
  /** Horas máximas de una jornada (turnos encadenados). */
  maxHorasJornada: number
  /** Horas máximas programadas en un mismo día de inicio. */
  maxHorasDia: number
  /** Horas mínimas de descanso entre jornadas. */
  minHorasDescanso: number
}

export const CONFIG_VALIDACION_TURNOS: ConfigValidacionTurnos = {
  minutosTraslado: 30,
  minutosPausaMismaJornada: 60,
  maxHorasJornada: 12,
  maxHorasDia: 12,
  minHorasDescanso: 12,
}

export type CodigoValidacionTurno =
  | 'superposicion'
  | 'traslado_insuficiente'
  | 'jornada_excedida'
  | 'horas_diarias_excedidas'
  | 'descanso_insuficiente'

export interface HallazgoValidacionTurno {
  codigo: CodigoValidacionTurno
  mensaje: string
  /** Turno existente con el que se produce el hallazgo, si corresponde. */
  turnoId?: string | null
  minutos?: number
  horas?: number
}

export interface ResultadoValidacionTurno {
  /** Bloquean el guardado (sólo superposición). */
  errores: HallazgoValidacionTurno[]
  /** Se informan y el usuario decide. */
  advertencias: HallazgoValidacionTurno[]
}

const MIN_DIA = 1440

/** Días desde 1970-01-01 para una fecha YYYY-MM-DD (sin zona horaria). */
function diaAbsoluto(fecha: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha ?? '')
  if (!m) return null
  return Math.floor(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000)
}

function minutosHora(hora: string): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(hora ?? '')
  if (!m) return null
  return Number(m[1]) * 60 + Number(m[2])
}

/**
 * Intervalo absoluto [inicio, fin) en minutos. Si el fin no es posterior al
 * inicio, el turno cruza la medianoche y termina al día siguiente — mismo
 * criterio que `rangoTurno`, `finProgramadoTurno` y las RPC.
 */
export function intervaloTurno(t: Pick<TurnoCarga, 'fecha' | 'hora_inicio' | 'hora_fin'>): { inicio: number; fin: number } | null {
  const dia = diaAbsoluto(t.fecha)
  const hi = minutosHora(t.hora_inicio)
  const hf = minutosHora(t.hora_fin)
  if (dia === null || hi === null || hf === null) return null
  const inicio = dia * MIN_DIA + hi
  const fin = dia * MIN_DIA + hf + (hf <= hi ? MIN_DIA : 0)
  return { inicio, fin }
}

export function duracionHorasTurno(t: Pick<TurnoCarga, 'fecha' | 'hora_inicio' | 'hora_fin'>): number {
  const r = intervaloTurno(t)
  return r ? (r.fin - r.inicio) / 60 : 0
}

/**
 * Turnos que cuentan para la carga del vigilador: tienen obligación y no son
 * de un objetivo pausado. Mismo universo que `tieneTurnoSuperpuesto`.
 */
function cuentaParaCarga(t: TurnoCarga, objetivosPausados?: Set<string> | null): boolean {
  if ((ESTADOS_TURNO_SIN_OBLIGACION_COBERTURA as readonly string[]).includes(t.estado ?? '')) return false
  if (objetivosPausados && t.objetivo_id && objetivosPausados.has(t.objetivo_id)) return false
  return true
}

const fmtHoras = (h: number) => (Math.round(h * 100) / 100).toString().replace('.', ',')

/**
 * Valida el candidato contra los turnos existentes del mismo vigilador.
 * `existentes` puede traer turnos de otros vigiladores: se filtran.
 * `excluirTurnoId` es el turno que se está editando.
 */
export function validarCargaTurno(
  candidato: TurnoCarga,
  existentes: TurnoCarga[],
  opciones: {
    excluirTurnoId?: string | null
    objetivosPausados?: Set<string> | null
    config?: Partial<ConfigValidacionTurnos>
  } = {},
): ResultadoValidacionTurno {
  const cfg = { ...CONFIG_VALIDACION_TURNOS, ...(opciones.config ?? {}) }
  const errores: HallazgoValidacionTurno[] = []
  const advertencias: HallazgoValidacionTurno[] = []

  if (!candidato.guardia_id) return { errores, advertencias }
  if (!cuentaParaCarga(candidato, null)) return { errores, advertencias }
  const rc = intervaloTurno(candidato)
  if (!rc) return { errores, advertencias }

  const excluir = opciones.excluirTurnoId ?? candidato.id ?? null
  const propios = existentes
    .filter(t => t.guardia_id === candidato.guardia_id)
    .filter(t => !excluir || t.id !== excluir)
    .filter(t => cuentaParaCarga(t, opciones.objetivosPausados))
    .map(t => ({ t, r: intervaloTurno(t) }))
    .filter((x): x is { t: TurnoCarga; r: { inicio: number; fin: number } } => x.r !== null)

  // 1) Superposición — único bloqueo.
  for (const { t, r } of propios) {
    if (r.inicio < rc.fin && rc.inicio < r.fin) {
      errores.push({
        codigo: 'superposicion',
        turnoId: t.id ?? null,
        mensaje: `Se superpone con el turno del ${t.fecha} ${t.hora_inicio.slice(0, 5)}–${t.hora_fin.slice(0, 5)}.`,
      })
    }
  }

  // 2) Traslado entre objetivos distintos (en ambos sentidos).
  for (const { t, r } of propios) {
    if (!t.objetivo_id || !candidato.objetivo_id || t.objetivo_id === candidato.objetivo_id) continue
    const hueco = r.fin <= rc.inicio ? rc.inicio - r.fin : rc.fin <= r.inicio ? r.inicio - rc.fin : null
    if (hueco !== null && hueco < cfg.minutosTraslado) {
      advertencias.push({
        codigo: 'traslado_insuficiente',
        turnoId: t.id ?? null,
        minutos: hueco,
        mensaje: `Entre este turno y el del ${t.fecha} ${t.hora_inicio.slice(0, 5)}–${t.hora_fin.slice(0, 5)} en otro objetivo hay ${hueco} min; el traslado configurado es de ${cfg.minutosTraslado} min.`,
      })
    }
  }

  // Línea de tiempo sin superpuestos (esos ya son error) para jornadas y descanso.
  const linea = [...propios.filter(({ r }) => !(r.inicio < rc.fin && rc.inicio < r.fin)), { t: candidato, r: rc }]
    .sort((a, b) => a.r.inicio - b.r.inicio)

  // 3) Jornadas: turnos encadenados con pausa <= minutosPausaMismaJornada.
  const jornadas: { inicio: number; fin: number; minutos: number; turnos: TurnoCarga[] }[] = []
  for (const x of linea) {
    const ultima = jornadas[jornadas.length - 1]
    if (ultima && x.r.inicio - ultima.fin <= cfg.minutosPausaMismaJornada) {
      ultima.fin = Math.max(ultima.fin, x.r.fin)
      ultima.minutos += x.r.fin - x.r.inicio
      ultima.turnos.push(x.t)
    } else {
      jornadas.push({ inicio: x.r.inicio, fin: x.r.fin, minutos: x.r.fin - x.r.inicio, turnos: [x.t] })
    }
  }
  const idxCand = jornadas.findIndex(j => j.turnos.includes(candidato))
  const jornada = jornadas[idxCand]
  if (jornada && jornada.turnos.length > 1 && jornada.minutos / 60 > cfg.maxHorasJornada) {
    advertencias.push({
      codigo: 'jornada_excedida',
      horas: jornada.minutos / 60,
      mensaje: `Doble turno: la jornada encadenada suma ${fmtHoras(jornada.minutos / 60)} h (máximo ${cfg.maxHorasJornada} h).`,
    })
  }

  // 4) Descanso entre la jornada del candidato y sus vecinas.
  for (const vecina of [jornadas[idxCand - 1], jornadas[idxCand + 1]]) {
    if (!vecina || !jornada) continue
    const descanso = vecina.fin <= jornada.inicio ? jornada.inicio - vecina.fin : vecina.inicio - jornada.fin
    if (descanso >= 0 && descanso / 60 < cfg.minHorasDescanso) {
      advertencias.push({
        codigo: 'descanso_insuficiente',
        minutos: descanso,
        mensaje: `Descanso de ${fmtHoras(descanso / 60)} h entre jornadas (mínimo ${cfg.minHorasDescanso} h).`,
      })
    }
  }

  // 5) Horas del día de inicio (los nocturnos cuentan enteros en su día de inicio).
  const horasDia = linea
    .filter(x => x.t.fecha === candidato.fecha)
    .reduce((s, x) => s + (x.r.fin - x.r.inicio) / 60, 0)
  if (horasDia > cfg.maxHorasDia) {
    advertencias.push({
      codigo: 'horas_diarias_excedidas',
      horas: horasDia,
      mensaje: `El ${candidato.fecha} suma ${fmtHoras(horasDia)} h programadas (máximo ${cfg.maxHorasDia} h).`,
    })
  }

  return { errores, advertencias }
}

/** Texto para un `confirm()`: lista de advertencias y la pregunta. */
export function textoConfirmacionAdvertencias(advertencias: HallazgoValidacionTurno[]): string {
  return [
    'Atención — la carga del vigilador tiene advertencias:',
    ...advertencias.map(a => `• ${a.mensaje}`),
    '',
    '¿Guardar de todos modos?',
  ].join('\n')
}

/**
 * Error que devuelve la base cuando el trigger rechaza una superposición.
 * Sirve para mostrar el mismo mensaje que la validación local.
 */
export function esErrorTurnoSuperpuesto(error: { message?: string | null; code?: string | null } | null | undefined): boolean {
  if (!error) return false
  return error.code === '23P01' || /TURNO_SUPERPUESTO/.test(error.message ?? '')
}
