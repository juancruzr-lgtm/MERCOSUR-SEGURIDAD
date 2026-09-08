// Parser de planillas de Visual Sueldos (export "Planilla de Sueldos").
// Estructura real (agosto/jjjjj 08/09/2026):
//   fila de encabezados con: LEGAJO, NOMBRE, CUIL, FEC.INGRESO, CTRO.CTO.,
//   O.SOCIAL, FECHA NAC., CATEGORIA, luego pares [<cod nombre> | Cant.] por
//   concepto, y al final columnas calculadas por Visual: Imponible, No Imponible,
//   Descuentos, Asignaciones, Neto.
// El set de conceptos VARÍA entre períodos → se leen dinámicamente del encabezado.
// La función es PURA: recibe la grilla (filas x celdas) y no lee archivos ni red.

export type CeldaVisual = string | number | null | undefined

export interface ConceptoVisual {
  col: number          // columna (1-based) del importe
  colCant: number      // columna de la cantidad
  codigo: string       // dígitos iniciales del encabezado
  nombre: string       // resto del encabezado
}

export interface LineaImportada {
  cuil: string | null
  legajo: string | null
  nombreArchivo: string | null   // nombre tal como viene en el archivo
  codigo: string
  concepto: string
  cantidad: number | null
  importe: number | null
}

export interface EmpleadoTotales {
  cuil: string | null
  imponible: number | null
  noImponible: number | null
  descuentos: number | null
  asignaciones: number | null
  neto: number | null
}

export interface PlanillaVisualParseada {
  conceptos: ConceptoVisual[]
  lineas: LineaImportada[]        // sólo conceptos con importe o cantidad != 0
  totales: EmpleadoTotales[]
  filaEncabezado: number
  advertencias: string[]
}

const norm = (v: CeldaVisual): string => String(v ?? '').replace(/\s+/g, ' ').trim()
const num = (v: CeldaVisual): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
// Encabezado de concepto: dígitos iniciales + resto. Ej "000 DIAS TRABAJADAS",
// "48410 embargo 10% sobre minimo", '214 "Suma No Remunerativa...'.
const RE_CODIGO = /^\s*"?(\d+)\s+(.+?)\s*$/
const COLS_TOTALES = new Set(['imponible', 'no imponible', 'descuentos', 'asignaciones', 'neto'])
const esCant = (h: string) => /^cant\.?$/i.test(h)

/** Encuentra la fila de encabezados (la que tiene LEGAJO y CUIL). */
function detectarEncabezado(filas: CeldaVisual[][]): number {
  for (let r = 0; r < Math.min(filas.length, 15); r++) {
    const set = new Set((filas[r] || []).map(c => norm(c).toUpperCase()))
    if (set.has('LEGAJO') && set.has('CUIL')) return r
  }
  return -1
}

function indiceColumna(header: CeldaVisual[], etiqueta: string): number {
  for (let i = 0; i < header.length; i++) if (norm(header[i]).toUpperCase() === etiqueta) return i
  return -1
}

/**
 * Parsea la grilla (array de filas; cada fila array de celdas, 0-based) de una
 * planilla de Visual Sueldos. No asume el set de conceptos: los deriva del
 * encabezado. Filtra las columnas de totales (calculadas por Visual).
 */
export function parsearPlanillaVisual(filas: CeldaVisual[][]): PlanillaVisualParseada {
  const advertencias: string[] = []
  const fh = detectarEncabezado(filas)
  if (fh < 0) return { conceptos: [], lineas: [], totales: [], filaEncabezado: -1, advertencias: ['No se encontró la fila de encabezados (LEGAJO/CUIL).'] }
  const header = filas[fh]
  const iCuil = indiceColumna(header, 'CUIL')
  const iLegajo = indiceColumna(header, 'LEGAJO')
  const iNombre = indiceColumna(header, 'NOMBRE')

  // Conceptos: columnas cuyo encabezado matchea código; la cantidad va en la
  // columna siguiente si está etiquetada "Cant.".
  const conceptos: ConceptoVisual[] = []
  const totalesCols: Record<string, number> = {}
  for (let c = 0; c < header.length; c++) {
    const h = norm(header[c])
    if (!h) continue
    if (COLS_TOTALES.has(h.toLowerCase())) { totalesCols[h.toLowerCase()] = c; continue }
    const m = h.match(RE_CODIGO)
    if (m) {
      const colCant = (c + 1 < header.length && esCant(norm(header[c + 1]))) ? c + 1 : -1
      conceptos.push({ col: c, colCant, codigo: m[1], nombre: m[2].replace(/"/g, '').trim() })
    }
  }
  if (conceptos.length === 0) advertencias.push('No se detectaron columnas de concepto.')

  const lineas: LineaImportada[] = []
  const totales: EmpleadoTotales[] = []
  for (let r = fh + 1; r < filas.length; r++) {
    const fila = filas[r] || []
    const cuil = iCuil >= 0 ? norm(fila[iCuil]) : ''
    const legajo = iLegajo >= 0 ? norm(fila[iLegajo]) : ''
    const nombre = iNombre >= 0 ? norm(fila[iNombre]) : ''
    // Fin de datos: fila sin CUIL ni legajo (totales/pie).
    if (!cuil && !legajo) continue
    // CUIL válido = 11 dígitos; si no, se marca (empleado se resolverá igual por otras claves).
    const cuilLimpio = cuil.replace(/\D/g, '')
    const cuilOut = cuilLimpio.length === 11 ? cuilLimpio : (cuil || null)
    for (const cp of conceptos) {
      const importe = num(fila[cp.col])
      const cantidad = cp.colCant >= 0 ? num(fila[cp.colCant]) : null
      if ((importe ?? 0) === 0 && (cantidad ?? 0) === 0) continue // sólo lo que aporta
      lineas.push({ cuil: cuilOut, legajo: legajo || null, nombreArchivo: nombre || null, codigo: cp.codigo, concepto: cp.nombre, cantidad, importe })
    }
    totales.push({
      cuil: cuilOut,
      imponible: 'imponible' in totalesCols ? num(fila[totalesCols['imponible']]) : null,
      noImponible: 'no imponible' in totalesCols ? num(fila[totalesCols['no imponible']]) : null,
      descuentos: 'descuentos' in totalesCols ? num(fila[totalesCols['descuentos']]) : null,
      asignaciones: 'asignaciones' in totalesCols ? num(fila[totalesCols['asignaciones']]) : null,
      neto: 'neto' in totalesCols ? num(fila[totalesCols['neto']]) : null,
    })
  }
  return { conceptos, lineas, totales, filaEncabezado: fh, advertencias }
}

/** Clasificación por defecto SUGERIDA (no vinculante) para un código, como ayuda
 * de preview. NO decide sola: el usuario confirma/ajusta. base_auxiliar para los
 * que no son haber/descuento directo (p.ej. 050 dif). */
export function categoriaSugerida(codigo: string, nombre: string): string {
  const n = nombre.toLowerCase()
  if (/^0*50$/.test(codigo) || /\bdif\b/.test(n)) return 'base_auxiliar'
  if (/(dias|horas)\s+trabaj/.test(n) || codigo === '000' || codigo === '001') return 'base_auxiliar'
  if (/jubil|inssjyp|obra social|sindicato|embargo|aliment|expediente|exped/.test(n)) return 'descuento'
  if (/viatico|presentismo|no remunerativa|vacac|feriado|adicional|antigued|nocturnidad|medico|acc laboral/.test(n)) return 'asignacion'
  return 'imponible'
}
