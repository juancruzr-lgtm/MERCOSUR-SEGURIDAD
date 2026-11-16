/**
 * lib/tablero-gerencia/horas.ts
 *
 * Horas del Tablero de Gerencia: mensual (comparación oficial) y avance
 * semanal dentro del mes (seguimiento, sin cierre semanal).
 *
 * Fuente ÚNICA del cálculo: la regla oficial de lib/liquidacion.ts
 * (`selectRegistroPrincipal` + `horasLiquidablesRegistro`), la misma que usan
 * la liquidación y el Legajo. No se suma `registros_asistencia.horas_liquidables`
 * ni `horas_trabajadas` directamente: en producción `horas_liquidables` está
 * vacía en ~80 % de los registros (auditoría 16/11/2026) y sumarla da cifras
 * que no coinciden con lo liquidado.
 *
 * Diferencias conocidas con la función SQL `turno_horas_liquidadas`
 * (se marcan en cada línea con `divergeSql` para no esconderlas):
 *   1. Junio/julio 2026: TS liquida turnos "cubierto" sin registro (período de
 *      transición); SQL devuelve 0.
 *   2. Turnos anulado/reemplazado/cancelado: SQL devuelve 0; acá también
 *      (se alinea con SQL), pero se marca si el registro tenía horas.
 *
 * Las horas sin respaldo de fichaje (confirmación manual) se cuentan, porque
 * son horas oficiales, pero se separan para que Gerencia las vea.
 */

import {
  horasLiquidablesRegistro,
  horasProgramadasTurno,
  selectRegistroPrincipal,
  esPeriodoTransicion,
  type RegistroLiquidacion,
  type TurnoLiquidacion,
} from '@/lib/liquidacion'
import { ESTADOS_SIN_OBLIGACION } from '@/lib/revision-operativa'

export type RespaldoHoras =
  | 'fichaje_completo'     // entrada y salida reales
  | 'corregida'            // tiempos _final autorizados
  | 'valor_guardado'       // horas_liquidables cargadas (supervisor/admin/cron)
  | 'sin_fichaje'          // confirmación o carga sin fichaje de entrada
  | 'transicion'           // jun/jul 2026 cubierto sin registro (sólo TS)
  | 'incompleto'           // falta entrada o salida: 0 h
  | 'sin_obligacion'       // turno anulado/reemplazado/cancelado
  | 'pendiente'            // turno que todavía no terminó: no cuenta (ni programadas ni incompleto)

export interface TurnoHoras extends TurnoLiquidacion {
  id: string
  guardia_id?: string | null
  cliente_id?: string | null
}

export interface RegistroHoras extends RegistroLiquidacion {
  turno_id: string
  registro_anulado_at?: string | null
  tipo_registro?: string | null
}

export interface LineaHoras {
  turnoId: string
  fecha: string
  semanaDelMes: number
  empleadoId: string | null
  objetivoId: string | null
  clienteId: string | null
  programadas: number
  oficiales: number
  /** oficiales − programadas; sólo para el detalle. */
  diferencia: number
  respaldo: RespaldoHoras
  divergeSql: boolean
}

/** Semana del mes 1..5 (días 1–7 = 1, 8–14 = 2…). Sin cierre semanal: sólo avance. */
export function semanaDelMes(fecha: string): number {
  return Math.min(5, Math.floor((Number(fecha.slice(8, 10)) - 1) / 7) + 1)
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * `pendiente`: el turno todavía no terminó. Se excluye de todo el cálculo para
 * que el mes en curso no compare horas trabajadas contra turnos futuros ni los
 * cuente como "incompletos".
 */
export function lineaHoras(turno: TurnoHoras, registros: RegistroHoras[], opts: { pendiente?: boolean } = {}): LineaHoras {
  const vigentes = registros.filter(r => !r.registro_anulado_at && (r.tipo_registro ?? '') !== 'ausencia')
  const reg = selectRegistroPrincipal(vigentes) ?? null
  const programadas = horasProgramadasTurno(turno)
  const base = {
    turnoId: turno.id,
    fecha: turno.fecha,
    semanaDelMes: semanaDelMes(turno.fecha),
    empleadoId: reg?.guardia_final_id ?? reg?.guardia_id ?? turno.guardia_id ?? null,
    objetivoId: reg?.objetivo_final_id ?? turno.objetivo_id ?? null,
    clienteId: turno.cliente_id ?? null,
  }

  if (opts.pendiente) {
    return { ...base, programadas: 0, oficiales: 0, diferencia: 0, respaldo: 'pendiente', divergeSql: false }
  }

  if (ESTADOS_SIN_OBLIGACION.has(turno.estado ?? '')) {
    const teniaHoras = reg ? horasLiquidablesRegistro({ ...turno, estado: 'programado' }, reg) > 0 : false
    // divergeSql marca un turno sin obligación cuyo registro tenía horas:
    // otras pantallas TS que no filtran por estado podrían estar sumándolas.
    return { ...base, programadas: 0, oficiales: 0, diferencia: 0, respaldo: 'sin_obligacion', divergeSql: teniaHoras }
  }

  const oficiales = horasLiquidablesRegistro(turno, reg)
  let respaldo: RespaldoHoras
  if (!reg) respaldo = oficiales > 0 && esPeriodoTransicion(turno.fecha) ? 'transicion' : 'incompleto'
  else if (reg.cobertura_anulada_at) respaldo = 'incompleto'
  else if (reg.horas_liquidables != null) respaldo = reg.hora_entrada_real ? 'valor_guardado' : 'sin_fichaje'
  else if (reg.hora_entrada_final || reg.hora_salida_final) respaldo = 'corregida'
  else if (reg.hora_entrada_real && reg.hora_salida_real) respaldo = 'fichaje_completo'
  else respaldo = 'incompleto'

  return {
    ...base,
    programadas: redondear(programadas),
    oficiales: redondear(oficiales),
    diferencia: redondear(oficiales - programadas),
    respaldo,
    divergeSql: respaldo === 'transicion',
  }
}

export interface TotalesHoras {
  programadas: number
  oficiales: number
  sinFichaje: number
  incompletos: number
  turnos: number
}

function vacio(): TotalesHoras {
  return { programadas: 0, oficiales: 0, sinFichaje: 0, incompletos: 0, turnos: 0 }
}

function sumar(t: TotalesHoras, l: LineaHoras) {
  t.programadas = redondear(t.programadas + l.programadas)
  t.oficiales = redondear(t.oficiales + l.oficiales)
  if (l.respaldo === 'sin_fichaje') t.sinFichaje = redondear(t.sinFichaje + l.oficiales)
  if (l.respaldo === 'incompleto') t.incompletos++
  if (l.respaldo !== 'sin_obligacion' && l.respaldo !== 'pendiente') t.turnos++
}

export interface ResumenHorasMes {
  total: TotalesHoras
  porCliente: Record<string, TotalesHoras>
  porObjetivo: Record<string, TotalesHoras>
  porEmpleado: Record<string, TotalesHoras>
  /** Avance semanal acumulado del mes (seguimiento, no cierre). */
  semanas: { semana: number; oficialesAcumuladas: number; programadasAcumuladas: number }[]
  lineasQueDivergenDeSql: number
}

export function resumirHorasMes(lineas: LineaHoras[]): ResumenHorasMes {
  const r: ResumenHorasMes = {
    total: vacio(), porCliente: {}, porObjetivo: {}, porEmpleado: {}, semanas: [], lineasQueDivergenDeSql: 0,
  }
  const porSemana = new Map<number, TotalesHoras>()
  for (const l of lineas) {
    sumar(r.total, l)
    sumar((r.porCliente[l.clienteId ?? 'sin_cliente'] ??= vacio()), l)
    sumar((r.porObjetivo[l.objetivoId ?? 'sin_objetivo'] ??= vacio()), l)
    sumar((r.porEmpleado[l.empleadoId ?? 'sin_empleado'] ??= vacio()), l)
    const s = porSemana.get(l.semanaDelMes) ?? vacio()
    sumar(s, l)
    porSemana.set(l.semanaDelMes, s)
    if (l.divergeSql) r.lineasQueDivergenDeSql++
  }
  let accO = 0
  let accP = 0
  for (let s = 1; s <= 5; s++) {
    const t = porSemana.get(s)
    if (!t) continue
    accO = redondear(accO + t.oficiales)
    accP = redondear(accP + t.programadas)
    r.semanas.push({ semana: s, oficialesAcumuladas: accO, programadasAcumuladas: accP })
  }
  return r
}

export interface ComparacionMensual {
  actual: number
  anterior: number
  variacion: number
  variacionPct: number | null
}

/** Comparación oficial mes contra mes. */
export function compararMeses(actual: number, anterior: number): ComparacionMensual {
  return {
    actual,
    anterior,
    variacion: redondear(actual - anterior),
    variacionPct: anterior > 0 ? Math.round(((actual - anterior) / anterior) * 1000) / 10 : null,
  }
}

/**
 * Detecta líneas para la regla HOR-01 (diferencia a revisar): fichaje
 * completo cuya duración real se aleja de la programada más de `umbralHoras`.
 * Recibe las horas reales ya calculadas (calcular_horas_reconocidas).
 */
export function requiereRevisionDiferencia(linea: LineaHoras, horasReales: number, umbralHoras = 1): boolean {
  return linea.respaldo === 'fichaje_completo' && Math.abs(horasReales - linea.programadas) > umbralHoras
}
