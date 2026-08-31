// Separar las horas del día que YA SE TRABAJARON de las que todavía se están
// trabajando.
//
// ── El hecho que lo motivó ──────────────────────────────────────────────────
// El tablero mostraba "Horas trabajadas hoy: 60,0" con CERO turnos finalizados.
// Las 60 horas eran cinco cargas manuales de 12 h —cobertura confirmada por un
// supervisor— sobre turnos que a esa hora seguían corriendo: BASSE terminaba
// 22:00, CACERES 18:00, los de LAROMET 20:00.
//
// No es un error de cálculo ni de liquidación. En agosto, 105 registros
// (1.167,5 h, el 43 % de las horas del mes) son carga manual, y 68 de ellos se
// crearon ANTES de que terminara el turno. Es la práctica operativa real: el
// supervisor confirma la cobertura cuando la ve, no cuando termina.
//
// Lo que estaba mal era la ETIQUETA. "Trabajadas" afirma un hecho consumado
// sobre un servicio que todavía está ocurriendo.
//
// ── Lo que este módulo NO hace ──────────────────────────────────────────────
// No cambia la liquidación. Las horas liquidables de cada registro salen de
// `horasLiquidablesRegistro`, sin tocar, y la SUMA de las dos categorías es
// exactamente el total de antes. Esto sólo decide en qué columna se muestra
// cada hora que ya estaba contada.
//
// Tampoco recalcula nada histórico ni toca los totales mensuales: un mes
// cerrado no tiene turnos en curso, así que la distinción sólo existe para HOY.

import { horasLiquidablesRegistro } from '@/lib/liquidacion'
import type { RegistroLiquidacion, TurnoLiquidacion } from '@/lib/liquidacion'

export type EstadoTemporal = 'cerrado' | 'en_curso'

/**
 * ¿La jornada de este turno ya terminó?
 *
 * Se pregunta por el SERVICIO, no por el fichaje. Un turno está cerrado cuando
 * pasó cualquiera de las dos cosas:
 *
 *   · hay una salida registrada —propia o corregida por Administración—, o
 *   · ya pasó su hora de fin programada.
 *
 * La segunda condición es la que evita el falso "en curso" del turno que
 * terminó y nadie fichó la salida: a las 23:00 un turno que terminaba a las
 * 19:00 está cerrado, haya o no salida cargada. Sin ella, todo lo que se cierra
 * por el cron nocturno figuraría en curso hasta que corriera.
 *
 * Los turnos NOCTURNOS terminan al día siguiente: 19:00–07:00 con fin menor o
 * igual que el inicio corre el fin 24 horas. Sin esto, un nocturno figuraría
 * cerrado apenas empieza.
 */
export function estadoTemporalTurno(
  turno: Pick<TurnoLiquidacion, 'fecha' | 'hora_inicio' | 'hora_fin'>,
  registro: Pick<RegistroLiquidacion, 'hora_salida_real' | 'hora_salida_final'> | null | undefined,
  ahora: Date = new Date(),
): EstadoTemporal {
  if (registro?.hora_salida_real != null || registro?.hora_salida_final != null) return 'cerrado'

  const fin = finProgramado(turno)
  if (fin === null) return 'cerrado'   // sin horario legible no se puede afirmar que sigue

  return ahora.getTime() >= fin ? 'cerrado' : 'en_curso'
}

/** Instante del fin programado, en ms. `null` si el horario no se puede leer. */
export function finProgramado(
  turno: Pick<TurnoLiquidacion, 'fecha' | 'hora_inicio' | 'hora_fin'>,
): number | null {
  const [a, m, d] = (turno.fecha ?? '').split('-').map(Number)
  const ini = aMinutos(turno.hora_inicio)
  const fin = aMinutos(turno.hora_fin)
  if (!a || !m || !d || fin === null) return null

  const nocturno = ini !== null && fin <= ini
  const base = new Date(a, m - 1, d, 0, 0, 0, 0)
  base.setMinutes(fin + (nocturno ? 24 * 60 : 0))
  return base.getTime()
}

function aMinutos(hhmm?: string | null): number | null {
  if (!hhmm) return null
  const [h, m] = hhmm.split(':').map(Number)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

export interface HorasDelDia {
  /** Jornadas terminadas: el servicio ya ocurrió. */
  cerradas: number
  /** Horas liquidables de turnos que a esta hora siguen corriendo. */
  enCurso: number
  /** cerradas + enCurso. Es exactamente el total que se mostraba antes. */
  total: number
  /** Cuántos turnos aportan a cada una, para poder auditar el número. */
  turnosCerrados: number
  turnosEnCurso: number
}

export const HORAS_DEL_DIA_VACIO: HorasDelDia = {
  cerradas: 0, enCurso: 0, total: 0, turnosCerrados: 0, turnosEnCurso: 0,
}

/**
 * Reparte las horas liquidables del día entre cerradas y en curso.
 *
 * `pares` viene ya deduplicado por turno —el registro principal de cada uno—
 * porque quien llama ya resolvió esa elección: contar acá de nuevo sería una
 * segunda definición de "cuál registro vale" y tarde o temprano diría otra cosa
 * que la liquidación.
 *
 * Un turno sin horas liquidables (0) no suma en ninguna de las dos, pero sí se
 * cuenta como turno: es la diferencia entre "no trabajó" y "trabajó y todavía
 * no está reconocido".
 */
export function repartirHorasDelDia(
  pares: Array<{ turno: TurnoLiquidacion; registro?: RegistroLiquidacion | null }>,
  ahora: Date = new Date(),
): HorasDelDia {
  const out: HorasDelDia = { ...HORAS_DEL_DIA_VACIO }

  for (const { turno, registro } of pares) {
    const horas = horasLiquidablesRegistro(turno, registro)
    if (estadoTemporalTurno(turno, registro, ahora) === 'cerrado') {
      out.cerradas += horas
      out.turnosCerrados += 1
    } else {
      out.enCurso += horas
      out.turnosEnCurso += 1
    }
  }

  out.total = out.cerradas + out.enCurso
  return out
}
