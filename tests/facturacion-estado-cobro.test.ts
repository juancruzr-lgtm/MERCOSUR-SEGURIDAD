import { describe, expect, it } from 'vitest'
import { estadoCobro, vencimientoDe } from '@/lib/facturacion/estado-cobro'

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
