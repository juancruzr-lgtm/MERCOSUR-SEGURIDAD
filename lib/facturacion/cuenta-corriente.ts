/**
 * lib/facturacion/cuenta-corriente.ts
 *
 * Cuenta corriente comercial por cliente. Reglas:
 *  - Un cobro (transferencia, cheque, efectivo) o un certificado de retención
 *    RECIBIDO se aplica a uno o varios comprobantes; un comprobante recibe
 *    varias aplicaciones. Nunca más de lo disponible ni más que el saldo.
 *  - Una retención ESTIMADA (calculada a partir del neto, sin certificado) no
 *    cancela deuda.
 *  - Los anticipos son cobros sin aplicar: quedan como saldo a favor.
 *  - Una aplicación no se borra: se revierte con motivo y responsable.
 */

export type EstadoRetencion = 'estimada' | 'certificado_recibido' | 'anulada'
export type EstadoCheque = 'en_cartera' | 'depositado' | 'acreditado' | 'rechazado' | 'endosado' | 'anulado'

/** Transiciones permitidas de cheques/echeques. */
export const TRANSICIONES_CHEQUE: Record<EstadoCheque, EstadoCheque[]> = {
  en_cartera: ['depositado', 'endosado', 'anulado'],
  depositado: ['acreditado', 'rechazado'],
  acreditado: [],
  rechazado: ['en_cartera', 'anulado'],
  endosado: [],
  anulado: [],
}

export function puedeCambiarCheque(de: EstadoCheque, a: EstadoCheque): boolean {
  return TRANSICIONES_CHEQUE[de]?.includes(a) ?? false
}

/** Un cheque sólo es dinero aplicable cuando está acreditado (o en cartera, como valor a cobrar). */
export function chequeAplicable(estado: EstadoCheque): boolean {
  return estado === 'en_cartera' || estado === 'depositado' || estado === 'acreditado'
}

export type OrigenAplicacion =
  | { tipo: 'cobro'; id: string; importe: number; aplicado: number; clienteId: string; chequeEstado?: EstadoCheque }
  | { tipo: 'retencion'; id: string; importe: number; aplicado: number; clienteId: string; estado: EstadoRetencion }
  | { tipo: 'nota_credito'; id: string; importe: number; aplicado: number; clienteId: string }

export type DestinoAplicacion = { id: string; clienteId: string; saldo: number; clase: 'factura' | 'nota_debito' | 'saldo_inicial' }

export type ValidacionAplicacion = { ok: true } | { ok: false; motivo: string }

export function validarAplicacion(
  origen: OrigenAplicacion,
  destino: DestinoAplicacion,
  importe: number,
  aplicacionesVigentes: Array<{ origenId: string; destinoId: string }>,
): ValidacionAplicacion {
  if (!Number.isInteger(importe) || importe <= 0) return { ok: false, motivo: 'El importe a aplicar debe ser positivo (en centavos).' }
  if (origen.clienteId !== destino.clienteId) return { ok: false, motivo: 'El cobro y el comprobante son de clientes distintos.' }
  if (origen.tipo === 'retencion' && origen.estado !== 'certificado_recibido') {
    return { ok: false, motivo: 'Una retención sin certificado recibido no cancela deuda.' }
  }
  if (origen.tipo === 'cobro' && origen.chequeEstado && !chequeAplicable(origen.chequeEstado)) {
    return { ok: false, motivo: `El cheque está ${origen.chequeEstado}: no se puede aplicar.` }
  }
  if (aplicacionesVigentes.some(a => a.origenId === origen.id && a.destinoId === destino.id)) {
    return { ok: false, motivo: 'Ese cobro ya está aplicado a este comprobante; revertí la aplicación vigente antes de volver a aplicarlo.' }
  }
  const disponible = origen.importe - origen.aplicado
  if (importe > disponible) return { ok: false, motivo: `Supera lo disponible del ${origen.tipo} (${disponible}).` }
  if (importe > destino.saldo) return { ok: false, motivo: `Supera el saldo del comprobante (${destino.saldo}).` }
  return { ok: true }
}

export type TramoAntiguedad = 'no_vencido' | '1_30' | '31_60' | '61_90' | 'mas_90'

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000)
}

export function tramoAntiguedad(vencimiento: string | null, hoy: string): TramoAntiguedad {
  if (!vencimiento) return 'no_vencido'
  const d = diasEntre(vencimiento, hoy)
  if (d <= 0) return 'no_vencido'
  if (d <= 30) return '1_30'
  if (d <= 60) return '31_60'
  if (d <= 90) return '61_90'
  return 'mas_90'
}

export function antiguedadDeuda(
  comprobantes: Array<{ saldo: number; vencimiento: string | null }>,
  hoy: string,
): Record<TramoAntiguedad, number> {
  const r: Record<TramoAntiguedad, number> = { no_vencido: 0, '1_30': 0, '31_60': 0, '61_90': 0, mas_90: 0 }
  for (const c of comprobantes) if (c.saldo > 0) r[tramoAntiguedad(c.vencimiento, hoy)] += c.saldo
  return r
}

/**
 * Saldo inicial: sólo se acepta con respaldo (documento o comprobantes
 * identificados). No se infiere de un extracto bancario de un único mes.
 */
export function validarSaldoInicial(s: { importe: number; fecha: string; respaldoDocumentoId: string | null; detalle: string }): ValidacionAplicacion {
  if (!s.respaldoDocumentoId) return { ok: false, motivo: 'El saldo inicial necesita un documento de respaldo (resumen de cuenta firmado, listado contable).' }
  if (!s.detalle?.trim()) return { ok: false, motivo: 'Describí de dónde sale el saldo inicial.' }
  if (!Number.isInteger(s.importe) || s.importe === 0) return { ok: false, motivo: 'Importe de saldo inicial inválido.' }
  return { ok: true }
}
