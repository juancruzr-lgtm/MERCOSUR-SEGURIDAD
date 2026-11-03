/**
 * lib/facturacion/comprobantes.ts
 *
 * Comprobantes fiscales. Identidad = emisor + tipo + punto de venta + número
 * (lo que ARCA considera único). Un comprobante autorizado no se modifica:
 * toda corrección es una nota de crédito/débito vinculada.
 */

export type ClaseComprobante = 'factura' | 'nota_debito' | 'nota_credito'

export type TipoComprobante = {
  codigo: number
  letra: 'A' | 'B' | 'C'
  clase: ClaseComprobante
  fce: boolean
  nombre: string
}

// Códigos de la tabla de tipos de comprobante de ARCA (FEParamGetTiposCbte).
export const TIPOS_COMPROBANTE: Record<number, TipoComprobante> = {
  1: { codigo: 1, letra: 'A', clase: 'factura', fce: false, nombre: 'Factura A' },
  2: { codigo: 2, letra: 'A', clase: 'nota_debito', fce: false, nombre: 'Nota de Débito A' },
  3: { codigo: 3, letra: 'A', clase: 'nota_credito', fce: false, nombre: 'Nota de Crédito A' },
  6: { codigo: 6, letra: 'B', clase: 'factura', fce: false, nombre: 'Factura B' },
  7: { codigo: 7, letra: 'B', clase: 'nota_debito', fce: false, nombre: 'Nota de Débito B' },
  8: { codigo: 8, letra: 'B', clase: 'nota_credito', fce: false, nombre: 'Nota de Crédito B' },
  201: { codigo: 201, letra: 'A', clase: 'factura', fce: true, nombre: 'Factura de Crédito Electrónica MiPyMEs A' },
  202: { codigo: 202, letra: 'A', clase: 'nota_debito', fce: true, nombre: 'Nota de Débito Electrónica MiPyMEs A' },
  203: { codigo: 203, letra: 'A', clase: 'nota_credito', fce: true, nombre: 'Nota de Crédito Electrónica MiPyMEs A' },
}

export function tipoComprobante(codigo: number): TipoComprobante {
  const t = TIPOS_COMPROBANTE[codigo]
  if (!t) throw new Error(`Tipo de comprobante no contemplado: ${codigo}`)
  return t
}

/** +1 factura / ND (aumentan deuda), -1 NC (la reducen). */
export function signoComprobante(codigo: number): 1 | -1 {
  return tipoComprobante(codigo).clase === 'nota_credito' ? -1 : 1
}

/** Las NC/ND deben ir a un comprobante de la misma letra y familia (FCE con FCE). */
export function tipoAsociadoValido(codigoNota: number, codigoAsociado: number): boolean {
  const n = tipoComprobante(codigoNota)
  const a = tipoComprobante(codigoAsociado)
  return n.clase !== 'factura' && a.clase === 'factura' && n.letra === a.letra && n.fce === a.fce
}

export function limpiarCuit(cuit: string | null | undefined): string {
  return String(cuit ?? '').replace(/\D/g, '')
}

/** Dígito verificador de CUIT (módulo 11). */
export function cuitValido(cuit: string | null | undefined): boolean {
  const c = limpiarCuit(cuit)
  if (c.length !== 11) return false
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = pesos.reduce((acc, p, i) => acc + p * Number(c[i]), 0)
  let dv = 11 - (suma % 11)
  if (dv === 11) dv = 0
  if (dv === 10) return false
  return dv === Number(c[10])
}

export type IdentidadComprobante = {
  cuitEmisor: string
  tipo: number
  puntoVenta: number
  numero: number
}

export function claveComprobante(c: IdentidadComprobante): string {
  return `${limpiarCuit(c.cuitEmisor)}-${String(c.tipo).padStart(3, '0')}-${String(c.puntoVenta).padStart(5, '0')}-${String(c.numero).padStart(8, '0')}`
}

/** 'A 0001-00002047' para mostrar. */
export function numeroVisible(c: { tipo: number; puntoVenta: number; numero: number }): string {
  const t = TIPOS_COMPROBANTE[c.tipo]
  const pre = t ? `${t.clase === 'factura' ? 'FC' : t.clase === 'nota_credito' ? 'NC' : 'ND'} ${t.letra}` : `T${c.tipo}`
  return `${pre} ${String(c.puntoVenta).padStart(4, '0')}-${String(c.numero).padStart(8, '0')}`
}

/**
 * Una NC sobre una factura: total si deja el saldo FISCAL de la factura en
 * cero, parcial si no. Rechaza la NC que excede lo que queda por acreditar
 * (considerando las NC anteriores a esa misma factura).
 */
export function clasificarNotaCredito(
  totalFactura: number,
  ncPreviasCentavos: number[],
  totalNc: number,
): { ok: true; alcance: 'total' | 'parcial'; saldoFiscal: number } | { ok: false; motivo: string } {
  if (totalNc <= 0) return { ok: false, motivo: 'La nota de crédito debe tener importe positivo.' }
  const previas = ncPreviasCentavos.reduce((a, b) => a + b, 0)
  const disponible = totalFactura - previas
  if (totalNc > disponible) {
    return { ok: false, motivo: `La nota de crédito (${totalNc}) supera lo que queda por acreditar de la factura (${disponible}).` }
  }
  const saldoFiscal = disponible - totalNc
  return { ok: true, alcance: saldoFiscal === 0 ? 'total' : 'parcial', saldoFiscal }
}

export type Movimiento = { importe: number; revertido?: boolean }

/**
 * Saldo pendiente de un comprobante de deuda: total + ND − NC − aplicaciones
 * vigentes (cobros y retenciones con certificado). Las aplicaciones
 * revertidas no cuentan.
 */
export function saldoComprobante(input: {
  total: number
  notasDebito?: number[]
  notasCredito?: number[]
  aplicaciones?: Movimiento[]
}): number {
  const nd = (input.notasDebito ?? []).reduce((a, b) => a + b, 0)
  const nc = (input.notasCredito ?? []).reduce((a, b) => a + b, 0)
  const ap = (input.aplicaciones ?? []).filter(x => !x.revertido).reduce((a, b) => a + b.importe, 0)
  return input.total + nd - nc - ap
}
