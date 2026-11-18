/**
 * lib/facturacion/intereses-variables.ts
 *
 * Intereses por mora con una tasa que cambia día a día (la BADLAR del BCRA, con la corrección que se elija).
 * SÓLO CÁLCULO: no registra intereses ni pide notas de débito.
 *
 * Mismas convenciones que public.fact_interes_calcular (20261201150000), salvo la tasa:
 *  · la mora empieza el día siguiente al vencimiento + los días de gracia;
 *  · el saldo de cada día es el total más los movimientos con fecha hasta ese día (las ND suman; las NC,
 *    los cobros y las retenciones aplicadas restan): el día del cobro ya no genera interés sobre lo cobrado;
 *  · interés de cada día = saldo × tasa del día (% nominal anual) / 36.500 (interés simple); se redondea
 *    al centavo por tramo (un tramo = días seguidos con el mismo saldo).
 *  · tasa del día = la publicada el último día hábil hasta esa fecha, × factor + puntos.
 */
import { sumarDias } from '@/lib/periodo-argentina'

export type PuntoSerie = { fecha: string; valor: number }
/** Movimiento del saldo de una factura: + nota de débito; − nota de crédito, cobro o retención aplicada. */
export type Movimiento = { fecha: string; importe_c: number }
/** Corrección de la tasa publicada: tasa × factor + puntos (en puntos porcentuales anuales). */
export type Correccion = { factor: number; puntos: number }
export type TramoInteres = { desde: string; hasta: string; dias: number; saldo_c: number; tasa_promedio: number; interes_c: number }
export type ResultadoInteres = { desde: string; hasta: string; tramos: TramoInteres[]; interes_c: number; dias_mora: number; dias_sin_tasa: number }

const MAX_DIAS = 3700 // ~10 años: tope de seguridad del recorrido día por día

export const SIN_CORRECCION: Correccion = { factor: 1, puntos: 0 }
export const corregirTasa = (valor: number, c: Correccion) => valor * c.factor + c.puntos

/** Serie limpia y ordenada por fecha (ascendente), sin fechas repetidas. */
export function ordenarSerie(serie: PuntoSerie[]): PuntoSerie[] {
  const porFecha = new Map<string, number>()
  for (const p of serie) if (/^\d{4}-\d{2}-\d{2}$/.test(p.fecha) && Number.isFinite(p.valor)) porFecha.set(p.fecha, p.valor)
  return Array.from(porFecha, ([fecha, valor]) => ({ fecha, valor })).sort((a, b) => a.fecha.localeCompare(b.fecha))
}

/** Valor publicado el último día hábil hasta `fecha` (la serie, ordenada); null si la serie empieza después. */
export function tasaDelDia(serie: PuntoSerie[], fecha: string): number | null {
  let lo = 0, hi = serie.length - 1, r = -1
  while (lo <= hi) {
    const m = (lo + hi) >> 1
    if (serie[m].fecha <= fecha) { r = m; lo = m + 1 } else hi = m - 1
  }
  return r >= 0 ? serie[r].valor : null
}

/** Interés por mora de una factura, día por día, con la tasa variable corregida. */
export function interesConTasaVariable(o: {
  total_c: number; vencimiento: string; graciaDias?: number; movimientos: Movimiento[]; hasta: string; serie: PuntoSerie[]; correccion?: Correccion
}): ResultadoInteres {
  const desde = sumarDias(o.vencimiento, Math.max(0, Math.trunc(o.graciaDias ?? 0)) + 1)
  const res: ResultadoInteres = { desde, hasta: o.hasta, tramos: [], interes_c: 0, dias_mora: 0, dias_sin_tasa: 0 }
  if (o.hasta < desde) return res
  const correccion = o.correccion ?? SIN_CORRECCION
  const movs = [...o.movimientos].sort((a, b) => a.fecha.localeCompare(b.fecha))
  let saldo = Number(o.total_c)
  let i = 0
  let t: { desde: string; hasta: string; dias: number; saldo_c: number; sumaTasa: number; interes: number } | null = null
  const cerrar = () => {
    if (t) {
      const interes_c = Math.round(t.interes)
      res.tramos.push({ desde: t.desde, hasta: t.hasta, dias: t.dias, saldo_c: t.saldo_c, tasa_promedio: Math.round((t.sumaTasa / t.dias) * 10000) / 10000, interes_c })
      res.interes_c += interes_c
    }
    t = null
  }
  let d = desde
  for (let n = 0; d <= o.hasta && n < MAX_DIAS; n++, d = sumarDias(d, 1)) {
    while (i < movs.length && movs[i].fecha <= d) { saldo += Number(movs[i].importe_c); i++ }
    if (saldo <= 0) { cerrar(); continue }
    const publicada = tasaDelDia(o.serie, d)
    if (publicada == null) { res.dias_sin_tasa++; cerrar(); continue }
    const tasa = corregirTasa(publicada, correccion)
    res.dias_mora++
    if (!t || t.saldo_c !== saldo) { cerrar(); t = { desde: d, hasta: d, dias: 0, saldo_c: saldo, sumaTasa: 0, interes: 0 } }
    t.hasta = d; t.dias++; t.sumaTasa += tasa; t.interes += (saldo * tasa) / 36500
  }
  cerrar()
  return res
}
