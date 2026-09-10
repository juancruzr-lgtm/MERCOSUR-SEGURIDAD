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
