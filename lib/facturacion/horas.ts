/**
 * lib/facturacion/horas.ts
 *
 * Horas FACTURABLES de un objetivo en un período comercial: cuánto tiempo
 * estuvo CUBIERTO cada puesto programado, más lo que el supervisor aceptó fuera
 * de turno. Usa las horas liquidables de lib/liquidacion (que no se toca), así
 * que lo facturado coincide con lo que se liquida.
 *
 *  - programadas: tiempo programado de los turnos con obligación, por puesto
 *    (unión de intervalos), recortado al período comercial.
 *  - cubiertas: tiempo programado que tuvo un vigilador. Un registro completo
 *    (dentro de la tolerancia de 15 min que usa liquidación) cubre el turno
 *    programado entero; uno parcial cubre la intersección de su horario
 *    efectivo con el programado, sin pasar de sus horas liquidables.
 *  - aceptadas fuera de turno: lo que el supervisor reconoció por encima del
 *    turno (horas liquidables > programadas). Se liquida, así que se factura
 *    (regla de JC, 03/11/2026: programado + lo aceptado = lo que se liquida).
 *  - excedentes: lo fichado fuera del horario SIN aceptar. No se liquida ni se
 *    factura; queda sólo informado.
 *  - superpuestas: tiempo en que dos turnos del MISMO puesto se pisan
 *    (relevos anticipados, coberturas dobles). Con la regla 'unir' (por
 *    defecto) se factura una sola vez; sólo el contrato puede indicar 'sumar'.
 *  - descubiertas: programado ya ocurrido sin cobertura. No se factura salvo
 *    decisión de Administración al aprobar (queda registrada con motivo).
 *  - Capacitación (turnos.tipo_evento = 'capacitacion', valor validado por
 *    CHECK en la base): se paga al vigilador pero NO se factura. Queda fuera
 *    de programadas, cubiertas y descubiertas, y se informa aparte con sus
 *    horas liquidables. Sin búsquedas de texto: sólo la característica.
 *  - Los turnos sin puesto no se pueden unir: se suman y se avisa.
 *  - Diurnas/nocturnas con la franja del CONTRATO, sobre lo cubierto.
 *
 * Los horarios efectivos (hora_*_final / hora_*_real) son `time` sin fecha:
 * se ubican en el día que queda más cerca del horario programado.
 */

import {
  effectiveEntrada, effectiveObjetivo, effectiveSalida, horasLiquidablesRegistro, selectRegistroPrincipal,
  type RegistroLiquidacion, type TurnoLiquidacion,
} from '@/lib/liquidacion'
import { esCapacitacion } from '@/lib/caracteristica-turno'
import { inicioDiaArgentinaISO } from '@/lib/periodo-argentina'
import { clasificarDiurnaNocturna, type FranjaNocturna, type RangoPeriodo } from './periodos'

const ESTADOS_SIN_OBLIGACION = new Set(['reemplazado', 'anulado', 'cancelado'])
const TOLERANCIA_MIN = 15
const MIN = 60000

export type TurnoFacturable = TurnoLiquidacion & { id: string; puesto_id?: string | null; tipo_evento?: string | null }
export type RegistroFacturable = RegistroLiquidacion & { id: string; turno_id: string; tipo_registro?: string | null }
export type ReglaSuperposicion = 'unir' | 'sumar'

type Tramo = [number, number] // epoch ms

export type DetalleTurno = {
  turno_id: string
  registro_id: string | null
  puesto_id: string | null
  fecha: string
  programados: number
  cubiertos: number
  estado: 'cubierto' | 'parcial' | 'sin_registro' | 'futuro' | 'capacitacion'
}

export type HorasObjetivo = {
  objetivoId: string
  minutosProgramados: number
  minutosCubiertos: number
  minutosSuperpuestos: number
  minutosDescubiertos: number
  /** Reconocidos por el supervisor fuera del turno: ya incluidos en minutosCubiertos. */
  minutosAceptadosFuera: number
  /** Fichados fuera del turno sin aceptar: no se liquidan ni se facturan. */
  minutosExcedentes: number
  /** Capacitación: se liquida y NO se factura. Fuera de todos los demás totales. */
  minutosCapacitacionProgramados: number
  minutosCapacitacionLiquidables: number
  turnosCapacitacion: number
  /** Diurnas/nocturnas de lo cubierto (null si el contrato no separa o no hay franja). */
  minutosDiurnos: number | null
  minutosNocturnos: number | null
  /** Ídem para lo descubierto, por si Administración decide facturarlo. */
  descubiertosDiurnos: number | null
  descubiertosNocturnos: number | null
  turnosSinRegistro: number
  turnosFuturos: number
  turnosSinPuesto: number
  detalle: DetalleTurno[]
}

function hhmm(h: string): number {
  const [a, b] = String(h).split(':').map(Number)
  return (a || 0) * 60 + (b || 0)
}

/** Instantes programados del turno (hora argentina; fin <= inicio = día siguiente). */
export function instantesTurno(t: TurnoLiquidacion): { inicio: string; fin: string } {
  const base = Date.parse(inicioDiaArgentinaISO(t.fecha))
  const ini = hhmm(t.hora_inicio)
  let fin = hhmm(t.hora_fin)
  if (fin <= ini) fin += 24 * 60
  return { inicio: new Date(base + ini * MIN).toISOString(), fin: new Date(base + fin * MIN).toISOString() }
}

/** Ubica un `time` (o un instante ISO) en el día más cercano a la referencia. */
export function ubicarHora(fecha: string, valor: string | null | undefined, referencia: number): number | null {
  if (!valor) return null
  if (/T|\d{4}-\d{2}-\d{2} /.test(valor)) { const t = Date.parse(valor); return Number.isFinite(t) ? t : null }
  if (!/^\d{1,2}:\d{2}/.test(valor)) return null
  const base = Date.parse(inicioDiaArgentinaISO(fecha)) + hhmm(valor) * MIN
  let mejor = base
  for (const d of [-1, 1, 2]) {
    const c = base + d * 24 * 60 * MIN
    if (Math.abs(c - referencia) < Math.abs(mejor - referencia)) mejor = c
  }
  return mejor
}

export function unir(tramos: Tramo[]): Tramo[] {
  const s = tramos.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])
  const out: Tramo[] = []
  for (const [a, b] of s) {
    const u = out[out.length - 1]
    if (u && a <= u[1]) u[1] = Math.max(u[1], b)
    else out.push([a, b])
  }
  return out
}
const largo = (ts: Tramo[]) => ts.reduce((s, [a, b]) => s + Math.max(0, b - a), 0) / MIN
function recortar(t: Tramo, d: number, h: number): Tramo | null {
  const a = Math.max(t[0], d), b = Math.min(t[1], h)
  return b > a ? [a, b] : null
}
/** Los primeros `minutos` de los tramos, en orden. */
function hasta(ts: Tramo[], minutos: number): Tramo[] {
  const out: Tramo[] = []
  let resta = minutos * MIN
  for (const [a, b] of unir(ts)) {
    if (resta <= 0) break
    const fin = Math.min(b, a + resta)
    out.push([a, fin]); resta -= fin - a
  }
  return out
}
/** a − b, ambos ya unidos. */
function restar(a: Tramo[], b: Tramo[]): Tramo[] {
  const out: Tramo[] = []
  for (const [x, y] of a) {
    let ini = x
    for (const [p, q] of b) {
      if (q <= ini || p >= y) continue
      if (p > ini) out.push([ini, Math.min(p, y)])
      ini = Math.max(ini, q)
      if (ini >= y) break
    }
    if (ini < y) out.push([ini, y])
  }
  return out
}

function clasificarTramos(ts: Tramo[], franja: FranjaNocturna) {
  let d = 0, n = 0
  for (const [a, b] of ts) {
    const c = clasificarDiurnaNocturna(new Date(a).toISOString(), new Date(b).toISOString(), franja)
    d += c.diurnos; n += c.nocturnos
  }
  return { d, n }
}

export function horasDelObjetivo(input: {
  objetivoId: string
  periodo: Pick<RangoPeriodo, 'instanteDesde' | 'instanteHasta'>
  turnos: TurnoFacturable[]
  registros: RegistroFacturable[]
  franjaNocturna: FranjaNocturna | null
  separarDiurnaNocturna: boolean
  superposicion?: ReglaSuperposicion
  ahora?: Date
}): HorasObjetivo {
  const ahora = (input.ahora ?? new Date()).getTime()
  const pd = Date.parse(input.periodo.instanteDesde), ph = Date.parse(input.periodo.instanteHasta)
  const porTurno = new Map<string, RegistroFacturable[]>()
  for (const r of input.registros) {
    if (r.tipo_registro === 'ausencia') continue
    porTurno.set(r.turno_id, [...(porTurno.get(r.turno_id) ?? []), r])
  }
  const prog = new Map<string, Tramo[]>()
  const cub = new Map<string, Tramo[]>()
  const detalle: DetalleTurno[] = []
  let sinRegistro = 0, futuros = 0, sinPuesto = 0, excedentes = 0, aceptadosFuera = 0, brutoCubierto = 0
  let capProgramados = 0, capLiquidables = 0, capTurnos = 0

  // 1ª pasada: lo programado, por puesto.
  type Item = { t: TurnoFacturable; reg: RegistroFacturable | undefined; pi: number; pf: number; enPeriodo: Tramo; clave: string }
  const items: Item[] = []
  for (const t of input.turnos) {
    if (ESTADOS_SIN_OBLIGACION.has(String(t.estado ?? ''))) continue
    const reg = selectRegistroPrincipal(porTurno.get(t.id) ?? [])
    if (effectiveObjetivo(reg, t) !== input.objetivoId) continue
    const p = instantesTurno(t)
    const pi = Date.parse(p.inicio), pf = Date.parse(p.fin)
    const enPeriodo = recortar([pi, pf], pd, ph)
    if (!enPeriodo) continue
    if (esCapacitacion(t.tipo_evento)) {
      // Se liquida (lib/liquidacion no distingue) y no se factura: ni programa, ni cubre, ni queda descubierta.
      const liqCap = Math.round(horasLiquidablesRegistro(t, reg) * 60)
      capTurnos++; capProgramados += largo([enPeriodo]); capLiquidables += liqCap
      detalle.push({ turno_id: t.id, registro_id: reg?.id ?? null, puesto_id: t.puesto_id ?? null, fecha: t.fecha, programados: largo([enPeriodo]), cubiertos: 0, estado: 'capacitacion' })
      continue
    }
    const clave = t.puesto_id ?? `turno:${t.id}`
    if (!t.puesto_id) sinPuesto++
    prog.set(clave, [...(prog.get(clave) ?? []), enPeriodo])
    items.push({ t, reg, pi, pf, enPeriodo, clave })
  }
  const progPuesto = new Map<string, Tramo[]>()
  for (const [k, ts] of Array.from(prog.entries())) progPuesto.set(k, unir(ts))

  // 2ª pasada: lo cubierto. El horario efectivo cubre cualquier tramo programado
  // del MISMO puesto (un relevo que llega antes tapa la salida anticipada del
  // anterior). Lo que cae fuera de lo programado se factura sólo si el
  // supervisor lo reconoció (liquidables > turno); si no, es excedente.
  for (const { t, reg, pi, pf, enPeriodo, clave } of items) {
    const programados = largo([enPeriodo])
    const liq = Math.round(horasLiquidablesRegistro(t, reg) * 60)
    if (liq <= 0) {
      const estado = pf > ahora ? 'futuro' : 'sin_registro'
      if (estado === 'futuro') futuros++; else sinRegistro++
      detalle.push({ turno_id: t.id, registro_id: reg?.id ?? null, puesto_id: t.puesto_id ?? null, fecha: t.fecha, programados, cubiertos: 0, estado })
      continue
    }
    const dur = (pf - pi) / MIN
    const e = ubicarHora(t.fecha, effectiveEntrada(reg), pi)
    const s = ubicarHora(t.fecha, effectiveSalida(reg), pf)
    const efectivo: Tramo | null = e != null && s != null && s > e ? [e, s] : null
    const delPuesto = progPuesto.get(clave) ?? []
    const enPuesto = (x: Tramo) => delPuesto.map(q => recortar(x, q[0], q[1])).filter(Boolean) as Tramo[]
    let tramos: Tramo[]
    if (liq >= dur - TOLERANCIA_MIN) {
      // Turno completo (misma tolerancia que liquidación): todo lo propio, más lo
      // que el horario efectivo haya cubierto de turnos vecinos del puesto.
      tramos = unir([[pi, pf], ...(efectivo ? enPuesto(efectivo) : [])])
    } else if (efectivo) {
      // Parcial: nunca más de lo que se liquida (el supervisor pudo reconocer menos).
      tramos = hasta(enPuesto(efectivo), liq)
    } else {
      tramos = [[pi, Math.min(pf, pi + liq * MIN)]]
    }
    // Reconocido por encima del turno: se ubica en lo fichado fuera del puesto
    // (o a continuación del turno si no hay horario) y se factura.
    const fuera = efectivo ? restar([recortar(efectivo, pd, ph) ?? [0, 0]], delPuesto) : []
    const extra = Math.max(0, liq - dur)
    // Con horario, sólo lo que cae fuera del puesto: lo reconocido DENTRO de otro
    // turno del puesto (relevo anticipado) ya está cubierto por la unión.
    const aceptado = extra <= 0 ? [] : efectivo ? hasta(fuera, extra) : [recortar([pf, pf + extra * MIN], pd, ph)].filter(Boolean) as Tramo[]
    aceptadosFuera += Math.round(largo(aceptado))
    excedentes += Math.max(0, Math.round(largo(fuera) - largo(aceptado)))
    const c = [...tramos.map(x => recortar(x, pd, ph)).filter(Boolean) as Tramo[], ...aceptado]
    const cubiertos = largo(c)
    const propios = largo(c.map(x => recortar(x, pi, pf)).filter(Boolean) as Tramo[])
    if (c.length) { cub.set(clave, [...(cub.get(clave) ?? []), ...c]); brutoCubierto += cubiertos }
    detalle.push({ turno_id: t.id, registro_id: reg?.id ?? null, puesto_id: t.puesto_id ?? null, fecha: t.fecha, programados, cubiertos: Math.round(cubiertos),
      estado: propios >= programados - TOLERANCIA_MIN ? 'cubierto' : 'parcial' })
  }

  let programadosU: Tramo[] = [], cubiertosU: Tramo[] = [], descubiertosU: Tramo[] = []
  for (const [k, ts] of Array.from(prog.entries())) {
    const pu = unir(ts)
    const cu = unir(cub.get(k) ?? [])
    programadosU = programadosU.concat(pu)
    cubiertosU = cubiertosU.concat(cu)
    // Descubierto: programado ya ocurrido y sin cobertura.
    const pasado = pu.map(x => recortar(x, -Infinity, ahora)).filter(Boolean) as Tramo[]
    descubiertosU = descubiertosU.concat(restar(pasado, cu))
  }
  const cubiertosUnidos = Math.round(largo(cubiertosU))
  const sumar = input.superposicion === 'sumar'
  const clasificar = input.separarDiurnaNocturna && input.franjaNocturna != null
  let d: number | null = null, n: number | null = null, dd: number | null = null, dn: number | null = null
  if (clasificar) {
    const c1 = clasificarTramos(cubiertosU, input.franjaNocturna!)
    const c2 = clasificarTramos(descubiertosU, input.franjaNocturna!)
    d = Math.round(c1.d); n = Math.round(c1.n); dd = Math.round(c2.d); dn = Math.round(c2.n)
    if (sumar && brutoCubierto > cubiertosUnidos && c1.d + c1.n > 0) {
      const f = Math.round(brutoCubierto) / (c1.d + c1.n)
      n = Math.round(c1.n * f); d = Math.round(brutoCubierto) - n
    }
  }
  return {
    objetivoId: input.objetivoId,
    minutosProgramados: Math.round(largo(programadosU)),
    minutosCubiertos: sumar ? Math.round(brutoCubierto) : cubiertosUnidos,
    minutosSuperpuestos: Math.max(0, Math.round(brutoCubierto) - cubiertosUnidos),
    minutosDescubiertos: Math.round(largo(descubiertosU)),
    minutosAceptadosFuera: aceptadosFuera,
    minutosExcedentes: excedentes,
    minutosCapacitacionProgramados: Math.round(capProgramados), minutosCapacitacionLiquidables: capLiquidables, turnosCapacitacion: capTurnos,
    minutosDiurnos: d, minutosNocturnos: n, descubiertosDiurnos: dd, descubiertosNocturnos: dn,
    turnosSinRegistro: sinRegistro, turnosFuturos: futuros, turnosSinPuesto: sinPuesto,
    detalle,
  }
}

/**
 * Decisión de Administración sobre lo descubierto. Nunca cambia lo cubierto
 * ni los registros: sólo cuánto se aprueba facturar, con motivo.
 */
export function minutosAprobables(h: HorasObjetivo, tratamiento: 'no_facturar' | 'facturar') {
  const f = tratamiento === 'facturar'
  return {
    aprobados: h.minutosCubiertos + (f ? h.minutosDescubiertos : 0),
    diurnos: h.minutosDiurnos == null ? null : h.minutosDiurnos + (f ? h.descubiertosDiurnos ?? 0 : 0),
    nocturnos: h.minutosNocturnos == null ? null : h.minutosNocturnos + (f ? h.descubiertosNocturnos ?? 0 : 0),
  }
}
