// Condiciones de pago para calcular, en pantalla, el vencimiento comercial de las facturas (Cobranzas, cuenta
// del cliente, deuda por cliente y Tablero). Se leen en cada carga: si cambia el plazo de un contrato, el
// vencimiento de sus facturas cambia solo. Sin permiso para leerlas (o ante un error), las pantallas siguen
// con lo informado en la factura o la emisión + 30 días, como antes.
import { leer } from './datos'
import { conVencimiento, type CondicionesPago, type ContratoPago, type FacturaParaVencer, type SaldoFactura, type SeguimientoPago } from './estado-cobro'

const PAGINA = 1000 // PostgREST corta en 1000 filas sin avisar

/** Todas las filas de una tabla, de a 1000 (ordenadas por `orden` para que las páginas no se pisen). */
export async function leerTodo<T = any>(tabla: string, campos: string, orden: string, filtro: (q: any) => any = q => q): Promise<T[]> {
  const out: T[] = []
  for (let desde = 0; ; desde += PAGINA) {
    const pagina = await leer<T>(tabla, q => filtro(q).order(orden).range(desde, desde + PAGINA - 1), campos)
    out.push(...pagina)
    if (pagina.length < PAGINA) return out
  }
}

export async function cargarCondicionesPago(): Promise<CondicionesPago | null> {
  try {
    const [contratos, prefacturas, comprobantes, seguimiento] = await Promise.all([
      leerTodo<ContratoPago>('fact_contratos', 'id, cliente_id, estado, pago_evento, dias_vencimiento, pago_dia_mes', 'id'),
      leerTodo<{ id: string; contrato_id: string }>('fact_prefacturas', 'id, contrato_id', 'id', q => q.not('contrato_id', 'is', null)),
      leerTodo<{ id: string; prefactura_id: string }>('fact_comprobantes', 'id, prefactura_id', 'id', q => q.eq('ambiente', 'produccion').not('prefactura_id', 'is', null)),
      leerTodo<SeguimientoPago>('fact_comprobante_seguimiento', 'comprobante_id, vencimiento_manual, presentada_el, recibida_el, conformidad_el', 'comprobante_id'),
    ])
    return {
      contratos,
      contratoDePrefactura: new Map(prefacturas.map(p => [p.id, p.contrato_id])),
      prefacturaDeComprobante: new Map(comprobantes.map(c => [c.id, c.prefactura_id])),
      seguimiento: new Map(seguimiento.map(s => [s.comprobante_id, s])),
    }
  } catch {
    return null
  }
}

/** Las filas de fact_v_saldos con su vencimiento comercial (ver vencimientoComercial en estado-cobro). */
export async function conVencimientoComercial<T extends FacturaParaVencer & Pick<SaldoFactura, 'vto_pago'>>(filas: T[]) {
  return conVencimiento(filas, await cargarCondicionesPago())
}
