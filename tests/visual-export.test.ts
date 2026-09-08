import { describe, it, expect } from 'vitest'
import {
  filasVisual, escribirLibroVisualXls, construirLineasVisual,
  type ConsolidadaRow, type ConfigConcepto, type ConceptoCfg, type EmpleadoPadron,
} from '@/lib/visual-export'

const rows: ConsolidadaRow[] = [
  { empleado_id: 'u1', legajo_visual: 'ALMADA', cuil: '20144945817', nombre: 'ALMADA', codigo: '203', cantidad: 1, importe: 514500 },
  { empleado_id: 'u1', legajo_visual: 'ALMADA', cuil: '20144945817', nombre: 'ALMADA', codigo: '204', cantidad: 1, importe: 180000 },
]

describe('filasVisual (LIQ2D compat)', () => {
  it('exporta con config por defecto e incluye el nombre (col G)', () => {
    const f = filasVisual(rows, new Map())
    expect(f.length).toBe(2)
    expect(f[0]).toMatchObject({ legajo: 'ALMADA', cuil: '20144945817', codigo: '203', nombre: 'ALMADA' })
  })
})

// Catálogo de prueba con las políticas reales
const catalogo = new Map<string, ConceptoCfg>([
  ['000', { politica: 'valor', entrada: 'CAN' }],
  ['001', { politica: 'valor', entrada: 'IMP' }],
  ['006', { politica: 'valor', entrada: 'CANIMP' }],
  ['101', { politica: 'linea_cero', entrada: 'CALCULADO' }],
  ['011', { politica: 'linea_cero', entrada: 'CALCULADO' }],
  ['104', { politica: 'individual', entrada: 'CALCULADO' }],
  ['993', { politica: 'individual', entrada: 'IMP' }],
])
const LINEA_CERO = ['011', '101']

const padron: EmpleadoPadron[] = [
  { empleado_id: 'u1', cod_interno: 'ALMADA', cuil: '20144945817', nombre: 'ESTANISLAO ALMADA' },
  { empleado_id: 'u2', cod_interno: '001 Bis', cuil: '20477655239', nombre: 'SANTIAGO PEREZ' },
  { empleado_id: 'up', cod_interno: 'PRUEBA', cuil: '20000000000', nombre: 'CUENTA PRUEBA', esPrueba: true },
]

describe('construirLineasVisual (LIQ2F)', () => {
  it('emite haberes (001 IMP cant=1, 000 CAN días, 006 CANIMP) + líneas 0/0 estructurales + individual', () => {
    const haberes = new Map([
      ['u1', [{ codigo: '000', cantidad: 26, importe: null }, { codigo: '001', cantidad: null, importe: 765375 }, { codigo: '006', cantidad: 1, importe: 40812 }]],
    ])
    const permanentes = new Map([['u1', [{ codigo: '104', importe: null }, { codigo: '993', importe: 44540.52 }]]])
    const r = construirLineasVisual({ padron: [padron[0]], catalogo, haberes, permanentes, lineaCero: LINEA_CERO })
    const de = (cod: string) => r.lineas.find(l => l.codigo === cod)!
    expect(de('000')).toMatchObject({ cantidad: 26, importe: null })      // días reales
    expect(de('001')).toMatchObject({ cantidad: 1, importe: 765375 })      // IMP → cant 1
    expect(de('006')).toMatchObject({ cantidad: 1, importe: 40812 })       // CANIMP
    expect(de('011')).toMatchObject({ cantidad: 0, importe: 0 })           // estructural 0/0
    expect(de('101')).toMatchObject({ cantidad: 0, importe: 0 })           // estructural 0/0
    expect(de('104')).toMatchObject({ cantidad: 0, importe: 0 })           // individual calculado 0/0
    expect(de('993')).toMatchObject({ cantidad: 1, importe: 44540.52 })    // individual IMP con importe
    expect(r.criticos.length).toBe(0)
    expect(r.padron[0].estado).toBe('exporta')
    // A = COD_INTERNO, G = nombre
    expect(de('001').legajo).toBe('ALMADA')
    expect(de('001').nombre).toBe('ESTANISLAO ALMADA')
  })

  it('la cuenta de prueba no corresponde exportar (no es exclusión silenciosa)', () => {
    const r = construirLineasVisual({ padron: [padron[2]], catalogo, haberes: new Map(), permanentes: new Map(), lineaCero: [] })
    expect(r.lineas.length).toBe(0)
    expect(r.padron[0].estado).toBe('no_corresponde')
    expect(r.padron[0].motivo).toMatch(/prueba/)
  })

  it('bloqueo por empleado: falta COD_INTERNO → excluye ese empleado, NO frena el archivo', () => {
    const sinCod: EmpleadoPadron = { empleado_id: 'x', cod_interno: null, cuil: '20144945817', nombre: 'SIN COD' }
    const haberes = new Map([['x', [{ codigo: '001', cantidad: null, importe: 100 }]]])
    const r = construirLineasVisual({ padron: [sinCod], catalogo, haberes, permanentes: new Map(), lineaCero: [] })
    expect(r.bloqueados.some(c => c.tipo === 'falta_cod_interno')).toBe(true)
    expect(r.criticos.length).toBe(0)             // NO es crítico estructural
    expect(r.lineas.length).toBe(0)               // ese empleado no se exporta
    expect(r.padron[0].estado).toBe('falta_info')
  })

  it('bloqueo por empleado: CUIL inválido', () => {
    const malCuil: EmpleadoPadron = { empleado_id: 'y', cod_interno: 'Y', cuil: '123', nombre: 'MAL CUIL' }
    const r = construirLineasVisual({ padron: [malCuil], catalogo, haberes: new Map(), permanentes: new Map(), lineaCero: [] })
    expect(r.bloqueados.some(c => c.tipo === 'cuil_invalido')).toBe(true)
  })

  it('crítico: concepto sin configuración en el catálogo', () => {
    const haberes = new Map([['u1', [{ codigo: '9999', cantidad: 1, importe: 5 }]]])
    const r = construirLineasVisual({ padron: [padron[0]], catalogo, haberes, permanentes: new Map(), lineaCero: [] })
    expect(r.criticos.some(c => c.tipo === 'concepto_sin_config')).toBe(true)
  })

  it('advertencia: individual IMP (993) sin importe → no bloquea', () => {
    const permanentes = new Map([['u1', [{ codigo: '993', importe: null }]]])
    const r = construirLineasVisual({ padron: [padron[0]], catalogo, haberes: new Map(), permanentes, lineaCero: [] })
    expect(r.advertencias.some(a => a.tipo === 'individual_imp_sin_importe')).toBe(true)
    expect(r.criticos.length).toBe(0)
  })

  it('crítico: 000 (CAN) sin cantidad', () => {
    const haberes = new Map([['u1', [{ codigo: '000', cantidad: null, importe: null }]]])
    const r = construirLineasVisual({ padron: [padron[0]], catalogo, haberes, permanentes: new Map(), lineaCero: [] })
    expect(r.criticos.some(c => c.tipo === 'cantidad_faltante')).toBe(true)
  })
})

describe('escribirLibroVisualXls (contrato nativo)', () => {
  it('produce BIFF8 con A1 título, E1 = empresa, G = nombre, código texto', async () => {
    const XLSX: any = await import('xlsx')
    const f = filasVisual(rows, new Map())
    const bytes = await escribirLibroVisualXls(f, { xlsxMod: XLSX, empresaId: 63 })
    expect(Array.from(bytes.slice(0, 4))).toEqual([0xd0, 0xcf, 0x11, 0xe0])
    const wb = XLSX.read(bytes, { type: 'array', cellNF: true })
    expect(wb.SheetNames).toEqual(['Hoja1', 'Hoja2', 'Hoja3'])
    const ws = wb.Sheets['Hoja1']
    expect(ws['A1'].v).toContain('VisualSueldos')
    expect(String(ws['E1'].v)).toBe('63')
    expect(ws['A2'].v).toBe('Legajo')
    expect(ws['G2'].v).toMatch(/Nombre y Apellido/)
    expect(ws['C3'].t).toBe('s')            // código texto
    expect(ws['B3'].t).toBe('s')            // CUIL texto
    expect(ws['G3'].v).toBe('ALMADA')       // nombre en G
  })
})
