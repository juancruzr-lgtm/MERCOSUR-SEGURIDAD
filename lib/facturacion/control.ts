/**
 * lib/facturacion/control.ts
 *
 * Control funcional: una prefactura de la app contra la factura REAL emitida
 * por el circuito de siempre (importada del CSV de ARCA). Sólo compara: no
 * vincula ni cambia nada. Si coinciden, la factura real se puede registrar
 * contra la prefactura (emisión manual), y queda cerrada sin duplicar.
 */

import { limpiarCuit, numeroVisible } from './comprobantes'

export type FilaControl = { campo: string; app: string; real: string; coincide: boolean; diferencia?: string }

const pesos = (c: number) => `$ ${(c / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function compararConFacturaReal(
  p: { tipo_comprobante: number | null; cuit_receptor: string | null; neto_c: number | null; iva_c: number | null; total_c: number | null },
  c: { tipo: number; punto_venta: number; numero: number; doc_nro_receptor: string | null; neto_c: number; iva_c: number; total_c: number },
): { filas: FilaControl[]; coincideTotal: boolean; registrable: boolean } {
  const dif = (a: number, b: number) => {
    const d = a - b
    return d === 0 ? undefined : `${d > 0 ? '+' : ''}${pesos(d)}${b ? ` (${((d / b) * 100).toFixed(2)} %)` : ''}`
  }
  const netoApp = Number(p.neto_c ?? 0), ivaApp = Number(p.iva_c ?? 0), totalApp = Number(p.total_c ?? 0)
  const filas: FilaControl[] = [
    { campo: 'Tipo de comprobante', app: String(p.tipo_comprobante ?? '—'), real: String(c.tipo), coincide: p.tipo_comprobante === c.tipo },
    { campo: 'CUIT del receptor', app: limpiarCuit(p.cuit_receptor), real: limpiarCuit(c.doc_nro_receptor), coincide: limpiarCuit(p.cuit_receptor) === limpiarCuit(c.doc_nro_receptor) },
    // ARCA a veces informa el neto a 1 centavo (lo saca del total): se tolera hasta 2.
    { campo: 'Neto', app: pesos(netoApp), real: pesos(c.neto_c), coincide: Math.abs(netoApp - c.neto_c) <= 2, diferencia: dif(netoApp, c.neto_c) },
    { campo: 'IVA', app: pesos(ivaApp), real: pesos(c.iva_c), coincide: Math.abs(ivaApp - c.iva_c) <= 2, diferencia: dif(ivaApp, c.iva_c) },
    { campo: 'Total', app: pesos(totalApp), real: pesos(c.total_c), coincide: totalApp === c.total_c, diferencia: dif(totalApp, c.total_c) },
  ]
  const coincideTotal = filas[4].coincide
  return { filas, coincideTotal, registrable: filas.every(f => f.coincide) }
}

export const etiquetaFactura = (c: { tipo: number; punto_venta: number; numero: number }) =>
  numeroVisible({ tipo: c.tipo, puntoVenta: c.punto_venta, numero: c.numero })
