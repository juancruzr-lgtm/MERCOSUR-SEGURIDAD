// Vencimiento de pago informado a ARCA y plazo de pago por defecto.
// - Prueba en homologación del 10/11/2026: la prefactura de PNC tenía vencimiento 03/11; al emitir el
//   10/11 se le informó a ARCA otra fecha, pero el comprobante y el PDF quedaban con 03/11. Ahora el
//   comprobante guarda lo que recibió ARCA (migración 20261210100000).
// - Gerencia (10/11/2026): los contratos tienen 30 días de plazo si no dicen otro (20261210110000).
import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { comprobanteDesdeSolicitud } from '@/lib/facturacion/emision-servidor'
import { PLAZO_PAGO_POR_DEFECTO, plazoPagoDias, vtoPagoParaArca } from '@/lib/facturacion/vto-arca'

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8')

describe('plazo de pago del contrato', () => {
  it('si el contrato no tiene otro, 30 días', () => {
    expect(PLAZO_PAGO_POR_DEFECTO).toBe(30)
    expect(plazoPagoDias(null)).toBe(30)
    expect(plazoPagoDias(undefined)).toBe(30)
    expect(plazoPagoDias('')).toBe(30)
  })

  it('respeta el plazo cargado, incluso 0 (contado)', () => {
    expect(plazoPagoDias(45)).toBe(45)
    expect(plazoPagoDias('60')).toBe(60)
    expect(plazoPagoDias(0)).toBe(0)
  })

  it('un valor inválido no inventa plazos raros: vuelve a 30', () => {
    expect(plazoPagoDias(-5)).toBe(30)
    expect(plazoPagoDias(400)).toBe(30)
    expect(plazoPagoDias('treinta')).toBe(30)
    expect(plazoPagoDias(12.5)).toBe(30)
  })
})

describe('vencimiento de pago informado a ARCA', () => {
  it('si la fecha aprobada todavía no pasó, se respeta', () => {
    expect(vtoPagoParaArca('2026-11-10', '2026-11-10')).toBe('2026-11-10')
    expect(vtoPagoParaArca('2026-12-10', '2026-11-10', 45)).toBe('2026-12-10')
  })

  it('si ya pasó, emisión + plazo del contrato (30 días si no tiene otro)', () => {
    expect(vtoPagoParaArca('2026-11-03', '2026-11-10')).toBe('2026-12-10')
    expect(vtoPagoParaArca('2026-11-03', '2026-11-10', null)).toBe('2026-12-10')
    expect(vtoPagoParaArca('2026-11-03', '2026-11-10', 45)).toBe('2026-12-25')
    expect(vtoPagoParaArca('2026-11-03', '2026-11-10', 0)).toBe('2026-11-10')
  })

  it('sin fecha aprobada, emisión + plazo', () => {
    expect(vtoPagoParaArca(null, '2026-11-10')).toBe('2026-12-10')
    expect(vtoPagoParaArca(undefined, '2026-12-15')).toBe('2027-01-14')
    expect(vtoPagoParaArca('', '2026-11-10', 15)).toBe('2026-11-25')
  })

  it('el pedido a ARCA aplica esa regla (caso PNC, factura A del 10/11)', () => {
    const e = {
      id: 'e1', tipo: 1, punto_venta: 999,
      solicitud: { neto_c: 100000000, iva_c: 21000000, total_c: 121000000, vto_pago: '2026-11-03', periodo_desde: '2026-10-01', periodo_hasta: '2026-10-31', cuit_receptor: '30716728397' },
    } as any
    const c = comprobanteDesdeSolicitud(e, { numero: 1, hoy: '2026-11-10', condicionIva: 'responsable_inscripto' })
    expect(c.fecha).toBe('2026-11-10')
    expect(c.vtoPago).toBe('2026-12-10')
    expect(c.servicioDesde).toBe('2026-10-01')
    expect(c.servicioHasta).toBe('2026-10-31')
    expect(comprobanteDesdeSolicitud(e, { numero: 1, hoy: '2026-11-10', condicionIva: 'responsable_inscripto', plazoDias: 45 }).vtoPago).toBe('2026-12-25')
  })
})

describe('migraciones', () => {
  it('20261210100000: el comprobante se da de alta con las fechas del pedido a ARCA', () => {
    const sql = leer('supabase/migrations/20261210100000_facturacion_vto_enviado_a_arca.sql')
    expect(sql).toMatch(/v_arca jsonb := coalesce\(e\.solicitud->'arca', '\{\}'::jsonb\)/)
    expect(sql).toMatch(/coalesce\(nullif\(v_arca->>'vtoPago', ''\)::date, nullif\(s->>'vto_pago', ''\)::date\)/)
    expect(sql).toMatch(/coalesce\(nullif\(v_arca->>'servicioDesde', ''\)::date, nullif\(s->>'periodo_desde', ''\)::date\)/)
    expect(sql).toMatch(/coalesce\(nullif\(v_arca->>'servicioHasta', ''\)::date, nullif\(s->>'periodo_hasta', ''\)::date\)/)
    const rb = leer('supabase/rollback/20261210100000_facturacion_vto_enviado_a_arca_rollback.sql')
    expect(rb).toMatch(/nullif\(s->>'vto_pago', ''\)::date,/)
    expect(rb).not.toMatch(/v_arca/)
  })

  it('20261210110000: 30 días desde la emisión por defecto, sin pisar plazos cargados', () => {
    const sql = leer('supabase/migrations/20261210110000_facturacion_plazo_pago_30_por_defecto.sql')
    expect(sql).toMatch(/alter column dias_vencimiento set default 30/)
    expect(sql).toMatch(/alter column pago_evento set default 'emision'/)
    expect(sql).toMatch(/coalesce\(k\.dias_vencimiento, 30\)/)
    expect(sql).toMatch(/coalesce\(k\.pago_evento, 'emision'\)/)
    expect(sql).toMatch(/insert into public\.fact_historial/)
    const rb = leer('supabase/rollback/20261210110000_facturacion_plazo_pago_30_por_defecto_rollback.sql')
    expect(rb).toMatch(/drop default/)
  })
})
