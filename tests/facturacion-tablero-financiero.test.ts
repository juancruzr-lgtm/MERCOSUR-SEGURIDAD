import { describe, expect, it } from 'vitest'
import { antiguedad, diasPromedioCobro, mesesHasta, serieMensual } from '@/lib/facturacion/tablero-financiero'

const f = (id: string, o: any) => ({ comprobante_id: id, cliente_id: 'c', total_c: 1000, nc_c: 0, aplicado_c: 0, saldo_c: 1000, fecha_emision: '2026-08-01', vto_pago: null, ...o })

describe('tablero financiero', () => {
  it('separa deuda vencida por antigüedad, por vencer y retenciones', () => {
    const a = antiguedad([
      f('a', { fecha_emision: '2026-10-01' }),                       // vence 31/10 → 16 días
      f('b', { fecha_emision: '2026-08-01' }),                       // vence 31/08 → 77 días
      f('c', { fecha_emision: '2026-11-10' }),                       // por vencer
      f('d', { aplicado_c: 800, saldo_c: 200 }),                     // cobrada, faltan retenciones
      f('e', { aplicado_c: 1000, saldo_c: 0 }),                      // pagada
    ], '2026-11-16')
    expect(a).toMatchObject({ d1_30: 1000, d61_90: 1000, vencido: 2000, porVencer: 1000, retenciones: 200 })
  })
  it('días promedio de cobro ponderados por importe', () => {
    const filas = [f('a', { fecha_emision: '2026-01-01' }), f('b', { fecha_emision: '2026-01-01' })]
    const cobros = new Map([['x', { id: 'x', fecha: '2026-01-11', importe_c: 100 }], ['y', { id: 'y', fecha: '2026-01-31', importe_c: 300 }]])
    expect(diasPromedioCobro(filas, [{ cobro_id: 'x', comprobante_id: 'a', importe_c: 100 }, { cobro_id: 'y', comprobante_id: 'b', importe_c: 300 }], cobros)).toBe(25)
  })
  it('serie mensual de facturado y cobrado', () => {
    expect(mesesHasta('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02'])
    const s = serieMensual([f('a', { fecha_emision: '2026-01-05', nc_c: 100 })], [{ id: 'x', fecha: '2026-02-03', importe_c: 500 }], ['2026-01', '2026-02'])
    expect(s).toEqual([{ mes: '2026-01', facturado: 900, cobrado: 0 }, { mes: '2026-02', facturado: 0, cobrado: 500 }])
  })
})
