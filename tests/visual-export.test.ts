import { describe, it, expect } from 'vitest'
import {
  filasVisual, escribirLibroVisualXls, construirLineasVisual,
  type ConsolidadaRow, type ConfigConcepto, type ConceptoCfg, type PersonaPadron, type ExpedienteLinea, type HaberLinea,
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

  it('B · 0 días pero con concepto (haber) → exporta el concepto SIN inventar 000 y NO bloquea', () => {
    const r = construirLineasVisual({ padron: [padron[0]], catalogo, haberes: new Map([['p1', [{ codigo: '001', cantidad: null, importe: 100 }]]]), dias: new Map(), permanentes: new Map(), expedientes: new Map(), lineaCero: [] })
    expect(r.bloqueados.length).toBe(0)
    expect(r.lineas.some(l => l.codigo === '001')).toBe(true)
    expect(r.lineas.some(l => l.codigo === '000')).toBe(false)
    expect(r.padron[0].estado).toBe('exporta')
  })
  it('C · 0 días y sin conceptos (operativo) → EXCLUIDO del período, sin bloquear ni inventar 000', () => {
    const r = construirLineasVisual({ padron: [padron[0]], catalogo, haberes: new Map(), dias: new Map(), permanentes: new Map(), expedientes: new Map(), lineaCero: LINEA_CERO })
    expect(r.lineas.length).toBe(0)
    expect(r.bloqueados.length).toBe(0)
    expect(r.padron[0].estado).toBe('no_corresponde')
    expect(r.padron[0].motivo).toMatch(/sin jornadas ni conceptos/)
  })
  it('D · 0 días y sin conceptos (mensualizado) → PENDIENTE de 000 manual, sin bloquear el archivo', () => {
    const mens: PersonaPadron = { persona_id: 'pm', cod_interno: 'MENS', cuil: '20111111112', nombre: 'MENSUAL', mensualizado: true }
    const r = construirLineasVisual({ padron: [mens], catalogo, haberes: new Map(), dias: new Map(), permanentes: new Map(), expedientes: new Map(), lineaCero: LINEA_CERO })
    expect(r.lineas.length).toBe(0)
    expect(r.bloqueados.length).toBe(0)
    expect(r.advertencias.some(a => a.tipo === 'dias_pendiente_mensualizado')).toBe(true)
    expect(r.padron[0].estado).toBe('no_corresponde')
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

  it('persona excluida (Acosta/Monzón/Wilhjelm) → no se exporta pero se REPORTA (no silenciosa)', () => {
    const excl: PersonaPadron = { persona_id: 'ex', cod_interno: null, cuil: null, nombre: 'CARLOS ACOSTA', excluido: true, motivoExcluido: 'no tiene recibo' }
    const r = construirLineasVisual({ padron: [excl], catalogo, haberes: new Map([['ex', [{ codigo: '001', cantidad: null, importe: 100 }]]]), dias: new Map([['ex', 20]]), permanentes: new Map(), expedientes: new Map(), lineaCero: LINEA_CERO })
    expect(r.lineas.length).toBe(0)                        // no exporta, aunque tenga datos
    expect(r.padron[0].estado).toBe('no_corresponde')
    expect(r.padron[0].motivo).toMatch(/excluido de liquidación/)
    expect(r.bloqueados.length).toBe(0)                    // no es bloqueo, es decisión
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

// ── Diferencia de Obra Social (133) + ajuste (050): omitir si remunerativo > Básico ──
// Regla JC 05/10: la app decide ANTES de exportar, por IMPORTES (no horas): suma el
// remunerativo previsto de los conceptos a exportar (categorías imponible/asignación,
// excluyendo no remunerativos y el propio 133) y lo compara con el Básico de la
// liquidación. Mayor → se OMITE el 133 (y el 050). Igual o menor → se conserva.
describe('construirLineasVisual · 133/050 por remunerativo vs Básico', () => {
  const catOS = new Map<string, ConceptoCfg>([
    ['001', { politica: 'valor', entrada: 'IMP', categoria: 'imponible' }],     // remunerativo
    ['204', { politica: 'valor', entrada: 'IMP', categoria: 'asignacion' }],    // remunerativo
    ['212', { politica: 'valor', entrada: 'IMP', categoria: 'asignacion' }],    // adicional (remunerativo)
    ['203', { politica: 'valor', entrada: 'IMP', categoria: 'asignacion' }],    // viáticos (asignación pero NO remunerativo)
    ['214', { politica: 'valor', entrada: 'IMP', categoria: 'no_imponible' }],  // NO remunerativo
    ['011', { politica: 'linea_cero', entrada: 'CALCULADO', categoria: 'imponible' }],
    ['050', { politica: 'linea_cero', entrada: 'CALCULADO', categoria: 'base_auxiliar' }],
    ['133', { politica: 'linea_cero', entrada: 'CALCULADO', categoria: 'descuento' }],
  ])
  const LC = ['011', '050', '133']
  const per: PersonaPadron = { persona_id: 'p', cod_interno: 'X', cuil: '20144945817', nombre: 'TEST' }
  const dias = new Map<string, number | null>([['p', 20]])
  const BASICO = 1_000_000
  const correr = (haberes: HaberLinea[], basicoLiquidacion?: number) =>
    construirLineasVisual({ padron: [per], catalogo: catOS, haberes: new Map([['p', haberes]]), dias, permanentes: new Map(), expedientes: new Map(), lineaCero: LC, basicoLiquidacion })
  const tiene = (r: ReturnType<typeof correr>, cod: string) => r.lineas.some(l => l.codigo === cod)

  it('remunerativo < Básico → 133 y 050 PRESENTES (0/0)', () => {
    const r = correr([{ codigo: '001', cantidad: null, importe: 500_000 }], BASICO)
    expect(tiene(r, '133')).toBe(true)
    expect(tiene(r, '050')).toBe(true)
    expect(r.lineas.find(l => l.codigo === '133')).toMatchObject({ cantidad: 0, importe: 0 })
  })

  it('remunerativo = Básico → se conserva el 133 (igual o menor)', () => {
    const r = correr([{ codigo: '001', cantidad: null, importe: 1_000_000 }], BASICO)
    expect(tiene(r, '133')).toBe(true)
  })

  it('remunerativo > Básico → 133 y 050 OMITIDOS; el resto intacto', () => {
    const r = correr([{ codigo: '001', cantidad: null, importe: 900_000 }, { codigo: '204', cantidad: null, importe: 200_000 }], BASICO)
    expect(tiene(r, '133')).toBe(false)
    expect(tiene(r, '050')).toBe(false)
    // los demás conceptos permanecen intactos
    expect(tiene(r, '001')).toBe(true)
    expect(tiene(r, '204')).toBe(true)
    expect(tiene(r, '011')).toBe(true)  // estructural remunerativo sigue
    expect(tiene(r, '000')).toBe(true)  // días
  })

  it('los VIÁTICOS (203) NO suman al remunerativo (no son remunerativos) → 133 se conserva', () => {
    // importe total 1.400.000 pero remunerativo real 500.000 (viáticos excluidos) < Básico
    const r = correr([{ codigo: '001', cantidad: null, importe: 500_000 }, { codigo: '203', cantidad: null, importe: 900_000 }], BASICO)
    expect(tiene(r, '133')).toBe(true)
    expect(tiene(r, '203')).toBe(true)  // los viáticos sí se exportan, sólo no cuentan para el umbral
  })

  it('los NO remunerativos (214) no suman al remunerativo → 133 se conserva', () => {
    // importe total 1.400.000 pero remunerativo real 500.000 (214 excluido) < Básico
    const r = correr([{ codigo: '001', cantidad: null, importe: 500_000 }, { codigo: '214', cantidad: null, importe: 900_000 }], BASICO)
    expect(tiene(r, '133')).toBe(true)
    expect(tiene(r, '214')).toBe(true)  // el no remunerativo sí se exporta, sólo no cuenta para el umbral
  })

  it('con correcciones manuales que elevan el remunerativo por encima del Básico → 133 omitido', () => {
    // el importe ya viene corregido en el snapshot; basta con que supere el Básico
    const r = correr([{ codigo: '001', cantidad: null, importe: 1_200_000 }], BASICO)
    expect(tiene(r, '133')).toBe(false)
  })

  it('sin Básico (no se pasa) → comportamiento previo: 133 presente', () => {
    const r = correr([{ codigo: '001', cantidad: null, importe: 9_000_000 }])
    expect(tiene(r, '133')).toBe(true)
  })

  // Supervisores (JC): el Básico es por 200 hs; su concepto HORAS (001) lleva 150 hs
  // y las 50 hs restantes van en ADICIONAL (212). El remunerativo debe sumar 001+212
  // (no comparar 001 solo), así alcanzan el básico; con presentismo/viáticos quedan
  // por encima. 150 hs = 0.75·básico = 750.000; 50 hs = 0.25·básico = 250.000.
  it('supervisor: 001 (150 hs) + adicional 212 (50 hs) = básico exacto → se conserva (igual)', () => {
    const r = correr([
      { codigo: '001', cantidad: null, importe: 750_000 },  // 150 hs
      { codigo: '212', cantidad: null, importe: 250_000 },  // 50 hs → completa el básico
    ], BASICO)
    expect(tiene(r, '133')).toBe(true)   // remunerativo = básico → igual → conserva
    expect(tiene(r, '212')).toBe(true)
  })

  it('supervisor con presentismo encima del básico (001 150h + 212 50h + 204) → 133 omitido', () => {
    const r = correr([
      { codigo: '001', cantidad: null, importe: 750_000 },  // 150 hs
      { codigo: '212', cantidad: null, importe: 250_000 },  // 50 hs
      { codigo: '204', cantidad: null, importe: 180_000 },  // presentismo → supera el básico
    ], BASICO)
    expect(tiene(r, '133')).toBe(false)
  })
})
