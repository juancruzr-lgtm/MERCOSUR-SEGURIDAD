import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { conVencimiento, contratoDeFactura, detalleVencimiento, estadoCobro, proximoDiaDePago, vencimientoComercial, vencimientoDe, type CondicionesPago } from '@/lib/facturacion/estado-cobro'

const f = (o: Partial<Parameters<typeof estadoCobro>[0]>) => ({ total_c: 100000, nc_c: 0, aplicado_c: 0, saldo_c: 100000, fecha_emision: '2026-10-01', vto_pago: null, ...o })

describe('estado de cobro de una factura', () => {
  it('vence a los 30 días si ARCA no tiene vencimiento', () => {
    expect(vencimientoDe({ fecha_emision: '2026-10-01', vto_pago: null })).toBe('2026-10-31')
    expect(vencimientoDe({ fecha_emision: '2026-10-01', vto_pago: '2026-11-15' })).toBe('2026-11-15')
  })
  it('sin cobros: vencida o por vencer según la fecha', () => {
    expect(estadoCobro(f({}), '2026-11-16')).toEqual({ estado: 'vencida', diasVencida: 16 })
    expect(estadoCobro(f({}), '2026-10-20').estado).toBe('por_vencer')
  })
  it('pagada, anulada con NC, parcial o cobrada con retenciones pendientes', () => {
    expect(estadoCobro(f({ aplicado_c: 100000, saldo_c: 0 }), '2026-11-16').estado).toBe('pagada')
    expect(estadoCobro(f({ nc_c: 100000, saldo_c: 0 }), '2026-11-16').estado).toBe('anulada')
    expect(estadoCobro(f({ aplicado_c: 80000, saldo_c: 20000 }), '2026-11-16').estado).toBe('cobrada_retenciones')
    expect(estadoCobro(f({ aplicado_c: 40000, saldo_c: 60000 }), '2026-11-16').estado).toBe('parcial')
  })
})

// Vencimiento comercial: mismas reglas que public.fact_vencimiento_comercial. Caso real: Laromet pasó a 60 días
// desde la emisión (Gerencia, 18/11/2026) y Cobranzas seguía con emisión + 30 / lo informado en la factura.
describe('vencimiento comercial (sale del contrato vigente)', () => {
  const LAROMET = { id: 'k-laromet', cliente_id: 'c-laromet', estado: 'vigente', pago_evento: 'emision', dias_vencimiento: 60, pago_dia_mes: null }
  const cond = (o: Partial<CondicionesPago> = {}): CondicionesPago => ({
    contratos: [LAROMET,
      { id: 'k-muni-1', cliente_id: 'c-muni', estado: 'vigente', pago_evento: 'emision', dias_vencimiento: 30, pago_dia_mes: null },
      { id: 'k-muni-2', cliente_id: 'c-muni', estado: 'vigente', pago_evento: 'emision', dias_vencimiento: 45, pago_dia_mes: null },
      { id: 'k-sin', cliente_id: 'c-sin', estado: 'vigente', pago_evento: null, dias_vencimiento: null, pago_dia_mes: null }],
    contratoDePrefactura: new Map([['p-oct', 'k-laromet'], ['p-muni', 'k-muni-2']]),
    prefacturaDeComprobante: new Map([['a-2071', 'p-oct'], ['m-1', 'p-muni']]),
    seguimiento: new Map(), ...o,
  })
  const fac = (comprobante_id: string, cliente_id: string | null, fecha_emision: string) => ({ comprobante_id, cliente_id, fecha_emision })

  it('Laromet: 60 días desde la emisión, con o sin prefactura (importadas de ARCA)', () => {
    expect(vencimientoComercial(fac('a-2071', 'c-laromet', '2026-11-01'), cond())).toEqual({ fecha: '2026-12-31', detalle: '60 días desde la emisión (contrato)' })
    // A 2054 (septiembre, sin prefactura): el único contrato vigente del cliente.
    expect(vencimientoComercial(fac('a-2054', 'c-laromet', '2026-10-05'), cond())?.fecha).toBe('2026-12-04')
  })
  it('si cambia el plazo del contrato, el vencimiento cambia solo', () => {
    const c30 = cond({ contratos: [{ ...LAROMET, dias_vencimiento: 30 }] })
    expect(vencimientoComercial(fac('a-2071', 'c-laromet', '2026-11-01'), c30)?.fecha).toBe('2026-12-01')
    expect(vencimientoComercial(fac('a-2071', 'c-laromet', '2026-11-01'), cond())?.fecha).toBe('2026-12-31')
  })
  it('contrato de la factura: el de su prefactura; sin prefactura, sólo si el cliente tiene un único contrato vigente', () => {
    expect(contratoDeFactura(fac('m-1', 'c-muni', '2026-11-01'), cond())?.id).toBe('k-muni-2')
    expect(contratoDeFactura(fac('m-2', 'c-muni', '2026-11-01'), cond())).toBeNull()
    expect(contratoDeFactura(fac('x', null, '2026-11-01'), cond())).toBeNull()
  })
  it('sin condición definida, sin contrato identificable o sin la fecha del evento: no hay vencimiento comercial', () => {
    expect(vencimientoComercial(fac('s-1', 'c-sin', '2026-11-01'), cond())).toBeNull()
    expect(vencimientoComercial(fac('m-2', 'c-muni', '2026-11-01'), cond())).toBeNull()
    const recepcion = cond({ contratos: [{ ...LAROMET, pago_evento: 'recepcion', dias_vencimiento: 15 }] })
    expect(vencimientoComercial(fac('a-2071', 'c-laromet', '2026-11-01'), recepcion)).toBeNull()
    recepcion.seguimiento.set('a-2071', { comprobante_id: 'a-2071', recibida_el: '2026-11-04' })
    expect(vencimientoComercial(fac('a-2071', 'c-laromet', '2026-11-01'), recepcion)).toEqual({ fecha: '2026-11-19', detalle: '15 días desde la recepción (contrato)' })
  })
  it('el vencimiento cargado a mano manda', () => {
    const c = cond({ seguimiento: new Map([['a-2071', { comprobante_id: 'a-2071', vencimiento_manual: '2027-02-15' }]]) })
    expect(vencimientoComercial(fac('a-2071', 'c-laromet', '2026-11-01'), c)).toEqual({ fecha: '2027-02-15', detalle: 'vencimiento cargado a mano' })
  })
  it('día fijo del mes: el primer día de pago en o después de emisión + plazo (fin de mes si no existe)', () => {
    expect(proximoDiaDePago('2026-11-05', 10)).toBe('2026-11-10')
    expect(proximoDiaDePago('2026-11-12', 10)).toBe('2026-12-10')
    expect(proximoDiaDePago('2026-12-20', 10)).toBe('2027-01-10')
    expect(proximoDiaDePago('2027-02-01', 31)).toBe('2027-02-28')
    const fija = cond({ contratos: [{ ...LAROMET, pago_evento: 'fecha_fija', dias_vencimiento: 30, pago_dia_mes: 10 }] })
    expect(vencimientoComercial(fac('a-2071', 'c-laromet', '2026-11-01'), fija)).toEqual({ fecha: '2026-12-10', detalle: 'día 10 del mes, tras 30 días (contrato)' })
  })
  it('Cobranzas: la fila usa el vencimiento del contrato; sin condiciones (p. ej. sin permiso), como antes', () => {
    const filas = [{ ...f({ fecha_emision: '2026-11-03', vto_pago: '2026-12-03' }), comprobante_id: 'a-2071', cliente_id: 'c-laromet' }]
    const [con] = conVencimiento(filas, cond())
    expect(vencimientoDe(con)).toBe('2027-01-02')
    expect(detalleVencimiento(con)).toBe('60 días desde la emisión (contrato)')
    expect(estadoCobro(con, '2026-12-20').estado).toBe('por_vencer') // con lo informado en la factura (03/12) ya figuraba vencida
    const [sin] = conVencimiento(filas, null)
    expect(vencimientoDe(sin)).toBe('2026-12-03')
    expect(detalleVencimiento(sin)).toBe('el informado en la factura')
    expect(detalleVencimiento({ vto_pago: null })).toMatch(/emisión \+ 30 días/)
  })
  it('las pantallas de Cobranzas, cuenta del cliente, deuda por cliente y Tablero cargan las condiciones', () => {
    for (const archivo of ['FacturasCobros', 'Cobranzas', 'ClientesDeuda', 'TableroFinanciero']) {
      const src = readFileSync(new URL(`../components/facturacion/${archivo}.tsx`, import.meta.url), 'utf8')
      expect(src, archivo).toMatch(/cargarCondicionesPago\(\)/)
      expect(src, archivo).toMatch(/conVencimiento\(/)
    }
  })
})
