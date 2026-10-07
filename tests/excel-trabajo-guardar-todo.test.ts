import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { generarExcelTrabajoLiquidacion, plantillaTrabajoDelMes, cargarParametrosDelMes } from '@/lib/excel-trabajo-liquidacion'
import { analizarReimportCompleto } from '@/lib/excel-trabajo-reimport-completo'
import { escribirPlantillaLiquidacionXLSX } from '@/lib/liquidacion-xlsx'
import { PARAMETROS_PLANTILLA, resolverParametrosDelMes, type ParametrosLiquidacion } from '@/lib/resumen-guardia'
import { CLAVES_LEGAJO_VIGENCIA, type CeldaVisual } from '@/lib/excel-trabajo-reimport'

// JC 07/10: "se tienen que guardar todos los cambios que haga en ese archivo de
// trabajo". Ida y vuelta: Juan edita el Excel (parámetros del mes, variables,
// importes escritos sobre la fórmula, textos, adelantos) → se analiza → se guarda
// → el Excel de trabajo regenerado sale IGUAL al que subió.

function fakeClient(tablas: Record<string, any[]>) {
  const valor = (row: any, campo: string) => campo.split('.').reduce((o, k) => (o == null ? o : o[k]), row)
  const make = (name: string) => {
    const filtros: ((r: any) => boolean)[] = []
    let tope: number | null = null
    const filas = () => {
      const r = (tablas[name] ?? []).filter(row => filtros.every(f => f(row)))
      return tope == null ? r : r.slice(0, tope)
    }
    const b: any = {
      select: () => b, order: () => b, in: () => b,
      eq: (c: string, v: any) => { filtros.push(r => valor(r, c) === v); return b },
      neq: (c: string, v: any) => { filtros.push(r => valor(r, c) !== v); return b },
      gte: (c: string, v: any) => { filtros.push(r => String(valor(r, c)) >= String(v)); return b },
      lte: (c: string, v: any) => { filtros.push(r => String(valor(r, c)) <= String(v)); return b },
      lt: (c: string, v: any) => { filtros.push(r => String(valor(r, c)) < String(v)); return b },
      gt: (c: string, v: any) => { filtros.push(r => String(valor(r, c)) > String(v)); return b },
      limit: (n: number) => { tope = n; return b },
      range: (d: number, h: number) => Promise.resolve({ data: filas().slice(d, h + 1), error: null }),
      then: (resolve: any) => resolve({ data: filas(), error: null }),
    }
    return b
  }
  return { from: (name: string) => make(name) }
}

const MES = '2026-08'
const PER = 'p08'
const usuarios = [
  { id: 'v1', nombre: 'ESTANISLAO', apellido: 'ALMADA', rol: 'guardia', puesto_organizacional: 'vigilador', estado: 'activo', es_prueba: false, cuil: '20144945817', legajo: '1', legajo_visual: 'ALMADA', cuenta_bancaria: '0001234567' },
  { id: 'v2', nombre: 'JUAN', apellido: 'ROSALES', rol: 'guardia', puesto_organizacional: 'vigilador', estado: 'activo', es_prueba: false, cuil: '20295393522', legajo: '2', legajo_visual: 'ROSALES', cuenta_bancaria: '0007654321' },
  { id: 's1', nombre: 'MARIA', apellido: 'SUAREZ', rol: 'supervisor', puesto_organizacional: 'supervisor', estado: 'activo', es_prueba: false, cuil: '27111111112', legajo: '3', legajo_visual: 'SUAREZ', cuenta_bancaria: '0001111111' },
  { id: 'a1', nombre: 'PEDRO', apellido: 'GOMEZ', rol: 'admin', puesto_organizacional: 'administrativo', estado: 'activo', es_prueba: false, cuil: '20222222223', legajo: '4', legajo_visual: 'GOMEZ', cuenta_bancaria: '0002222222' },
]

function tablas(): Record<string, any[]> {
  const turnos: any[] = [], registros: any[] = []
  for (const [g, dias] of [['v1', 24], ['v2', 15]] as [string, number][]) {
    for (let d = 1; d <= dias; d++) {
      const fecha = `${MES}-${String(d).padStart(2, '0')}`
      const id = `t-${g}-${d}`
      turnos.push({ id, fecha, hora_inicio: '07:00', hora_fin: '19:00', objetivo_id: 'o1', estado: 'cubierto', guardia_id: g })
      registros.push({ id: `r-${id}`, turno_id: id, guardia_id: g, horas_liquidables: 12, created_at: `${fecha}T07:00:00-03:00`, turno: { fecha } })
    }
  }
  return {
    usuarios, turnos, registros_asistencia: registros,
    objetivos: [{ id: 'o1', nombre: 'CLUB', es_prueba: false, zona_id: null, nocturnidad_activa: false }],
    supervisor_zonas: [], nocturnidad_empleado_objetivo: [], novedades_laborales: [], supervisores_guardia: [], supervisiones: [],
    liquidacion_periodo: [{ id: PER, mes: MES, estado: 'borrador' }],
    liquidacion_ajuste: [], liquidacion_parametro_mes: [],
    liquidacion_sueldo_mensual: [{ usuario_id: 'a1', importe: 2550000, vigencia_desde: '2026-01-01', vigencia_hasta: null }],
    liquidacion_extra_mensual: [], liquidacion_concepto_permanente: [],
  }
}

async function aGrid(buf: ArrayBuffer): Promise<CeldaVisual[][]> {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf)
  const grid: CeldaVisual[][] = []
  wb.worksheets[0].eachRow({ includeEmpty: true }, (row) => {
    const cells: CeldaVisual[] = []
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      let v: any = cell.value
      if (v && typeof v === 'object' && 'result' in v) v = v.result
      if (v && typeof v === 'object' && 'richText' in v) v = v.richText.map((t: any) => t.text).join('')
      cells[col - 1] = v ?? null
    })
    grid.push(cells)
  })
  return grid
}

/**
 * "El Excel que Juan guardó": lo que Excel calcularía después de sus ediciones.
 * Se arma con la misma plantilla (así las fórmulas quedan recalculadas como en
 * Excel) aplicando sus cambios.
 */
async function archivoDeJuan(t: Record<string, any[]>) {
  const client = fakeClient(t)
  const parametros: ParametrosLiquidacion = { ...PARAMETROS_PLANTILLA, basico: 1150000, presentismo: 200000, hora: null, dia: null }
  const ajustes = new Map<string, Record<string, number | null>>([
    ['v2', { jornadas: 20, adelantos: 30000 }],
    // Viático escrito a mano sobre la fórmula (AC) y feriado $ (AT).
    ['v1', { 'celda:AC': 123456.78, 'celda:AT': 5000 }],
  ])
  const textos = new Map<string, Record<string, string | null>>([
    ['v1', { 'texto:E': 'Licencia acordada con gerencia', 'texto:BB': 'revisar en septiembre' }],
  ])
  const { plantilla } = await plantillaTrabajoDelMes(client, MES, ajustes, { parametros, textos })
  return escribirPlantillaLiquidacionXLSX(plantilla!)
}

/** Simula guardar_reimport_excel_trabajo sobre las tablas falsas. */
function guardar(t: Record<string, any[]>, an: Awaited<ReturnType<typeof analizarReimportCompleto>>) {
  const upsert = (row: any) => {
    t.liquidacion_ajuste = t.liquidacion_ajuste.filter(a => !(a.empleado_id === row.empleado_id && a.clave === row.clave))
    t.liquidacion_ajuste.push({ periodo_id: PER, tipo: 'variable', origen: 'excel_reimport', ...row })
  }
  for (const d of an.comparacion.diffs) if (!CLAVES_LEGAJO_VIGENCIA.has(d.clave)) upsert({ empleado_id: d.usuarioId, clave: d.clave, valor_liquidacion: d.excel, valor_texto: null })
  for (const c of an.celdas) upsert(c.tipo === 'texto'
    ? { empleado_id: c.usuarioId, clave: c.clave, valor_liquidacion: null, valor_texto: c.excel }
    : { empleado_id: c.usuarioId, clave: c.clave, valor_liquidacion: c.excel, valor_texto: null })
  for (const q of an.quitar) t.liquidacion_ajuste = t.liquidacion_ajuste.filter(a => !(a.empleado_id === q.usuarioId && a.clave === q.clave))
  for (const p of an.parametros) {
    t.liquidacion_parametro_mes = t.liquidacion_parametro_mes.filter(x => !(x.mes === MES && x.clave === p.clave))
    if (p.excel != null) t.liquidacion_parametro_mes.push({ mes: MES, clave: p.clave, valor: p.excel })
  }
}

describe('Excel de trabajo: se guarda TODO lo que se cambia', () => {
  it('detecta parámetros, variables, importes escritos a mano, textos y adelantos', async () => {
    const t = tablas()
    const an = await analizarReimportCompleto(fakeClient(t), { id: PER, mes: MES }, await aGrid(await archivoDeJuan(t)))
    expect(an.error).toBeNull()
    expect(an.parametros.map(p => [p.clave, p.excel])).toEqual([['basico', 1150000], ['presentismo', 200000]])
    const vars = an.comparacion.diffs.map(d => `${d.usuarioId}:${d.clave}=${d.excel}`).sort()
    expect(vars).toEqual(['v2:adelantos=30000', 'v2:jornadas=20'])
    const celdas = an.celdas.map(c => `${c.usuarioId}:${c.clave}=${c.excel}`).sort()
    expect(celdas).toEqual([
      'v1:celda:AC=123456.78', 'v1:celda:AT=5000',
      'v1:texto:BB=revisar en septiembre', 'v1:texto:E=Licencia acordada con gerencia',
    ])
    // Un básico nuevo NO hace aparecer como "a mano" los importes que recalculan.
    expect(an.celdas.some(c => c.clave === 'celda:AD' || c.clave === 'celda:AJ' || c.clave === 'celda:AO')).toBe(false)
    expect(an.quitar).toEqual([])
    expect(an.advertencias).toEqual([])
  }, 120000)

  it('IDA Y VUELTA: guardado lo detectado, el Excel de trabajo regenerado es igual al subido', async () => {
    const t = tablas()
    const subido = await aGrid(await archivoDeJuan(t))
    guardar(t, await analizarReimportCompleto(fakeClient(t), { id: PER, mes: MES }, subido))

    const r = await generarExcelTrabajoLiquidacion(fakeClient(t), MES, { periodoId: PER })
    const regenerado = await aGrid(r.buf!)
    // Mismas celdas con el mismo valor (la regenerada agrega SINDICATO al final).
    const filas = Math.max(subido.length, regenerado.length)
    const difs: string[] = []
    for (let i = 0; i < filas; i++) {
      const cols = Math.max(subido[i]?.length ?? 0, 59)
      for (let j = 0; j < cols; j++) {
        const a = subido[i]?.[j] ?? null, b = regenerado[i]?.[j] ?? null
        const igual = typeof a === 'number' || typeof b === 'number' ? Math.abs(Number(a ?? 0) - Number(b ?? 0)) < 0.005 : String(a ?? '') === String(b ?? '')
        if (!igual) difs.push(`fila ${i + 1} col ${j + 1}: subido=${a} regenerado=${b}`)
      }
    }
    expect(difs).toEqual([])
    // Y una segunda subida del mismo contenido ya no propone nada nuevo.
    const an2 = await analizarReimportCompleto(fakeClient(t), { id: PER, mes: MES }, regenerado)
    expect(an2.parametros).toEqual([])
    expect(an2.celdas).toEqual([])
    expect(an2.quitar).toEqual([])
  }, 180000)

  it('los parámetros guardados se heredan a los meses siguientes (hora/día manual sólo su mes)', () => {
    const g = [
      { mes: '2026-08', clave: 'basico', valor: 1150000 },
      { mes: '2026-08', clave: 'hora', valor: 6000 },
      { mes: '2026-10', clave: 'basico', valor: 1200000 },
    ]
    expect(resolverParametrosDelMes('2026-07', g).basico).toBe(PARAMETROS_PLANTILLA.basico)
    expect(resolverParametrosDelMes('2026-08', g)).toMatchObject({ basico: 1150000, hora: 6000 })
    expect(resolverParametrosDelMes('2026-09', g)).toMatchObject({ basico: 1150000, hora: null })
    expect(resolverParametrosDelMes('2026-11', g).basico).toBe(1200000)
  })

  it('una corrección que vuelve al valor del sistema se quita (no queda pegada)', async () => {
    const t = tablas()
    t.liquidacion_ajuste.push(
      { periodo_id: PER, empleado_id: 'v1', clave: 'celda:AC', valor_liquidacion: 1, origen: 'excel_reimport' },
      { periodo_id: PER, empleado_id: 'v2', clave: 'jornadas', valor_liquidacion: 99, origen: 'excel_reimport' },
      // Otro origen: NO se toca desde el Excel.
      { periodo_id: PER, empleado_id: 'v2', clave: 'licencias', valor_liquidacion: 2, origen: 'manual' },
    )
    // Archivo sin correcciones (todo como lo calcula el sistema).
    const { plantilla } = await plantillaTrabajoDelMes(fakeClient({ ...t, liquidacion_ajuste: [] }), MES)
    const an = await analizarReimportCompleto(fakeClient(t), { id: PER, mes: MES }, await aGrid(await escribirPlantillaLiquidacionXLSX(plantilla!)))
    expect(an.quitar.map(q => `${q.usuarioId}:${q.clave}`).sort()).toEqual(['v1:celda:AC', 'v2:jornadas'])
  }, 120000)

  it('lo que no se puede guardar se avisa (fila sin identidad, total a mano, celda fuera de estructura, sindicato)', async () => {
    const t = tablas()
    t.liquidacion_concepto_permanente = [{ empleado_id: 'v2', activo: true, vigencia_desde: '2026-01-01', vigencia_hasta: null, concepto: { codigo_visual: '104' } }]
    const r = await generarExcelTrabajoLiquidacion(fakeClient(t), MES, { periodoId: PER })
    const grid = await aGrid(r.buf!)
    const filaV1 = grid.findIndex(f => f?.[55] === 'v1')
    const filaV2 = grid.findIndex(f => f?.[55] === 'v2')
    grid[filaV1][78] = 'nota suelta'                       // CA: fuera de estructura
    grid[filaV2][59] = null                                 // BH: desmarca SINDICATO
    const filaTotal = grid.findIndex(f => String(f?.[0] ?? '').startsWith('TOTAL GENERAL'))
    grid[filaTotal][28] = 1                                 // AC del total escrito a mano
    grid.push([]); grid.push([null, '20999999990', null, 'PERSONA NUEVA'])  // fila agregada sin identidad
    const an = await analizarReimportCompleto(fakeClient(t), { id: PER, mes: MES }, grid)
    const tipos = an.advertencias.map(a => a.tipo).sort()
    expect(tipos).toEqual(['celda_fuera_de_estructura', 'fila_sin_identidad', 'sindicato_desmarcado', 'total_editado'])
  }, 120000)

  it('sin parámetros guardados (o sin la tabla todavía) usa los valores por defecto', async () => {
    const sinTabla = { from: () => ({ select: () => ({ lte: () => Promise.resolve({ data: null, error: { message: 'relation does not exist' } }) }) }) }
    expect(await cargarParametrosDelMes(sinTabla, MES)).toMatchObject({ basico: PARAMETROS_PLANTILLA.basico, hora: null })
  })
})
