/**
 * lib/facturacion/vto-arca.ts
 *
 * Plazo de pago de los contratos y fecha de vencimiento de pago que se le
 * informa a ARCA (FchVtoPago).
 *
 * - Plazo: el que tenga cargado el contrato; si no tiene otro, 30 días
 *   (decisión de Gerencia, 10/11/2026; migración 20261210110000).
 * - ARCA exige la fecha para servicios y no acepta una anterior al comprobante.
 *   La prefactura trae la fecha aprobada; si al emitir ya pasó, se informa la
 *   fecha de emisión + el plazo del contrato.
 * - Desde la migración 20261210100000, el comprobante guarda (y el PDF imprime)
 *   la fecha que efectivamente recibió ARCA, no la de la prefactura.
 *
 * Sin dependencias de servidor: la usan la emisión, la prefacturación y la
 * pantalla de Prefacturas.
 */

import { sumarDias } from '@/lib/periodo-argentina'

/** Plazo de pago cuando el contrato no tiene otro. */
export const PLAZO_PAGO_POR_DEFECTO = 30

/** Plazo de pago en días: el del contrato (0 a 365) o, si no tiene otro, 30. */
export function plazoPagoDias(dias: number | string | null | undefined): number {
  if (dias === null || dias === undefined || dias === '') return PLAZO_PAGO_POR_DEFECTO
  const n = Number(dias)
  return Number.isInteger(n) && n >= 0 && n <= 365 ? n : PLAZO_PAGO_POR_DEFECTO
}

/**
 * Fecha (YYYY-MM-DD) que se informa a ARCA si el comprobante sale con fecha `fechaEmision`:
 * la aprobada en la prefactura si todavía no pasó; si no, emisión + plazo del contrato.
 */
export function vtoPagoParaArca(vtoPrefactura: string | null | undefined, fechaEmision: string, plazoDias?: number | string | null): string {
  if (vtoPrefactura && vtoPrefactura >= fechaEmision) return vtoPrefactura
  return sumarDias(fechaEmision, plazoPagoDias(plazoDias))
}
