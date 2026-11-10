/**
 * lib/facturacion/vto-arca.ts
 *
 * Fecha de vencimiento de pago que se le informa a ARCA (FchVtoPago).
 *
 * Para servicios, ARCA la exige y no puede ser anterior a la fecha del
 * comprobante. La prefactura trae la fecha aprobada; si al emitir ya pasó, se
 * informa la fecha de emisión. Desde la migración 20261210100000, el comprobante
 * guarda (y el PDF imprime) la fecha que efectivamente recibió ARCA, no la de la
 * prefactura.
 *
 * Sin dependencias de servidor: la usan la emisión y la pantalla de Prefacturas.
 */

/** Fecha (YYYY-MM-DD) que se informa a ARCA si el comprobante sale con fecha `fechaEmision`. */
export function vtoPagoParaArca(vtoPrefactura: string | null | undefined, fechaEmision: string): string {
  return vtoPrefactura && vtoPrefactura >= fechaEmision ? vtoPrefactura : fechaEmision
}
