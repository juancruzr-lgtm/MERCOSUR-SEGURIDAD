// Cálculos del tablero financiero a partir de saldos, cobros y aplicaciones (centavos). Sin acceso a la base.
import { diasEntre, estadoCobro, vencimientoDe, type SaldoFactura } from './estado-cobro'

export interface FilaSaldo extends SaldoFactura { comprobante_id: string; cliente_id: string | null }
export interface Cobro { id: string; fecha: string; importe_c: number; cheque_estado?: string | null; medio?: string; cliente_id?: string }
export interface Aplicacion { cobro_id: string | null; comprobante_id: string | null; importe_c: number }

export interface Antiguedad { d1_30: number; d31_60: number; d61_90: number; mas_90: number; vencido: number; porVencer: number; retenciones: number }
const vacia = (): Antiguedad => ({ d1_30: 0, d31_60: 0, d61_90: 0, mas_90: 0, vencido: 0, porVencer: 0, retenciones: 0 })

/** Deuda por antigüedad: vencidas y pagos parciales por días de atraso; lo que falta por retenciones, aparte. */
export function antiguedad(filas: FilaSaldo[], hoy: string): Antiguedad {
  const a = vacia()
  for (const f of filas) {
    const { estado, diasVencida } = estadoCobro(f, hoy), saldo = Number(f.saldo_c)
    if (estado === 'cobrada_retenciones') a.retenciones += saldo
    else if (estado === 'por_vencer') a.porVencer += saldo
    else if (estado === 'vencida' || estado === 'parcial') {
      if (diasVencida <= 0) { a.porVencer += saldo; continue }
      a.vencido += saldo
      if (diasVencida <= 30) a.d1_30 += saldo; else if (diasVencida <= 60) a.d31_60 += saldo; else if (diasVencida <= 90) a.d61_90 += saldo; else a.mas_90 += saldo
    }
  }
  return a
}

/** Días promedio entre la emisión y el cobro, ponderados por importe aplicado. */
export function diasPromedioCobro(filas: FilaSaldo[], aps: Aplicacion[], cobros: Map<string, Cobro>): number | null {
  const emision = new Map(filas.map(f => [f.comprobante_id, f.fecha_emision]))
  let peso = 0, suma = 0
  for (const a of aps) {
    const c = a.cobro_id ? cobros.get(a.cobro_id) : null, e = a.comprobante_id ? emision.get(a.comprobante_id) : null
    if (!c || !e) continue
    const d = Math.max(0, diasEntre(e, c.fecha)), w = Number(a.importe_c)
    suma += d * w; peso += w
  }
  return peso ? Math.round(suma / peso) : null
}

/** Facturado (por fecha de emisión, neto de NC) y cobrado (por fecha de cobro) mes a mes. */
export function serieMensual(filas: FilaSaldo[], cobros: Cobro[], meses: string[]) {
  return meses.map(m => {
    const facturado = filas.filter(f => String(f.fecha_emision).startsWith(m)).reduce((s, f) => s + Number(f.total_c) - Number(f.nc_c), 0)
    const cobrado = cobros.filter(c => String(c.fecha).startsWith(m)).reduce((s, c) => s + Number(c.importe_c), 0)
    return { mes: m, facturado, cobrado }
  })
}

/** Facturas con saldo que vencen entre hoy y hoy + días (sin contar lo que falta por retenciones). */
export function proximosVencimientos(filas: FilaSaldo[], hoy: string, dias = 30) {
  return filas.map(f => ({ ...f, vto: vencimientoDe(f), ...estadoCobro(f, hoy) }))
    .filter(f => f.estado === 'por_vencer' && diasEntre(hoy, f.vto) <= dias)
    .sort((a, b) => a.vto.localeCompare(b.vto))
}

export function mesesHasta(mes: string, n: number): string[] {
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1 - i, 1))
    out.push(d.toISOString().slice(0, 7))
  }
  return out
}
