// lib/visual-export.ts
//
// LIQ2D — Generador del archivo de importación a Visual Sueldos (.xls BIFF8) a
// partir del SNAPSHOT CONSOLIDADO (LIQ2C). No recalcula nada: toma lo congelado
// y arma el archivo según el contrato real auditado (docs/visual-import-contrato):
//   Hoja1 · fila1 título · fila2 encabezados · datos desde fila3
//   A Legajo(texto) | B CUIL(texto) | C Código(texto) | D Cantidad(nº) | E Importe(nº)
// Formato largo: una fila por (empleado, código). Config por concepto decide qué
// se exporta y si manda cantidad/importe. NADA hardcodeado.

export interface ConsolidadaRow {
  empleado_id: string
  legajo_visual: string | null
  cuil: string | null
  nombre: string | null
  codigo: string
  cantidad: number | null
  importe: number | null
}

export interface ConfigConcepto {
  exporta_visual: boolean
  manda_cantidad: boolean
  manda_importe: boolean
}

export interface FilaVisual {
  legajo: string
  cuil: string
  codigo: string
  cantidad: number | null
  importe: number | null
}

const TITULO = 'VisualSueldos - Planilla de importación de datos'
const ENCABEZADOS = ['Legajo', 'CUIL', 'Código de concepto', 'Cantidad', 'Importe']

/**
 * Filas a exportar (puro). Aplica la config por código: si un concepto está en
 * el catálogo con exporta_visual=false, se omite; si no está en el catálogo, se
 * exporta por defecto (cantidad + importe). Omite filas que no mandan ni
 * cantidad ni importe.
 */
export function filasVisual(
  consolidadas: ConsolidadaRow[],
  configPorCodigo: Map<string, ConfigConcepto>,
): FilaVisual[] {
  const out: FilaVisual[] = []
  for (const r of consolidadas) {
    const cfg = configPorCodigo.get(r.codigo)
    if (cfg && cfg.exporta_visual === false) continue
    const mandaCantidad = cfg ? cfg.manda_cantidad : true
    const mandaImporte = cfg ? cfg.manda_importe : true
    const cantidad = mandaCantidad ? (r.cantidad ?? 1) : null
    const importe = mandaImporte ? (r.importe ?? null) : null
    if (cantidad === null && importe === null) continue
    out.push({
      legajo: String(r.legajo_visual || r.nombre || '').trim(),
      cuil: String(r.cuil || '').replace(/\D/g, ''),
      codigo: String(r.codigo).trim(),
      cantidad, importe,
    })
  }
  return out
}

/**
 * Escribe el libro .xls BIFF8 real (Hoja1 con datos + Hoja2/Hoja3 vacías).
 * CUIL y código como TEXTO (preserva ceros a la izquierda del código);
 * cantidad/importe numéricos con formato 0.00. Devuelve los bytes.
 * `xlsxMod` permite inyectar SheetJS en tests; en runtime se importa.
 */
export async function escribirLibroVisualXls(filas: FilaVisual[], xlsxMod?: any): Promise<Uint8Array> {
  const XLSX: any = xlsxMod ?? (await import('xlsx'))
  const aoa: any[][] = [[TITULO], ENCABEZADOS, ...filas.map(f => [f.legajo, f.cuil, f.codigo, f.cantidad, f.importe])]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // Tipado de celdas por fila de datos (desde la fila 3 = índice 2).
  for (let i = 0; i < filas.length; i++) {
    const r = i + 2 // 0-based row index
    // Texto para CUIL y código (preserva ceros a la izquierda). El molde real
    // deja CUIL en formato General y sólo el código en '@'; se replica igual.
    const setText = (c: number, z?: string) => { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a] && ws[a].v !== null && ws[a].v !== undefined && ws[a].v !== '') { ws[a].t = 's'; if (z) ws[a].z = z } }
    const setNum = (c: number) => { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a] && typeof ws[a].v === 'number') { ws[a].t = 'n'; ws[a].z = '0.00' } }
    setText(1)          // CUIL (General, texto)
    setText(2, '@')     // Código (texto explícito)
    setNum(3); setNum(4)    // Cantidad, Importe
  }
  ws['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 12 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Hoja1')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Hoja2')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Hoja3')
  const out = XLSX.write(wb, { bookType: 'biff8', type: 'array' })
  return out instanceof Uint8Array ? out : new Uint8Array(out)
}
