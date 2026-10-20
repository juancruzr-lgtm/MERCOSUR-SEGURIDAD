import { describe, expect, it } from 'vitest'
import {
  CONTEO_SAC_CONFIRMADO, calcularLiquidacionFinal, diasComputablesSAC, filasVisualFinal, jsonEstable, ordinariosDePlantilla,
  totalSAC, totalSACVacaciones, type DatosLiquidacionFinal, type ConceptoCatalogo, type ConteoSAC,
} from '@/lib/liquidacion-final'
import { plantillaTrabajoDelMes } from '@/lib/excel-trabajo-liquidacion'
import { escribirExcelLiquidacionFinal } from '@/lib/liquidacion-final-excel'
import { escribirLibroVisualXls } from '@/lib/visual-export'
import { conceptosDePersona } from '@/lib/liquidacion-final-datos'

// Referencias: recibos 15263 (Fulla) y 15264 (Paniagua) de la «Liq. Especial
// SEPTIEMBRE 2026» y la Planilla de Sueldos de Visual que JC adjuntó (20/10).
// Básico 1.020.300 · valor día 40.812 (= básico/25) · hora extra 2.500.
const BASICO = 1020300
const VALOR_DIA = BASICO / 200 * 8
const HORA_EXTRA = 2500

// Catálogo real (migración 20260908220000) para los códigos que intervienen.
const CATALOGO = new Map<string, ConceptoCatalogo>([
  ['000', { politica: 'valor', entrada: 'CAN', nombre: 'DIAS TRABAJADAS' }],
  ['001', { politica: 'valor', entrada: 'IMP', nombre: 'horas trabajadas' }],
  ['004', { politica: 'valor', entrada: 'IMP', nombre: 'adicional nocturnidad' }],
  ['006', { politica: 'valor', entrada: 'CANIMP', nombre: 'Feriado' }],
  ['120003', { politica: 'valor', entrada: 'CANIMP', nombre: 'sac proporcional' }],
  ['203', { politica: 'valor', entrada: 'IMP', nombre: 'Viaticos' }],
  ['204', { politica: 'valor', entrada: 'IMP', nombre: 'presentismo' }],
  ['205', { politica: 'valor', entrada: 'CANIMP', nombre: 'Vacac' }],
  ['208', { politica: 'valor', entrada: 'CANIMP', nombre: 'Vac No Goz' }],
  ['212', { politica: 'valor', entrada: 'CANIMP', nombre: 'ADICIONAL' }],
  ['214', { politica: 'valor', entrada: 'IMP', nombre: 'Suma No Remunerativa' }],
  ['217', { politica: 'valor', entrada: 'IMP', nombre: 'sac sobre vacaciones no goz' }],
  ['888', { politica: 'no', entrada: 'CANIMP', nombre: 'licencia' }],
])

type Over = Omit<Partial<DatosLiquidacionFinal>, 'baja'> & { baja?: Partial<DatosLiquidacionFinal['baja']> }

// La regla de conteo del SAC NO está confirmada (CONTEO_SAC_CONFIRMADO = null).
// Los casos de referencia se prueban con las DOS variantes, cada una con la fecha
// de baja que reproduce 91 (Fulla) y 62 (Paniagua). El resto de los tests usa la
// variante exclusiva sólo como dato del test (no fija la regla de la app).
const VARIANTES: { conteo: ConteoSAC; fulla: string; paniagua: string }[] = [
  { conteo: 'exclusivo', fulla: '2026-09-30', paniagua: '2026-10-03' },
  { conteo: 'inclusivo', fulla: '2026-09-29', paniagua: '2026-10-02' },
]

function datos(over: Over = {}, conteo: ConteoSAC | null = 'exclusivo'): DatosLiquidacionFinal {
  const { baja, ...resto } = over
  return {
    persona: { cuil: '20285365814', legajoVisual: 'FULLA w', nombre: 'FULLA WALTER DARIO', empleadoId: 'u-fulla' },
    baja: { fecha: '2026-09-30', causa: 'renuncia', fechaIngreso: '2023-03-01', discrepancia: null, ...(baja ?? {}) },
    parametros: { basico: BASICO, horaExtra: HORA_EXTRA, valorDia: VALOR_DIA, conteoSAC: conteo },
    ordinarios: { jornadas: 0, conceptos: [], horasExtra: 0 },
    yaLiquidado: [],
    extrasPagadas: 0,
    catalogo: CATALOGO,
    entradas: { vacaciones: { saldoDias: 14, tomadasDias: 0, nota: 'Fulla: 14 días, dato manual del caso' } },
    ...resto,
  }
}
const linea = (r: ReturnType<typeof calcularLiquidacionFinal>, cod: string) => r.lineas.find(l => l.codigo === cod)

// Paniagua: 6 jornadas de octubre (01, 02, 04, 05, 07 y 08) con 62 h → 48 h
// reconocidas (6×8) y 14 h excedentes. Conceptos de la planilla del mes.
const ORDINARIOS_PANIAGUA = {
  jornadas: 6,
  horasExtra: 14,
  conceptos: [
    { codigo: '203', importe: 123480, cantidad: 6 },
    { codigo: '204', importe: 43200, cantidad: 6 },
    { codigo: '214', importe: 7200, cantidad: 6 },
    { codigo: '001', importe: 244872, cantidad: 48 },
  ],
}
const paniagua = (over: Over = {}, conteo: ConteoSAC | null = 'exclusivo') => datos({
  persona: { cuil: '20441767871', legajoVisual: '010 Bis', nombre: 'PANIAGUA EDGAR IVAN', empleadoId: 'u-pan' },
  // 62 días de SAC desde el ingreso (02/08): 03/10 (exclusivo) o 02/10 (inclusivo).
  // PENDIENTE JC: los turnos de producción llegan al 08/10 (eso daría 67/68 días).
  ordinarios: ORDINARIOS_PANIAGUA,
  entradas: { vacaciones: { saldoDias: 3, tomadasDias: 0 } },
  ...over,
  baja: { fecha: '2026-10-03', causa: 'renuncia', fechaIngreso: '2026-08-02', ...(over.baja ?? {}) },
}, conteo)

describe('SAC proporcional: regla de días (parametrizable, sin confirmar)', () => {
  it('la app NO fija la regla: CONTEO_SAC_CONFIRMADO es null hasta que JC la confirme', () => {
    expect(CONTEO_SAC_CONFIRMADO).toBeNull()
  })
  it.each(VARIANTES)('$conteo — Fulla: baja $fulla, semestre desde 01/07 → 91 días, $190.782,12', ({ conteo, fulla }) => {
    expect(diasComputablesSAC(fulla, '2023-03-01', conteo)).toEqual({ inicioSemestre: '2026-07-01', inicioComputo: '2026-07-01', dias: 91 })
    expect(totalSAC(BASICO, 91)).toBe(190782.12)
  })
  it.each(VARIANTES)('$conteo — Paniagua: baja $paniagua, desde el ingreso 02/08 → 62 días, $129.983,42', ({ conteo, paniagua: baja }) => {
    const s = diasComputablesSAC(baja, '2026-08-02', conteo)
    expect(s.inicioComputo).toBe('2026-08-02')
    expect(s.dias).toBe(62)
    expect(totalSAC(BASICO, 62)).toBe(129983.42)
  })
  it('la misma fecha difiere en un día entre variantes', () => {
    expect(diasComputablesSAC('2026-09-30', '2023-03-01', 'exclusivo').dias).toBe(91)
    expect(diasComputablesSAC('2026-09-30', '2023-03-01', 'inclusivo').dias).toBe(92)
  })
  it('límites de semestre (exclusivo / inclusivo)', () => {
    const d = (baja: string, ing: string) => [diasComputablesSAC(baja, ing, 'exclusivo').dias, diasComputablesSAC(baja, ing, 'inclusivo').dias]
    expect(diasComputablesSAC('2026-06-30', '2020-01-01', 'exclusivo').inicioSemestre).toBe('2026-01-01')
    expect(diasComputablesSAC('2026-07-01', '2020-01-01', 'exclusivo').inicioSemestre).toBe('2026-07-01')
    expect(d('2026-06-30', '2020-01-01')).toEqual([180, 181])
    expect(d('2026-07-01', '2020-01-01')).toEqual([0, 1])
    expect(d('2026-12-31', '2020-01-01')).toEqual([183, 184])
    expect(d('2026-01-01', '2020-01-01')).toEqual([0, 1])
    // Ingreso dentro del semestre de la baja manda; ingreso el mismo día de la baja.
    expect(d('2026-03-15', '2026-03-15')).toEqual([0, 1])
    // Año bisiesto (2028): 01/01 → 30/06.
    expect(d('2028-06-30', '2027-01-01')).toEqual([181, 182])
  })
  it('regla sin confirmar → 120003 pendiente, con las dos variantes a la vista', () => {
    const r = calcularLiquidacionFinal(datos({}, null))
    expect(linea(r, '120003')).toBeUndefined()
    expect(r.faltantes.map(f => f.clave)).toEqual(['regla_conteo_sac'])
    expect(r.calculo.fechas.variantes).toEqual([
      { conteo: 'exclusivo', dias: 91, total: 190782.12 },
      { conteo: 'inclusivo', dias: 92, total: 192878.63 },
    ])
    // Lo demás se calcula igual: 208 y 217 no dependen del conteo.
    expect(linea(r, '208')).toMatchObject({ total: 571368 })
  })
  it('SAC sobre vacaciones no gozadas (217): Fulla 14 días $39.134,79; Paniagua 3 días $8.386,03', () => {
    expect(totalSACVacaciones(BASICO, 14)).toBe(39134.79)
    expect(totalSACVacaciones(BASICO, 3)).toBe(8386.03)
  })
})

describe.each(VARIANTES)('calcularLiquidacionFinal — caso Fulla ($conteo, baja $fulla)', ({ conteo, fulla }) => {
  const r = calcularLiquidacionFinal(datos({ baja: { fecha: fulla } }, conteo))
  it('sin faltantes y con los conceptos finales', () => {
    expect(r.faltantes).toEqual([])
    expect(r.lineas.map(l => l.codigo)).toEqual(['120003', '208', '217'])
  })
  it('120003 va como Cantidad 1 × total (así salió en el recibo) con 91 días en el detalle', () => {
    expect(linea(r, '120003')).toMatchObject({ cantidad: 1, importe: 190782.12, total: 190782.12 })
    expect(linea(r, '120003')!.detalle.base).toMatchObject({ dias: 91, conteo, inicio: '2026-07-01', baja: fulla })
    expect(r.calculo.fechas).toMatchObject({ diasSAC: 91, conteo, variantes: null })
  })
  it('208 va como Cantidad = días × Importe = valor día (14 × 40.812 = 571.368, igual al recibo)', () => {
    expect(linea(r, '208')).toMatchObject({ cantidad: 14, importe: 40812, total: 571368 })
  })
  it('217 va como importe total', () => {
    expect(linea(r, '217')).toMatchObject({ entrada: 'IMP', cantidad: 1, importe: 39134.79, total: 39134.79 })
  })
  it('sin jornadas en el mes: no inventa 000 ni ordinarios y lo avisa', () => {
    expect(linea(r, '000')).toBeUndefined()
    expect(r.advertencias.join(' ')).toMatch(/Sin jornadas/)
  })
})

describe.each(VARIANTES)('calcularLiquidacionFinal — caso Paniagua ($conteo, baja $paniagua)', ({ conteo, paniagua: baja }) => {
  const r = calcularLiquidacionFinal(paniagua({ baja: { fecha: baja } }, conteo))
  it('reproduce el recibo 15264 concepto por concepto', () => {
    expect(r.faltantes).toEqual([])
    expect(r.calculo.fechas.diasSAC).toBe(62)
    const tabla = Object.fromEntries(r.lineas.map(l => [l.codigo, [l.cantidad, l.importe, l.total]]))
    expect(tabla).toEqual({
      '000': [6, null, 0],
      '001': [1, 244872, 244872],
      '120003': [1, 129983.42, 129983.42],
      '203': [1, 123480, 123480],
      '208': [3, 40812, 122436],
      '212': [1, 35000, 35000],
      '214': [1, 7200, 7200],
      '217': [1, 8386.03, 8386.03],
    })
  })
  it('presentismo en cero por renuncia que no completa el mes, con motivo registrado', () => {
    expect(linea(r, '204')).toBeUndefined()
    expect(r.calculo.presentismo).toMatchObject({ calculado: 43200, aplicado: 0 })
    expect(r.calculo.presentismo.motivo).toMatch(/Renuncia/)
  })
  it('212: 14 h × $2.500 = $35.000, con la base en el detalle', () => {
    expect(linea(r, '212')!.detalle.base).toMatchObject({ horas: 14, valorHora: 2500, bruto: 35000, pagado: 0 })
  })
})

describe('presentismo (Paniagua)', () => {
  it('la regla de presentismo no se generaliza: despido sin causa conserva la fórmula mensual', () => {
    const d = calcularLiquidacionFinal(paniagua({ baja: { causa: 'despido_sin_causa' } }))
    expect(linea(d, '204')).toMatchObject({ total: 43200 })
  })
  it('renuncia el último día del mes completa la condición: presentismo se mantiene', () => {
    const d = calcularLiquidacionFinal(paniagua({ baja: { fecha: '2026-10-31' } }))
    expect(linea(d, '204')).toMatchObject({ total: 43200 })
  })
  it('sin causa y con presentismo: queda pendiente (no se decide solo)', () => {
    const d = calcularLiquidacionFinal(paniagua({ baja: { causa: null } }))
    expect(d.faltantes.map(f => f.clave)).toContain('causa')
  })
})


describe('datos incompletos: marca pendiente, no asume cero', () => {
  it('sin saldo o sin tomadas de vacaciones → faltante y sin 208/217', () => {
    const r = calcularLiquidacionFinal(datos({ entradas: { vacaciones: { saldoDias: 14, tomadasDias: null } } }))
    expect(r.faltantes.map(f => f.clave)).toEqual(['vacaciones_tomadas'])
    expect(linea(r, '208')).toBeUndefined()
    expect(linea(r, '217')).toBeUndefined()
    const r2 = calcularLiquidacionFinal(datos({ entradas: {} }))
    expect(r2.faltantes.map(f => f.clave)).toEqual(['vacaciones_saldo', 'vacaciones_tomadas'])
  })
  it('saldo 0 y tomadas 0 cargados a mano → sin 208, sin faltante', () => {
    const r = calcularLiquidacionFinal(datos({ entradas: { vacaciones: { saldoDias: 0, tomadasDias: 0 } } }))
    expect(r.faltantes).toEqual([])
    expect(linea(r, '208')).toBeUndefined()
  })
  it('tomadas mayores que el saldo → faltante', () => {
    const r = calcularLiquidacionFinal(datos({ entradas: { vacaciones: { saldoDias: 3, tomadasDias: 5 } } }))
    expect(r.faltantes.map(f => f.clave)).toContain('vacaciones_negativas')
  })
  it('sin fecha de baja (baja detectada en la app sin fecha) → faltante, sin SAC', () => {
    const r = calcularLiquidacionFinal(datos({ baja: { fecha: null }, ordinarios: null }))
    expect(r.faltantes.map(f => f.clave)).toContain('fecha_baja')
    expect(linea(r, '120003')).toBeUndefined()
  })
  it('sin fecha de ingreso → faltante, sin SAC', () => {
    const r = calcularLiquidacionFinal(datos({ baja: { fechaIngreso: null } }))
    expect(r.faltantes.map(f => f.clave)).toEqual(['fecha_ingreso'])
    expect(linea(r, '120003')).toBeUndefined()
  })
  it('sin CUIL ni legajo Visual → faltantes; discrepancia de fechas → faltante', () => {
    const r = calcularLiquidacionFinal(datos({ persona: { cuil: null, legajoVisual: null, nombre: 'X', empleadoId: null }, baja: { discrepancia: 'Fechas de baja distintas' } }))
    expect(r.faltantes.map(f => f.clave)).toEqual(expect.arrayContaining(['cuil', 'legajo_visual', 'discrepancia']))
  })
  it('no se pudieron leer los datos del mes → faltante', () => {
    const r = calcularLiquidacionFinal(datos({ ordinarios: null }))
    expect(r.faltantes.map(f => f.clave)).toContain('ordinarios')
  })
  it('sueldo fijo: la regla de básico de convenio no aplica → faltante, no inventa SAC', () => {
    const r = calcularLiquidacionFinal(datos({ ordinarios: { jornadas: 0, conceptos: [], horasExtra: 0, sueldoFijo: true } }))
    expect(r.faltantes.map(f => f.clave)).toContain('regla_sueldo_fijo')
    expect(linea(r, '120003')).toBeUndefined()
  })
  it('concepto pendiente con política «no» en el catálogo (888) → faltante, no se descarta en silencio', () => {
    const r = calcularLiquidacionFinal(datos({ ordinarios: { jornadas: 1, conceptos: [{ codigo: '888', importe: 40812 }], horasExtra: 0 } }))
    expect(r.faltantes.map(f => f.clave)).toContain('catalogo:888')
  })
})

describe('prevención de doble pago', () => {
  it('descuenta lo ya enviado a Visual en el mes (registro verificable)', () => {
    const r = calcularLiquidacionFinal(paniagua({ yaLiquidado: [{ codigo: '001', cantidad: 1, importe: 81624 }, { codigo: '000', cantidad: 2, importe: null }] }))
    expect(linea(r, '001')).toMatchObject({ total: 163248 })
    expect(linea(r, '001')!.detalle.yaLiquidado).toBe(81624)
    expect(linea(r, '000')).toMatchObject({ cantidad: 4 })
  })
  it('si todo ya se liquidó, no repite el concepto', () => {
    const r = calcularLiquidacionFinal(paniagua({ yaLiquidado: [{ codigo: '203', cantidad: 1, importe: 123480 }] }))
    expect(linea(r, '203')).toBeUndefined()
  })
  it('extras: descuenta lo pagado por banco; si ya se pagaron todas, no hay 212', () => {
    expect(linea(calcularLiquidacionFinal(paniagua({ extrasPagadas: 10000 })), '212')).toMatchObject({ total: 25000 })
    expect(linea(calcularLiquidacionFinal(paniagua({ extrasPagadas: 35000 })), '212')).toBeUndefined()
  })
  it('208/217 o 120003 ya enviados en el mes → faltante (no se paga dos veces)', () => {
    const r = calcularLiquidacionFinal(datos({ yaLiquidado: [{ codigo: '208', cantidad: 14, importe: 571368 }, { codigo: '120003', cantidad: 1, importe: 1 }] }))
    expect(r.faltantes.map(f => f.clave)).toEqual(expect.arrayContaining(['ya_liquidado:208', 'sac_ya_liquidado']))
  })
  it('212 del adicional mensual + extras pendientes → conflicto, no se suman', () => {
    const o = { ...ORDINARIOS_PANIAGUA, conceptos: [...ORDINARIOS_PANIAGUA.conceptos, { codigo: '212', importe: 255075 }] }
    const r = calcularLiquidacionFinal(paniagua({ ordinarios: o }))
    expect(r.faltantes.map(f => f.clave)).toContain('conflicto_212')
  })
  it('lo ya liquidado queda en el cálculo, ordenado, para que la base lo compare al exportar', () => {
    const r = calcularLiquidacionFinal(paniagua({ yaLiquidado: [{ codigo: '203', cantidad: 1, importe: 1 }, { codigo: '001', cantidad: 1, importe: 1 }] }))
    expect(r.calculo.ya_liquidado.map(y => y.codigo)).toEqual(['001', '203'])
  })
})

describe('ajustes manuales', () => {
  it('pisan el calculado, conservan el valor original y el motivo', () => {
    const r = calcularLiquidacionFinal(datos({ entradas: { vacaciones: { saldoDias: 14, tomadasDias: 0 }, ajustes: [{ codigo: '208', cantidad: 12, motivo: 'acuerdo en la renuncia' }] } }))
    expect(linea(r, '208')).toMatchObject({ cantidad: 12, importe: 40812, total: 489744 })
    expect(linea(r, '208')!.detalle.calculado).toMatchObject({ cantidad: 14, total: 571368 })
    expect(r.advertencias.join(' ')).toMatch(/acuerdo en la renuncia/)
  })
  it('sin motivo no se aplica', () => {
    const r = calcularLiquidacionFinal(datos({ entradas: { vacaciones: { saldoDias: 14, tomadasDias: 0 }, ajustes: [{ codigo: '208', cantidad: 1, motivo: '' }] } }))
    expect(linea(r, '208')).toMatchObject({ cantidad: 14 })
    expect(r.faltantes.map(f => f.clave)).toContain('ajuste:208')
  })
  it('importe 0 quita la línea', () => {
    const r = calcularLiquidacionFinal(datos({ entradas: { vacaciones: { saldoDias: 14, tomadasDias: 0 }, ajustes: [{ codigo: '217', importe: 0, motivo: 'no corresponde en este caso' }] } }))
    expect(linea(r, '217')).toBeUndefined()
  })
})

describe('reintentos: el mismo dato da el mismo cálculo', () => {
  it('cálculo determinístico → mismo hash de contenido', () => {
    const a = calcularLiquidacionFinal(paniagua())
    const b = calcularLiquidacionFinal(paniagua())
    expect(jsonEstable(a)).toBe(jsonEstable(b))
    expect(jsonEstable({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}')
  })
})

// ── Recorte real de la planilla mensual (mismas fórmulas del Excel de trabajo) ──
function fakeClient(tablas: Record<string, any[]>) {
  const make = (name: string) => {
    const rows = tablas[name] ?? []
    const b: any = {
      select: () => b, order: () => b, eq: () => b, lte: () => b, gte: () => b, lt: () => b, gt: () => b, in: () => b, not: () => b, neq: () => b, limit: () => b,
      range: (d: number, h: number) => Promise.resolve({ data: rows.slice(d, h + 1), error: null }),
      then: (resolve: any) => resolve({ data: rows, error: null }),
    }
    return b
  }
  return { from: (n: string) => make(n) }
}

describe('ordinarios hasta la baja con la planilla del mes (Paniagua, octubre)', () => {
  const pan = { id: 'u-pan', nombre: 'EDGAR', apellido: 'PANIAGUA', rol: 'guardia', puesto_organizacional: 'vigilador', estado: 'activo', es_prueba: false, cuil: '20441767871', legajo: '44176787', legajo_visual: '010 Bis', cuenta_bancaria: null }
  const otro = { ...pan, id: 'u-otro', apellido: 'OTRO', cuil: '20000000001' }
  // Turnos reales de producción en octubre: 01, 02, 04, 05, 07, 08 (+ uno posterior a la baja).
  const fechas = ['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-05', '2026-10-07', '2026-10-08', '2026-10-10']
  const horas = [12, 10, 10, 10, 10, 10, 12]
  const turnos = fechas.map((f, i) => ({ id: `t${i}`, fecha: f, hora_inicio: '07:00', hora_fin: '19:00', objetivo_id: 'obj', estado: 'cubierto', guardia_id: 'u-pan' }))
  const registros = fechas.map((f, i) => ({ id: `r${i}`, turno_id: `t${i}`, guardia_id: 'u-pan', horas_liquidables: horas[i], turno: { fecha: f } }))
  const tablas = {
    usuarios: [pan, otro], objetivos: [{ id: 'obj', nombre: 'CLUB', es_prueba: false }], supervisor_zonas: [], nocturnidad_empleado_objetivo: [],
    turnos, registros_asistencia: registros, novedades_laborales: [], supervisores_guardia: [], supervisiones: [],
    liquidacion_sueldo_mensual: [], liquidacion_extra_mensual: [], liquidacion_parametro_mes: [],
  }

  it('baja 08/10: 6 jornadas, 001/203/214/204 de la fórmula mensual y 14 h excedentes', async () => {
    const r = await plantillaTrabajoDelMes(fakeClient(tablas), '2026-10', undefined, { recorte: { empleadoId: 'u-pan', hasta: '2026-10-08' } })
    expect(r.error).toBeNull()
    expect(r.resumen!.filas.map(f => f.empleadoId)).toEqual(['u-pan'])
    expect(r.resumen!.filas[0].jornadasReales).toBe(6)
    const o = ordinariosDePlantilla(r.plantilla!, 'u-pan')!
    const imp = Object.fromEntries(o.conceptos.map(c => [c.codigo, Math.round(c.importe * 100) / 100]))
    expect(imp).toMatchObject({ '001': 244872, '203': 123480, '214': 7200, '204': 43200 })
    expect(o.horasExtra).toBe(14)
  })

  it('una baja sin actividad en el mes no es error: sin ordinarios', async () => {
    const r = await plantillaTrabajoDelMes(fakeClient({ ...tablas, turnos: [], registros_asistencia: [] }), '2026-10', undefined, { recorte: { empleadoId: 'u-pan', hasta: '2026-10-08' } })
    expect(r.error).toBeNull()
    expect(r.resumen!.filas[0].jornadasReales).toBe(0)
    const o = ordinariosDePlantilla(r.plantilla!, 'u-pan')!
    expect(o.conceptos).toEqual([])
    expect(o.horasExtra).toBe(0)
  })

  it('baja dada en la app (inactivo) sin turnos en el mes: no figura en la planilla y no es error', async () => {
    const r = await plantillaTrabajoDelMes(fakeClient({ ...tablas, usuarios: [{ ...pan, estado: 'inactivo' }], turnos: [], registros_asistencia: [] }), '2026-10', undefined, { recorte: { empleadoId: 'u-pan', hasta: '2026-10-08' } })
    expect(r.error).toBeNull()
    expect(r.plantilla).toBeNull()
  })

  it('sin recorte el mes sigue igual (incluye el turno del 10/10 y al otro empleado)', async () => {
    const r = await plantillaTrabajoDelMes(fakeClient(tablas), '2026-10')
    expect(r.resumen!.filas.find(f => f.empleadoId === 'u-pan')!.jornadasReales).toBe(7)
    expect(r.resumen!.filas.map(f => f.empleadoId)).toContain('u-otro')
  })
})

describe('archivos: Excel de trabajo y .xls de Visual desde el mismo cálculo', () => {
  const r = calcularLiquidacionFinal(paniagua())
  const persona = { cuil: '20441767871', legajoVisual: '010 Bis', nombre: 'PANIAGUA EDGAR IVAN' }

  it('el .xls BIFF8 conserva códigos como texto, identidad y cantidades', async () => {
    const XLSX: any = await import('xlsx')
    const bytes = await escribirLibroVisualXls(filasVisualFinal(r.lineas, persona))
    const wb = XLSX.read(bytes, { type: 'array' })
    expect(wb.SheetNames).toEqual(['Hoja1', 'Hoja2', 'Hoja3'])
    const ws = wb.Sheets.Hoja1
    const filas: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }).slice(2)
    const porCodigo = Object.fromEntries(filas.map(f => [f[2], f]))
    expect(Object.keys(porCodigo).sort()).toEqual(['000', '001', '120003', '203', '208', '212', '214', '217'])
    expect(porCodigo['000']).toEqual(['010 Bis', '20441767871', '000', 6, null, null, 'PANIAGUA EDGAR IVAN'])
    expect(porCodigo['208'].slice(3, 5)).toEqual([3, 40812])
    expect(porCodigo['120003'].slice(3, 5)).toEqual([1, 129983.42])
    for (const f of filas) { expect(typeof f[1]).toBe('string'); expect(typeof f[2]).toBe('string') }
  })

  it('el Excel de trabajo lleva fórmulas con el mismo resultado y los faltantes', async () => {
    const buf = await escribirExcelLiquidacionFinal({ finalId: 'f1', version: 3, nombre: 'PANIAGUA', cuil: '20441767871', legajoVisual: '010 Bis', causa: 'renuncia', fuente: 'app' }, r)
    const ExcelJS = (await import('exceljs')).default
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as ArrayBuffer)
    const ws = wb.getWorksheet('Liquidación final')!
    expect((ws.getCell('B11').value as any).formula).toBe('B8-B10')
    expect((ws.getCell('B11').value as any).result).toBe(62)
    const filas: Record<string, any> = {}
    ws.eachRow((row, n) => { if (n > 21 && /^\d{3,6}$/.test(String(row.getCell(1).value))) filas[String(row.getCell(1).value)] = row })
    expect((filas['120003'].getCell(4).value as any).formula).toBe('ROUND((B3/200*150)/365*B11,2)')
    expect((filas['120003'].getCell(5).value as any).result).toBe(129983.42)
    expect((filas['208'].getCell(3).value as any).formula).toBe('B14')
    expect((filas['208'].getCell(5).value as any).result).toBe(122436)
    expect((filas['212'].getCell(4).value as any).formula).toBe('ROUND(MAX(0,B15*B6-B16),2)')
    expect(String(ws.getCell('J1').value)).toBe('f1')
  })
})

describe('resultado de Visual (Planilla de Sueldos real de JC)', () => {
  // Encabezados y fila de Paniagua tal como vienen en liq_fin_fulla_y_paniagua.xls.
  const enc = ['LEGAJO', 'NOMBRE', 'CUIL', 'FEC.INGRESO', 'CTRO.CTO.', 'O.SOCIAL', 'FECHA NAC.', 'CATEGORIA',
    '000 DIAS TRABAJADAS', 'Cant.', '001 horas trabajadas', 'Cant.', '120003 sac proporcional', 'Cant.',
    '208  vac no goz', 'Cant.', '212 ADICIONAL', 'Cant.', '212 GRATIFICACION EXTRAORDINARIA', 'Cant.', 'Imponible', 'No Imponible', 'Descuentos', 'Asignaciones', 'Neto']
  const fila = ['010 Bis', 'PANIAGUA  EDGAR IVAN', '20441767871', '02/08/2026', null, 'OS', '01/01/2000', null,
    6, 6, 244872, 1, 129983.42, 1, 122436, 3, 0, 0, 35000, 1, 374855.42, 7200, 63725.42, 280916, 599246]
  const grid = [['MERCOSUR SEGURIDAD SRL'], [], [], enc, fila, ['Totales Liquidación']]

  it('toma los conceptos de la persona; el 212 repetido en cero se descarta', () => {
    const r = conceptosDePersona(grid as any, '20441767871')
    expect(r.error).toBeNull()
    const cods = r.conceptos.map(c => c.codigo)
    expect(cods.filter(c => c === '212')).toHaveLength(1)
    expect(r.conceptos.find(c => c.codigo === '212')).toMatchObject({ importe: 35000, cantidad: 1 })
    expect(r.conceptos.find(c => c.codigo === '208')).toMatchObject({ importe: 122436, cantidad: 3 })
  })
  it('CUIL que no está en el archivo → error', () => {
    expect(conceptosDePersona(grid as any, '20285365814').error).toMatch(/no trae/)
  })
})
