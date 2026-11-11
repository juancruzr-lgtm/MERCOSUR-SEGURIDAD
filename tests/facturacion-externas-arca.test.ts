// Facturas emitidas fuera de la app (importadas del archivo de ARCA) cruzadas con las prefacturas.
// ARCA no las devuelve por web service: 11002 para los PV que no son Web Service (11/11/2026).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { emparejar, fechaCompatible, horasFacturadas, type ComprobanteExterno, type PrefacturaAbierta } from '@/lib/facturacion/externas-arca'

const comp = (o: Partial<ComprobanteExterno>): ComprobanteExterno => ({
  id: 'c1', tipo: 1, puntoVenta: 2, numero: 100, fecha: '2026-11-05', docNro: '30702637895', receptor: 'LAS BLONDAS SA',
  netoC: 409726070, ivaC: 86042475, totalC: 495768545, cae: '76451064999999', ...o,
})
const pref = (o: Partial<PrefacturaAbierta>): PrefacturaAbierta => ({
  id: 'p1', version: 6, estado: 'aprobada_emitir', cuit_receptor: '30702637895', tipo_comprobante: 1, total_c: 495768545, neto_c: 409726070, iva_c: 86042475,
  periodo_desde: '2026-10-01', periodo_hasta_excl: '2026-11-01', cliente: 'LAS BLONDAS SA',
  lineas: [{ concepto: 'Horas de vigilancia', cantidad: '294.5', precio: '13912.6', importes: { neto: 409726070, total: 495768545 } }], ...o,
})

describe('fechaCompatible', () => {
  it('octubre: emitidas del 25/10 al 15/12; las de principios de octubre son de septiembre', () => {
    const p = { periodo_hasta_excl: '2026-11-01' }
    expect(fechaCompatible('2026-10-25', p)).toBe(true)
    expect(fechaCompatible('2026-11-05', p)).toBe(true)
    expect(fechaCompatible('2026-12-16', p)).toBe(true)
    expect(fechaCompatible('2026-10-03', p)).toBe(false)
    expect(fechaCompatible('2026-12-17', p)).toBe(false)
  })
})

describe('horasFacturadas', () => {
  it('A: neto / precio; B con tarifa IVA incluido: total / precio', () => {
    expect(horasFacturadas(pref({}), { netoC: 409726070, totalC: 495768545 })).toEqual({ reales: 294.5, prefactura: 294.5 })
    expect(horasFacturadas(pref({}), { netoC: 417072650, totalC: 504657907 })?.reales).toBeCloseTo(299.78, 1)
    const b = pref({ tipo_comprobante: 6, lineas: [{ cantidad: '248', precio: '13808.53', importes: { neto: 283017805, total: 342451544 } }] })
    expect(horasFacturadas(b, { netoC: 283017805, totalC: 342451544 })?.reales).toBe(248)
    expect(horasFacturadas(pref({ lineas: [] }), { netoC: 1, totalC: 1 })).toBeNull()
  })
})

describe('emparejar', () => {
  it('coincide sólo lo exacto: CUIT, tipo, total y fecha compatible', () => {
    expect(emparejar([pref({})], [comp({})]).coincidencias).toHaveLength(1)
  })
  it('otro total: se informa con las horas facturadas, no se marca', () => {
    const r = emparejar([pref({})], [comp({ netoC: 417072650, ivaC: 87585257, totalC: 504657907 })])
    expect(r.coincidencias).toHaveLength(0)
    expect(r.diferencias[0].motivo).toMatch(/total .*la prefactura dice/)
    expect(r.diferencias[0].motivo).toMatch(/h facturadas \(la prefactura tiene 294.5 h\)/)
    expect(emparejar([pref({ tipo_comprobante: 201 })], [comp({})]).diferencias[0].motivo).toMatch(/tipo 1 \(la prefactura dice 201\)/)
  })
  it('un abono igual emitido a principios de octubre (septiembre) no cierra octubre', () => {
    const r = emparejar([pref({})], [comp({ fecha: '2026-10-03' })])
    expect(r.coincidencias).toHaveLength(0)
    expect(r.sinFactura).toHaveLength(1)
    expect(r.sinPrefactura).toHaveLength(1)
  })
  it('varias prefacturas del mismo cliente (Laromet): lo exacto primero, sin mezclar', () => {
    const p1 = pref({ id: 'a', total_c: 100, neto_c: 83, iva_c: 17, lineas: [] }), p2 = pref({ id: 'b', total_c: 200, neto_c: 165, iva_c: 35, lineas: [] })
    const r = emparejar([p1, p2], [comp({ id: 'x', totalC: 210 }), comp({ id: 'y', totalC: 100 })])
    expect(r.coincidencias.map(m => [m.prefactura.id, m.comprobante.id])).toEqual([['a', 'y']])
    expect(r.diferencias.map(d => [d.prefactura.id, d.comprobante.id])).toEqual([['b', 'x']])
  })
  it('dos facturas iguales para una prefactura, o una factura para dos: ambiguo', () => {
    expect(emparejar([pref({})], [comp({ id: 'x' }), comp({ id: 'y' })]).ambiguas).toHaveLength(1)
    const r = emparejar([pref({ id: 'a' }), pref({ id: 'b' })], [comp({})])
    expect(r.coincidencias).toHaveLength(0)
    expect(r.ambiguas).toHaveLength(2)
  })
})

describe('ruta /api/facturacion/arca-externas', () => {
  const src = readFileSync(join(__dirname, '..', 'app/api/facturacion/arca-externas/route.ts'), 'utf8')
  it('no consulta ni pide nada a ARCA: usa la fila importada', () => {
    expect(src).not.toMatch(/solicitarCae|FECAESolicitar|consultarComprobante|ultimoAutorizado/)
    expect(src).toMatch(/from\('fact_comprobantes'\)/)
  })
  it('los importes y el CAE salen de la fila importada (no del navegador) y se comparan antes de aprobar', () => {
    expect(src.indexOf("'neto o IVA'")).toBeLessThan(src.indexOf("rpc('fact_prefactura_aprobar'"))
    expect(src.indexOf('emision_manual')).toBeLessThan(src.indexOf("rpc('fact_prefactura_aprobar'"))
    expect(src).toMatch(/cae: String\(k\.cae\)/)
    expect(src).not.toMatch(/b\.cae|b\.total|b\.neto|b\.tipo/)
  })
  it('exige Gerencia o Administración y no reutiliza un comprobante ya vinculado', () => {
    expect(src).toMatch(/facturacion_puede_actual/)
    expect(src).toMatch(/ya está vinculado/)
  })
})
