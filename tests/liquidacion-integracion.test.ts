import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { generarExcelTrabajoLiquidacion, generarLibroGeneralTrabajo, plantillaTrabajoDelMes } from '@/lib/excel-trabajo-liquidacion'
import { analizarReimportCompleto } from '@/lib/excel-trabajo-reimport-completo'
import { escribirPlantillaLiquidacionXLSX } from '@/lib/liquidacion-xlsx'
import { regenerarVisualDesdeEnviado } from '@/lib/visual-generar'
import { filasSueldosBanco } from '@/lib/pagos-banco'
import { PARAMETROS_PLANTILLA } from '@/lib/resumen-guardia'
import { CLAVES_LEGAJO_VIGENCIA, type CeldaVisual } from '@/lib/excel-trabajo-reimport'
import { fakeClient } from './helpers/supabase-falso'

// Integración de punta a punta (JC 07/10), todo junto:
// Juan edita el Excel de trabajo (básico de convenio, adelanto, importe a mano)
// → se guarda → el libro general lo refleja: parámetros del mes, sueldo mensual
// fijo, adelanto descontado UNA sola vez del sueldo a depositar, pagos por
// persona, gráfico y colores; y la regla 050/133 usa el Básico DEL MES.

const usuarios = [
  { id: 'v1', nombre: 'ESTANISLAO', apellido: 'ALMADA', rol: 'guardia', puesto_organizacional: 'vigilador', estado: 'activo', es_prueba: false, cuil: '20144945817', legajo: '1', legajo_visual: 'ALMADA', cuenta_bancaria: '0001234567' },
  { id: 'v2', nombre: 'JUAN', apellido: 'ROSALES', rol: 'guardia', puesto_organizacional: 'vigilador', estado: 'activo', es_prueba: false, cuil: '20295393522', legajo: '2', legajo_visual: 'ROSALES', cuenta_bancaria: '0007654321' },
  { id: 'a1', nombre: 'PEDRO', apellido: 'GOMEZ', rol: 'admin', puesto_organizacional: 'administrativo', estado: 'activo', es_prueba: false, cuil: '20222222223', legajo: '4', legajo_visual: 'GOMEZ', cuenta_bancaria: '0002222222' },
]

function tablas(): Record<string, any[]> {
  const turnos: any[] = [], registros: any[] = []
  for (const [mes, g, dias] of [['2026-07', 'v1', 20], ['2026-08', 'v1', 24], ['2026-08', 'v2', 15], ['2026-09', 'v1', 10]] as [string, string, number][]) {
    for (let d = 1; d <= dias; d++) {
      const fecha = `${mes}-${String(d).padStart(2, '0')}`
      const id = `t-${g}-${fecha}`
      turnos.push({ id, fecha, hora_inicio: '07:00', hora_fin: '19:00', objetivo_id: 'o1', estado: 'cubierto', guardia_id: g })
      registros.push({ id: `r-${id}`, turno_id: id, guardia_id: g, horas_liquidables: 12, created_at: `${fecha}T07:00:00-03:00`, turno: { fecha } })
    }
  }
  return {
    usuarios, turnos, registros_asistencia: registros,
    objetivos: [{ id: 'o1', nombre: 'CLUB', es_prueba: false, zona_id: null, nocturnidad_activa: false }],
    supervisor_zonas: [], nocturnidad_empleado_objetivo: [], novedades_laborales: [], supervisores_guardia: [], supervisiones: [],
    liquidacion_periodo: [
      { id: 'p07', mes: '2026-07', estado: 'liquidada' },
      { id: 'p08', mes: '2026-08', estado: 'borrador' },
      { id: 'p09', mes: '2026-09', estado: 'borrador' },
    ],
    liquidacion_ajuste: [], liquidacion_parametro_mes: [], liquidacion_consolidada: [], liquidacion_concepto_permanente: [],
    liquidacion_sueldo_mensual: [{ usuario_id: 'a1', importe: 2550000, vigencia_desde: '2026-01-01', vigencia_hasta: null }],
    liquidacion_extra_mensual: [{ usuario_id: 'a1', importe: 50000, vigencia_desde: '2026-01-01', vigencia_hasta: null }],
    liquidacion_resultado_visual: [{ id: 'rv08', periodo_id: 'p08', vigente: true }],
    liquidacion_resultado_fila: [
      { resultado_id: 'rv08', cuil: '20144945817', neto: 950000.5 },
      { resultado_id: 'rv08', cuil: '20295393522', neto: 720000.25 },
      { resultado_id: 'rv08', cuil: '20222222223', neto: 2101000 },   // Visual con descuentos: NO se paga esto
    ],
    liquidacion_persona: usuarios.map(u => ({ cuil: u.cuil, usuario_id: u.id })),
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
      cells[col - 1] = v ?? null
    })
    grid.push(cells)
  })
  return grid
}

/** Lo que haría guardar_reimport_excel_trabajo con lo detectado. */
function guardar(t: Record<string, any[]>, an: Awaited<ReturnType<typeof analizarReimportCompleto>>, periodo: { id: string; mes: string }) {
  const upsert = (row: any) => {
    t.liquidacion_ajuste = t.liquidacion_ajuste.filter(a => !(a.periodo_id === periodo.id && a.empleado_id === row.empleado_id && a.clave === row.clave))
    t.liquidacion_ajuste.push({ periodo_id: periodo.id, tipo: 'variable', origen: 'excel_reimport', ...row })
  }
  for (const d of an.comparacion.diffs) if (!CLAVES_LEGAJO_VIGENCIA.has(d.clave)) upsert({ empleado_id: d.usuarioId, clave: d.clave, valor_liquidacion: d.excel })
  for (const c of an.celdas) upsert(c.tipo === 'texto' ? { empleado_id: c.usuarioId, clave: c.clave, valor_texto: c.excel } : { empleado_id: c.usuarioId, clave: c.clave, valor_liquidacion: c.excel })
  for (const p of an.parametros) if (p.excel != null) t.liquidacion_parametro_mes.push({ mes: periodo.mes, clave: p.clave, valor: p.excel })
}

async function juanEditaAgosto(t: Record<string, any[]>) {
  // Excel recalculado tras: Básico 1.150.000, adelanto 50.000 a ALMADA y un
  // viático escrito a mano a ROSALES.
  const { plantilla } = await plantillaTrabajoDelMes(fakeClient(t), '2026-08',
    new Map([['v1', { adelantos: 50000 }], ['v2', { 'celda:AC': 300000 }]]),
    { parametros: { ...PARAMETROS_PLANTILLA, basico: 1150000, hora: null, dia: null }, textos: new Map() })
  const an = await analizarReimportCompleto(fakeClient(t), { id: 'p08', mes: '2026-08' }, await aGrid(await escribirPlantillaLiquidacionXLSX(plantilla!)))
  expect(an.error).toBeNull()
  guardar(t, an, { id: 'p08', mes: '2026-08' })
  return an
}

function columna(ws: ExcelJS.Worksheet, titulo: string) {
  let col = -1
  ws.getRow(6).eachCell((c, n) => { if (c.value === titulo) col = n })
  expect(col, titulo).toBeGreaterThan(0)
  const porUid = new Map<string, any>()
  ws.eachRow((row, n) => { const uid = row.getCell('BD').value; if (n > 6 && uid) porUid.set(String(uid), row.getCell(col).value) })
  return porUid
}
const valor = (v: any) => (v && typeof v === 'object' && 'result' in v ? v.result : v)

describe('Liquidación de punta a punta (Excel de trabajo → libro general → banco/Visual)', () => {
  it('lo editado en el Excel queda guardado y el libro general lo muestra completo', async () => {
    const t = tablas()
    const an = await juanEditaAgosto(t)
    expect(an.parametros.map(p => p.clave)).toEqual(['basico'])
    expect(an.celdas.map(c => `${c.usuarioId}:${c.clave}`)).toEqual(['v2:celda:AC'])

    const r = await generarLibroGeneralTrabajo(fakeClient(t))
    expect(r.periodos).toEqual(['2026-09', '2026-08', '2026-07'])
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.buf!)
    const ago = wb.getWorksheet('2026-08')!
    // Parámetro del mes guardado; septiembre lo hereda; julio (anterior) no cambia.
    expect(ago.getCell('B1').value).toBe(1150000)
    expect(wb.getWorksheet('2026-09')!.getCell('B1').value).toBe(1150000)
    expect(wb.getWorksheet('2026-07')!.getCell('B1').value).toBe(PARAMETROS_PLANTILLA.basico)
    // Importe escrito a mano: se respeta.
    expect(columna(ago, '203').get('v2')).toBe(300000)   // AC (viáticos 203): valor, no fórmula

    // Adelanto: figura en AR, NO se resta de AP, y se descuenta UNA vez del depósito.
    const ar = columna(ago, 'adelantos'), neto = columna(ago, 'NETO A PAGAR'), pago = columna(ago, 'SUELDO A DEPOSITAR')
    expect(ar.get('v1')).toBe(50000)
    expect(neto.get('v1')).toBe(900000.5)
    expect(pago.get('v1')).toBe(900000.5)
    const bs = await filasSueldosBanco(fakeClient(t), 'p08')
    expect(bs.rows.find(x => x.nombre.startsWith('ALMADA'))?.importe).toBe(900000.5)
    // Sueldo mensual FIJO aunque Visual devuelva otro neto; extras aparte.
    expect(neto.get('a1')).toBe(2550000)
    expect(pago.get('a1')).toBe(2550000)
    expect(columna(ago, 'EXTRAS A DEPOSITAR').get('a1')).toBe(50000)
    expect(columna(ago, 'TOTAL A DEPOSITAR').get('a1')).toBe(2600000)
  }, 180000)

  it('AP (extras por horas) no descuenta el adelanto: sólo una vez, en el sueldo a depositar', async () => {
    const t = tablas()
    await juanEditaAgosto(t)
    const r = await generarExcelTrabajoLiquidacion(fakeClient(t), '2026-08', { periodoId: 'p08' })
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.buf!)
    const ws = wb.worksheets[0]
    let fila = -1
    ws.eachRow((row, n) => { if (row.getCell('BD').value === 'v1') fila = n })
    const ap = ws.getCell(`AP${fila}`).value as any
    expect(ap.formula).toBe(`IF(AL${fila}>0,AL${fila}*$AP$6,0)`)
    const al = valor(ws.getCell(`AL${fila}`).value)
    expect(ap.result).toBe(al > 0 ? al * PARAMETROS_PLANTILLA.horaExtra : 0)
    expect(ws.getCell(`AR${fila}`).value).toBe(50000)
  }, 180000)

  it('se conservan gráfico y colores en cada solapa del libro', async () => {
    const t = tablas()
    await juanEditaAgosto(t)
    const r = await generarLibroGeneralTrabajo(fakeClient(t))
    const zip = await JSZip.loadAsync(r.buf!)
    for (const n of [1, 2, 3]) expect(zip.file(`xl/charts/chart${n}.xml`), `gráfico solapa ${n}`).toBeTruthy()
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(r.buf!)
    for (const ws of wb.worksheets) {
      expect((ws.getCell('A6').fill as any)?.fgColor?.argb, `encabezado ${ws.name}`).toBe('FF1F3A5F')
      expect(((ws as any).conditionalFormattings ?? []).length, `semáforos ${ws.name}`).toBeGreaterThan(0)
    }
  }, 180000)

  it('Diferencia de Obra Social (050/133): se omite si el remunerativo supera el Básico DEL MES', async () => {
    // 001 = 1.100.000: supera el Básico por defecto (1.020.300) pero no el del mes (1.150.000).
    const enviado = [
      { periodo_id: 'p08', cod_interno: '1', cuil: '20144945817', codigo: '001', cantidad: 1, importe: 1100000 },
      { periodo_id: 'p08', cod_interno: '1', cuil: '20144945817', codigo: '133', cantidad: 1, importe: 1 },
    ]
    const t = tablas()
    t.liquidacion_enviado_visual = enviado
    const sinParam = await regenerarVisualDesdeEnviado(fakeClient(t), 'p08')
    expect(sinParam.lineas).toBe(1)                     // con el Básico por defecto: 133 omitido
    t.liquidacion_parametro_mes.push({ mes: '2026-08', clave: 'basico', valor: 1150000 })
    const conParam = await regenerarVisualDesdeEnviado(fakeClient(t), 'p08')
    expect(conParam.lineas).toBe(2)                     // con el Básico del mes: 133 se envía
    t.liquidacion_enviado_visual[0].importe = 1200000   // ahora supera también el del mes
    expect((await regenerarVisualDesdeEnviado(fakeClient(t), 'p08')).lineas).toBe(1)
  }, 60000)
})
