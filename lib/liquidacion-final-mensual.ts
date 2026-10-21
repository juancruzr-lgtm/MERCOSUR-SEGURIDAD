// lib/liquidacion-final-mensual.ts
//
// Liquidaciones finales en el FORMATO DEL EXCEL DE TRABAJO MENSUAL (pedido de JC
// 21/10: «que me exporte el Excel como yo lo uso, como el Excel de trabajo y al
// final las columnas de la liquidación»).
//
// Cada persona de baja es una fila de la planilla mensual (mismas columnas,
// fórmulas y parámetros arriba), armada con el recorte de la baja: jornadas
// efectivamente trabajadas del mes y novedades cortadas en la fecha efectiva.
// A la derecha (desde BI) van las columnas de la liquidación final: vacaciones,
// días del SAC, 120003, 208, 217, 212 de extras, total a Visual, período de
// Visual, motivo y pendientes. Una solapa por mes de baja.
//
// Al volver a subirlo se lee igual que el mensual (mismas funciones de
// excel-trabajo-reimport) y cada cambio se traduce a la liquidación final:
//   · días/horas/feriados/novedades (G, I-P, AG, AH) y H/AL pisadas → correcciones
//     de la fila (entradas.ordinarios), que recalculan los conceptos del mes;
//   · un importe escrito en una columna de concepto (AC…AX) → ajuste de ese código;
//   · vacaciones (BK/BL) y período (BV) → como en la pantalla;
//   · 120003/208/217/212 escritos a mano (en vez de la fórmula) → ajuste;
//   · legajo de Visual (A) → se guarda en el usuario.
// Todo cambio de importes o de la fila exige MOTIVO (BW). Nada se aplica sobre
// una versión vieja del borrador.

import type { CeldaPlantilla, ColumnaPlantilla, PlantillaLiquidacion } from '@/lib/resumen-guardia'
import { COLUMNAS_ORDINARIAS, redondear, type AjusteManual, type EntradasFinal } from '@/lib/liquidacion-final'
import { compararCeldasEditadas, compararReimport, type CeldaVisual } from '@/lib/excel-trabajo-reimport'

/** Columnas de la liquidación final (a la derecha de la planilla mensual). */
export const COL_FINAL = {
  fechaBaja: 'BI', causa: 'BJ', vacSaldo: 'BK', vacTomadas: 'BL', noGozadas: 'BM', diasSAC: 'BN',
  c120003: 'BO', c208: 'BP', c217: 'BQ', hsExtra: 'BR', extrasPagadas: 'BS', c212: 'BT', total: 'BU',
  periodo: 'BV', motivo: 'BW', avisos: 'BX', finalId: 'BY', version: 'BZ',
} as const

/** Encabezado técnico de la columna con el id de la final: marca el formato. */
export const MARCA_FINAL_ID = 'final_id'
/** Prefijo de la identidad (BD) de una baja sin usuario en la app. */
export const SIN_USUARIO = 'baja:'

const CONCEPTOS_FINAL = [
  { codigo: '120003', col: COL_FINAL.c120003 },
  { codigo: '208', col: COL_FINAL.c208 },
  { codigo: '217', col: COL_FINAL.c217 },
  { codigo: '212', col: COL_FINAL.c212 },
] as const
type CodigoFinal = typeof CONCEPTOS_FINAL[number]['codigo']

/** Variables de la fila que corrigen la liquidación final (las demás se cambian en el mensual). */
const CLAVES_FILA = new Set(['jornadas', 'horas_liquidables', 'horas_nocturnas', 'feriados', 'licencias', 'art', 'vacaciones',
  'parte_medico', 'aus_susp', 'horas_rec', 'adicional_hs'])
/** Celdas calculadas que, pisadas, corrigen la fila (no son un concepto de Visual). */
const CELDAS_FILA = new Set(['celda:H', 'celda:AL'])

const TOL = 0.005
const COLUMNAS_TOTAL = ['AC', 'AD', 'AE', 'AF', 'AI', 'AJ', 'AT', 'AU', 'AV', 'AW', 'AX']

/** Lo que la fila de una persona muestra de su liquidación final guardada. */
export interface FilaFinalMensual {
  finalId: string
  version: number
  /** Identidad de la fila (BD): usuario_id, o «baja:<id>» si no tiene usuario. */
  usuarioId: string
  fechaBaja: string | null
  causa: string | null
  vacSaldo: number | null
  vacTomadas: number | null
  diasSAC: number | null
  sueldoFijo: boolean
  extrasPagadas: number
  /** Totales de las líneas de 120003/208/217/212 que hoy tienen un ajuste manual (0 = quitada). */
  ajustados: Partial<Record<CodigoFinal, number>>
  totalApp: number
  visualPeriodo: string | null
  avisos: string[]
}

/** Código de Visual de cada columna de concepto de la fila (según el encabezado). */
export function codigosDeColumnas(plantilla: PlantillaLiquidacion): Map<string, string> {
  const enc = plantilla.estilos.encabezado
  const porRef = new Map(plantilla.celdas.map(c => [c.ref, c.v]))
  const out = new Map<string, string>()
  for (const c of COLUMNAS_ORDINARIAS) {
    const cod = String(porRef.get(`${c.col}${enc}`) ?? '').trim()
    if (cod) out.set(c.col, cod)
  }
  return out
}

/**
 * Correcciones SÓLO de presentación para que la fila muestre lo que liquida la
 * final: un concepto con ajuste manual muestra el ajuste, y el presentismo en
 * cero por la causal (renuncia que no completa el mes) se ve en cero. No se
 * guardan: se rearman igual al volver a subir el archivo.
 */
export function correccionesDeVista(
  colsPorCodigo: Map<string, string>,
  ajustes: { codigo: string; total: number }[],
  presentismo: { calculado: number | null; aplicado: number | null } | null,
): Record<string, number> {
  const out: Record<string, number> = {}
  const colDe = new Map(Array.from(colsPorCodigo.entries()).map(([col, cod]) => [cod, col]))
  if (presentismo && (presentismo.calculado ?? 0) > 0 && presentismo.aplicado === 0 && colDe.get('204')) out[`celda:${colDe.get('204')}`] = 0
  for (const a of ajustes) {
    const col = colDe.get(a.codigo)
    if (col) out[`celda:${col}`] = a.total
  }
  return out
}

const COLUMNAS_FINAL: ColumnaPlantilla[] = [
  { col: COL_FINAL.fechaBaja, width: 11, numFmt: 'text' }, { col: COL_FINAL.causa, width: 22, numFmt: 'text' },
  { col: COL_FINAL.vacSaldo, width: 9 }, { col: COL_FINAL.vacTomadas, width: 9 }, { col: COL_FINAL.noGozadas, width: 9 },
  { col: COL_FINAL.diasSAC, width: 8 }, { col: COL_FINAL.c120003, width: 13, numFmt: 'money' }, { col: COL_FINAL.c208, width: 13, numFmt: 'money' },
  { col: COL_FINAL.c217, width: 12, numFmt: 'money' }, { col: COL_FINAL.hsExtra, width: 8, numFmt: 'hours' },
  { col: COL_FINAL.extrasPagadas, width: 12, numFmt: 'money' }, { col: COL_FINAL.c212, width: 12, numFmt: 'money' },
  { col: COL_FINAL.total, width: 14, numFmt: 'money' }, { col: COL_FINAL.periodo, width: 26, numFmt: 'text' },
  { col: COL_FINAL.motivo, width: 34, numFmt: 'text' }, { col: COL_FINAL.avisos, width: 60, numFmt: 'text' },
  { col: COL_FINAL.finalId, width: 38, hidden: true, numFmt: 'text' }, { col: COL_FINAL.version, width: 6, hidden: true },
]

const fechaTexto = (iso: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '')

/**
 * Agrega a la planilla (ya armada con las filas de baja) las columnas de la
 * liquidación final. Las de 120003/208/217/212 llevan la fórmula (con su
 * resultado) salvo que tengan un ajuste manual: ahí va el importe del ajuste.
 */
export function anexarColumnasFinal(plantilla: PlantillaLiquidacion, filas: Map<string, FilaFinalMensual>): PlantillaLiquidacion {
  const porRef = new Map(plantilla.celdas.map(c => [c.ref, c.v]))
  const num = (ref: string) => { const v = Number(porRef.get(ref) ?? 0); return Number.isFinite(v) ? v : 0 }
  const B1 = num('B1'), C3 = num('C3'), AP6 = num('AP6')
  const celdas: CeldaPlantilla[] = [...plantilla.celdas]
  const put = (ref: string, v?: string | number, f?: string) => celdas.push(f !== undefined ? { ref, v, f } : { ref, v })
  const enc = plantilla.estilos.encabezado

  put(`${COL_FINAL.fechaBaja}${enc - 1}`, 'LIQUIDACIÓN FINAL →')
  put(`${COL_FINAL.vacSaldo}${enc - 1}`, 'editable')
  put(`${COL_FINAL.vacTomadas}${enc - 1}`, 'editable')
  put(`${COL_FINAL.periodo}${enc - 1}`, 'editable')
  put(`${COL_FINAL.motivo}${enc - 1}`, 'obligatorio si cambiás importes o la fila')
  const titulos: [string, string][] = [
    [COL_FINAL.fechaBaja, 'FECHA BAJA'], [COL_FINAL.causa, 'CAUSA'], [COL_FINAL.vacSaldo, 'VAC. SALDO'],
    [COL_FINAL.vacTomadas, 'VAC. TOMADAS'], [COL_FINAL.noGozadas, 'VAC. NO GOZADAS'], [COL_FINAL.diasSAC, 'DÍAS SAC'],
    [COL_FINAL.c120003, '120003 SAC PROP.'], [COL_FINAL.c208, '208 VAC. NO GOZ.'], [COL_FINAL.c217, '217 SAC VAC.'],
    [COL_FINAL.hsExtra, 'HS EXTRA'], [COL_FINAL.extrasPagadas, 'EXTRAS PAGADAS'], [COL_FINAL.c212, '212 EXTRAS'],
    [COL_FINAL.total, 'TOTAL A VISUAL'], [COL_FINAL.periodo, 'PERÍODO VISUAL'], [COL_FINAL.motivo, 'MOTIVO DE LOS CAMBIOS'],
    [COL_FINAL.avisos, 'PENDIENTES / AVISOS'], [COL_FINAL.finalId, MARCA_FINAL_ID], [COL_FINAL.version, 'version'],
  ]
  for (const [col, t] of titulos) put(`${col}${enc}`, t)

  for (const r of plantilla.estilos.filasDatos) {
    const uid = String(porRef.get(`BD${r}`) ?? '')
    const f = filas.get(uid)
    if (!f) continue
    const avisos = [...f.avisos]
    put(`${COL_FINAL.fechaBaja}${r}`, fechaTexto(f.fechaBaja))
    put(`${COL_FINAL.causa}${r}`, f.causa ?? '')
    if (f.vacSaldo != null) put(`${COL_FINAL.vacSaldo}${r}`, f.vacSaldo)
    if (f.vacTomadas != null) put(`${COL_FINAL.vacTomadas}${r}`, f.vacTomadas)
    const noGoz = f.vacSaldo != null && f.vacTomadas != null ? redondear(f.vacSaldo - f.vacTomadas, 4) : null
    put(`${COL_FINAL.noGozadas}${r}`, noGoz ?? '', `IF(OR(${COL_FINAL.vacSaldo}${r}="",${COL_FINAL.vacTomadas}${r}=""),"",${COL_FINAL.vacSaldo}${r}-${COL_FINAL.vacTomadas}${r})`)
    if (f.diasSAC != null) put(`${COL_FINAL.diasSAC}${r}`, f.diasSAC)

    const valores: Record<CodigoFinal, number> = { '120003': 0, '208': 0, '217': 0, '212': 0 }
    const horas = f.sueldoFijo ? 0 : num(`AL${r}`)
    const formulas: Record<CodigoFinal, { f: string; v: number } | null> = f.sueldoFijo
      ? { '120003': null, '208': null, '217': null, '212': null }
      : {
          '120003': { f: `IF(${COL_FINAL.diasSAC}${r}="",0,ROUND(($B$1/200*150)/365*${COL_FINAL.diasSAC}${r},2))`, v: f.diasSAC != null ? redondear((B1 / 200 * 150) / 365 * f.diasSAC) : 0 },
          '208': { f: `IF(${COL_FINAL.noGozadas}${r}="",0,ROUND(${COL_FINAL.noGozadas}${r}*$C$3,2))`, v: noGoz != null && noGoz > 0 ? redondear(noGoz * C3) : 0 },
          '217': { f: `IF(${COL_FINAL.noGozadas}${r}="",0,ROUND($B$1/365*${COL_FINAL.noGozadas}${r},2))`, v: noGoz != null && noGoz > 0 ? redondear(B1 / 365 * noGoz) : 0 },
          '212': { f: `ROUND(MAX(0,${COL_FINAL.hsExtra}${r}*$AP$6-${COL_FINAL.extrasPagadas}${r}),2)`, v: redondear(Math.max(0, horas * AP6 - f.extrasPagadas)) },
        }
    put(`${COL_FINAL.hsExtra}${r}`, horas, f.sueldoFijo ? undefined : `AL${r}`)
    put(`${COL_FINAL.extrasPagadas}${r}`, f.extrasPagadas)
    for (const c of CONCEPTOS_FINAL) {
      const aj = f.ajustados[c.codigo]
      const fx = formulas[c.codigo]
      if (aj != null) { valores[c.codigo] = aj; put(`${c.col}${r}`, aj); avisos.push(`${c.codigo} con ajuste manual: ${aj}.`) }
      else if (fx) { valores[c.codigo] = fx.v; put(`${c.col}${r}`, fx.v, fx.f) }
    }
    const suma = redondear(COLUMNAS_TOTAL.reduce((s, col) => s + num(`${col}${r}`), 0) + Object.values(valores).reduce((s, v) => s + v, 0))
    if (Math.abs(suma - f.totalApp) < 0.01) {
      put(`${COL_FINAL.total}${r}`, f.totalApp, [...COLUMNAS_TOTAL.map(c => `${c}${r}`), ...CONCEPTOS_FINAL.map(c => `${c.col}${r}`)].join('+'))
    } else {
      put(`${COL_FINAL.total}${r}`, f.totalApp)
      avisos.push(`El total a Visual (${f.totalApp}) no es la suma de la fila (${suma}): hay importes ya liquidados en el mes, ajustes o conceptos pendientes. Ver la liquidación en la app.`)
    }
    if (f.visualPeriodo) put(`${COL_FINAL.periodo}${r}`, f.visualPeriodo)
    if (avisos.length) put(`${COL_FINAL.avisos}${r}`, avisos.join(' · '))
    put(`${COL_FINAL.finalId}${r}`, f.finalId)
    put(`${COL_FINAL.version}${r}`, f.version)
  }
  // Totales de la liquidación final en la fila TOTAL GENERAL.
  const t = plantilla.estilos.total
  for (const col of [COL_FINAL.c120003, COL_FINAL.c208, COL_FINAL.c217, COL_FINAL.c212, COL_FINAL.total]) {
    const v = celdas.filter(c => plantilla.estilos.filasDatos.some(r => c.ref === `${col}${r}`)).reduce((s, c) => s + (Number(c.v) || 0), 0)
    put(`${col}${t}`, redondear(v), `SUM(${col}${enc + 1}:${col}${t - 1})`)
  }
  const ultima = plantilla.ref.split(':')[1].replace(/\d+$/, '')
  return {
    ...plantilla,
    ref: `A1:${NUMERO(ultima) > NUMERO(COL_FINAL.version) ? ultima : COL_FINAL.version}${t}`,
    celdas,
    columnas: [...plantilla.columnas.filter(c => !COLUMNAS_FINAL.some(x => x.col === c.col)), ...COLUMNAS_FINAL],
  }
}

// ── Lectura del archivo devuelto ─────────────────────────────────────────────

const LETRA = (n: number): string => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) } return s }
const NUMERO = (col: string): number => { let n = 0; for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64); return n }

const valorCelda = (v: unknown): CeldaVisual => {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    const o = v as any
    // exceljs no conserva el resultado 0 de una fórmula al leer: sin resultado = 0 (Excel lo guarda así).
    if ('result' in o || 'formula' in o || 'sharedFormula' in o) return o.result === undefined ? 0 : valorCelda(o.result)
    if ('richText' in o) return (o.richText as { text: string }[]).map(t => t.text).join('')
    if ('text' in o) return String(o.text)
    if ('error' in o) return null
    return null
  }
  return v as CeldaVisual
}
const esFormula = (v: unknown) => typeof v === 'object' && v !== null && ('formula' in (v as any) || 'sharedFormula' in (v as any))
const numero = (v: CeldaVisual): number | null => {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const t = String(v).trim()
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : null
}
const texto = (v: CeldaVisual): string | null => { const t = String(v ?? '').trim(); return t || null }

export interface FilaLeida {
  fila: number
  finalId: string
  version: number
  usuarioId: string
  vacSaldo: number | null
  vacTomadas: number | null
  noGozadas: number | null
  periodo: string | null
  motivo: string | null
  conceptos: Record<CodigoFinal, { valor: number | null; formula: boolean }>
}

export interface HojaFinalMensual {
  nombre: string
  /** Grilla 0-based con los valores (resultado de las fórmulas), como la lee el reimport mensual. */
  grid: CeldaVisual[][]
  filas: FilaLeida[]
}

/** Lee una hoja de exceljs. null = no es una hoja de liquidaciones finales en formato mensual. */
export function leerHojaFinalMensual(ws: any): HojaFinalMensual | null {
  let enc = 0
  for (let r = 1; r <= 12 && !enc; r++) if (String(valorCelda(ws.getCell(`${COL_FINAL.finalId}${r}`).value) ?? '').trim() === MARCA_FINAL_ID) enc = r
  if (!enc) return null
  const ultimaCol = NUMERO(COL_FINAL.version)
  const grid: CeldaVisual[][] = []
  const filas: FilaLeida[] = []
  const filasHoja = Math.max(ws.rowCount ?? 0, ws.actualRowCount ?? 0)
  for (let r = 1; r <= filasHoja; r++) {
    const fila: CeldaVisual[] = []
    for (let c = 1; c <= ultimaCol; c++) fila.push(valorCelda(ws.getCell(r, c).value))
    grid.push(fila)
    if (r <= enc) continue
    const finalId = texto(fila[NUMERO(COL_FINAL.finalId) - 1])
    if (!finalId || !/^[0-9a-f-]{36}$/i.test(finalId)) continue
    const en = (col: string) => fila[NUMERO(col) - 1]
    const conceptos = {} as FilaLeida['conceptos']
    for (const c of CONCEPTOS_FINAL) conceptos[c.codigo] = { valor: numero(en(c.col)), formula: esFormula(ws.getCell(`${c.col}${r}`).value) }
    filas.push({
      fila: r, finalId, version: numero(en(COL_FINAL.version)) ?? -1, usuarioId: String(en('BD') ?? '').trim(),
      vacSaldo: numero(en(COL_FINAL.vacSaldo)), vacTomadas: numero(en(COL_FINAL.vacTomadas)), noGozadas: numero(en(COL_FINAL.noGozadas)),
      periodo: texto(en(COL_FINAL.periodo)), motivo: texto(en(COL_FINAL.motivo)), conceptos,
    })
  }
  return { nombre: ws.name, grid, filas }
}

/** Lo guardado de cada final que aparece en la hoja (para comparar). */
export interface GuardadoFinal {
  finalId: string
  version: number
  estado: string
  persona: string
  conUsuario: boolean
  entradas: EntradasFinal
  vacaciones: { saldo: number | null; tomadas: number | null }
  visualPeriodo: string | null
  /** Lo que la hoja mostró en 120003/208/217/212 al bajarla. */
  mostrado: Record<CodigoFinal, number | null>
}

export interface DiferenciaMensual {
  hoja: string
  finalId: string
  version: number
  persona: string
  cambios: string[]
  errores: string[]
  /** Entradas a guardar (null = nada que guardar en la final). */
  entradas: EntradasFinal | null
  /** Legajo de Visual escrito en la columna A (se guarda en el usuario). */
  legajoVisual: { usuarioId: string; valor: string } | null
}

const ETIQUETA_CLAVE: Record<string, string> = {
  jornadas: 'jornadas (G)', horas_liquidables: 'horas liquidables (I)', horas_nocturnas: 'horas nocturnas (J)', feriados: 'feriados (K)',
  licencias: 'licencias (L)', art: 'ART (M)', vacaciones: 'vacaciones (N)', parte_medico: 'parte médico (O)', aus_susp: 'aus/susp (P)',
  horas_rec: 'horas rec (AG)', adicional_hs: 'adicional hs (AH)', 'celda:H': 'días tope 25 (H)', 'celda:AL': 'hs extras (AL)',
}

/**
 * Compara la hoja devuelta con lo que se bajó y arma, por persona, lo que se
 * guarda en la liquidación final. Puro: `base` es la planilla tal como se bajó y
 * `armar(extra)` la rearma con correcciones adicionales por fila (usuario).
 */
export function diferenciasFinalMensual(
  hoja: HojaFinalMensual,
  base: PlantillaLiquidacion,
  armar: (extra: Map<string, Record<string, number | null>>) => PlantillaLiquidacion,
  guardados: Map<string, GuardadoFinal>,
): { diferencias: DiferenciaMensual[]; avisos: string[] } {
  const avisos: string[] = []
  // Parámetros del mes: se cambian en el Excel mensual, no acá.
  const baseRef = new Map(base.celdas.map(c => [c.ref, c.v]))
  for (const ref of ['B1', 'B2', 'B3', 'B4', 'C2', 'C3', 'AP6']) {
    const m = ref.match(/^([A-Z]+)(\d+)$/)!
    const arch = numero(hoja.grid[Number(m[2]) - 1]?.[NUMERO(m[1]) - 1])
    const esp = numero(baseRef.get(ref) as any)
    if (arch != null && esp != null && Math.abs(arch - esp) >= TOL) avisos.push(`${hoja.nombre}: el parámetro ${ref} cambió (${esp} → ${arch}) y no se usa acá: los parámetros del mes se cambian en el Excel de trabajo mensual.`)
  }

  const comp = compararReimport(base, hoja.grid)
  const porUsuario = new Map<string, { variables: typeof comp.diffs; legajo: string | null; otrosId: string[] }>()
  const de = (uid: string) => { let x = porUsuario.get(uid); if (!x) { x = { variables: [], legajo: null, otrosId: [] }; porUsuario.set(uid, x) } return x }
  for (const d of comp.diffs) if (d.usuarioId) de(d.usuarioId).variables.push(d)
  for (const i of comp.identidad) {
    if (i.campo === 'legajo_visual') de(i.usuarioId).legajo = i.excel
    else de(i.usuarioId).otrosId.push(i.etiqueta)
  }
  // Variables de la fila tal como vinieron: con ellas se rearma la planilla para
  // detectar los importes escritos a mano (igual que el reimport mensual).
  const variablesArchivo = new Map<string, Record<string, number | null>>()
  for (const [uid, x] of Array.from(porUsuario.entries())) {
    const m: Record<string, number | null> = {}
    for (const v of x.variables) m[v.clave] = v.excel
    if (Object.keys(m).length) variablesArchivo.set(uid, m)
  }
  const celdas = compararCeldasEditadas(manuales => {
    const unidos = new Map(variablesArchivo)
    for (const [uid, m] of Array.from(manuales.entries())) unidos.set(uid, { ...(unidos.get(uid) ?? {}), ...m })
    return armar(unidos)
  }, hoja.grid)
  const codigos = codigosDeColumnas(base)

  const diferencias: DiferenciaMensual[] = []
  for (const l of hoja.filas) {
    const g = guardados.get(l.finalId)
    const cambios: string[] = []
    const errores: string[] = []
    const baseDif = { hoja: hoja.nombre, finalId: l.finalId, version: l.version, persona: g?.persona ?? l.usuarioId }
    if (!g) { diferencias.push({ ...baseDif, cambios, errores: ['No se encontró esa liquidación final (¿anulada?).'], entradas: null, legajoVisual: null }); continue }
    if (!['pendiente_calculo', 'borrador', 'lista'].includes(g.estado)) {
      diferencias.push({ ...baseDif, cambios, errores: [`Ya está ${g.estado}: no se modifica.`], entradas: null, legajoVisual: null }); continue
    }
    const entradas: EntradasFinal = { ...g.entradas, ajustes: [...(g.entradas.ajustes ?? [])] }
    const ordinarios: Record<string, number | null> = { ...(g.entradas.ordinarios ?? {}) }
    let tocaFila = false
    const nuevosAjustes: AjusteManual[] = []
    const uid = l.usuarioId
    const x = porUsuario.get(uid)

    // Variables de la fila (días, horas, feriados, novedades).
    for (const v of x?.variables ?? []) {
      if (!CLAVES_FILA.has(v.clave)) { errores.push(`${v.etiqueta}: no se usa en la liquidación final (se cambia en el Excel mensual). Dejalo como estaba.`); continue }
      if (!g.conUsuario) { errores.push(`${v.etiqueta}: la persona no tiene usuario en la app; cargá el importe directamente en la columna del concepto.`); continue }
      ordinarios[v.clave] = v.excel; tocaFila = true
      cambios.push(`${ETIQUETA_CLAVE[v.clave] ?? v.etiqueta}: ${v.mercosur ?? '—'} → ${v.excel ?? 'vacío'}.`)
    }
    for (const etq of x?.otrosId ?? []) errores.push(`${etq}: se corrige en el legajo de la persona, no en este Excel.`)

    // Importes escritos a mano en la fila.
    for (const c of celdas.filter(c => c.usuarioId === uid && c.tipo === 'numero')) {
      const col = c.clave.replace('celda:', '')
      if (CELDAS_FILA.has(c.clave)) {
        if (!g.conUsuario) { errores.push(`${c.etiqueta}: la persona no tiene usuario en la app.`); continue }
        ordinarios[c.clave] = c.excel as number; tocaFila = true
        cambios.push(`${ETIQUETA_CLAVE[c.clave] ?? c.etiqueta}: ${c.mercosur ?? '—'} → ${c.excel}.`)
      } else if (codigos.has(col)) {
        const codigo = codigos.get(col)!
        nuevosAjustes.push({ codigo, cantidad: null, importe: Number(c.excel ?? 0), motivo: '' })
        cambios.push(`${codigo} (${col}): ${c.mercosur ?? '—'} → ${c.excel}.`)
      } else {
        errores.push(`${c.etiqueta} (${col}): es una fórmula o una columna informativa; no se usa en la liquidación final. Dejala como estaba.`)
      }
    }

    // Vacaciones y período de Visual.
    if (l.vacSaldo !== g.vacaciones.saldo || l.vacTomadas !== g.vacaciones.tomadas) {
      if (l.vacSaldo == null || l.vacTomadas == null) {
        if (l.vacSaldo != null || l.vacTomadas != null) errores.push('Vacaciones: completá las dos columnas (saldo y tomadas); vacías no se asumen cero.')
      } else {
        entradas.vacaciones = { saldoDias: l.vacSaldo, tomadasDias: l.vacTomadas, nota: 'cargadas en el Excel de trabajo' }
        cambios.push(`Vacaciones: saldo ${l.vacSaldo}, tomadas ${l.vacTomadas}.`)
      }
    }
    if (l.periodo && l.periodo !== (g.visualPeriodo ?? null)) { entradas.visualPeriodo = l.periodo; cambios.push(`Período de Visual: «${l.periodo}».`) }

    // 120003 / 208 / 217 / 212 escritos a mano (en lugar de la fórmula).
    for (const c of CONCEPTOS_FINAL) {
      const leido = l.conceptos[c.codigo]
      const antes = g.mostrado[c.codigo]
      if (leido.formula) continue
      const valor = leido.valor ?? 0
      if (antes != null && Math.abs(valor - antes) < TOL) continue
      if (c.codigo === '208') {
        const dias = l.noGozadas ?? (g.vacaciones.saldo != null && g.vacaciones.tomadas != null ? g.vacaciones.saldo - g.vacaciones.tomadas : null)
        if (dias && dias > 0) nuevosAjustes.push({ codigo: '208', cantidad: dias, importe: redondear(valor / dias), motivo: '' })
        else nuevosAjustes.push({ codigo: '208', cantidad: 1, importe: valor, motivo: '' })
      } else nuevosAjustes.push({ codigo: c.codigo, cantidad: null, importe: valor, motivo: '' })
      cambios.push(`${c.codigo}: ${antes ?? '—'} → ${valor} (importe escrito a mano).`)
    }

    const motivo = l.motivo
    if ((tocaFila || nuevosAjustes.length) && (!motivo || motivo.length < 3)) errores.push('Falta el MOTIVO DE LOS CAMBIOS (columna BW).')
    if (tocaFila) { entradas.ordinarios = ordinarios; entradas.ordinariosMotivo = motivo }
    for (const a of nuevosAjustes) {
      a.motivo = motivo ?? ''
      entradas.ajustes = [...(entradas.ajustes ?? []).filter(y => y.codigo !== a.codigo), a]
    }

    let legajoVisual: DiferenciaMensual['legajoVisual'] = null
    if (x?.legajo) {
      if (uid.startsWith(SIN_USUARIO)) errores.push('Legajo de Visual: la persona no tiene usuario en la app; cargalo en el padrón de Visual.')
      else { legajoVisual = { usuarioId: uid, valor: x.legajo }; cambios.push(`Legajo de Visual: ${x.legajo}.`) }
    }

    if (l.version !== g.version && (cambios.length || errores.length)) {
      diferencias.push({ ...baseDif, cambios, errores: [`El borrador cambió después de bajar el Excel (v${l.version} → v${g.version}). Bajalo de nuevo.`, ...errores], entradas: null, legajoVisual: null })
      continue
    }
    const hayEntradas = cambios.some(t => !t.startsWith('Legajo de Visual'))
    diferencias.push({ ...baseDif, cambios, errores, entradas: hayEntradas && !errores.length ? entradas : null, legajoVisual: errores.length ? null : legajoVisual })
  }
  return { diferencias, avisos }
}

export { LETRA as letraDeColumna }
