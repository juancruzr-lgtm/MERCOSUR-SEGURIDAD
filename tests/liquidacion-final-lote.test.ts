import { describe, expect, it } from 'vitest'
import { calcularLiquidacionFinal, type ConceptoCatalogo, type DatosLiquidacionFinal } from '@/lib/liquidacion-final'
import { escribirLibroLiquidacionesFinales, nombreHoja } from '@/lib/liquidacion-final-excel'
import { diferenciasDeHoja, leerHojasLiquidacionFinal } from '@/lib/liquidacion-final-lote'
import { exportarLote, importarResultadoLote } from '@/lib/liquidacion-final-datos'

const CAT = new Map<string, ConceptoCatalogo>([
  ['000', { politica: 'valor', entrada: 'CAN', nombre: 'DIAS TRABAJADAS' }],
  ['001', { politica: 'valor', entrada: 'IMP', nombre: 'horas trabajadas' }],
  ['120003', { politica: 'valor', entrada: 'CANIMP', nombre: 'sac proporcional' }],
  ['203', { politica: 'valor', entrada: 'IMP', nombre: 'Viaticos' }],
  ['204', { politica: 'valor', entrada: 'IMP', nombre: 'presentismo' }],
  ['208', { politica: 'valor', entrada: 'CANIMP', nombre: 'Vac No Goz' }],
  ['212', { politica: 'valor', entrada: 'CANIMP', nombre: 'ADICIONAL' }],
  ['214', { politica: 'valor', entrada: 'IMP', nombre: 'Suma No Remunerativa' }],
  ['217', { politica: 'valor', entrada: 'IMP', nombre: 'sac sobre vacaciones no goz' }],
])
const renuncia = { codigo: 'renuncia', nombre: 'Renuncia', presentismo: 'cero_si_no_completa_mes' as const, evaluar: [] }
const datos = (o: Partial<DatosLiquidacionFinal>): DatosLiquidacionFinal => ({
  persona: { cuil: '20285365814', legajoVisual: 'FULLA w', nombre: 'FULLA WALTER DARIO', empleadoId: 'u1' },
  baja: { fecha: '2026-09-30', causa: 'renuncia', fechaIngreso: '2023-03-01', causal: renuncia },
  parametros: { basico: 1020300, horaExtra: 2500, valorDia: 40812, conteoSAC: 'exclusivo' },
  ordinarios: { jornadas: 0, conceptos: [], horasExtra: 0 }, yaLiquidado: [], extrasPagadas: 0, catalogo: CAT,
  entradas: {}, ...o,
})
const ID_F = '00000000-0000-0000-0000-0000000000f1'
const ID_P = '00000000-0000-0000-0000-0000000000f2'
// Fulla sin vacaciones ni período (incompleta); Paniagua completa.
const fulla = calcularLiquidacionFinal(datos({}))
const paniagua = calcularLiquidacionFinal(datos({
  persona: { cuil: '20441767871', legajoVisual: '010 Bis', nombre: 'PANIAGUA EDGAR IVAN', empleadoId: 'u2' },
  baja: { fecha: '2026-10-03', causa: 'renuncia', fechaIngreso: '2026-08-02', causal: renuncia },
  ordinarios: { jornadas: 6, horasExtra: 14, conceptos: [{ codigo: '203', importe: 123480 }, { codigo: '204', importe: 43200 }, { codigo: '214', importe: 7200 }, { codigo: '001', importe: 244872 }] },
  entradas: { vacaciones: { saldoDias: 3, tomadasDias: 0 }, visualPeriodo: 'Liq. Especial SEPTIEMBRE 2026' },
}))
const cab = (id: string, nombre: string, cuil: string, legajo: string) => ({ finalId: id, version: 2, nombre, cuil, legajoVisual: legajo, causa: 'Renuncia', fuente: 'legajo' })

async function libro() {
  const buf = await escribirLibroLiquidacionesFinales([
    { cab: cab(ID_F, 'FULLA WALTER DARIO', '20285365814', 'FULLA w'), res: fulla, estado: 'borrador', fechaBaja: '2026-09-30' },
    { cab: cab(ID_P, 'PANIAGUA EDGAR IVAN', '20441767871', '010 Bis'), res: paniagua, estado: 'borrador', fechaBaja: '2026-10-03' },
  ])
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf as ArrayBuffer)
  return wb
}
const guardado = (r: ReturnType<typeof calcularLiquidacionFinal>, entradas = {}) => ({
  version: 2, estado: 'borrador', entradas,
  vacaciones: { saldo: r.calculo.vacaciones.saldo, tomadas: r.calculo.vacaciones.tomadas }, visualPeriodo: r.calculo.visualPeriodo,
})
const fila = (ws: any, codigo: string) => { for (let r = 22; r < 60; r++) if (String(ws.getCell(`A${r}`).value) === codigo) return r; return -1 }

describe('Excel de trabajo de todas las finales', () => {
  it('Índice + una hoja por persona con identidad oculta, celdas editables y filas libres', async () => {
    const wb = await libro()
    expect(wb.worksheets.map(w => w.name)).toEqual(['Índice', 'FULLA WALTER DARIO', 'PANIAGUA EDGAR IVAN'])
    const p = wb.getWorksheet('PANIAGUA EDGAR IVAN')!
    expect(String(p.getCell('J1').value)).toBe(ID_P)
    expect(p.getCell('B19').value).toBe('Liq. Especial SEPTIEMBRE 2026')
    expect(String(wb.getWorksheet('Índice')!.getCell('E2').value)).toBe(String(fulla.faltantes.length))
  }, 60000)

  it('sin cambios → nada que aplicar', async () => {
    const hojas = leerHojasLiquidacionFinal(await libro())
    expect(hojas).toHaveLength(2)
    const d = diferenciasDeHoja(hojas[1], guardado(paniagua, { visualPeriodo: 'Liq. Especial SEPTIEMBRE 2026' }), paniagua.lineas)
    expect(d).toMatchObject({ cambios: [], errores: [], entradas: null })
  }, 60000)

  it('completa lo que faltaba (vacaciones y período) de Fulla', async () => {
    const wb = await libro()
    const ws = wb.getWorksheet('FULLA WALTER DARIO')!
    ws.getCell('B12').value = 51; ws.getCell('B13').value = 37; ws.getCell('B19').value = 'Liq. Especial SEPTIEMBRE 2026'
    const h = leerHojasLiquidacionFinal(wb).find(x => x.finalId === ID_F)!
    const d = diferenciasDeHoja(h, guardado(fulla), fulla.lineas)
    expect(d.errores).toEqual([])
    expect(d.entradas).toMatchObject({ vacaciones: { saldoDias: 51, tomadasDias: 37 }, visualPeriodo: 'Liq. Especial SEPTIEMBRE 2026' })
    // Y con esas entradas el borrador queda completo: 208 = 14 días.
    const r = calcularLiquidacionFinal(datos({ entradas: d.entradas! }))
    expect(r.faltantes).toEqual([])
    expect(r.lineas.find(l => l.codigo === '208')).toMatchObject({ cantidad: 14, total: 571368 })
  }, 60000)

  it('vacaciones a medias (sólo una celda) → no se asume cero', async () => {
    const wb = await libro()
    wb.getWorksheet('FULLA WALTER DARIO')!.getCell('B12').value = 51
    const d = diferenciasDeHoja(leerHojasLiquidacionFinal(wb)[0], guardado(fulla), fulla.lineas)
    expect(d.entradas).toBeNull()
    expect(d.errores.join(' ')).toMatch(/no se asumen cero/)
  }, 60000)

  it('cambio de importe: es un ajuste (la nota en H es opcional); una fila libre agrega un concepto', async () => {
    const wb = await libro()
    const ws = wb.getWorksheet('PANIAGUA EDGAR IVAN')!
    ws.getCell(`D${fila(ws, '203')}`).value = 100000
    let d = diferenciasDeHoja(leerHojasLiquidacionFinal(wb)[1], guardado(paniagua), paniagua.lineas)
    expect(d.errores).toEqual([])
    expect(d.entradas!.ajustes).toEqual([{ codigo: '203', cantidad: null, importe: 100000, motivo: 'Editado en el Excel de trabajo' }])

    ws.getCell(`H${fila(ws, '203')}`).value = 'Viático acordado'
    const libre = fila(ws, 'TOTAL') - 1
    ws.getCell(`A${libre}`).value = '204'; ws.getCell(`D${libre}`).value = 1000; ws.getCell(`H${libre}`).value = 'Aprobado por Gerencia'
    d = diferenciasDeHoja(leerHojasLiquidacionFinal(wb)[1], guardado(paniagua), paniagua.lineas)
    expect(d.errores).toEqual([])
    expect(d.entradas!.ajustes).toEqual([
      { codigo: '203', cantidad: null, importe: 100000, motivo: 'Viático acordado' },
      { codigo: '204', cantidad: 1, importe: 1000, motivo: 'Aprobado por Gerencia' },
    ])
  }, 60000)

  it('pisar una fórmula con un número cuenta como ajuste (con motivo)', async () => {
    const wb = await libro()
    const ws = wb.getWorksheet('PANIAGUA EDGAR IVAN')!
    const r = fila(ws, '120003')
    ws.getCell(`D${r}`).value = 130000; ws.getCell(`H${r}`).value = 'Redondeo pedido'
    const d = diferenciasDeHoja(leerHojasLiquidacionFinal(wb)[1], guardado(paniagua), paniagua.lineas)
    expect(d.entradas!.ajustes).toEqual([{ codigo: '120003', cantidad: null, importe: 130000, motivo: 'Redondeo pedido' }])
  }, 60000)

  it('si el borrador cambió después de bajar el Excel, no se aplica; ni si ya se exportó', async () => {
    const wb = await libro()
    wb.getWorksheet('FULLA WALTER DARIO')!.getCell('B19').value = 'Liq. Especial SEPTIEMBRE 2026'
    const h = leerHojasLiquidacionFinal(wb)[0]
    expect(diferenciasDeHoja(h, { ...guardado(fulla), version: 3 }, fulla.lineas).errores[0]).toMatch(/cambió después/)
    expect(diferenciasDeHoja(h, { ...guardado(fulla), estado: 'exportada' }, fulla.lineas).errores[0]).toMatch(/exportada/)
  }, 60000)

  it('nombres de hoja válidos y únicos', () => {
    const u = new Set<string>()
    expect(nombreHoja('PEREZ [JUAN]: A/B', u)).toBe('PEREZ JUAN A B')
    expect(nombreHoja('PEREZ JUAN A B', u)).toBe('PEREZ JUAN A B (2)')
  })
})

// ── Exportar liquidaciones finales (un solo .xls de Visual) ──────────────────
function clienteFalso(lineasPor: Record<string, any[]>, rechazar: Set<string>) {
  const llamadas: any[] = []
  const tablas: Record<string, any[]> = {
    usuarios: [], liquidacion_persona: [],
    // Catálogo de Visual: haberes de la final ('valor') y una línea 0/0 que calcula Visual (descuentos como el mensual).
    liquidacion_concepto_catalogo: [...['000', '001', '120003', '203', '208', '212', '214', '217'].map(c => ({ codigo_visual: c, politica: 'valor', entrada: c === '000' ? 'CAN' : 'CANIMP', categoria: 'otro' })),
      { codigo_visual: '011', politica: 'linea_cero', entrada: 'CALCULADO', categoria: 'aporte' }],
  }
  const q = (rows: any[], filtro: Record<string, string> = {}) => {
    const b: any = {
      select: () => b, order: () => b, limit: () => b, lte: () => b, gte: () => b, in: () => b,
      eq: (k: string, v: string) => { filtro[k] = v; return b },
      maybeSingle: () => Promise.resolve({ data: rows.find(r => Object.entries(filtro).every(([k, v]) => String(r[k]) === v)) ?? null, error: null }),
      then: (ok: any) => ok({ data: filtro.final_id ? (lineasPor[filtro.final_id] ?? []) : rows, error: null }),
    }
    return b
  }
  return {
    llamadas,
    from: (t: string) => q(tablas[t] ?? []),
    rpc: (fn: string, args: any) => {
      llamadas.push({ fn, args })
      if (fn === 'liquidacion_final_exportar' && rechazar.has(args.p_final_id)) return Promise.resolve({ data: null, error: { message: 'Doble pago: cambió lo liquidado' } })
      return Promise.resolve({ data: fn === 'liquidacion_final_importar_resultado' ? { version: 1, repetido: false } : { estado: 'exportada', repetida: false }, error: null })
    },
  }
}
const finalFila = (id: string, nombre: string, cuil: string, estado: string): any => ({
  id, baja_id: 'b' + id, mes: '2026-10', estado, version: 3, requiere_recalculo: false, entradas: {}, calculo: null, faltantes: [], advertencias: [],
  baja: { id: 'b' + id, empleado_id: null, nombre, cuil, legajo: null, fecha_baja: '2026-10-03', estado: 'confirmada', origen: 'legajo', vacaciones: null, turnos_futuros: [] },
})

describe('EXPORTAR LIQUIDACIONES FINALES', () => {
  it('un solo .xls con las aprobadas; la rechazada por doble pago no entra y se informa', async () => {
    const lineasP = paniagua.lineas.map(l => ({ ...l }))
    const lineasF = [{ codigo: '208', entrada: 'CANIMP', cantidad: 14, importe: 40812, total: 571368 }]
    const c = clienteFalso({ [ID_P]: lineasP, [ID_F]: lineasF }, new Set([ID_F]))
    // persona() toma el legajo de Visual de liquidacion_persona por CUIL: lo cargamos.
    ;(c as any).from = ((orig) => (t: string) => t === 'liquidacion_persona'
      ? (() => { let cuil = ''; const b: any = { select: () => b, eq: (_k: string, v: string) => { cuil = v; return b }, maybeSingle: () => Promise.resolve({ data: { cod_interno: cuil === '20441767871' ? '010 Bis' : 'FULLA w', nombre: null }, error: null }) }; return b })()
      : orig(t))(c.from)
    const r = await exportarLote(c, [
      finalFila(ID_P, 'PANIAGUA, EDGAR IVAN', '20441767871', 'lista'),
      finalFila(ID_F, 'FULLA, WALTER DARIO', '20285365814', 'lista'),
      finalFila('00000000-0000-0000-0000-0000000000f3', 'OTRO, BORRADOR', '20000000001', 'borrador'),
    ])
    expect(r.incluidas).toEqual(['PANIAGUA, EDGAR IVAN'])
    expect(r.rechazadas).toEqual([{ persona: 'FULLA, WALTER DARIO', error: 'Doble pago: cambió lo liquidado' }])
    expect(c.llamadas.filter(x => x.fn === 'liquidacion_final_exportar').map(x => x.args.p_archivo)).toEqual([r.nombre, r.nombre])
    const XLSX: any = await import('xlsx')
    const filas: any[][] = XLSX.utils.sheet_to_json(XLSX.read(r.bytes, { type: 'array' }).Sheets.Hoja1, { header: 1, raw: true, defval: null }).slice(2)
    expect(new Set(filas.map(f => f[1]))).toEqual(new Set(['20441767871']))
    expect(filas.map(f => f[2])).toEqual(['000', '001', '120003', '203', '208', '212', '214', '217', '011'])   // + descuentos 0/0 como el mensual
  }, 60000)

  it('importa el resultado de Visual para todas las exportadas que figuran en la planilla', async () => {
    const c = clienteFalso({}, new Set())
    const XLSX: any = await import('xlsx')
    const enc = ['LEGAJO', 'NOMBRE', 'CUIL', 'FEC.INGRESO', 'CTRO.CTO.', 'O.SOCIAL', 'FECHA NAC.', 'CATEGORIA', '208  vac no goz', 'Cant.', 'Neto']
    const ws = XLSX.utils.aoa_to_sheet([['MERCOSUR'], [], [], enc, ['010 Bis', 'PANIAGUA', '20441767871', null, null, null, null, null, 122436, 3, 1], ['Totales Liquidación']])
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'P')
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    const r = await importarResultadoLote(c, [
      finalFila(ID_P, 'PANIAGUA, EDGAR IVAN', '20441767871', 'exportada'),
      finalFila(ID_F, 'FULLA, WALTER DARIO', '20285365814', 'exportada'),
    ], 'planilla.xlsx', buf)
    expect(r).toEqual([{ persona: 'PANIAGUA EDGAR IVAN', ok: true, detalle: 'versión 1' }])
    expect(c.llamadas.find(x => x.fn === 'liquidacion_final_importar_resultado').args.p_conceptos).toEqual([{ codigo: '208', nombre: 'vac no goz', cantidad: 3, importe: 122436 }])
  }, 60000)
})
