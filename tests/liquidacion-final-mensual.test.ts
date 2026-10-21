import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { PARAMETROS_PLANTILLA, plantillaLiquidacionResumenGuardia, type FilaResumenGuardia, type PlantillaLiquidacion } from '@/lib/resumen-guardia'
import {
  COL_FINAL, SIN_USUARIO, anexarColumnasFinal, codigosDeColumnas, correccionesDeVista, diferenciasFinalMensual, leerHojaFinalMensual,
  type FilaFinalMensual, type GuardadoFinal,
} from '@/lib/liquidacion-final-mensual'
import { escribirLibroMultiMes } from '@/lib/liquidacion-xlsx'

// Liquidaciones finales con el formato del Excel de trabajo mensual (JC 21/10):
// una fila por baja, las columnas del mensual y al final las de la liquidación.

const P = { ...PARAMETROS_PLANTILLA }
const U1 = '11111111-1111-1111-1111-111111111111'
const F1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const F2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const U2 = `${SIN_USUARIO}cccccccc-cccc-cccc-cccc-cccccccccccc`

function fila(id: string, nombre: string, extra: Partial<FilaResumenGuardia> = {}): FilaResumenGuardia {
  return {
    empleadoId: id, grupo: 'vigiladores', nombre, cuil: '20111111112', legajo: null, legajoVisual: null, cuenta: null,
    objetivos: [], jornadas: 0, jornadasReales: 0, fechasConActividad: 0, horasReales: 0, horasLiquidables: 0,
    feriadosTrabajados: 0, horasEnFeriado: 0, horasNocturnas: 0, horasNocturnasCalculadas: 0, nocturnidadOrigen: null,
    licencias: null, art: null, vacaciones: null, parteMedico: null, ausenciasSuspensiones: null, notas: [],
    supervisiones: 0, horasSupervision: 0, jornadasSupervision: 0, hsVigilanciaZona: 0, observaciones: [],
    origen: { turnoIds: [], registroIds: [], novedadIds: [] }, ...extra,
  } as FilaResumenGuardia
}

const resumen = {
  mes: '2026-10',
  filas: [
    fila(U1, 'PEREZ, JUAN', { jornadas: 6, jornadasReales: 6, horasLiquidables: 160, feriadosTrabajados: 1 }),
    fila(U2, 'GOMEZ ANA', { cuil: '27222222223' }),
  ],
  totales: { empleados: 2, jornadas: 6, horasReales: 0, horasLiquidables: 160, horasNocturnas: 0, feriadosTrabajados: 1 },
}

const vacia = plantillaLiquidacionResumenGuardia({ ...resumen, filas: [] }, undefined, undefined, undefined, P)
const cols = codigosDeColumnas(vacia)
// Renuncia que no completa el mes: presentismo en cero (se ve en cero en la fila).
const ajustesBase = new Map<string, Record<string, number | null>>([
  [U1, correccionesDeVista(cols, [], { calculado: 43200, aplicado: 0 })],
  [U2, correccionesDeVista(cols, [{ codigo: '001', total: 50000 }], null)],
])
const armar = (extra: Map<string, Record<string, number | null>>) => {
  const unidos = new Map(ajustesBase)
  for (const [k, m] of Array.from(extra.entries())) unidos.set(k, { ...(unidos.get(k) ?? {}), ...m })
  return plantillaLiquidacionResumenGuardia(resumen, unidos, undefined, undefined, P)
}
const base = armar(new Map())
const celda = (pl: PlantillaLiquidacion, ref: string) => pl.celdas.find(c => c.ref === ref)
const filaDe = (pl: PlantillaLiquidacion, uid: string) => Number(pl.celdas.find(c => /^BD\d+$/.test(c.ref) && c.v === uid)!.ref.slice(2))
const r1 = filaDe(base, U1)
const r2 = filaDe(base, U2)
const num = (pl: PlantillaLiquidacion, ref: string) => Number(celda(pl, ref)?.v ?? 0)

// Total de la final de PEREZ = conceptos de la fila + 120003 + 208 + 217 + 212.
const sumaFila = ['AC', 'AD', 'AE', 'AF', 'AI', 'AJ', 'AT', 'AU', 'AV', 'AW', 'AX'].reduce((s, c) => s + num(base, `${c}${r1}`), 0)
const sac = Math.round((P.basico / 200 * 150) / 365 * 62 * 100) / 100
const v208 = Math.round(3 * (P.basico / 200 * 8) * 100) / 100
const v217 = Math.round(P.basico / 365 * 3 * 100) / 100
const v212 = Math.round(num(base, `AL${r1}`) * P.horaExtra * 100) / 100
const totalPerez = Math.round((sumaFila + sac + v208 + v217 + v212) * 100) / 100

const filasFinal = new Map<string, FilaFinalMensual>([
  [U1, { finalId: F1, version: 3, usuarioId: U1, fechaBaja: '2026-10-03', causa: 'Renuncia', vacSaldo: 3, vacTomadas: 0, diasSAC: 62, sueldoFijo: false,
    extrasPagadas: 0, ajustados: {}, totalApp: totalPerez, visualPeriodo: null, avisos: ['Falta el período de Visual.'] }],
  [U2, { finalId: F2, version: 1, usuarioId: U2, fechaBaja: '2026-10-18', causa: 'Fin de contrato', vacSaldo: null, vacTomadas: null, diasSAC: 10, sueldoFijo: false,
    extrasPagadas: 0, ajustados: { '208': 0 }, totalApp: 999, visualPeriodo: 'Liq. Especial OCTUBRE 2026', avisos: [] }],
])
const conFinal = anexarColumnasFinal(base, filasFinal)

const guardados = new Map<string, GuardadoFinal>([
  [F1, { finalId: F1, version: 3, estado: 'borrador', persona: 'PEREZ JUAN', conUsuario: true, entradas: { vacaciones: { saldoDias: 3, tomadasDias: 0 } },
    vacaciones: { saldo: 3, tomadas: 0 }, visualPeriodo: null,
    mostrado: { '120003': num(conFinal, `${COL_FINAL.c120003}${r1}`), '208': num(conFinal, `${COL_FINAL.c208}${r1}`), '217': num(conFinal, `${COL_FINAL.c217}${r1}`), '212': num(conFinal, `${COL_FINAL.c212}${r1}`) } }],
  [F2, { finalId: F2, version: 1, estado: 'borrador', persona: 'GOMEZ ANA', conUsuario: false, entradas: { ajustes: [{ codigo: '001', importe: 50000, motivo: 'previo' }] },
    vacaciones: { saldo: null, tomadas: null }, visualPeriodo: 'Liq. Especial OCTUBRE 2026',
    mostrado: { '120003': num(conFinal, `${COL_FINAL.c120003}${r2}`), '208': 0, '217': num(conFinal, `${COL_FINAL.c217}${r2}`), '212': num(conFinal, `${COL_FINAL.c212}${r2}`) } }],
])

async function libro(): Promise<ExcelJS.Workbook> {
  const buf = await escribirLibroMultiMes([{ nombre: 'Finales 2026-10', plantilla: { ...conFinal, nombreHoja: 'Finales 2026-10' } }])
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); return wb
}
async function releer(wb: ExcelJS.Workbook) {
  const wb2 = new ExcelJS.Workbook(); await wb2.xlsx.load(await wb.xlsx.writeBuffer()); return leerHojaFinalMensual(wb2.worksheets[0])!
}
/** Simula el recálculo de Excel: copia a la fila los valores que dan las fórmulas con las variables nuevas. */
function recalcularFila(ws: ExcelJS.Worksheet, uid: string, variables: Record<string, number>) {
  const pl = armar(new Map([[uid, variables]]))
  const r = filaDe(pl, uid)
  for (const c of pl.celdas) {
    const m = c.ref.match(/^([A-Z]+)(\d+)$/)
    if (!m || Number(m[2]) !== r || c.f === undefined) continue
    ws.getCell(c.ref).value = { formula: c.f, result: c.v as number } as any
  }
}

describe('Excel de finales con el formato del mensual', () => {
  it('cada baja es una fila del mensual con las columnas de la liquidación al final', () => {
    expect(celda(conFinal, `${COL_FINAL.finalId}6`)?.v).toBe('final_id')
    expect(celda(conFinal, `${COL_FINAL.c120003}6`)?.v).toBe('120003 SAC PROP.')
    expect(celda(conFinal, `G${r1}`)?.v).toBe(6)                       // jornadas del mes (columna del mensual)
    expect(celda(conFinal, `AD${r1}`)?.v).toBe(0)                      // presentismo en cero por la causal
    expect(celda(conFinal, `AD${r1}`)?.f).toBeUndefined()
    expect(celda(conFinal, `${COL_FINAL.c120003}${r1}`)).toMatchObject({ v: sac, f: `IF(BN${r1}="",0,ROUND(($B$1/200*150)/365*BN${r1},2))` })
    expect(sac).toBe(129983.42)                                         // caso Paniagua: 62 días
    expect(celda(conFinal, `${COL_FINAL.c208}${r1}`)).toMatchObject({ v: 122436, f: `IF(BM${r1}="",0,ROUND(BM${r1}*$C$3,2))` })
    expect(celda(conFinal, `${COL_FINAL.c217}${r1}`)?.v).toBe(v217)
    expect(celda(conFinal, `${COL_FINAL.c212}${r1}`)?.f).toBe(`ROUND(MAX(0,BR${r1}*$AP$6-BS${r1}),2)`)
    expect(celda(conFinal, `${COL_FINAL.hsExtra}${r1}`)?.f).toBe(`AL${r1}`)
    // El total es fórmula cuando coincide con la app.
    expect(celda(conFinal, `${COL_FINAL.total}${r1}`)?.v).toBe(totalPerez)
    expect(celda(conFinal, `${COL_FINAL.total}${r1}`)?.f).toContain(`AC${r1}+AD${r1}`)
    expect(celda(conFinal, `${COL_FINAL.finalId}${r1}`)?.v).toBe(F1)
    expect(String(celda(conFinal, `${COL_FINAL.avisos}${r1}`)?.v)).toContain('período de Visual')
    // Sin usuario / sin actividad: fila en cero; ajustes de la app a la vista.
    expect(celda(conFinal, `AJ${r2}`)?.v).toBe(50000)
    expect(celda(conFinal, `${COL_FINAL.c208}${r2}`)).toMatchObject({ v: 0 })
    expect(celda(conFinal, `${COL_FINAL.c208}${r2}`)?.f).toBeUndefined()
    expect(celda(conFinal, `${COL_FINAL.total}${r2}`)?.f).toBeUndefined()   // no coincide → valor de la app y aviso
    expect(String(celda(conFinal, `${COL_FINAL.avisos}${r2}`)?.v)).toContain('no es la suma de la fila')
    const oculta = conFinal.columnas.find(c => c.col === COL_FINAL.finalId)
    expect(oculta?.hidden).toBe(true)
  })

  it('bajado y subido sin tocar: ningún cambio', async () => {
    const h = await releer(await libro())
    expect(h.filas.map(f => f.finalId).sort()).toEqual([F1, F2].sort())
    const { diferencias, avisos } = diferenciasFinalMensual(h, base, armar, guardados)
    expect(avisos).toEqual([])
    for (const d of diferencias) {
      expect(d.cambios).toEqual([])
      expect(d.errores).toEqual([])
      expect(d.entradas).toBeNull()
    }
  })

  it('corrige días, vacaciones, 120003 a mano, legajo y período (con motivo)', async () => {
    const wb = await libro()
    const ws = wb.worksheets[0]
    ws.getCell(`G${r1}`).value = 5
    recalcularFila(ws, U1, { jornadas: 5 })
    ws.getCell(`${COL_FINAL.vacSaldo}${r1}`).value = 4
    ws.getCell(`${COL_FINAL.vacTomadas}${r1}`).value = 1
    ws.getCell(`${COL_FINAL.c120003}${r1}`).value = 100000
    ws.getCell(`${COL_FINAL.motivo}${r1}`).value = 'Faltó el 08/10; SAC según Visual'
    ws.getCell(`A${r1}`).value = '0456'
    ws.getCell(`${COL_FINAL.periodo}${r2}`).value = 'Liq. Final OCTUBRE 2026'
    const { diferencias } = diferenciasFinalMensual(await releer(wb), base, armar, guardados)
    const d1 = diferencias.find(d => d.finalId === F1)!
    expect(d1.errores).toEqual([])
    expect(d1.entradas?.ordinarios).toEqual({ jornadas: 5 })
    expect(d1.entradas?.ordinariosMotivo).toBe('Faltó el 08/10; SAC según Visual')
    expect(d1.entradas?.vacaciones).toMatchObject({ saldoDias: 4, tomadasDias: 1 })
    expect(d1.entradas?.ajustes).toEqual([{ codigo: '120003', cantidad: null, importe: 100000, motivo: 'Faltó el 08/10; SAC según Visual' }])
    expect(d1.legajoVisual).toEqual({ usuarioId: U1, valor: '0456' })
    const d2 = diferencias.find(d => d.finalId === F2)!
    expect(d2.errores).toEqual([])
    expect(d2.entradas?.visualPeriodo).toBe('Liq. Final OCTUBRE 2026')
    expect(d2.entradas?.ajustes).toEqual([{ codigo: '001', importe: 50000, motivo: 'previo' }])
  })

  it('un importe escrito en una columna de concepto es un ajuste de ese código (presentismo incluido)', async () => {
    const wb = await libro()
    const ws = wb.worksheets[0]
    ws.getCell(`AD${r1}`).value = 43200
    recalcularFila(ws, U1, { 'celda:AD': 43200 })
    ws.getCell(`${COL_FINAL.motivo}${r1}`).value = 'Corresponde el presentismo'
    const d1 = diferenciasFinalMensual(await releer(wb), base, armar, guardados).diferencias.find(d => d.finalId === F1)!
    expect(d1.errores).toEqual([])
    expect(d1.entradas?.ajustes).toEqual([{ codigo: '204', cantidad: null, importe: 43200, motivo: 'Corresponde el presentismo' }])
    expect(d1.entradas?.ordinarios).toBeUndefined()
  })

  it('sin motivo, en una baja sin usuario o con un parámetro cambiado: no se aplica y se avisa', async () => {
    const wb = await libro()
    const ws = wb.worksheets[0]
    ws.getCell(`${COL_FINAL.c208}${r1}`).value = 1000
    ws.getCell(`G${r2}`).value = 3
    ws.getCell('B1').value = 999
    const { diferencias, avisos } = diferenciasFinalMensual(await releer(wb), base, armar, guardados)
    const d1 = diferencias.find(d => d.finalId === F1)!
    expect(d1.entradas).toBeNull()
    expect(d1.errores.join(' ')).toMatch(/Falta el MOTIVO/)
    const d2 = diferencias.find(d => d.finalId === F2)!
    expect(d2.entradas).toBeNull()
    expect(d2.errores.join(' ')).toMatch(/no tiene usuario/)
    expect(avisos.join(' ')).toMatch(/B1 cambió/)
  })

  it('un Excel bajado antes de un cambio en el borrador no se aplica', async () => {
    const wb = await libro()
    wb.worksheets[0].getCell(`${COL_FINAL.periodo}${r1}`).value = 'Liq. Final OCTUBRE 2026'
    const nuevos = new Map(guardados); nuevos.set(F1, { ...guardados.get(F1)!, version: 4 })
    const d1 = diferenciasFinalMensual(await releer(wb), base, armar, nuevos).diferencias.find(d => d.finalId === F1)!
    expect(d1.entradas).toBeNull()
    expect(d1.errores[0]).toMatch(/cambió después de bajar el Excel/)
  })

  it('no confunde el formato de una hoja por persona', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('PEREZ'); ws.getCell('J1').value = F1
    expect(leerHojaFinalMensual(ws)).toBeNull()
  })
})
