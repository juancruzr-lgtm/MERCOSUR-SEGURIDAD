/**
 * lib/facturacion/intereses-variables.ts
 *
 * Intereses por mora INFORMATIVOS de Cobranzas: sólo cálculo, para avisarle al cliente. No registra intereses ni
 * pide notas de débito. La tasa (la general o la del contrato) sale de lib/facturacion/tasa-mora:
 *  · BADLAR de bancos privados × factor ("BADLAR corregida"): interés simple día por día con la tasa nominal anual
 *    publicada el último día hábil hasta cada día (serie 7 del BCRA): saldo × BADLAR × factor / 36.500.
 *  · TIM del BCRA (CCyC art. 768 inc. c): índice diario acumulado (serie 1197), con la cuenta de su calculadora
 *    oficial: saldo × ((100 + TIM del día de cierre) / (100 + TIM del día anterior al inicio)) − saldo.
 *  · Tasa fija pactada: saldo × tasa × días / (36.500 anual | 3.000 mensual | 100 diaria), como fact_interes_calcular.
 *
 * Por factura, un tramo por cada saldo:
 *  · la mora empieza el día siguiente al vencimiento + los días de gracia;
 *  · cada cobro, retención o nota de crédito aplicada cierra el tramo ESE día (el día del pago cuenta, como en la
 *    calculadora del BCRA) y el saldo nuevo corre desde el día siguiente; una ND suma igual. Así, la tasa variable
 *    queda cerrada el día del cobro y, mientras no se paga, se ve lo acumulado a la fecha;
 *  · se redondea al centavo por tramo.
 */
import { sumarDias } from '@/lib/periodo-argentina'
import type { TasaMora } from './tasa-mora'

export type PuntoSerie = { fecha: string; valor: number }
/** Movimiento del saldo de una factura: + nota de débito; − nota de crédito, cobro o retención aplicada. */
export type Movimiento = { fecha: string; importe_c: number }
/** Días seguidos en mora con el mismo saldo. */
export type TramoMora = { desde: string; hasta: string; dias: number; saldo_c: number }
/** tna_equivalente: tasa nominal anual del tramo (%); coeficiente: sólo con la TIM. */
export type TramoInteres = TramoMora & { tna_equivalente: number; interes_c: number; coeficiente?: number }
export type ResultadoInteres = { desde: string; hasta: string; tramos: TramoInteres[]; interes_c: number; dias_mora: number; sin_dato: boolean }
/** Series del BCRA ya ordenadas (ordenarSerie). */
export type SeriesBcra = { badlar?: PuntoSerie[]; tim?: PuntoSerie[] }

const DIA = 86400000
const MAX_DIAS = 3700 // ~10 años: tope del recorrido día por día de la BADLAR
const FECHA = /^\d{4}-\d{2}-\d{2}$/
const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA)
const dos = (x: number) => Math.round(x * 100) / 100

/** Serie limpia y ordenada por fecha (ascendente), sin fechas repetidas. */
export function ordenarSerie(serie: PuntoSerie[]): PuntoSerie[] {
  const porFecha = new Map<string, number>()
  for (const p of serie) if (FECHA.test(p.fecha) && Number.isFinite(p.valor)) porFecha.set(p.fecha, p.valor)
  return Array.from(porFecha, ([fecha, valor]) => ({ fecha, valor })).sort((a, b) => a.fecha.localeCompare(b.fecha))
}

/** Valor publicado ese día o, si todavía no hay (o es feriado), el último anterior; null si la serie empieza después. */
export function valorDelDia(serie: PuntoSerie[], fecha: string): number | null {
  let lo = 0, hi = serie.length - 1, r = -1
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    if (serie[m].fecha <= fecha) { r = m; lo = m + 1 } else hi = m - 1
  }
  return r >= 0 ? serie[r].valor : null
}

/** Coeficiente de la TIM entre una fecha de inicio y una de cierre (ambas incluidas), como la calculadora del BCRA. */
export function coeficienteTim(serie: PuntoSerie[], inicio: string, cierre: string): number | null {
  const a = valorDelDia(serie, sumarDias(inicio, -1)), b = valorDelDia(serie, cierre)
  return a == null || b == null ? null : (100 + b) / (100 + a)
}

/** Tramos de saldo en mora de una factura hasta `hasta` (incluido). Movimientos con fecha inválida no cuentan. */
export function tramosDeMora(o: { total_c: number; vencimiento: string; graciaDias?: number; movimientos: Movimiento[]; hasta: string }): { desde: string; tramos: TramoMora[] } {
  const desde = sumarDias(o.vencimiento, Math.max(0, Math.trunc(o.graciaDias ?? 0)) + 1)
  const tramos: TramoMora[] = []
  if (o.hasta < desde) return { desde, tramos }
  const movs = o.movimientos.filter(m => FECHA.test(m.fecha)).sort((a, b) => a.fecha.localeCompare(b.fecha))
  // Lo movido antes del primer día de mora ya está en el saldo inicial.
  let saldo = Number(o.total_c) + movs.filter(m => m.fecha < desde).reduce((s, m) => s + Number(m.importe_c), 0)
  let inicio = desde
  const cerrar = (cierre: string) => {
    if (saldo > 0 && cierre >= inicio) tramos.push({ desde: inicio, hasta: cierre, dias: dias(inicio, cierre) + 1, saldo_c: saldo })
  }
  // Cada fecha con movimientos dentro de la mora cierra el tramo ese día; el saldo nuevo corre desde el siguiente.
  const fechas = Array.from(new Set(movs.filter(m => m.fecha >= desde && m.fecha < o.hasta).map(m => m.fecha))).sort()
  for (const f of fechas) {
    cerrar(f)
    saldo += movs.filter(m => m.fecha === f).reduce((s, m) => s + Number(m.importe_c), 0)
    inicio = sumarDias(f, 1)
  }
  cerrar(o.hasta)
  return { desde, tramos }
}

/** Interés de un tramo con la tasa dada; null si falta el dato de la serie del BCRA. */
function interesDelTramo(t: TramoMora, tasa: TasaMora, series: SeriesBcra): { interes_c: number; tna_equivalente: number; coeficiente?: number } | null {
  switch (tasa.tipo) {
    case 'tim': {
      const k = series.tim ? coeficienteTim(series.tim, t.desde, t.hasta) : null
      if (k == null) return null
      return { interes_c: Math.round(t.saldo_c * (k - 1)), coeficiente: Math.round(k * 1e8) / 1e8, tna_equivalente: dos(((k - 1) * 36500) / t.dias) }
    }
    case 'badlar': {
      if (!series.badlar) return null
      let suma = 0
      let d = t.desde
      for (let i = 0; i < t.dias && i < MAX_DIAS; i++, d = sumarDias(d, 1)) {
        const v = valorDelDia(series.badlar, d)
        if (v == null) return null
        suma += v
      }
      return { interes_c: Math.round((t.saldo_c * suma * tasa.factor) / 36500), tna_equivalente: dos((suma * tasa.factor) / t.dias) }
    }
    case 'fija': {
      const div = tasa.periodo === 'anual' ? 36500 : tasa.periodo === 'mensual' ? 3000 : 100
      return { interes_c: Math.round((t.saldo_c * tasa.tasa * t.dias) / div), tna_equivalente: dos((tasa.tasa * 36500) / div) }
    }
    default:
      return { interes_c: 0, tna_equivalente: 0 }
  }
}

/** Interés por mora de una factura con la tasa que corresponda, por tramos de saldo. */
export function interesConTasa(o: { total_c: number; vencimiento: string; graciaDias?: number; movimientos: Movimiento[]; hasta: string; tasa: TasaMora; series: SeriesBcra }): ResultadoInteres {
  const { desde, tramos } = tramosDeMora(o)
  const res: ResultadoInteres = { desde, hasta: o.hasta, tramos: [], interes_c: 0, dias_mora: 0, sin_dato: false }
  if (o.tasa.tipo === 'sin_interes') return res
  for (const t of tramos) {
    const c = interesDelTramo(t, o.tasa, o.series)
    if (!c) { res.sin_dato = true; continue }
    res.tramos.push({ ...t, ...c })
    res.interes_c += c.interes_c
    res.dias_mora += t.dias
  }
  return res
}

/** Interés por mora de una factura con la TIM (la cuenta de la calculadora oficial del BCRA). */
export function interesConTim(o: { total_c: number; vencimiento: string; graciaDias?: number; movimientos: Movimiento[]; hasta: string; serie: PuntoSerie[] }): ResultadoInteres {
  return interesConTasa({ ...o, tasa: { tipo: 'tim' }, series: { tim: o.serie } })
}
