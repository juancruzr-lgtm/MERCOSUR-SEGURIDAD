import { describe, it, expect } from 'vitest'
import {
  filasVisual, escribirLibroVisualXls, construirLineasVisual,
  type ConsolidadaRow, type ConfigConcepto, type ConceptoCfg, type PersonaPadron, type ExpedienteLinea,
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

const padron: PersonaPadron[] = [
  { persona_id: 'p1', cod_interno: 'ALMADA', cuil: '20144945817', nombre: 'ESTANISLAO ALMADA' },
  { persona_id: 'pg', cod_interno: 'GURUCHAR', cuil: '23142066599', nombre: 'ADRIAN GURUCHAR', tieneUsuario: false },
  { persona_id: 'pp', cod_interno: 'PRUEBA', cuil: '20000000000', nombre: 'CUENTA PRUEBA', esPrueba: true },
]
const diasOk = new Map<string, number | null>([['p1', 20], ['pg', 25]])

describe('construirLineasVisual (LIQ2G · persona/expedientes/000)', () => {
  it('emite haberes + 000 desde días editable + estructurales 0/0 + calculado individual + expediente → slot', () => {
    const haberes = new Map([['p1', [{ codigo: '001', cantidad: null, importe: 765375 }, { codigo: '006', cantidad: 1, importe: 40812 }]]])
    const permanentes = new Map([['p1', [{ codigo: '104', importe: null }]]])
    const expedientes = new Map([['p1', [{ referencia: 'exp', importe: 44540.52, slot_preferido: '993' as const }]]])
    const r = construirLineasVisual({ padron: [padron[0]], catalogo, haberes, dias: diasOk, permanentes, expedientes, lineaCero: LINEA_CERO })
    const de = (cod: string) => r.lineas.find(l => l.codigo === cod)!
    expect(de('000')).toMatchObject({ cantidad: 20, importe: null })      // 000 desde días editable (no jornadas)
    expect(de('001')).toMatchObject({ cantidad: 1, importe: 765375 })
    expect(de('006')).toMatchObject({ cantidad: 1, importe: 40812 })
    expect(de('011')).toMatchObject({ cantidad: 0, importe: 0 })          // estructural
    expect(de('104')).toMatchObject({ cantidad: 0, importe: 0 })          // calculado individual
    expect(de('993')).toMatchObject({ cantidad: 1, importe: 44540.52 })   // expediente en su slot preferido
    expect(r.criticos.length).toBe(0)
    expect(r.padron[0].estado).toBe('exporta')
    expect(de('001').legajo).toBe('ALMADA')
  })

  it('GURUCHAR (persona sin usuario) exporta su 104 + estructurales aunque no tenga haberes', () => {
    const permanentes = new Map([['pg', [{ codigo: '104', importe: null }]]])
    const r = construirLineasVisual({ padron: [padron[1]], catalogo, haberes: new Map(), dias: diasOk, permanentes, expedientes: new Map(), lineaCero: LINEA_CERO })
    expect(r.lineas.some(l => l.codigo === '104')).toBe(true)
    expect(r.padron[0].estado).toBe('exporta')
  })

  it('000 pendiente → bloquea esa persona (no se inventa), se reporta', () => {
    const r = construirLineasVisual({ padron: [padron[0]], catalogo, haberes: new Map([['p1', [{ codigo: '001', cantidad: null, importe: 100 }]]]), dias: new Map(), permanentes: new Map(), expedientes: new Map(), lineaCero: [] })
    expect(r.bloqueados.some(b => b.tipo === 'dias_pendiente')).toBe(true)
    expect(r.lineas.length).toBe(0)
    expect(r.padron[0].estado).toBe('falta_info')
  })

  it('más de 2 expedientes simultáneos → bloquea la persona, no descarta ni pisa', () => {
    const expedientes = new Map([['p1', [{ importe: 1 }, { importe: 2 }, { importe: 3 }] as ExpedienteLinea[]]])
    const r = construirLineasVisual({ padron: [padron[0]], catalogo, haberes: new Map(), dias: diasOk, permanentes: new Map(), expedientes, lineaCero: [] })
    expect(r.bloqueados.some(b => b.tipo === 'expedientes_exceden_slots')).toBe(true)
    expect(r.lineas.length).toBe(0)
  })

  it('dos expedientes → 111 (1º) y 993 (2º), preservando slot_preferido', () => {
    const expedientes = new Map([['p1', [{ importe: 100, slot_preferido: '993' as const }, { importe: 200 }] as ExpedienteLinea[]]])
    const r = construirLineasVisual({ padron: [padron[0]], catalogo, haberes: new Map(), dias: diasOk, permanentes: new Map(), expedientes, lineaCero: [] })
    expect(r.lineas.find(l => l.codigo === '993')?.importe).toBe(100)   // preferido preservado
    expect(r.lineas.find(l => l.codigo === '111')?.importe).toBe(200)   // el otro al slot libre
  })

  it('cuenta de prueba → no corresponde', () => {
    const r = construirLineasVisual({ padron: [padron[2]], catalogo, haberes: new Map(), dias: diasOk, permanentes: new Map(), expedientes: new Map(), lineaCero: [] })
    expect(r.padron[0].estado).toBe('no_corresponde')
  })

  it('bloqueo por persona: falta COD_INTERNO', () => {
    const sinCod: PersonaPadron = { persona_id: 'x', cod_interno: null, cuil: '20144945817', nombre: 'SIN COD' }
    const r = construirLineasVisual({ padron: [sinCod], catalogo, haberes: new Map(), dias: new Map([['x', 20]]), permanentes: new Map(), expedientes: new Map(), lineaCero: [] })
    expect(r.bloqueados.some(c => c.tipo === 'falta_cod_interno')).toBe(true)
    expect(r.criticos.length).toBe(0)
  })

  it('crítico estructural: concepto sin configuración', () => {
    const haberes = new Map([['p1', [{ codigo: '9999', cantidad: 1, importe: 5 }]]])
    const r = construirLineasVisual({ padron: [padron[0]], catalogo, haberes, dias: diasOk, permanentes: new Map(), expedientes: new Map(), lineaCero: [] })
    expect(r.criticos.some(c => c.tipo === 'concepto_sin_config')).toBe(true)
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
