import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import {
  generarExcelCompletoConNeto,
  generarLibroGeneralTrabajo,
  prepararLiquidacionDelMes,
} from '@/lib/excel-trabajo-liquidacion'
import { fakeClient } from './helpers/supabase-falso'

// Libro general = una solapa por período con el MISMO Excel completo que el botón
// individual. Se verifica celda por celda (valor, fórmula, formato) contra el
// archivo individual de cada mes, el orden de las solapas, el gráfico, el NETO
// pendiente sin Visual y el control contra el snapshot consolidado.

const usuarios = [
  { id: 'v1', nombre: 'ESTANISLAO', apellido: 'ALMADA', rol: 'guardia', puesto_organizacional: 'vigilador', estado: 'activo', es_prueba: false, cuil: '20144945817', legajo: '1', legajo_visual: 'ALMADA', cuenta_bancaria: '0001234567' },
  { id: 'v2', nombre: 'JUAN', apellido: 'ROSALES', rol: 'guardia', puesto_organizacional: 'vigilador', estado: 'activo', es_prueba: false, cuil: '20295393522', legajo: '2', legajo_visual: 'ROSALES', cuenta_bancaria: '0007654321' },
  { id: 's1', nombre: 'MARIA', apellido: 'SUAREZ', rol: 'supervisor', puesto_organizacional: 'supervisor', estado: 'activo', es_prueba: false, cuil: '27111111112', legajo: '3', legajo_visual: 'SUAREZ', cuenta_bancaria: '0001111111' },
  // Administrativo con sueldo mensual: no pasa por Visual en el mes de prueba.
  { id: 'a1', nombre: 'PEDRO', apellido: 'GOMEZ', rol: 'admin', puesto_organizacional: 'administrativo', estado: 'activo', es_prueba: false, cuil: '20222222223', legajo: '4', legajo_visual: 'GOMEZ', cuenta_bancaria: '0002222222' },
]

const OBJ = 'obj-1'
function actividad() {
  const turnos: any[] = [], registros: any[] = []
  // Distinta actividad por mes para que cada solapa tenga datos propios.
  const plan: [string, string, number][] = [['2026-07', 'v1', 20], ['2026-07', 'v2', 8], ['2026-08', 'v1', 24], ['2026-08', 'v2', 15], ['2026-09', 'v1', 12]]
  for (const [mes, g, dias] of plan) {
    for (let d = 1; d <= dias; d++) {
      const fecha = `${mes}-${String(d).padStart(2, '0')}`
      const id = `t-${g}-${fecha}`
      turnos.push({ id, fecha, hora_inicio: '07:00', hora_fin: '19:00', objetivo_id: OBJ, estado: 'cubierto', guardia_id: g })
      registros.push({ id: `r-${id}`, turno_id: id, guardia_id: g, horas_liquidables: 12, created_at: `${fecha}T07:00:00-03:00`, turno: { fecha } })
    }
  }
  return { turnos, registros }
}

function tablasBase(): Record<string, any[]> {
  const { turnos, registros } = actividad()
  return {
    usuarios, turnos, registros_asistencia: registros,
    objetivos: [{ id: OBJ, nombre: 'CLUB', es_prueba: false, zona_id: null, nocturnidad_activa: false }],
    supervisor_zonas: [], nocturnidad_empleado_objetivo: [], novedades_laborales: [],
    supervisores_guardia: [], supervisiones: [],
    liquidacion_periodo: [
      // Desordenados a propósito + uno anulado que NO debe salir.
      { id: 'p07', mes: '2026-07', estado: 'liquidada' },
      { id: 'p09', mes: '2026-09', estado: 'borrador' },
      { id: 'p06', mes: '2026-06', estado: 'anulado' },
      { id: 'p08', mes: '2026-08', estado: 'exportada' },
    ],
    // Corrección manual guardada SÓLO en agosto: no debe filtrarse a otros meses.
    liquidacion_ajuste: [
      { periodo_id: 'p08', empleado_id: 'v2', clave: 'horas_liquidables', valor_liquidacion: 200, tipo: 'variable' },
    ],
    // Sueldo mensual con cambio de vigencia: julio usa el viejo, ago/sep el nuevo.
    liquidacion_sueldo_mensual: [
      { usuario_id: 'a1', importe: 900000, vigencia_desde: '2026-01-01', vigencia_hasta: '2026-07-31' },
      { usuario_id: 'a1', importe: 1100000, vigencia_desde: '2026-08-01', vigencia_hasta: null },
    ],
    liquidacion_extra_mensual: [
      { usuario_id: 'a1', importe: 50000, vigencia_desde: '2026-01-01', vigencia_hasta: null },
    ],
    liquidacion_concepto_permanente: [],
    liquidacion_resultado_visual: [
      { id: 'rv07', periodo_id: 'p07', vigente: true },
      { id: 'rv08-viejo', periodo_id: 'p08', vigente: false },
      { id: 'rv08', periodo_id: 'p08', vigente: true },
      // Septiembre: sin resultado de Visual todavía.
    ],
    liquidacion_resultado_fila: [
      { resultado_id: 'rv07', cuil: '20144945817', neto: 812345.67 },
      { resultado_id: 'rv07', cuil: '20295393522', neto: 401000 },
      { resultado_id: 'rv08-viejo', cuil: '20144945817', neto: 1 },
      { resultado_id: 'rv08', cuil: '20144945817', neto: 950000.5 },
      { resultado_id: 'rv08', cuil: '20295393522', neto: 720000.25 },
      { resultado_id: 'rv08', cuil: '27111111112', neto: 1300000 },
      // El administrativo también figura en Visual con descuentos: se le paga el fijo.
      { resultado_id: 'rv08', cuil: '20222222223', neto: 812000.4 },
    ],
    liquidacion_persona: usuarios.map(u => ({ cuil: u.cuil, usuario_id: u.id })),
    liquidacion_consolidada: [],
  }
}

/** Congela en liquidacion_consolidada el snapshot real del período (como al exportar). */
async function congelar(tablas: Record<string, any[]>, periodo: { id: string; mes: string }) {
  const prep = await prepararLiquidacionDelMes(fakeClient(tablas), periodo)
  expect(prep.error).toBeNull()
  for (const f of prep.snapshotFilas) tablas.liquidacion_consolidada.push({ periodo_id: periodo.id, ...f })
}

// Representación comparable de una hoja: valor/fórmula/resultado + formato de
// cada celda, columnas, vistas y formatos condicionales.
function firmaHoja(ws: ExcelJS.Worksheet) {
  const celdas: Record<string, string> = {}
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (c) => {
      celdas[c.address] = JSON.stringify({ v: c.value, z: c.numFmt, f: c.fill, fo: c.font, b: c.border, a: c.alignment })
    })
  })
  const columnas = (ws.columns ?? []).map(c => ({ w: c.width, h: c.hidden, z: (c as any).numFmt }))
  // x14Id es un GUID aleatorio que exceljs asigna a cada dataBar: no es contenido.
  const cf = JSON.stringify((ws as any).conditionalFormattings ?? []).replace(/"x14Id":"\{[^}]+\}"/g, '"x14Id":"*"')
  return { celdas, columnas, vistas: JSON.stringify(ws.views), cf, filas: ws.rowCount }
}

async function cargar(buf: ArrayBuffer) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb
}

function celdaPorTexto(ws: ExcelJS.Worksheet, fila: number, texto: string): number {
  let col = -1
  ws.getRow(fila).eachCell((c, n) => { if (c.value === texto) col = n })
  return col
}

describe('Libro general = Excel completo de cada mes', () => {
  it('una solapa por período no anulado, del más reciente al más antiguo', async () => {
    const r = await generarLibroGeneralTrabajo(fakeClient(tablasBase()))
    expect(r.error).toBeNull()
    expect(r.periodos).toEqual(['2026-09', '2026-08', '2026-07'])
    expect(r.omitidos).toEqual([])
    const wb = await cargar(r.buf!)
    expect(wb.worksheets.map(w => w.name)).toEqual(['2026-09', '2026-08', '2026-07'])
  }, 120000)

  it('cada solapa coincide celda por celda con su Excel completo individual (personas, datos, importes, totales, formato)', async () => {
    const tablas = tablasBase()
    await congelar(tablas, { id: 'p07', mes: '2026-07' })
    const client = fakeClient(tablas)
    const libro = await cargar((await generarLibroGeneralTrabajo(client)).buf!)
    for (const p of [{ id: 'p09', mes: '2026-09' }, { id: 'p08', mes: '2026-08' }, { id: 'p07', mes: '2026-07' }]) {
      const ind = await generarExcelCompletoConNeto(client, p)
      expect(ind.error).toBeNull()
      const wsInd = (await cargar(ind.buf!)).worksheets[0]
      const wsLib = libro.getWorksheet(p.mes)!
      const a = firmaHoja(wsInd), b = firmaHoja(wsLib)
      expect(Object.keys(b.celdas).sort(), `${p.mes}: mismas celdas`).toEqual(Object.keys(a.celdas).sort())
      // Las fórmulas/estilos no referencian el nombre de hoja: deben ser idénticos.
      for (const ref of Object.keys(a.celdas)) expect(b.celdas[ref], `${p.mes} ${ref}`).toBe(a.celdas[ref])
      expect(b.columnas).toEqual(a.columnas)
      expect(b.vistas).toBe(a.vistas)
      expect(b.cf).toBe(a.cf)
    }
  }, 180000)

  // Valores numéricos de una columna (por encabezado de fila 6) por usuario_id, y su total.
  function columna(ws: ExcelJS.Worksheet, titulo: string) {
    const col = celdaPorTexto(ws, 6, titulo); expect(col, titulo).toBeGreaterThan(0)
    const porUid = new Map<string, number>()
    let total: any
    ws.eachRow((row, n) => {
      if (n <= 6) return
      const v = row.getCell(col).value
      if (String(row.getCell(1).value ?? '').toUpperCase().startsWith('TOTAL GENERAL')) total = v
      const uid = row.getCell('BD').value
      if (uid && typeof v === 'number') porUid.set(String(uid), v)
    })
    return { porUid, total }
  }

  it('NETO A PAGAR: sueldo mensual FIJO para quien lo tiene (aunque Visual traiga otro neto); el resto, Visual vigente', async () => {
    const libro = await cargar((await generarLibroGeneralTrabajo(fakeClient(tablasBase()))).buf!)
    const ago = columna(libro.getWorksheet('2026-08')!, 'NETO A PAGAR')
    // a1 (administrativo) figura en Visual con 812.000,40 pero cobra su fijo 1.100.000.
    expect(Object.fromEntries(ago.porUid)).toEqual({ v1: 950000.5, v2: 720000.25, s1: 1300000, a1: 1100000 })
    expect(ago.total).toBe(950000.5 + 720000.25 + 1300000 + 1100000)
    // Sin Visual (septiembre): el fijo figura; los que dependen de Visual no; total PENDIENTE.
    const sepWs = libro.getWorksheet('2026-09')!
    const sep = columna(sepWs, 'NETO A PAGAR')
    expect(Object.fromEntries(sep.porUid)).toEqual({ a1: 1100000 })
    expect(sep.total).toBe('PENDIENTE')
    expect(String(sepWs.getCell('C4').value)).toMatch(/pendiente/i)
    const r = await generarLibroGeneralTrabajo(fakeClient(tablasBase()))
    expect(r.visualPendiente).toEqual(['2026-09'])
  }, 120000)

  it('SUELDO A DEPOSITAR / EXTRAS A DEPOSITAR / TOTAL A DEPOSITAR por persona = lo que sale en los archivos del banco', async () => {
    const t = tablasBase()
    t.usuarios = t.usuarios.map(u => u.id === 'v2' ? { ...u, excluir_pago_banco: true } : u)   // baja: fuera del banco
    const client = fakeClient(t)
    const ws = (await cargar((await generarLibroGeneralTrabajo(client)).buf!)).getWorksheet('2026-08')!
    const sueldo = columna(ws, 'SUELDO A DEPOSITAR'), extras = columna(ws, 'EXTRAS A DEPOSITAR'), total = columna(ws, 'TOTAL A DEPOSITAR')
    expect(Object.fromEntries(sueldo.porUid)).toEqual({ v1: 950000.5, s1: 1300000, a1: 1100000 })
    expect(Object.fromEntries(extras.porUid)).toEqual({ a1: 50000 })
    expect(total.porUid.get('a1')).toBe(1150000)
    expect(total.porUid.has('v2')).toBe(false)
    // Mismos importes que los archivos del banco (sueldos y extras).
    const { filasSueldosBanco, filasExtrasBanco } = await import('@/lib/pagos-banco')
    const bs = await filasSueldosBanco(client, 'p08'), be = await filasExtrasBanco(client, 'p08')
    const sum = (rows: { importe: number }[]) => Math.round(rows.reduce((a, b) => a + b.importe, 0) * 100) / 100
    expect(sueldo.total).toBe(sum([...bs.rows, ...bs.excluidos]))
    expect(extras.total).toBe(sum([...be.rows, ...be.excluidos]))
    expect(total.total).toBe(Math.round(((sueldo.total as number) + (extras.total as number)) * 100) / 100)
    // Orden: los pagos van antes y NETO A PAGAR sigue siendo la última columna.
    expect(celdaPorTexto(ws, 6, 'NETO A PAGAR')).toBe(celdaPorTexto(ws, 6, 'TOTAL A DEPOSITAR') + 1)
  }, 120000)

  it('ADELANTOS: se descuentan una sola vez del sueldo a depositar (NETO A PAGAR y SUELDO A DEPOSITAR), nunca negativo', async () => {
    const t = tablasBase()
    t.liquidacion_ajuste.push(
      { periodo_id: 'p08', empleado_id: 'v1', clave: 'adelantos', valor_liquidacion: 50000, tipo: 'variable' },
      { periodo_id: 'p08', empleado_id: 'a1', clave: 'adelantos', valor_liquidacion: 2000000, tipo: 'variable' },
    )
    const client = fakeClient(t)
    const ws = (await cargar((await generarLibroGeneralTrabajo(client)).buf!)).getWorksheet('2026-08')!
    const neto = columna(ws, 'NETO A PAGAR'), sueldo = columna(ws, 'SUELDO A DEPOSITAR')
    expect(neto.porUid.get('v1')).toBe(900000.5)          // 950.000,50 − 50.000
    expect(sueldo.porUid.get('v1')).toBe(900000.5)        // el banco deposita lo mismo
    expect(neto.porUid.get('a1')).toBe(0)                 // adelanto > sueldo fijo → 0, no negativo
    expect(String(ws.getCell('C4').value)).toMatch(/superan el sueldo/)
    // Julio no tiene adelantos: no se descuenta nada (no se arrastra de agosto).
    const jul = columna((await cargar((await generarLibroGeneralTrabajo(client)).buf!)).getWorksheet('2026-07')!, 'NETO A PAGAR')
    expect(jul.porUid.get('v1')).toBe(812345.67)
    const { filasSueldosBanco } = await import('@/lib/pagos-banco')
    const bs = await filasSueldosBanco(client, 'p08')
    expect(bs.rows.find(r => r.nombre.startsWith('ALMADA'))?.importe).toBe(900000.5)
  }, 120000)

  it('sin la función de pagos (migración sin aplicar) las columnas avisan NO DISPONIBLE', async () => {
    const c: any = fakeClient(tablasBase())
    c.rpc = () => Promise.resolve({ data: null, error: { message: 'function pagos_banco_por_usuario does not exist' } })
    const ws = (await cargar((await generarLibroGeneralTrabajo(c)).buf!)).getWorksheet('2026-08')!
    expect(columna(ws, 'SUELDO A DEPOSITAR').total).toBe('NO DISPONIBLE')
    expect(String(ws.getCell('C4').value)).toMatch(/Importes a depositar no disponibles/)
  }, 120000)

  it('cada mes usa SUS datos guardados: ajuste de agosto no se filtra a julio; sueldo mensual por vigencia', async () => {
    const libro = await cargar((await generarLibroGeneralTrabajo(fakeClient(tablasBase()))).buf!)
    const valorDe = (ws: ExcelJS.Worksheet, uid: string, col: string) => {
      let out: any
      ws.eachRow((row, n) => { if (row.getCell('BD').value === uid) out = ws.getCell(`${col}${n}`).value })
      return out && typeof out === 'object' && 'result' in out ? out.result : out
    }
    // I = horas liquidables: agosto lleva la corrección guardada (200), julio no.
    expect(valorDe(libro.getWorksheet('2026-08')!, 'v2', 'I')).toBe(200)
    expect(valorDe(libro.getWorksheet('2026-07')!, 'v2', 'I')).toBe(96)
    // BF = SUELDO MENSUAL del administrativo según la vigencia de cada mes.
    expect(valorDe(libro.getWorksheet('2026-07')!, 'a1', 'BF')).toBe(900000)
    expect(valorDe(libro.getWorksheet('2026-08')!, 'a1', 'BF')).toBe(1100000)
    // BE = período de la solapa (identidad oculta intacta).
    expect(valorDe(libro.getWorksheet('2026-09')!, 'v1', 'BE')).toBe('2026-09')
  }, 120000)

  it('compara contra el snapshot consolidado: coincide → sin aviso; difiere → aviso en la hoja y en el resultado', async () => {
    const tablas = tablasBase()
    await congelar(tablas, { id: 'p07', mes: '2026-07' })
    const ok = await generarLibroGeneralTrabajo(fakeClient(tablas))
    expect(ok.difierenDeConsolidada).toEqual([])
    expect((await cargar(ok.buf!)).getWorksheet('2026-07')!.getCell('C4').value).toBeNull()

    tablas.liquidacion_consolidada[0].importe += 1000
    const mal = await generarLibroGeneralTrabajo(fakeClient(tablas))
    expect(mal.difierenDeConsolidada).toEqual(['2026-07'])
    expect(String((await cargar(mal.buf!)).getWorksheet('2026-07')!.getCell('C4').value)).toMatch(/difieren de lo consolidado/)
  }, 180000)

  it('el paquete es válido para Excel: un gráfico por solapa, relaciones y content types consistentes', async () => {
    const r = await generarLibroGeneralTrabajo(fakeClient(tablasBase()))
    const zip = await JSZip.loadAsync(r.buf!)
    const ct = await zip.file('[Content_Types].xml')!.async('string')
    for (const n of [1, 2, 3]) {
      expect(zip.file(`xl/charts/chart${n}.xml`), `chart${n}`).toBeTruthy()
      expect(ct).toContain(`/xl/charts/chart${n}.xml`)
      expect(ct).toContain(`/xl/drawings/drawing${n}.xml`)
      const sheet = await zip.file(`xl/worksheets/sheet${n}.xml`)!.async('string')
      const rels = await zip.file(`xl/worksheets/_rels/sheet${n}.xml.rels`)!.async('string')
      const rid = sheet.match(/<drawing r:id="(rId\d+)"\/>/)![1]
      expect(rels).toContain(`Id="${rid}"`)
      const ids = Array.from(rels.matchAll(/Id="(rId\d+)"/g)).map(m => m[1])
      expect(new Set(ids).size, `rIds únicos sheet${n}`).toBe(ids.length)
    }
    // Cada gráfico apunta a SU solapa.
    const wb = await cargar(r.buf!)
    for (let i = 0; i < 3; i++) {
      const xml = await zip.file(`xl/charts/chart${i + 1}.xml`)!.async('string')
      expect(xml).toContain(`'${wb.worksheets[i].name}'!$AD$`)
    }
  }, 120000)

  it('sin períodos → error claro; un mes que falla figura en omitidos (no se pierde en silencio)', async () => {
    const vacio = await generarLibroGeneralTrabajo(fakeClient({ ...tablasBase(), liquidacion_periodo: [] }))
    expect(vacio.buf).toBeNull()
    expect(vacio.error).toMatch(/No hay períodos/)
    const t = tablasBase()
    t.liquidacion_periodo.push({ id: 'pX', mes: '2026/10', estado: 'borrador' })
    const r = await generarLibroGeneralTrabajo(fakeClient(t))
    expect(r.periodos).toEqual(['2026-09', '2026-08', '2026-07'])
    expect(r.omitidos.map(o => o.mes)).toEqual(['2026/10'])
  }, 120000)
})
