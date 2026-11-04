/**
 * lib/planilla-objetivo.ts
 *
 * Horas de un objetivo en un período, tal como las muestra Reportes →
 * Planilla objetivo. Es la ÚNICA fuente de "horas liquidables por objetivo":
 * la usan Reportes y Facturación, así no hay dos cálculos que puedan diferir.
 *
 *  - Una fila por REGISTRO de asistencia cuyo objetivo efectivo
 *    (objetivo_final_id, o el del turno) es el objetivo. Si dos vigiladores
 *    cubrieron el mismo turno, son dos filas.
 *  - Las horas de cada fila salen de resolverLineaLiquidacion (lib/liquidacion):
 *    fichado, reconocido por el supervisor, corrección autorizada, etc. No se
 *    reconstruye nada desde el GPS.
 *  - Los turnos del objetivo sin registro agregan una fila: 0 h, salvo el
 *    período de transición (jun–jul 2026), donde el turno cubierto vale lo programado.
 *  - Capacitación (turnos.tipo_evento): se liquida al vigilador y se informa
 *    aparte; NO suma al total del objetivo.
 *
 * No cambia ninguna regla de liquidación: sólo arma y suma lo que ya resuelve.
 */

import { esCapacitacion } from '@/lib/caracteristica-turno'
import {
  effectiveGuardia, esPeriodoTransicion, resolverLineaLiquidacion, selectRegistroPrincipal,
  type LineaLiquidacion, type RegistroLiquidacion, type TurnoLiquidacion,
} from '@/lib/liquidacion'

function minutos(hora?: string | null): number | null {
  if (!hora) return null
  const [hh, mm] = hora.slice(0, 5).split(':').map(Number)
  return Number.isFinite(hh) && Number.isFinite(mm) ? hh * 60 + mm : null
}

/** Duración programada como la usa la Planilla objetivo (fin <= inicio = día siguiente; 24 h si son iguales). */
export function duracionProgramadaPlanilla(turno: Pick<TurnoLiquidacion, 'hora_inicio' | 'hora_fin'>): number {
  const inicio = minutos(turno.hora_inicio)
  let fin = minutos(turno.hora_fin)
  if (inicio === null || fin === null) return 0
  if (fin <= inicio) fin += 24 * 60
  return Math.max(0, fin - inicio) / 60
}

export type TurnoPlanilla = TurnoLiquidacion & { id: string; objetivo_id?: string | null; tipo_evento?: string | null }
export type RegistroPlanilla = RegistroLiquidacion & { id: string; turno_id: string; objetivo_final_id?: string | null; horas_trabajadas?: number | string | null }

export type FilaHorasObjetivo<T extends TurnoPlanilla = TurnoPlanilla, R extends RegistroPlanilla = RegistroPlanilla> = {
  turno: T
  registro: R | null
  /** null en los turnos sin registro. */
  linea: LineaLiquidacion | null
  horasLiquidables: number
  horasReales: number
  capacitacion: boolean
  /** Turno sin registro reconocido como cubierto por el período de transición. */
  transicion: boolean
}

/** Filas de la Planilla objetivo: primero las de registro (en el orden recibido), después los turnos sin registro. */
export function filasHorasObjetivo<T extends TurnoPlanilla, R extends RegistroPlanilla>(
  objetivoId: string,
  turnos: T[],
  registros: R[],
  turnoPorId: Map<string, T> = new Map(turnos.map(t => [t.id, t])),
): FilaHorasObjetivo<T, R>[] {
  const registrosObjetivo = registros.filter(r => (r.objetivo_final_id ?? turnoPorId.get(r.turno_id)?.objetivo_id) === objetivoId)
  const conRegistro = new Set(registrosObjetivo.map(r => r.turno_id))
  const filas: FilaHorasObjetivo<T, R>[] = []
  for (const registro of registrosObjetivo) {
    const turno = turnoPorId.get(registro.turno_id)
    if (!turno) continue
    const linea = resolverLineaLiquidacion(turno, registro)
    filas.push({ turno, registro, linea, horasLiquidables: linea.horasLiquidables, horasReales: linea.horasReales,
      capacitacion: esCapacitacion(turno.tipo_evento), transicion: false })
  }
  for (const turno of turnos) {
    if (turno.objetivo_id !== objetivoId || conRegistro.has(turno.id)) continue
    const transicion = turno.estado === 'cubierto' && esPeriodoTransicion(turno.fecha)
    filas.push({ turno, registro: null, linea: null, horasLiquidables: transicion ? duracionProgramadaPlanilla(turno) : 0, horasReales: 0,
      capacitacion: esCapacitacion(turno.tipo_evento), transicion })
  }
  return filas
}

/** Totales de la Planilla objetivo (los mismos números que muestra Reportes). */
export function totalesHorasObjetivo(filas: FilaHorasObjetivo[]) {
  // Horas reales: un registro principal por (turno, vigilador), como siempre mostró Reportes.
  const porTurnoGuardia = new Map<string, RegistroPlanilla[]>()
  for (const f of filas) {
    if (!f.registro) continue
    const k = `${f.registro.turno_id}|${effectiveGuardia(f.registro) ?? '__'}`
    porTurnoGuardia.set(k, [...(porTurnoGuardia.get(k) ?? []), f.registro])
  }
  let horasReales = 0
  for (const rs of Array.from(porTurnoGuardia.values())) {
    const p = selectRegistroPrincipal(rs)
    if (p) horasReales += Math.max(0, Number((p as RegistroPlanilla).horas_trabajadas) || 0)
  }
  const turnosCap = new Set<string>()
  let horasCapacitacion = 0, horasLiquidables = 0
  for (const f of filas) {
    if (f.capacitacion) { turnosCap.add(f.turno.id); horasCapacitacion += f.horasLiquidables || 0 }
    else horasLiquidables += f.horasLiquidables || 0
  }
  return { horasReales, horasLiquidables, horasCapacitacion, turnosCapacitacion: turnosCap.size }
}
