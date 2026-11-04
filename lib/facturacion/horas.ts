/**
 * lib/facturacion/horas.ts
 *
 * Horas FACTURABLES de un objetivo en un período comercial. NO calcula horas:
 * parte de las horas liquidables que muestra Reportes → Planilla objetivo
 * (lib/planilla-objetivo, la misma función y los mismos datos), que ya
 * incorporan fichajes, reconocimientos del supervisor y correcciones
 * posteriores. Si Reportes cambia, la propuesta de Facturación cambia igual.
 *
 * Sobre esas horas aplica sólo reglas COMERCIALES, cada una informada aparte:
 *  - Capacitación (turnos.tipo_evento = 'capacitacion'): se liquida, no se
 *    factura. Reportes ya la deja fuera del total del objetivo.
 *  - Simultáneos: un turno contenido en otro o idéntico es otro vigilador
 *    prestando servicio a la vez (refuerzo, otro puesto, evento): se factura.
 *  - Relevos: dos turnos ESCALONADOS del mismo puesto que se pisan hasta 2 h.
 *    Con la regla 'unir' del contrato (por defecto) ese tramo se cobra una vez;
 *    con 'sumar', dos. Nunca se descarta otra cosa por coincidir en horario.
 *  - Escalonados que se pisan más de 2 h: se facturan y quedan para revisar.
 *  - Descubiertas: lo programado que no tiene horas reconocidas. No se factura
 *    salvo decisión de Administración al aprobar (con motivo).
 *  - Las horas reales (GPS) se informan; nunca reemplazan a las liquidables.
 *
 * Los turnos van al período por su fecha de inicio, igual que en Reportes.
 */

import { esCapacitacion } from '@/lib/caracteristica-turno'
import type { RegistroLiquidacion, TurnoLiquidacion } from '@/lib/liquidacion'
import { inicioDiaArgentinaISO } from '@/lib/periodo-argentina'
import { duracionProgramadaPlanilla, filasHorasObjetivo, totalesHorasObjetivo } from '@/lib/planilla-objetivo'
import { clasificarDiurnaNocturna, type FranjaNocturna, type RangoPeriodo } from './periodos'

const ESTADOS_SIN_OBLIGACION = new Set(['reemplazado', 'anulado', 'cancelado'])
const TOLERANCIA_MIN = 15
const RELEVO_MAX_MIN = 120
const MIN = 60000

export type TurnoFacturable = TurnoLiquidacion & { id: string; objetivo_id?: string | null; puesto_id?: string | null; tipo_evento?: string | null }
export type RegistroFacturable = RegistroLiquidacion & { id: string; turno_id: string; objetivo_final_id?: string | null; tipo_registro?: string | null; horas_trabajadas?: number | string | null }
export type ReglaSuperposicion = 'unir' | 'sumar'

type Tramo = [number, number] // epoch ms

export type DetalleTurno = {
  turno_id: string
  registro_id: string | null
  puesto_id: string | null
  fecha: string
  programados: number
  /** Minutos liquidables (Reportes) de la fila. */
  cubiertos: number
  estado: 'cubierto' | 'parcial' | 'sin_registro' | 'futuro' | 'capacitacion'
}

export type ParaRevisar = { fecha: string; tipo: 'relevo_largo'; detalle: string; minutos: number }

export type HorasObjetivo = {
  objetivoId: string
  /** Reportes → Planilla objetivo: horas liquidables del objetivo (sin capacitación). */
  minutosLiquidables: number
  /** Duración fichada por GPS (informativa). */
  minutosReales: number
  minutosProgramados: number
  /** Facturables antes de decidir sobre lo descubierto = liquidables − relevos duplicados. */
  minutosCubiertos: number
  /** Relevos: tramo que se descuenta por estar dos veces (0 con regla 'sumar'). */
  minutosSuperpuestos: number
  /** Vigiladores simultáneos: se facturan (informativo). */
  minutosSimultaneos: number
  minutosDescubiertos: number
  /** Reconocidos por encima del turno: ya incluidos en las liquidables. */
  minutosAceptadosFuera: number
  minutosCapacitacionProgramados: number
  minutosCapacitacionLiquidables: number
  turnosCapacitacion: number
  /** Diurnas/nocturnas de lo facturable (null si el contrato no separa o no hay franja). */
  minutosDiurnos: number | null
  minutosNocturnos: number | null
  descubiertosDiurnos: number | null
  descubiertosNocturnos: number | null
  turnosSinRegistro: number
  turnosFuturos: number
  turnosSinPuesto: number
  revisar: ParaRevisar[]
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

function clasificar(t: Tramo, franja: FranjaNocturna) {
  const c = clasificarDiurnaNocturna(new Date(t[0]).toISOString(), new Date(t[1]).toISOString(), franja)
  return { d: c.diurnos, n: c.nocturnos }
}

export function horasDelObjetivo(input: {
  objetivoId: string
  periodo: Pick<RangoPeriodo, 'desde' | 'hastaExclusivo'>
  turnos: TurnoFacturable[]
  registros: RegistroFacturable[]
  franjaNocturna: FranjaNocturna | null
  separarDiurnaNocturna: boolean
  superposicion?: ReglaSuperposicion
  ahora?: Date
}): HorasObjetivo {
  const ahora = (input.ahora ?? new Date()).getTime()
  const { desde, hastaExclusivo } = input.periodo
  // Mismo universo que Reportes: turnos del período por fecha de inicio y sus registros.
  const turnos = input.turnos.filter(t => t.fecha >= desde && t.fecha < hastaExclusivo)
  const filas = filasHorasObjetivo(input.objetivoId, turnos, input.registros)
  const tot = totalesHorasObjetivo(filas)

  const franja = input.separarDiurnaNocturna ? input.franjaNocturna : null
  const detalle: DetalleTurno[] = []
  let aceptadosFuera = 0, sinPuesto = 0, d = 0, n = 0
  const conHoras: Array<{ clave: string; pi: number; pf: number; min: number; fecha: string }> = []
  const liqPorTurno = new Map<string, number>()
  for (const f of filas) {
    const t = f.turno as TurnoFacturable
    const programados = Math.round(duracionProgramadaPlanilla(t) * 60)
    const min = Math.round((f.horasLiquidables || 0) * 60)
    if (f.capacitacion) {
      detalle.push({ turno_id: t.id, registro_id: f.registro?.id ?? null, puesto_id: t.puesto_id ?? null, fecha: t.fecha, programados, cubiertos: 0, estado: 'capacitacion' })
      continue
    }
    liqPorTurno.set(t.id, (liqPorTurno.get(t.id) ?? 0) + min)
    const p = instantesTurno(t)
    const pi = Date.parse(p.inicio), pf = Date.parse(p.fin)
    if (min > 0) {
      if (!t.puesto_id) sinPuesto++
      conHoras.push({ clave: t.puesto_id ?? `obj:${input.objetivoId}`, pi, pf, min, fecha: t.fecha })
      aceptadosFuera += Math.max(0, min - programados)
      if (franja) {
        // Lo reconocido se reparte como el horario programado del turno.
        const c = clasificar([pi, pf], franja), tot2 = c.d + c.n || 1
        d += min * c.d / tot2; n += min * c.n / tot2
      }
    }
    detalle.push({ turno_id: t.id, registro_id: f.registro?.id ?? null, puesto_id: t.puesto_id ?? null, fecha: t.fecha, programados, cubiertos: min,
      estado: min <= 0 ? (pf > ahora ? 'futuro' : 'sin_registro') : min >= programados - TOLERANCIA_MIN ? 'cubierto' : 'parcial' })
  }

  // Programado y descubierto: por turno con obligación, sin capacitación. Lo
  // que falta se mide por puesto y día: un relevo que entra antes y reconoce
  // esa hora tapa la salida anticipada del anterior (no es un hueco).
  let programadosTot = 0, sinRegistro = 0, futuros = 0
  const grupos = new Map<string, { prog: number; liq: number; d: number; n: number }>()
  for (const t of turnos) {
    if (t.objetivo_id !== input.objetivoId || ESTADOS_SIN_OBLIGACION.has(String(t.estado ?? '')) || esCapacitacion(t.tipo_evento)) continue
    const prog = Math.round(duracionProgramadaPlanilla(t) * 60)
    programadosTot += prog
    const liq = liqPorTurno.get(t.id) ?? 0
    const p = instantesTurno(t)
    const pi = Date.parse(p.inicio), pf = Date.parse(p.fin)
    if (pf > ahora) { if (liq <= 0) futuros++; continue }
    if (liq <= 0) sinRegistro++
    const k = `${t.puesto_id ?? `turno:${t.id}`}|${t.fecha}`
    const g = grupos.get(k) ?? { prog: 0, liq: 0, d: 0, n: 0 }
    g.prog += prog; g.liq += liq
    if (franja) { const c = clasificar([pi, pf], franja), s = c.d + c.n || 1; g.d += prog * c.d / s; g.n += prog * c.n / s }
    grupos.set(k, g)
  }
  let descubiertos = 0, dn = 0
  for (const g of Array.from(grupos.values())) {
    const falta = Math.max(0, g.prog - g.liq)
    descubiertos += falta
    if (franja && falta > 0) dn += falta * g.n / (g.d + g.n || 1)
  }

  // Superposiciones entre filas con horas del mismo puesto (sin puesto: del objetivo).
  let relevos = 0, simultaneos = 0
  const revisar: ParaRevisar[] = []
  const porClave = new Map<string, typeof conHoras>()
  for (const x of conHoras) porClave.set(x.clave, [...(porClave.get(x.clave) ?? []), x])
  for (const xs of Array.from(porClave.values())) {
    xs.sort((a, b) => a.pi - b.pi)
    let relevosClave = 0
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length && xs[j].pi < xs[i].pf; j++) {
      const a = xs[i], b = xs[j]
      const juntos = Math.round((Math.min(a.pf, b.pf) - Math.max(a.pi, b.pi)) / MIN)
      if (juntos <= 0) continue
      const contenido = (a.pi <= b.pi && a.pf >= b.pf) || (b.pi <= a.pi && b.pf >= a.pf)
      if (contenido) continue
      if (juntos <= RELEVO_MAX_MIN) relevosClave += Math.min(juntos, a.min, b.min)
      else revisar.push({ fecha: a.fecha, tipo: 'relevo_largo', minutos: juntos,
        detalle: `Dos turnos escalonados del mismo puesto se pisan ${Math.round(juntos / 6) / 10} h: se facturan los dos; confirmar si fue relevo o refuerzo` })
    }
    relevos += relevosClave
    // Simultáneos = horas de vigiladores adicionales: lo programado de las filas
    // menos su unión y menos los relevos (informativo; se facturan).
    const suma = xs.reduce((s, x) => s + (x.pf - x.pi) / MIN, 0)
    let union = 0, fin = -Infinity
    for (const x of xs) { if (x.pf <= fin) continue; union += (x.pf - Math.max(x.pi, fin)) / MIN; fin = x.pf }
    simultaneos += Math.max(0, Math.round(suma - union) - relevosClave)
  }
  const descontar = input.superposicion === 'sumar' ? 0 : relevos
  const liquidables = Math.round(tot.horasLiquidables * 60)
  const facturables = Math.max(0, liquidables - descontar)
  let minD: number | null = null, minN: number | null = null
  if (franja) {
    const s = d + n
    const f = s > 0 ? facturables / s : 0
    minN = Math.round(n * f); minD = facturables - minN
  }
  return {
    objetivoId: input.objetivoId,
    minutosLiquidables: liquidables,
    minutosReales: Math.round(tot.horasReales * 60),
    minutosProgramados: programadosTot,
    minutosCubiertos: facturables,
    minutosSuperpuestos: descontar,
    minutosSimultaneos: simultaneos,
    minutosDescubiertos: descubiertos,
    minutosAceptadosFuera: aceptadosFuera,
    minutosCapacitacionProgramados: detalle.filter(x => x.estado === 'capacitacion').reduce((s, x) => s + x.programados, 0),
    minutosCapacitacionLiquidables: Math.round(tot.horasCapacitacion * 60),
    turnosCapacitacion: tot.turnosCapacitacion,
    minutosDiurnos: minD, minutosNocturnos: minN,
    // Diurnas + nocturnas = total exacto (lo exige la base al aprobar).
    descubiertosDiurnos: franja ? descubiertos - Math.round(dn) : null, descubiertosNocturnos: franja ? Math.round(dn) : null,
    turnosSinRegistro: sinRegistro, turnosFuturos: futuros, turnosSinPuesto: sinPuesto,
    revisar,
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
