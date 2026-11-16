// Estado de cobro de una factura para la pantalla de Cobranzas (sólo lectura; los importes en centavos).
export type EstadoCobro = 'anulada' | 'pagada' | 'cobrada_retenciones' | 'parcial' | 'vencida' | 'por_vencer'

export interface SaldoFactura {
  total_c: number
  nc_c: number
  aplicado_c: number
  saldo_c: number
  fecha_emision: string
  vto_pago: string | null
}

/** Vencimiento: el informado a ARCA o, si no hay, la fecha de emisión + 30 días (plazo por defecto). */
export function vencimientoDe(f: Pick<SaldoFactura, 'fecha_emision' | 'vto_pago'>): string {
  if (f.vto_pago) return f.vto_pago
  const d = new Date(`${f.fecha_emision}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 30)
  return d.toISOString().slice(0, 10)
}

/** Días entre dos fechas AAAA-MM-DD (b - a). */
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000)
}

/**
 * Lo que queda impago después de un cobro suele ser retención (IVA, Ganancias, IIBB, SUSS): hasta un 25 %
 * del total se muestra como "cobrada, faltan retenciones" y no como pago parcial.
 */
export const TOPE_RETENCIONES = 0.25

export function estadoCobro(f: SaldoFactura, hoy: string): { estado: EstadoCobro; diasVencida: number } {
  const total = Number(f.total_c), nc = Number(f.nc_c), aplicado = Number(f.aplicado_c), saldo = Number(f.saldo_c)
  const vto = vencimientoDe(f)
  const diasVencida = Math.max(0, diasEntre(vto, hoy))
  if (nc >= total) return { estado: 'anulada', diasVencida: 0 }
  if (saldo <= 0) return { estado: 'pagada', diasVencida: 0 }
  if (aplicado > 0) return { estado: saldo <= total * TOPE_RETENCIONES ? 'cobrada_retenciones' : 'parcial', diasVencida }
  return { estado: vto < hoy ? 'vencida' : 'por_vencer', diasVencida }
}

export const ETIQUETA_ESTADO: Record<EstadoCobro, { texto: string; color: string }> = {
  pagada: { texto: 'Pagada', color: '#16a34a' },
  cobrada_retenciones: { texto: 'Cobrada · faltan retenciones', color: '#65a30d' },
  parcial: { texto: 'Pago parcial', color: '#ca8a04' },
  vencida: { texto: 'Vencida', color: '#dc2626' },
  por_vencer: { texto: 'Por vencer', color: '#2563eb' },
  anulada: { texto: 'Anulada con NC', color: '#64748b' },
}
