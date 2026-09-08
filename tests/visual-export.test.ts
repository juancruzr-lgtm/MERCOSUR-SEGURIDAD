import { describe, it, expect } from 'vitest'
import { filasVisual, escribirLibroVisualXls, type ConsolidadaRow, type ConfigConcepto } from '@/lib/visual-export'

const rows: ConsolidadaRow[] = [
  { empleado_id: 'u1', legajo_visual: 'ALMADA', cuil: '20144945817', nombre: 'ALMADA', codigo: '203', cantidad: 1, importe: 514500 },
  { empleado_id: 'u1', legajo_visual: 'ALMADA', cuil: '20144945817', nombre: 'ALMADA', codigo: '204', cantidad: 1, importe: 180000 },
  { empleado_id: 'u2', legajo_visual: 'ROSALES', cuil: '20295393522', nombre: 'ROSALES', codigo: '999', cantidad: 1, importe: 12345 },
]

describe('filasVisual (LIQ2D · config por concepto)', () => {
  it('sin config exporta todo, con cantidad por defecto 1 e importe', () => {
    const f = filasVisual(rows, new Map())
    expect(f.length).toBe(3)
    expect(f[0]).toMatchObject({ legajo: 'ALMADA', cuil: '20144945817', codigo: '203', cantidad: 1, importe: 514500 })
  })

  it('un concepto con exporta_visual=false se omite (lo calcula Visual)', () => {
    const cfg = new Map<string, ConfigConcepto>([['999', { exporta_visual: false, manda_cantidad: true, manda_importe: true }]])
    const f = filasVisual(rows, cfg)
    expect(f.map(x => x.codigo)).toEqual(['203', '204'])
  })

  it('manda_importe=false deja el importe en null (sólo cantidad)', () => {
    const cfg = new Map<string, ConfigConcepto>([['203', { exporta_visual: true, manda_cantidad: true, manda_importe: false }]])
    const f = filasVisual(rows, cfg)
    const c203 = f.find(x => x.codigo === '203')!
    expect(c203.importe).toBeNull()
    expect(c203.cantidad).toBe(1)
  })

  it('si no manda ni cantidad ni importe, la fila se omite', () => {
    const cfg = new Map<string, ConfigConcepto>([['203', { exporta_visual: true, manda_cantidad: false, manda_importe: false }]])
    const f = filasVisual(rows, cfg)
    expect(f.some(x => x.codigo === '203')).toBe(false)
  })
})

describe('escribirLibroVisualXls (LIQ2D · contrato BIFF8)', () => {
  it('produce un .xls BIFF8 con la estructura real de Visual', async () => {
    const XLSX: any = await import('xlsx')
    const f = filasVisual(rows, new Map())
    const bytes = await escribirLibroVisualXls(f, XLSX)
    // magic OLE2/BIFF8
    expect(Array.from(bytes.slice(0, 4))).toEqual([0xd0, 0xcf, 0x11, 0xe0])
    const wb = XLSX.read(bytes, { type: 'array', cellNF: true })
    expect(wb.SheetNames).toEqual(['Hoja1', 'Hoja2', 'Hoja3'])
    const ws = wb.Sheets['Hoja1']
    expect(ws['A1'].v).toContain('VisualSueldos')
    expect(ws['A2'].v).toBe('Legajo')
    expect(ws['B2'].v).toBe('CUIL')
    expect(ws['C2'].v).toBe('Código de concepto')
    expect(ws['D2'].v).toBe('Cantidad')
    expect(ws['E2'].v).toBe('Importe')
    // fila 3 (primer dato): CUIL y código texto; importe número
    expect(ws['B3'].t).toBe('s')
    expect(ws['B3'].v).toBe('20144945817')
    expect(ws['C3'].t).toBe('s')
    expect(ws['C3'].v).toBe('203')
    expect(ws['E3'].t).toBe('n')
    expect(ws['E3'].v).toBe(514500)
  })

  it('preserva ceros a la izquierda del código', async () => {
    const XLSX: any = await import('xlsx')
    const f = filasVisual([{ empleado_id: 'u1', legajo_visual: 'X', cuil: '20111111111', nombre: 'X', codigo: '001', cantidad: 1, importe: 100 }], new Map())
    const bytes = await escribirLibroVisualXls(f, XLSX)
    const wb = XLSX.read(bytes, { type: 'array' })
    expect(wb.Sheets['Hoja1']['C3'].v).toBe('001')
    expect(wb.Sheets['Hoja1']['C3'].t).toBe('s')
  })
})
