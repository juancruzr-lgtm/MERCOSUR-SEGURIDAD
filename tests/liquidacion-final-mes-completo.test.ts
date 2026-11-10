import { describe, expect, it } from 'vitest'
import { lineasMesCompleto } from '@/lib/liquidacion-final'

// Ibarra (JC 10/11): el mensual de octubre se mandó a Visual pero no se pagó; se
// quiere UN recibo con el mes + la liquidación final.
const enviado = [
  { codigo: '000', cantidad: 14, importe: 0 },
  { codigo: '001', cantidad: 1, importe: 612180 },
  { codigo: '006', cantidad: 1, importe: 40812 },
  { codigo: '011', cantidad: 0, importe: 0 },
  { codigo: '050', cantidad: 0, importe: 0 },
  { codigo: '203', cantidad: 1, importe: 288120 },
  { codigo: '204', cantidad: 1, importe: 100800 },
  { codigo: '214', cantidad: 1, importe: 16800 },
]
const entrada = (c: string) => ({ '000': 'CAN', '208': 'CANIMP', '120003': 'CANIMP', '212': 'CANIMP' } as Record<string, string>)[c] ?? 'IMP'

describe('exportar mes completo + liquidación final', () => {
  it('suma lo ya enviado del mes y la final en un solo juego de líneas', () => {
    const final = [
      { codigo: '120003', cantidad: 1, importe: 251580.82, total: 251580.82 },
      { codigo: '208', cantidad: 4, importe: 40812, total: 163248 },
      { codigo: '212', cantidad: 1, importe: 155000, total: 155000 },
      { codigo: '217', cantidad: 1, importe: 11181.37, total: 11181.37 },
    ]
    const r = lineasMesCompleto(final, enviado, entrada)
    expect(r).toEqual([
      { codigo: '000', cantidad: 14, importe: 0 },
      { codigo: '001', cantidad: 1, importe: 612180 },
      { codigo: '006', cantidad: 1, importe: 40812 },
      { codigo: '120003', cantidad: 1, importe: 251580.82 },
      { codigo: '203', cantidad: 1, importe: 288120 },
      { codigo: '204', cantidad: 1, importe: 100800 },
      { codigo: '208', cantidad: 4, importe: 40812 },
      { codigo: '212', cantidad: 1, importe: 155000 },
      { codigo: '214', cantidad: 1, importe: 16800 },
      { codigo: '217', cantidad: 1, importe: 11181.37 },
    ])
  })
  it('un código en los dos lados: días se suman; importes van con cantidad 1 y el total', () => {
    const final = [
      { codigo: '000', cantidad: 2, importe: null, total: 0 },
      { codigo: '001', cantidad: 1, importe: 153045, total: 153045 },
    ]
    const r = lineasMesCompleto(final, enviado, entrada)
    expect(r.find(l => l.codigo === '000')).toEqual({ codigo: '000', cantidad: 16, importe: null })
    expect(r.find(l => l.codigo === '001')).toEqual({ codigo: '001', cantidad: 1, importe: 765225 })
  })
})
