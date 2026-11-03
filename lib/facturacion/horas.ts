/**
 * lib/facturacion/horas.ts
 *
 * Horas de un objetivo en un período de facturación, calculadas con la MISMA
 * regla de horas liquidables que usa la liquidación (lib/liquidacion). Fuente:
 * turnos + registros_asistencia de la app. Las planillas externas no entran.
 *
 *  - registradas: horas liquidables de turnos con registro (fichaje, carga o
 *    corrección) dentro del período.
 *  - sin registro: turnos ya ocurridos con obligación y 0 horas → quedan como
 *    pendientes; NUNCA se convierten en horas facturables ni en cero
 *    "confirmado".
 *  - Un turno que cruza el límite del período se reparte en proporción a los
 *    minutos que caen de cada lado.
 *  - Diurnas/nocturnas con la franja CONTRACTUAL (no la salarial).
 *
 * El resultado es una propuesta: la foto aprobada vive en
 * fact_horas_aprobaciones y no modifica ningún registro operativo.
 */

import {
  effectiveEntrada, effectiveObjetivo, effectiveSalida, horasLiquidablesRegistro, selectRegistroPrincipal,
  type RegistroLiquidacion, type TurnoLiquidacion,
} from '@/lib/liquidacion'
import { inicioDiaArgentinaISO } from '@/lib/periodo-argentina'
import { clasificarDiurnaNocturna, minutosEnRango, type FranjaNocturna, type RangoPeriodo } from './periodos'

const ESTADOS_SIN_OBLIGACION = new Set(['reemplazado', 'anulado', 'cancelado'])

export type TurnoFacturable = TurnoLiquidacion & { id: string }
export type RegistroFacturable = RegistroLiquidacion & { id: string; turno_id: string; tipo_registro?: string | null }

export type DetalleTurno = {
  turno_id: string
  registro_id: string | null
  fecha: string
  minutos: number
  minutos_diurnos: number | null
  minutos_nocturnos: number | null
  estado: 'con_registro' | 'sin_registro'
}

export type HorasObjetivo = {
  objetivoId: string
  minutosRegistrados: number
  minutosDiurnos: number | null
  minutosNocturnos: number | null
  minutosSinRegistro: number
  turnosSinRegistro: number
  detalle: DetalleTurno[]
}

function hhmm(h: string): number {
  const [a, b] = String(h).split(':').map(Number)
  return (a || 0) * 60 + (b || 0)
}

/** Instantes programados del turno (hora argentina; fin < inicio = día siguiente). */
export function instantesTurno(t: TurnoLiquidacion): { inicio: string; fin: string } {
  const base = Date.parse(inicioDiaArgentinaISO(t.fecha))
  const ini = hhmm(t.hora_inicio)
  let fin = hhmm(t.hora_fin)
  if (fin <= ini) fin += 24 * 60
  return { inicio: new Date(base + ini * 60000).toISOString(), fin: new Date(base + fin * 60000).toISOString() }
}

export function horasDelObjetivo(input: {
  objetivoId: string
  periodo: Pick<RangoPeriodo, 'instanteDesde' | 'instanteHasta'>
  turnos: TurnoFacturable[]
  registros: RegistroFacturable[]
  franjaNocturna: FranjaNocturna | null
  separarDiurnaNocturna: boolean
  ahora?: Date
}): HorasObjetivo {
  const ahora = (input.ahora ?? new Date()).getTime()
  const porTurno = new Map<string, RegistroFacturable[]>()
  for (const r of input.registros) {
    if (r.tipo_registro === 'ausencia') continue
    porTurno.set(r.turno_id, [...(porTurno.get(r.turno_id) ?? []), r])
  }
  const detalle: DetalleTurno[] = []
  let registrados = 0, diurnos = 0, nocturnos = 0, sinRegistro = 0, turnosSin = 0
  const clasificar = input.separarDiurnaNocturna && input.franjaNocturna != null

  for (const t of input.turnos) {
    if (ESTADOS_SIN_OBLIGACION.has(String(t.estado ?? ''))) continue
    const reg = selectRegistroPrincipal(porTurno.get(t.id) ?? [])
    // Objetivo efectivo: una corrección puede mover el registro a otro objetivo.
    if (effectiveObjetivo(reg, t) !== input.objetivoId) continue
    const prog = instantesTurno(t)
    const durProg = minutosEnRango(prog.inicio, prog.fin, prog.inicio, prog.fin)
    const dentro = minutosEnRango(prog.inicio, prog.fin, input.periodo.instanteDesde, input.periodo.instanteHasta)
    if (dentro === 0 || durProg === 0) continue
    const fraccion = dentro / durProg
    const liq = Math.round(horasLiquidablesRegistro(t, reg) * 60 * fraccion)

    if (liq <= 0) {
      if (Date.parse(prog.fin) <= ahora) {
        sinRegistro += Math.round(durProg * fraccion)
        turnosSin += 1
        detalle.push({ turno_id: t.id, registro_id: reg?.id ?? null, fecha: t.fecha, minutos: 0, minutos_diurnos: null, minutos_nocturnos: null, estado: 'sin_registro' })
      }
      continue
    }

    let d: number | null = null, n: number | null = null
    if (clasificar) {
      // Tramo real (o el programado si no hay horarios efectivos), recortado al período,
      // escalado a las horas liquidables para que diurnas + nocturnas = liquidables.
      const ini = effectiveEntrada(reg) ?? prog.inicio
      const fin = effectiveSalida(reg) ?? prog.fin
      const a = new Date(Math.max(Date.parse(ini), Date.parse(input.periodo.instanteDesde))).toISOString()
      const b = new Date(Math.min(Date.parse(fin), Date.parse(input.periodo.instanteHasta))).toISOString()
      const c = clasificarDiurnaNocturna(a, b, input.franjaNocturna!)
      const tot = c.diurnos + c.nocturnos
      n = tot > 0 ? Math.round(liq * c.nocturnos / tot) : 0
      d = liq - n
      diurnos += d
      nocturnos += n
    }
    registrados += liq
    detalle.push({ turno_id: t.id, registro_id: reg?.id ?? null, fecha: t.fecha, minutos: liq, minutos_diurnos: d, minutos_nocturnos: n, estado: 'con_registro' })
  }

  return {
    objetivoId: input.objetivoId,
    minutosRegistrados: registrados,
    minutosDiurnos: clasificar ? diurnos : null,
    minutosNocturnos: clasificar ? nocturnos : null,
    minutosSinRegistro: sinRegistro,
    turnosSinRegistro: turnosSin,
    detalle,
  }
}
