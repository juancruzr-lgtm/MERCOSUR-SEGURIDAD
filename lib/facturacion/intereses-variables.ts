/**
 * lib/facturacion/intereses-variables.ts
 *
 * Intereses por mora con la Tasa de Intereses Moratorios (TIM) del BCRA (Código Civil y Comercial, art. 768,
 * inc. c). SÓLO CÁLCULO: no registra intereses ni pide notas de débito.
 *
 * La TIM se publica como un índice diario acumulado (variable 1197 de la API de estadísticas del BCRA, todos los
 * días). Misma cuenta que la calculadora oficial del BCRA (calculadora-de-tasa-de-intereses-moratorios-tim):
 *   interés = monto × ((100 + TIM del día de cierre) / (100 + TIM del día anterior al inicio)) − monto.
 *
 * Por factura, un tramo por cada saldo:
 *  · la mora empieza el día siguiente al vencimiento + los días de gracia (fecha de inicio de la calculadora);
 *  · cada cobro, retención o nota de crédito aplicada cierra el tramo ESE día (fecha de cierre = fecha de pago,
 *    como al cargarla en la calculadora) y el saldo nuevo corre desde el día siguiente; una ND suma igual;
 *  · se redondea al centavo por tramo.
 */
import { sumarDias } from '@/lib/periodo-argentina'

export type PuntoSerie = { fecha: string; valor: number }
/** Movimiento del saldo de una factura: + nota de débito; − nota de crédito, cobro o retención aplicada. */
export type Movimiento = { fecha: string; importe_c: number }
export type TramoInteres = { desde: string; hasta: string; dias: number; saldo_c: number; coeficiente: number; tna_equivalente: number; interes_c: number }
export type ResultadoInteres = { desde: string; hasta: string; tramos: TramoInteres[]; interes_c: number; dias_mora: number; sin_dato: boolean }

const DIA = 86400000
const dias = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DIA)

/** Serie limpia y ordenada por fecha (ascendente), sin fechas repetidas. */
export function ordenarSerie(serie: PuntoSerie[]): PuntoSerie[] {
  const porFecha = new Map<string, number>()
  for (const p of serie) if (/^\d{4}-\d{2}-\d{2}$/.test(p.fecha) && Number.isFinite(p.valor)) porFecha.set(p.fecha, p.valor)
  return Array.from(porFecha, ([fecha, valor]) => ({ fecha, valor })).sort((a, b) => a.fecha.localeCompare(b.fecha))
}

/** Valor publicado ese día o, si todavía no hay, el último anterior (la serie, ordenada); null si empieza después. */
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

/** Interés por mora de una factura con la TIM, por tramos de saldo. */
export function interesConTim(o: { total_c: number; vencimiento: string; graciaDias?: number; movimientos: Movimiento[]; hasta: string; serie: PuntoSerie[] }): ResultadoInteres {
  const desde = sumarDias(o.vencimiento, Math.max(0, Math.trunc(o.graciaDias ?? 0)) + 1)
  const res: ResultadoInteres = { desde, hasta: o.hasta, tramos: [], interes_c: 0, dias_mora: 0, sin_dato: false }
  if (o.hasta < desde) return res
  const movs = [...o.movimientos].sort((a, b) => a.fecha.localeCompare(b.fecha))
  // Lo movido antes del primer día de mora ya está en el saldo inicial.
  let saldo = Number(o.total_c) + movs.filter(m => m.fecha < desde).reduce((s, m) => s + Number(m.importe_c), 0)
  let inicio = desde
  const tramo = (cierre: string) => {
    if (saldo <= 0 || cierre < inicio) return
    const k = coeficienteTim(o.serie, inicio, cierre)
    if (k == null) { res.sin_dato = true; return }
    const n = dias(inicio, cierre) + 1
    const interes_c = Math.round(saldo * (k - 1))
    res.tramos.push({ desde: inicio, hasta: cierre, dias: n, saldo_c: saldo, coeficiente: Math.round(k * 1e8) / 1e8, tna_equivalente: Math.round(((k - 1) * 36500 / n) * 100) / 100, interes_c })
    res.interes_c += interes_c
    res.dias_mora += n
  }
  // Cada fecha con movimientos dentro de la mora cierra el tramo ese día; el saldo nuevo corre desde el siguiente.
  const fechas = Array.from(new Set(movs.filter(m => m.fecha >= desde && m.fecha < o.hasta).map(m => m.fecha))).sort()
  for (const f of fechas) {
    tramo(f)
    saldo += movs.filter(m => m.fecha === f).reduce((s, m) => s + Number(m.importe_c), 0)
    inicio = sumarDias(f, 1)
  }
  tramo(o.hasta)
  return res
}
