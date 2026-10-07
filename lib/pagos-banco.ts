// lib/pagos-banco.ts
//
// PAGOS — archivos de acreditación para el banco (Galicia). Formato auditado
// (JC 06/10): hoja "Empleados" con 4 columnas → Cuenta | Nombre | Importe |
// Concepto. La CUENTA va como TEXTO (conserva ceros a la izquierda). El importe
// NO se recalcula: sueldos = SUELDO MENSUAL fijo para quien lo tiene (JC 07/10,
// aunque Visual devuelva otro neto) y neto de Visual para el resto;
// extras = extra fija vigente del mes. El CONCEPTO lo pide Galicia: 1 = sueldos,
// 11 = extras. Toda la lógica de importes vive en las RPC pagos_*_banco.

// Código de concepto de Galicia por tipo de archivo.
export const CONCEPTO_BANCO = { sueldos: 1, extras: 11 } as const

export interface FilaBanco { cuenta: string; nombre: string; importe: number }
export interface ArchivoBanco {
  rows: FilaBanco[]              // cuentas de Galicia (van al archivo)
  excluidos: FilaBanco[]         // CBU/cuenta de otro banco: NO entran (pagar aparte)
  total: number
  error: string | null
}

// El batch de Galicia acredita a CUENTAS de Galicia (numéricas, hasta ~14 dígitos).
// Un CBU (22 dígitos) o cuenta de otro banco NO se puede acreditar por este archivo
// → se deja afuera y se avisa para pagarla por separado. (Caso ALMARA: CBU 072…)
const esCuentaGalicia = (c: string): boolean => /^\d{6,18}$/.test(c) && c.length !== 22

function mapRows(data: any[]): FilaBanco[] {
  return (data ?? []).map((r) => ({
    cuenta: String(r.cuenta ?? '').trim(),
    nombre: String(r.nombre ?? '').trim(),
    importe: Math.round(Number(r.importe ?? 0) * 100) / 100,
  }))
}

function partir(rows: FilaBanco[]): ArchivoBanco {
  const galicia = rows.filter(r => esCuentaGalicia(r.cuenta))
  const excluidos = rows.filter(r => !esCuentaGalicia(r.cuenta))
  return { rows: galicia, excluidos, total: Math.round(galicia.reduce((a, b) => a + b.importe, 0) * 100) / 100, error: null }
}

export async function filasSueldosBanco(client: any, periodoId: string): Promise<ArchivoBanco> {
  const { data, error } = await client.rpc('pagos_sueldos_banco', { p_periodo_id: periodoId })
  if (error) return { rows: [], excluidos: [], total: 0, error: error.message || String(error) }
  return partir(mapRows(data))
}

export async function filasExtrasBanco(client: any, periodoId: string): Promise<ArchivoBanco> {
  const { data, error } = await client.rpc('pagos_extras_banco', { p_periodo_id: periodoId })
  if (error) return { rows: [], excluidos: [], total: 0, error: error.message || String(error) }
  return partir(mapRows(data))
}

/**
 * Escribe el .xlsx del banco (SheetJS). Hoja "Empleados", encabezado
 * Cuenta|Nombre|Importe|Concepto. La cuenta se fuerza como celda de TEXTO.
 * `concepto` = código de Galicia del archivo (1 sueldos, 11 extras).
 */
export async function escribirBancoXLSX(rows: FilaBanco[], concepto: number): Promise<ArrayBuffer> {
  const XLSX = await import('xlsx')
  const aoa: any[][] = [['Cuenta', 'Nombre', 'Importe', 'Concepto']]
  for (const r of rows) aoa.push([r.cuenta, r.nombre, r.importe, concepto])
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // Cuenta como texto (ceros a la izquierda). Fila 1 es encabezado.
  for (let i = 2; i <= aoa.length; i++) {
    const ref = `A${i}`
    if (ws[ref]) { ws[ref].t = 's'; ws[ref].z = '@' }
  }
  ws['!cols'] = [{ wch: 24 }, { wch: 34 }, { wch: 14 }, { wch: 10 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Empleados')
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return out as ArrayBuffer
}
