// Estado de cobro de una factura para la pantalla de Cobranzas (sólo lectura; los importes en centavos).
import { sumarDias } from '@/lib/periodo-argentina'
import { PLAZO_PAGO_POR_DEFECTO } from './vto-arca'

export type EstadoCobro = 'anulada' | 'pagada' | 'cobrada_retenciones' | 'parcial' | 'vencida' | 'por_vencer'

export interface SaldoFactura {
  total_c: number
  nc_c: number
  aplicado_c: number
  saldo_c: number
  fecha_emision: string
  vto_pago: string | null
  /** Vencimiento comercial (contrato o carga manual), si se calculó: ver vencimientoComercial. */
  vto_comercial?: string | null
  /** Cómo se llegó al vencimiento, para mostrarlo ("60 días desde la emisión", "cargado a mano", …). */
  vto_detalle?: string | null
}

/**
 * Vencimiento de una factura: el comercial (sale del contrato VIGENTE del cliente, así un cambio de plazo
 * se aplica solo) o, si no hay condición identificable, el informado a ARCA o la emisión + 30 días.
 */
export function vencimientoDe(f: Pick<SaldoFactura, 'fecha_emision' | 'vto_pago' | 'vto_comercial'>): string {
  if (f.vto_comercial) return f.vto_comercial
  if (f.vto_pago) return f.vto_pago
  return sumarDias(f.fecha_emision, PLAZO_PAGO_POR_DEFECTO)
}

/** Texto corto de cómo vence la factura (para mostrar al lado de la fecha). */
export function detalleVencimiento(f: Pick<SaldoFactura, 'vto_pago' | 'vto_comercial' | 'vto_detalle'>): string {
  if (f.vto_comercial && f.vto_detalle) return f.vto_detalle
  return f.vto_pago ? 'el informado en la factura' : `emisión + ${PLAZO_PAGO_POR_DEFECTO} días: el contrato no define el plazo`
}

// ── Vencimiento comercial ─────────────────────────────────────────────────────
// Mismas reglas que public.fact_vencimiento_comercial (20261201150000): vencimiento cargado a mano; si no, el
// contrato de la factura (el de su prefactura o, si no tiene, el único contrato vigente del cliente) con su
// plazo y desde qué evento corre. Sin condición (o sin la fecha del evento) no hay vencimiento comercial.

export interface ContratoPago {
  id: string; cliente_id: string | null; estado: string | null
  pago_evento: string | null; dias_vencimiento: number | string | null; pago_dia_mes: number | string | null
}
export interface SeguimientoPago {
  comprobante_id: string; vencimiento_manual?: string | null
  presentada_el?: string | null; recibida_el?: string | null; conformidad_el?: string | null
}
export interface CondicionesPago {
  contratos: ContratoPago[]
  /** prefactura → contrato */
  contratoDePrefactura: Map<string, string>
  /** comprobante → prefactura */
  prefacturaDeComprobante: Map<string, string>
  /** comprobante → fechas de seguimiento y vencimiento manual */
  seguimiento: Map<string, SeguimientoPago>
}
export interface FacturaParaVencer { comprobante_id: string; cliente_id: string | null; fecha_emision: string }

const DESDE: Record<string, string> = {
  emision: 'desde la emisión', presentacion: 'desde la presentación', recepcion: 'desde la recepción', conformidad: 'desde la conformidad',
}

/** Contrato de una factura: el de su prefactura; sin prefactura, el único contrato vigente del cliente. */
export function contratoDeFactura(f: FacturaParaVencer, c: CondicionesPago): ContratoPago | null {
  const pref = c.prefacturaDeComprobante.get(f.comprobante_id)
  if (pref) {
    const id = c.contratoDePrefactura.get(pref)
    return (id && c.contratos.find(k => k.id === id)) || null
  }
  if (!f.cliente_id) return null
  const vigentes = c.contratos.filter(k => k.cliente_id === f.cliente_id && k.estado === 'vigente')
  return vigentes.length === 1 ? vigentes[0] : null
}

/** Primer día de pago (el día del mes o, si no existe, el último) en o después de `desde`. */
export function proximoDiaDePago(desde: string, dia: number | string | null): string {
  const [a, m] = desde.split('-').map(Number)
  const enMes = (anio: number, mes: number) => {
    const ultimo = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
    const d = Math.min(Number(dia) > 0 ? Number(dia) : ultimo, ultimo)
    return `${anio}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  }
  const este = enMes(a, m)
  return este >= desde ? este : enMes(m === 12 ? a + 1 : a, m === 12 ? 1 : m + 1)
}

/** Vencimiento comercial de una factura, o null si el contrato no lo define (o falta la fecha del evento). */
export function vencimientoComercial(f: FacturaParaVencer, c: CondicionesPago): { fecha: string; detalle: string } | null {
  const s = c.seguimiento.get(f.comprobante_id)
  if (s?.vencimiento_manual) return { fecha: s.vencimiento_manual, detalle: 'vencimiento cargado a mano' }
  const k = contratoDeFactura(f, c)
  if (!k || !k.pago_evento || (k.dias_vencimiento == null && k.pago_evento !== 'fecha_fija')) return null
  const base = k.pago_evento === 'emision' || k.pago_evento === 'fecha_fija' ? f.fecha_emision
    : k.pago_evento === 'presentacion' ? s?.presentada_el : k.pago_evento === 'recepcion' ? s?.recibida_el : k.pago_evento === 'conformidad' ? s?.conformidad_el : null
  if (!base) return null
  const dias = Number(k.dias_vencimiento ?? 0)
  const d0 = sumarDias(base, dias)
  if (k.pago_evento === 'fecha_fija') {
    return { fecha: proximoDiaDePago(d0, k.pago_dia_mes), detalle: `día ${k.pago_dia_mes ?? 'fin'} del mes${dias ? `, tras ${dias} días` : ''} (contrato)` }
  }
  return { fecha: d0, detalle: `${dias} días${DESDE[k.pago_evento] ? ` ${DESDE[k.pago_evento]}` : ''} (contrato)` }
}

/** Agrega a cada fila su vencimiento comercial y el texto de cómo se calculó (sin condiciones, queda como estaba). */
export function conVencimiento<T extends FacturaParaVencer & Pick<SaldoFactura, 'vto_pago'>>(filas: T[], c: CondicionesPago | null): Array<T & { vto_comercial: string | null; vto_detalle: string | null }> {
  return filas.map(f => {
    const v = c ? vencimientoComercial(f, c) : null
    return { ...f, vto_comercial: v?.fecha ?? null, vto_detalle: v?.detalle ?? null }
  })
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
