// La sección Facturación abre en el último mes vencido (hora de Argentina) y muestra el período
// en una barra fija por encima de las pestañas, la misma para todas.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'

vi.mock('@/lib/supabase', () => ({ supabase: { from: () => ({ select: () => ({ in: () => ({ eq: async () => ({ data: [] }), then: (ok: any) => ok({ data: [] }) }) }) }), rpc: async () => ({ data: null, error: null }) } }))
vi.mock('@/lib/facturacion/datos', () => ({ rpc: async () => { throw new Error('sin base') }, leer: async () => [], api: async () => ({}) }))
// Las pestañas se reemplazan por marcadores que muestran el mes y el período que reciben.
const marca = vi.hoisted(() => (nombre: string) => ({ default: (p: any) => {
  const { createElement: h } = require('react')
  return h('div', { 'data-tab': nombre }, `${nombre}:${p.mes}:${p.periodo ? (p.periodo.habilitado ? 'escribe' : 'consulta') : '-'}`)
} }))
vi.mock('@/components/facturacion/Bandeja', () => marca('bandeja'))
vi.mock('@/components/facturacion/Horas', () => marca('horas'))
vi.mock('@/components/facturacion/Maestros', () => marca('maestros'))
vi.mock('@/components/facturacion/Documentos', () => marca('documentos'))
vi.mock('@/components/facturacion/Comprobantes', () => marca('comprobantes'))
vi.mock('@/components/facturacion/Cobranzas', () => marca('cobranzas'))
vi.mock('@/components/facturacion/Tablero', () => marca('tablero'))
vi.mock('@/components/facturacion/Vencimientos', () => marca('vencimientos'))

describe('Facturación abre en el mes vencido', () => {
  afterEach(() => vi.useRealTimers())
  const abrir = async (instante: string) => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(instante))
    vi.resetModules()
    const { default: Panel } = await import('@/components/facturacion/FacturacionPanel')
    return renderToString(createElement(Panel, { user: { id: 'u' } })).replace(/<!-- -->/g, '')
  }

  it('en noviembre de 2026 abre OCTUBRE 2026 como período vencido, con Aceptar habilitado', async () => {
    const html = await abrir('2026-11-04T15:00:00Z')
    expect(html).toContain('FACTURACIÓN — OCTUBRE 2026')
    expect(html).toContain('PERÍODO VENCIDO')
    expect(html).toMatch(/type="month"[^>]*value="2026-10"/)
    expect(html).toContain('bandeja:2026-10:escribe')
  })
  it('el 30/11 a las 23:30 (Argentina) sigue abriendo octubre; el 01/12 a la 00:00 abre noviembre', async () => {
    expect(await abrir('2026-12-01T02:30:00Z')).toContain('FACTURACIÓN — OCTUBRE 2026')
    expect(await abrir('2026-12-01T03:00:00Z')).toContain('FACTURACIÓN — NOVIEMBRE 2026')
  })
  it('en enero abre diciembre del año anterior', async () => {
    expect(await abrir('2027-01-02T12:00:00Z')).toContain('FACTURACIÓN — DICIEMBRE 2026')
  })
  it('la barra del período está por encima de las pestañas (es la misma en todas)', async () => {
    const html = await abrir('2026-11-04T15:00:00Z')
    const barra = html.indexOf('data-testid="barra-periodo"'), pestanas = html.indexOf('>Prefacturas<'), contenido = html.indexOf('data-tab=')
    expect(barra).toBeGreaterThan(-1)
    expect(barra).toBeLessThan(pestanas)
    expect(pestanas).toBeLessThan(contenido)
    expect(html).toContain('position:sticky')
  })
})

describe('barra del período en curso', () => {
  it('muestra la advertencia y que sólo se consulta', async () => {
    const { BarraPeriodo, periodoLocal } = await import('@/components/facturacion/periodo')
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-04T15:00:00Z'))
    const html = renderToString(createElement(BarraPeriodo, { periodo: periodoLocal('2026-11'), alCambiar: () => {} })).replace(/<!-- -->/g, '')
    expect(html).toContain('FACTURACIÓN — NOVIEMBRE 2026')
    expect(html).toContain('ADVERTENCIA — PERÍODO EN CURSO')
    expect(html).toContain('Sólo consulta')
    vi.useRealTimers()
  })
})
