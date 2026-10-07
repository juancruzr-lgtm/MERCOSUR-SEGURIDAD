// lib/excel-trabajo-reimport.ts
//
// LIQ2B — Reimport del Excel de trabajo editado por Juan y comparación contra
// el baseline de MERCOSUR. PURO: no lee archivos ni red. Recibe (a) la
// PlantillaLiquidacion del mes (baseline = lo que MERCOSUR generó, ver
// lib/excel-trabajo-liquidacion) y (b) la grilla del archivo subido, y devuelve
// las DIFERENCIAS por (empleado, variable).
//
// Principio (directiva 5 de JC): distinguir DATO OPERATIVO ORIGINAL (lo que
// calculó MERCOSUR, inmutable) del VALOR DE LIQUIDACIÓN (lo que dejó Juan).
// Nunca convierte el valor de liquidación en fichajes/turnos. La identidad de
// la fila es el usuario_id oculto (col BD), con CUIL (col B) como control —
// jamás el nombre ni el número de fila.

import type { PlantillaLiquidacion } from '@/lib/resumen-guardia'

export type CeldaVisual = string | number | null | undefined

/** Variables editables del Excel de trabajo: las entradas que Juan ajusta. */
export interface VariableReimport {
  clave: string
  col: string      // letra de columna (informativa)
  idx: number      // índice 0-based en la grilla
  etiqueta: string
}

// Columnas de entrada del bloque de cálculo (no las fórmulas derivadas). Orden
// = el del archivo. idx 0-based: A=0, B=1, ... G=6, I=8, ... AH=33, AR=43.
export const VARIABLES_REIMPORT: VariableReimport[] = [
  { clave: 'jornadas', col: 'G', idx: 6, etiqueta: 'Jornadas' },
  { clave: 'horas_liquidables', col: 'I', idx: 8, etiqueta: 'Horas liquidables' },
  { clave: 'horas_nocturnas', col: 'J', idx: 9, etiqueta: 'Horas nocturnas' },
  { clave: 'feriados', col: 'K', idx: 10, etiqueta: 'Feriados' },
  { clave: 'licencias', col: 'L', idx: 11, etiqueta: 'Licencias' },
  { clave: 'art', col: 'M', idx: 12, etiqueta: 'ART' },
  { clave: 'vacaciones', col: 'N', idx: 13, etiqueta: 'Vacaciones' },
  { clave: 'parte_medico', col: 'O', idx: 14, etiqueta: 'Parte médico' },
  { clave: 'aus_susp', col: 'P', idx: 15, etiqueta: 'Aus/Susp' },
  // "Horas rec" (AG): horas reconocidas que se pagan en el 001. Por defecto es
  // fórmula, pero Juan la puede corregir a mano en el Excel y acá se captura para
  // que el 001 la refleje (va a liquidacion_ajuste como el resto de las variables).
  { clave: 'horas_rec', col: 'AG', idx: 32, etiqueta: 'Horas rec (001)' },
  { clave: 'adicional_hs', col: 'AH', idx: 33, etiqueta: 'Adicional (hs)' },
  { clave: 'adelantos', col: 'AR', idx: 43, etiqueta: 'Adelantos' },
  // SUELDO MENSUAL (grupo A). Se detecta como cualquier variable, pero al
  // confirmar NO va a liquidacion_ajuste: se guarda con VIGENCIA vía
  // set_sueldo_mensual (se arrastra a los meses siguientes). Sólo lleva valor en
  // las filas de mensualizados fijos; en el resto la celda va vacía → sin diff.
  { clave: 'sueldo_mensual', col: 'BF', idx: 57, etiqueta: 'SUELDO MENSUAL' },
  // EXTRA fija (concepto "extras" AP). Igual que SUELDO MENSUAL: al confirmar se
  // persiste con VIGENCIA vía set_extra_mensual (se arrastra al mes siguiente),
  // no a liquidacion_ajuste. Sólo en filas de sueldo fijo.
  { clave: 'extra_mensual', col: 'BG', idx: 58, etiqueta: 'EXTRA' },
]

/** Claves que se persisten con vigencia (legajo, no ajuste de mes). */
export const CLAVE_SUELDO_MENSUAL = 'sueldo_mensual'
export const CLAVE_EXTRA_MENSUAL = 'extra_mensual'
/** Claves de legajo con vigencia (arrastre): NO van a liquidacion_ajuste. */
export const CLAVES_LEGAJO_VIGENCIA = new Set([CLAVE_SUELDO_MENSUAL, CLAVE_EXTRA_MENSUAL])

const IDX_LEGAJO = 0   // A · LEGAJO VISUAL (COD_INTERNO)
const IDX_CUIL = 1     // B
const IDX_CUENTA = 2   // C · CUENTA bancaria
const IDX_NOMBRE = 3   // D
const IDX_BD = 55      // usuario_id oculto
const IDX_BE = 56      // periodo oculto
// Marca específica de Sindicato, anexada al FINAL del Excel (col BH, índice 59).
// Debe coincidir con la posición que usa anexarColumnaSindicato en
// lib/excel-trabajo-liquidacion.ts (hoy: después de EXTRA/BG).
const IDX_SINDICATO = 59
// "Marcado" = cualquier valor no vacío que no sea 0/no/false (X, SI, 1, etc.).
const marcado = (v: CeldaVisual): boolean => {
  const s = String(v ?? '').trim().toLowerCase()
  return s !== '' && s !== '0' && s !== 'no' && s !== 'false'
}

// La fila 6 del Excel es el ENCABEZADO: BD6 y BE6 llevan los rótulos literales de
// esas columnas ('usuario_id' y 'periodo'). No es un empleado. Se los excluye por
// su valor centinela para que NO entren como persona ni generen un registro
// fantasma. (Los usuario_id reales son uuid; nunca son estos literales.)
const BD_ENCABEZADO = 'usuario_id'
const BE_ENCABEZADO = 'periodo'
const esFilaEncabezado = (bd: string, be?: string): boolean =>
  bd === BD_ENCABEZADO || be === BE_ENCABEZADO
// Período válido del archivo: 'YYYY-MM'. Nunca el rótulo 'periodo' ni vacío.
const esPeriodoValido = (p?: string | null): p is string => /^\d{4}-\d{2}$/.test(String(p ?? ''))

const num = (v: CeldaVisual): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
const norm = (v: CeldaVisual): string => String(v ?? '').trim()
// Igualdad numérica tolerante (redondeos de Excel). null == null; null != número.
const igual = (a: number | null, b: number | null): boolean => {
  if (a === null && b === null) return true
  if (a === null || b === null) return false
  return Math.abs(a - b) < 0.005
}

export interface EmpleadoValores {
  usuarioId: string
  cuil: string | null
  nombre: string | null
  periodo: string | null
  // Identidad editable en el Excel (se guarda al reimportar): legajo/cuenta.
  legajo: string | null
  cuenta: string | null
  // Marca específica de Sindicato en el Excel (columna dedicada). true = afiliar.
  sindicato: boolean
  valores: Record<string, number | null>
}

/** Extrae el baseline (valores que MERCOSUR emitió) desde la plantilla. */
export function baselineDesdePlantilla(plantilla: PlantillaLiquidacion): Map<string, EmpleadoValores> {
  const porRef = new Map<string, string | number | undefined>()
  for (const c of plantilla.celdas) porRef.set(c.ref, c.v)
  const parseRef = (ref: string) => { const m = ref.match(/^([A-Z]+)(\d+)$/); return m ? { col: m[1], row: Number(m[2]) } : null }
  const colLetter = (idx: number): string => { let n = idx + 1, s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) } return s }

  const out = new Map<string, EmpleadoValores>()
  // Filas de empleado = las que tienen usuario_id en BD. La fila de encabezado
  // (BD='usuario_id') NO es empleado: se excluye para no crear un registro fantasma.
  for (const c of plantilla.celdas) {
    const p = parseRef(c.ref)
    if (!p || p.col !== 'BD') continue
    const usuarioId = norm(c.v as any)
    if (!usuarioId || esFilaEncabezado(usuarioId)) continue
    const r = p.row
    const valores: Record<string, number | null> = {}
    for (const v of VARIABLES_REIMPORT) valores[v.clave] = num(porRef.get(`${colLetter(v.idx)}${r}`) as any)
    out.set(usuarioId, {
      usuarioId,
      cuil: norm(porRef.get(`${colLetter(IDX_CUIL)}${r}`) as any) || null,
      nombre: norm(porRef.get(`${colLetter(IDX_NOMBRE)}${r}`) as any) || null,
      periodo: norm(porRef.get(`${colLetter(IDX_BE)}${r}`) as any) || null,
      legajo: norm(porRef.get(`${colLetter(IDX_LEGAJO)}${r}`) as any) || null,
      cuenta: norm(porRef.get(`${colLetter(IDX_CUENTA)}${r}`) as any) || null,
      sindicato: marcado(porRef.get(`${colLetter(IDX_SINDICATO)}${r}`) as any),
      valores,
    })
  }
  return out
}

/** Extrae los valores del archivo subido (grilla 0-based, valores efectivos). */
export function parseGridReimport(grid: CeldaVisual[][]): Map<string, EmpleadoValores> {
  const out = new Map<string, EmpleadoValores>()
  for (const fila of grid) {
    if (!fila) continue
    const usuarioId = norm(fila[IDX_BD])
    // Sin identidad → no es empleado. La fila de encabezado (BD='usuario_id',
    // BE='periodo') tampoco: se excluye para no crear un registro fantasma.
    if (!usuarioId || esFilaEncabezado(usuarioId, norm(fila[IDX_BE]))) continue
    const valores: Record<string, number | null> = {}
    for (const v of VARIABLES_REIMPORT) valores[v.clave] = num(fila[v.idx])
    out.set(usuarioId, {
      usuarioId,
      cuil: norm(fila[IDX_CUIL]) || null,
      nombre: norm(fila[IDX_NOMBRE]) || null,
      periodo: norm(fila[IDX_BE]) || null,
      legajo: norm(fila[IDX_LEGAJO]) || null,
      cuenta: norm(fila[IDX_CUENTA]) || null,
      sindicato: marcado(fila[IDX_SINDICATO]),
      valores,
    })
  }
  return out
}

export type EstadoDiff = 'ajuste' | 'sin_identidad' | 'empleado_no_en_padron'

export interface FilaDiff {
  usuarioId: string | null
  cuil: string | null
  nombre: string | null
  clave: string
  etiqueta: string
  mercosur: number | null   // DATO OPERATIVO ORIGINAL
  excel: number | null      // VALOR DE LIQUIDACIÓN
  diferencia: number | null
  estado: EstadoDiff
}

/** Cambio de IDENTIDAD (texto) editado en el Excel: legajo / CUIL / cuenta. */
export interface FilaIdentidadDiff {
  usuarioId: string
  nombre: string | null
  campo: 'legajo_visual' | 'cuil' | 'cuenta'
  etiqueta: string
  mercosur: string | null   // lo que tenía el usuario
  excel: string | null      // lo que dejó Juan en el Excel
}

export interface ResultadoComparacion {
  diffs: FilaDiff[]
  /** Cambios de identidad (legajo/CUIL/cuenta) a persistir en `usuarios`. */
  identidad: FilaIdentidadDiff[]
  /** usuario_id del archivo que no está en el padrón del período. */
  fueraDePadron: string[]
  /** filas del archivo sin usuario_id (no se pueden identificar). */
  sinIdentidad: number
  /** Filas de EMPLEADO reconocidas en el archivo (excluye encabezado/totales). */
  personasEnArchivo: number
  /** Período leído del archivo ('YYYY-MM'), sólo de filas de persona válidas. */
  periodoDelArchivo: string | null
}

/**
 * Compara el archivo subido contra el baseline. Devuelve una fila por cada
 * (empleado, variable) que cambió. No aplica nada: es el preview obligatorio.
 */
export function compararReimport(
  plantilla: PlantillaLiquidacion,
  grid: CeldaVisual[][],
): ResultadoComparacion {
  const baseline = baselineDesdePlantilla(plantilla)
  const subido = parseGridReimport(grid)
  const diffs: FilaDiff[] = []
  const identidad: FilaIdentidadDiff[] = []
  const fueraDePadron: string[] = []
  let periodoDelArchivo: string | null = null

  for (const [usuarioId, emp] of Array.from(subido.entries())) {
    // El período sale SÓLO de filas de persona con período válido 'YYYY-MM'
    // (nunca el rótulo 'periodo' del encabezado, ya excluido en el parse).
    if (!periodoDelArchivo && esPeriodoValido(emp.periodo)) periodoDelArchivo = emp.periodo
    const base = baseline.get(usuarioId)
    if (!base) { fueraDePadron.push(usuarioId); continue }
    for (const v of VARIABLES_REIMPORT) {
      const mercosur = base.valores[v.clave] ?? null
      const excel = emp.valores[v.clave] ?? null
      if (igual(mercosur, excel)) continue
      diffs.push({
        usuarioId, cuil: emp.cuil ?? base.cuil, nombre: emp.nombre ?? base.nombre,
        clave: v.clave, etiqueta: v.etiqueta, mercosur, excel,
        diferencia: (excel ?? 0) - (mercosur ?? 0), estado: 'ajuste',
      })
    }
    // IDENTIDAD (texto): sólo se registra cambio cuando el Excel trae un valor NO
    // vacío distinto del actual. Vacío = "no lo tocó" → nunca borra lo existente.
    const campos: Array<{ campo: FilaIdentidadDiff['campo']; etiqueta: string; base: string | null; excel: string | null }> = [
      { campo: 'legajo_visual', etiqueta: 'Legajo (COD_INTERNO)', base: base.legajo, excel: emp.legajo },
      { campo: 'cuil', etiqueta: 'CUIL', base: base.cuil, excel: emp.cuil },
      { campo: 'cuenta', etiqueta: 'Cuenta', base: base.cuenta, excel: emp.cuenta },
    ]
    for (const c of campos) {
      const nuevo = norm(c.excel)
      if (!nuevo) continue                       // vacío en el Excel → no se toca
      if (nuevo === norm(c.base)) continue       // sin cambio
      identidad.push({ usuarioId, nombre: emp.nombre ?? base.nombre, campo: c.campo, etiqueta: c.etiqueta, mercosur: c.base, excel: nuevo })
    }
  }
  // Filas sin identidad en el archivo (BD vacío) = no eran filas de empleado.
  let sinIdentidad = 0
  for (const fila of grid) if (fila && norm(fila[IDX_BD]) === '' && num(fila[6]) !== null) sinIdentidad++

  return { diffs, identidad, fueraDePadron, sinIdentidad, personasEnArchivo: subido.size, periodoDelArchivo }
}

// ── TODO lo editado en el Excel de trabajo se guarda (JC 07/10) ─────────────
// Además de las variables de entrada, el archivo puede traer: parámetros del mes
// (B1:B4, C2:C3, AP6), celdas CALCULADAS pisadas a mano (un importe escrito
// sobre la fórmula) y textos editados (NOMBRE, NOVEDADES, OBJETIVO/S,
// OBSERVACION). Todo eso se detecta acá y se guarda al confirmar. Lo que no se
// puede guardar (fila agregada sin identidad, total escrito a mano, celda fuera
// de la estructura…) NO se ignora en silencio: vuelve como advertencia.

/** Celdas calculadas que, si Juan las pisa a mano, se guardan como 'celda:<COL>'. */
export const COLUMNAS_CELDA: { col: string; etiqueta: string }[] = [
  { col: 'H', etiqueta: 'Días (tope 25)' },
  { col: 'AC', etiqueta: 'Viáticos (203)' }, { col: 'AD', etiqueta: 'Presentismo (204)' },
  { col: 'AE', etiqueta: 'No rem. (214)' }, { col: 'AF', etiqueta: 'Nocturnidad (004)' },
  { col: 'AI', etiqueta: 'Adicional (212)' }, { col: 'AJ', etiqueta: 'Horas rec $ (001)' },
  { col: 'AL', etiqueta: 'Hs extras' }, { col: 'AM', etiqueta: '% extras' }, { col: 'AN', etiqueta: 'Hs por día' },
  { col: 'AO', etiqueta: 'Total' }, { col: 'AP', etiqueta: 'Extras' }, { col: 'AS', etiqueta: 'Costo por hora' },
  { col: 'AT', etiqueta: 'Feriados (006)' }, { col: 'AU', etiqueta: 'Licencia (888)' }, { col: 'AV', etiqueta: 'ART (010)' },
  { col: 'AW', etiqueta: 'Vacaciones (205)' }, { col: 'AX', etiqueta: 'Parte médico (008)' },
  { col: 'AY', etiqueta: 'Supervisiones' }, { col: 'AZ', etiqueta: 'Horas supervisión' },
  { col: 'BA', etiqueta: 'Jornadas supervisión' }, { col: 'BC', etiqueta: 'Hs vigilancia zona' },
]
/** Textos editables que se guardan como 'texto:<COL>'. */
export const COLUMNAS_TEXTO: { col: string; etiqueta: string }[] = [
  { col: 'D', etiqueta: 'Nombre' }, { col: 'E', etiqueta: 'Novedades' },
  { col: 'F', etiqueta: 'Objetivo/s' }, { col: 'BB', etiqueta: 'Observación' },
]
// Columnas que se leen por otra vía (identidad, variables, legajo, técnicas) o
// que se recalculan: un valor ahí no es "fuera de estructura".
const COLS_CONOCIDAS = new Set([
  'A', 'B', 'C', 'G', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'AG', 'AH', 'AR', 'BD', 'BE', 'BF', 'BG', 'BH',
  ...COLUMNAS_CELDA.map(c => c.col), ...COLUMNAS_TEXTO.map(c => c.col),
])
// Columnas que se totalizan en subtotales/total (mismo criterio que la plantilla).
const COLS_TOTALES = ['G', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P',
  'AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AL', 'AO', 'AP',
  'AT', 'AU', 'AV', 'AW', 'AX', 'AY', 'AZ', 'BA']

const colANum = (col: string): number => { let n = 0; for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64); return n }
const numALetra = (n: number): string => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) } return s }
/** Valor de la grilla (0-based) en una referencia A1 de Excel. */
const enGrid = (grid: CeldaVisual[][], col: string, fila: number): CeldaVisual => grid[fila - 1]?.[colANum(col) - 1]
// Para celdas calculadas: vacío ≈ 0 (una celda sin emitir y un 0 son lo mismo).
const igualCalc = (a: number | null, b: number | null) => Math.abs((a ?? 0) - (b ?? 0)) < 0.005

export interface CambioParametro {
  clave: string
  etiqueta: string
  ref: string
  mercosur: number | null
  excel: number | null
}

export interface CambioCelda {
  usuarioId: string
  cuil: string | null
  nombre: string | null
  /** 'celda:AC' / 'texto:D' */
  clave: string
  etiqueta: string
  tipo: 'numero' | 'texto'
  mercosur: number | string | null
  excel: number | string | null
}

export type TipoAdvertencia =
  | 'fila_sin_identidad' | 'persona_ausente' | 'total_editado'
  | 'celda_fuera_de_estructura' | 'identidad_vaciada' | 'sindicato_desmarcado'

export interface AdvertenciaReimport { tipo: TipoAdvertencia; detalle: string }

/**
 * Parámetros del mes que dejó Juan en el archivo vs los de la plantilla base.
 * Hora (C2) y día (C3) cuentan como cambio SÓLO si se escribieron a mano: si
 * siguen siendo básico/200 y hora×8 (aunque el básico haya cambiado), no.
 */
export function compararParametros(
  base: PlantillaLiquidacion,
  grid: CeldaVisual[][],
  definiciones: { clave: string; ref: string; etiqueta: string }[],
): CambioParametro[] {
  const celda = new Map(base.celdas.map(c => [c.ref, c]))
  const baseNum = (ref: string) => num(celda.get(ref)?.v as any)
  const archNum = (ref: string) => { const m = ref.match(/^([A-Z]+)(\d+)$/)!; return num(enGrid(grid, m[1], Number(m[2]))) }
  const out: CambioParametro[] = []
  const b1 = archNum('B1'), c2 = archNum('C2')
  for (const d of definiciones) {
    let mercosur: number | null, excel: number | null
    if (d.clave === 'hora' || d.clave === 'dia') {
      // Valor "manual" = el que no sale de la fórmula. Base: manual si la celda no
      // trae fórmula. Archivo: manual si difiere de lo que daría la fórmula.
      mercosur = celda.get(d.ref)?.f === undefined ? baseNum(d.ref) : null
      const v = archNum(d.ref)
      const formula = d.clave === 'hora' ? (b1 == null ? null : b1 / 200) : (c2 == null ? null : c2 * 8)
      excel = v != null && formula != null && !igual(v, formula) ? v : null
    } else {
      mercosur = baseNum(d.ref)
      excel = archNum(d.ref)
      if (excel == null) continue   // vacío = no lo tocó: se conserva el guardado
    }
    if (!igual(mercosur, excel)) out.push({ clave: d.clave, etiqueta: d.etiqueta, ref: d.ref, mercosur, excel })
  }
  return out
}

/**
 * Orden de dependencia de las celdas calculadas de una fila (como recalcula
 * Excel): un valor escrito a mano en un nivel cambia los niveles siguientes,
 * que NO deben confundirse con ediciones manuales.
 */
const NIVELES_CELDA: string[][] = [
  ['H'],
  ['AC', 'AD', 'AE', 'AF', 'AI', 'AJ', 'AL', 'AT', 'AU', 'AV', 'AW', 'AX', 'AY', 'AZ', 'BA', 'BC'],
  ['AM', 'AN', 'AP'],
  ['AO'],
  ['AS'],
]

/**
 * Celdas calculadas pisadas a mano y textos editados. `armar(manuales)` devuelve
 * la planilla con los parámetros y las variables DEL ARCHIVO más los valores
 * manuales ya detectados: lo que daría cada fórmula con lo que Juan dejó. Se
 * recorre por niveles de dependencia: lo que difiere en un nivel (habiendo
 * aplicado los manuales de los anteriores) lo escribió Juan → se guarda.
 * Devuelve el conjunto COMPLETO de valores manuales del archivo (no sólo los
 * nuevos): quien confirma compara contra lo guardado.
 */
export function compararCeldasEditadas(
  armar: (manuales: Map<string, Record<string, number | null>>) => PlantillaLiquidacion,
  grid: CeldaVisual[][],
): CambioCelda[] {
  const etiqueta = new Map(COLUMNAS_CELDA.map(c => [c.col, c.etiqueta]))
  const manuales = new Map<string, Record<string, number | null>>()
  const out: CambioCelda[] = []
  const filasArchivo: { uid: string; r: number; cuil: string | null; nombre: string | null }[] = []
  grid.forEach((fila, i) => {
    const uid = norm(fila?.[IDX_BD])
    if (!uid || esFilaEncabezado(uid, norm(fila?.[IDX_BE]))) return
    filasArchivo.push({ uid, r: i + 1, cuil: norm(fila[IDX_CUIL]) || null, nombre: norm(fila[IDX_NOMBRE]) || null })
  })

  NIVELES_CELDA.forEach((nivel, k) => {
    const esperada = armar(manuales)
    const celda = new Map(esperada.celdas.map(c => [c.ref, c]))
    const filaEsperada = new Map<string, number>()
    for (const c of esperada.celdas) {
      const m = c.ref.match(/^BD(\d+)$/)
      if (m && !esFilaEncabezado(norm(c.v as any))) filaEsperada.set(norm(c.v as any), Number(m[1]))
    }
    for (const f of filasArchivo) {
      const re = filaEsperada.get(f.uid); if (re == null) continue
      for (const col of nivel) {
        const esp = num(celda.get(`${col}${re}`)?.v as any)
        const arch = num(enGrid(grid, col, f.r))
        if (igualCalc(esp, arch)) continue
        out.push({ usuarioId: f.uid, cuil: f.cuil, nombre: f.nombre, clave: `celda:${col}`, etiqueta: etiqueta.get(col) ?? col, tipo: 'numero', mercosur: esp, excel: arch ?? 0 })
        const m = manuales.get(f.uid) ?? {}
        m[`celda:${col}`] = arch ?? 0
        manuales.set(f.uid, m)
      }
      if (k > 0) continue
      for (const c of COLUMNAS_TEXTO) {
        const esp = norm(celda.get(`${c.col}${re}`)?.v as any)
        const arch = norm(enGrid(grid, c.col, f.r))
        if (esp === arch) continue
        out.push({ usuarioId: f.uid, cuil: f.cuil, nombre: f.nombre, clave: `texto:${c.col}`, etiqueta: c.etiqueta, tipo: 'texto', mercosur: esp || null, excel: arch })
      }
    }
  })
  return out
}

/**
 * Lo que el archivo trae y NO se puede guardar tal cual: se informa en vez de
 * ignorarse. `base` = plantilla del período (para personas e identidad).
 */
export function advertenciasReimport(
  base: PlantillaLiquidacion,
  grid: CeldaVisual[][],
  opts: { sindicatoBase?: Set<string> } = {},
): AdvertenciaReimport[] {
  const out: AdvertenciaReimport[] = []
  const baseline = baselineDesdePlantilla(base)
  const subido = parseGridReimport(grid)

  // 1) Filas con persona pero sin identidad (agregadas a mano en el Excel).
  grid.forEach((fila, i) => {
    if (!fila || i < 6) return
    const bd = norm(fila[IDX_BD])
    if (bd) return
    const cuil = norm(fila[IDX_CUIL]), nombre = norm(fila[IDX_NOMBRE])
    if (cuil || nombre) out.push({ tipo: 'fila_sin_identidad', detalle: `Fila ${i + 1}: ${nombre || '(sin nombre)'}${cuil ? ` · CUIL ${cuil}` : ''} no tiene identidad del sistema: no se puede guardar. Dala de alta en el padrón y regenerá el Excel.` })
  })

  // 2) Personas del período que no están en el archivo (fila borrada).
  for (const [uid, b] of Array.from(baseline.entries())) {
    if (!subido.has(uid)) out.push({ tipo: 'persona_ausente', detalle: `${b.nombre ?? uid}: no está en el archivo. Se mantiene en la liquidación con sus valores actuales (para excluirlo, usá el padrón del período).` })
  }

  // 3) Subtotales / total escritos a mano (no coinciden con la suma de sus filas).
  let desde = -1
  const sumas: Record<string, number>[] = []
  grid.forEach((fila, i) => {
    const a = norm(fila?.[0]).toUpperCase()
    if (a.startsWith('BLOQUE')) { desde = i; return }
    const esSub = a.startsWith('SUBTOTAL'), esTot = a.startsWith('TOTAL GENERAL')
    if (!esSub && !esTot) return
    const suma: Record<string, number> = {}
    if (esSub) {
      for (let k = desde + 1; k < i; k++) {
        if (!norm(grid[k]?.[IDX_BD])) continue
        for (const col of COLS_TOTALES) suma[col] = (suma[col] ?? 0) + (num(enGrid(grid, col, k + 1)) ?? 0)
      }
      sumas.push(suma)
    } else {
      for (const col of COLS_TOTALES) suma[col] = sumas.reduce((s, x) => s + (x[col] ?? 0), 0)
    }
    for (const col of COLS_TOTALES) {
      const v = num(enGrid(grid, col, i + 1))
      if (v == null) continue
      if (Math.abs(v - (suma[col] ?? 0)) > 0.01) out.push({ tipo: 'total_editado', detalle: `${col}${i + 1} (${norm(fila[0])}): ${v} no es la suma de sus filas (${Math.round((suma[col] ?? 0) * 100) / 100}). Los totales se recalculan: corregí el valor en las filas de cada persona.` })
    }
  })

  // 4) Valores en filas de persona fuera de las columnas que se leen.
  grid.forEach((fila, i) => {
    const uid = norm(fila?.[IDX_BD])
    if (!uid || esFilaEncabezado(uid, norm(fila?.[IDX_BE]))) return
    fila.forEach((v, j) => {
      if (v === null || v === undefined || norm(v) === '') return
      const col = numALetra(j + 1)
      if (!COLS_CONOCIDAS.has(col)) out.push({ tipo: 'celda_fuera_de_estructura', detalle: `${col}${i + 1} (${norm(fila[IDX_NOMBRE]) || uid}): "${norm(v)}" está en una columna que no forma parte de la liquidación y no se guarda.` })
    })
  })

  // 5) Identidad borrada: vacío no borra lo existente (se avisa).
  for (const [uid, e] of Array.from(subido.entries())) {
    const b = baseline.get(uid); if (!b) continue
    const campos: [string, string | null, string | null][] = [['Legajo', b.legajo, e.legajo], ['CUIL', b.cuil, e.cuil], ['Cuenta', b.cuenta, e.cuenta]]
    for (const [et, antes, ahora] of campos) {
      if (norm(antes) && !norm(ahora)) out.push({ tipo: 'identidad_vaciada', detalle: `${e.nombre ?? uid}: ${et} quedó vacío en el Excel; se conserva "${antes}" (un vacío no borra datos).` })
    }
  }

  // 6) Sindicato desmarcado: la baja no se hace desde el Excel.
  if (opts.sindicatoBase) {
    for (const uid of Array.from(opts.sindicatoBase)) {
      const e = subido.get(uid)
      if (e && !e.sindicato) out.push({ tipo: 'sindicato_desmarcado', detalle: `${e.nombre ?? uid}: se quitó la marca de SINDICATO. La baja del sindicato se hace desde Conceptos permanentes (no se da de baja desde el Excel).` })
    }
  }
  return out
}
