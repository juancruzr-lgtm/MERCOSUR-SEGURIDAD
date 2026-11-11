// Facturas emitidas fuera de la app leídas de ARCA (sólo lectura) y emparejadas con prefacturas.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { comprobanteDeConsulta, emparejar, recorrerPuntoVenta, type ComprobanteArca, type PrefacturaAbierta } from '@/lib/facturacion/externas-arca'

const comp = (o: Partial<ComprobanteArca>): ComprobanteArca => ({
  tipo: 1, puntoVenta: 2, numero: 100, fecha: '2026-11-05', docTipo: 80, docNro: '30702637895', netoC: 409726070, ivaC: 86042475, totalC: 495768545,
  cae: '76451064999999', caeVto: '2026-11-15', servicioDesde: '2026-10-01', servicioHasta: '2026-10-31', vtoPago: '2026-12-05', ...o,
})
const pref = (o: Partial<PrefacturaAbierta>): PrefacturaAbierta => ({
  id: 'p1', version: 6, estado: 'aprobada_emitir', cuit_receptor: '30702637895', tipo_comprobante: 1, total_c: 495768545, neto_c: 409726070, iva_c: 86042475,
  periodo_desde: '2026-10-01', periodo_hasta_excl: '2026-11-01', cliente: 'LAS BLONDAS SA', ...o,
})

describe('comprobanteDeConsulta', () => {
  it('lee el ResultGet de FECompConsultar (importes en pesos → centavos, fechas AAAAMMDD)', () => {
    const c = comprobanteDeConsulta({ ResultGet: { CbteTipo: 6, PtoVta: 2, CbteDesde: 839, CbteFch: 20261104, DocTipo: 80, DocNro: 30546679183,
      ImpNeto: 3473595.37, ImpIVA: 729455.03, ImpTotal: 4203050.4, CodAutorizacion: 76451064961574, FchVto: 20261114, FchServDesde: 20261001, FchServHasta: 20261031, FchVtoPago: 20261204 } },
    { tipo: 6, puntoVenta: 2, numero: 839 })!
    expect(c).toMatchObject({ tipo: 6, puntoVenta: 2, numero: 839, fecha: '2026-11-04', docNro: '30546679183', netoC: 347359537, ivaC: 72945503, totalC: 420305040,
      cae: '76451064961574', caeVto: '2026-11-14', servicioDesde: '2026-10-01', servicioHasta: '2026-10-31' })
    expect(comprobanteDeConsulta({ ResultGet: {} }, { tipo: 1, puntoVenta: 1, numero: 1 })).toBeNull()
  })
})

describe('recorrerPuntoVenta', () => {
  it('va del último hacia atrás y corta en el primero anterior a la fecha; saltea los inexistentes', async () => {
    const fechas: Record<number, string> = { 10: '2026-11-08', 9: '2026-11-03', 7: '2026-10-02', 6: '2026-09-30', 5: '2026-09-29' }
    const pedidos: number[] = []
    const r = await recorrerPuntoVenta({
      ultimo: async () => ({ ok: true, numero: 10 }),
      consultar: async n => { pedidos.push(n); return fechas[n] ? { encontrado: true, comprobante: comp({ numero: n, fecha: fechas[n] }) } : { encontrado: false } },
    }, { desde: '2026-10-01', paralelo: 2 })
    expect(r.comprobantes.map(c => c.numero)).toEqual([10, 9, 7])
    expect(r.error).toBeNull()
    expect(r.completo).toBe(true)
    expect(Math.min(...pedidos)).toBeGreaterThanOrEqual(5) // no sigue de largo
  })
  it('un error de ARCA corta y se informa; sin facturas no falla', async () => {
    expect((await recorrerPuntoVenta({ ultimo: async () => ({ ok: false, error: '10015: punto de venta no habilitado' }), consultar: async () => ({ encontrado: false }) }, { desde: '2026-10-01' })).error).toMatch(/10015/)
    const r = await recorrerPuntoVenta({ ultimo: async () => ({ ok: true, numero: 3 }), consultar: async () => ({ error: 'timeout' }) }, { desde: '2026-10-01' })
    expect(r).toMatchObject({ error: 'timeout', completo: false })
    expect((await recorrerPuntoVenta({ ultimo: async () => ({ ok: true, numero: 0 }), consultar: async () => ({ encontrado: false }) }, { desde: '2026-10-01' })).comprobantes).toEqual([])
  })
  it('respeta el máximo de números leídos', async () => {
    const r = await recorrerPuntoVenta({ ultimo: async () => ({ ok: true, numero: 500 }), consultar: async n => ({ encontrado: true, comprobante: comp({ numero: n }) }) }, { desde: '2026-10-01', maximo: 20 })
    expect(r.comprobantes).toHaveLength(20)
    expect(r.completo).toBe(false)
  })
})

describe('emparejar', () => {
  it('coincide sólo lo exacto: CUIT, tipo, total y período', () => {
    const r = emparejar([pref({})], [comp({})])
    expect(r.coincidencias).toHaveLength(1)
    expect(r.diferencias).toHaveLength(0)
  })
  it('mismo cliente y período con otro total o tipo: se informa, no se marca', () => {
    const r = emparejar([pref({})], [comp({ totalC: 495768500 })])
    expect(r.coincidencias).toHaveLength(0)
    expect(r.diferencias[0].motivo).toMatch(/total/)
    expect(emparejar([pref({ tipo_comprobante: 201 })], [comp({})]).diferencias[0].motivo).toMatch(/tipo 1/)
  })
  it('una factura de otro período (septiembre) no cierra la prefactura de octubre', () => {
    const r = emparejar([pref({})], [comp({ servicioDesde: '2026-09-01', servicioHasta: '2026-09-30', fecha: '2026-10-03' })])
    expect(r.coincidencias).toHaveLength(0)
    expect(r.sinFactura).toHaveLength(1)
    expect(r.sinPrefactura).toHaveLength(1)
  })
  it('dos facturas iguales para la misma prefactura, o una factura para dos prefacturas: ambiguo', () => {
    expect(emparejar([pref({})], [comp({ numero: 100 }), comp({ numero: 101 })]).ambiguas).toHaveLength(1)
    const r = emparejar([pref({ id: 'a' }), pref({ id: 'b' })], [comp({})])
    expect(r.coincidencias).toHaveLength(0)
    expect(r.ambiguas).toHaveLength(2)
  })
  it('sin período de servicio en ARCA usa la fecha de emisión', () => {
    expect(emparejar([pref({})], [comp({ servicioDesde: null, servicioHasta: null, fecha: '2026-11-04' })]).coincidencias).toHaveLength(1)
    expect(emparejar([pref({})], [comp({ servicioDesde: null, servicioHasta: null, fecha: '2026-09-28' })]).coincidencias).toHaveLength(0)
  })
})

describe('ruta /api/facturacion/arca-externas', () => {
  const src = readFileSync(join(__dirname, '..', 'app/api/facturacion/arca-externas/route.ts'), 'utf8')
  it('sólo consulta: nunca pide CAE', () => {
    expect(src).not.toMatch(/solicitarCae|FECAESolicitar/)
    expect(src).toMatch(/consultarComprobante/)
  })
  it('al marcar, los datos fiscales salen de ARCA (no del navegador) y se comparan con la prefactura antes de aprobar', () => {
    const post = src.slice(src.indexOf('export async function POST'))
    expect(post.indexOf('consultarComprobante')).toBeLessThan(post.indexOf("rpc('fact_prefactura_aprobar'"))
    expect(post.indexOf('emision_manual')).toBeLessThan(post.indexOf("rpc('fact_prefactura_aprobar'"))
    expect(post).toMatch(/cae: comp\.cae/)
    expect(post).not.toMatch(/b\.cae|b\.total|b\.neto/)
  })
  it('no toca el punto de venta de la app y exige Gerencia o Administración', () => {
    expect(src).toMatch(/punto de venta de la app/)
    expect(src).toMatch(/facturacion_puede_actual/)
  })
})
