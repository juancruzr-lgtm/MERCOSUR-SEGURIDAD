// Vencimiento de pago informado a ARCA (prueba en homologación del 10/11/2026).
// La prefactura de PNC tenía vencimiento 03/11; al emitir el 10/11 se le informó a ARCA
// la fecha de emisión, pero el comprobante y el PDF quedaban con 03/11. Ahora el
// comprobante guarda lo que recibió ARCA.
import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { comprobanteDesdeSolicitud } from '@/lib/facturacion/emision-servidor'
import { vtoPagoParaArca } from '@/lib/facturacion/vto-arca'

describe('vencimiento de pago informado a ARCA', () => {
  it('si la fecha aprobada ya pasó, se informa la de emisión', () => {
    expect(vtoPagoParaArca('2026-11-03', '2026-11-10')).toBe('2026-11-10')
  })

  it('si la fecha aprobada es igual o posterior a la emisión, se respeta', () => {
    expect(vtoPagoParaArca('2026-11-10', '2026-11-10')).toBe('2026-11-10')
    expect(vtoPagoParaArca('2026-12-10', '2026-11-10')).toBe('2026-12-10')
  })

  it('sin fecha aprobada, se informa la de emisión', () => {
    expect(vtoPagoParaArca(null, '2026-11-10')).toBe('2026-11-10')
    expect(vtoPagoParaArca(undefined, '2026-11-10')).toBe('2026-11-10')
    expect(vtoPagoParaArca('', '2026-11-10')).toBe('2026-11-10')
  })

  it('el pedido a ARCA aplica esa regla (caso PNC, factura A del 10/11)', () => {
    const e = {
      id: 'e1', tipo: 1, punto_venta: 999,
      solicitud: { neto_c: 100000000, iva_c: 21000000, total_c: 121000000, vto_pago: '2026-11-03', periodo_desde: '2026-10-01', periodo_hasta: '2026-10-31', cuit_receptor: '30716728397' },
    } as any
    const c = comprobanteDesdeSolicitud(e, { numero: 1, hoy: '2026-11-10', condicionIva: 'responsable_inscripto' })
    expect(c.fecha).toBe('2026-11-10')
    expect(c.vtoPago).toBe('2026-11-10')
    expect(c.servicioDesde).toBe('2026-10-01')
    expect(c.servicioHasta).toBe('2026-10-31')
  })

  it('la base da de alta el comprobante con las fechas del pedido a ARCA (migración 20261210100000)', () => {
    const sql = readFileSync(new URL('../supabase/migrations/20261210100000_facturacion_vto_enviado_a_arca.sql', import.meta.url), 'utf8')
    expect(sql).toMatch(/v_arca jsonb := coalesce\(e\.solicitud->'arca', '\{\}'::jsonb\)/)
    expect(sql).toMatch(/coalesce\(nullif\(v_arca->>'vtoPago', ''\)::date, nullif\(s->>'vto_pago', ''\)::date\)/)
    expect(sql).toMatch(/coalesce\(nullif\(v_arca->>'servicioDesde', ''\)::date, nullif\(s->>'periodo_desde', ''\)::date\)/)
    expect(sql).toMatch(/coalesce\(nullif\(v_arca->>'servicioHasta', ''\)::date, nullif\(s->>'periodo_hasta', ''\)::date\)/)
    // El rollback existe y vuelve a la versión anterior (fechas de la prefactura).
    const rb = readFileSync(new URL('../supabase/rollback/20261210100000_facturacion_vto_enviado_a_arca_rollback.sql', import.meta.url), 'utf8')
    expect(rb).toMatch(/nullif\(s->>'vto_pago', ''\)::date,/)
    expect(rb).not.toMatch(/v_arca/)
  })
})
