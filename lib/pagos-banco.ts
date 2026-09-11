// lib/pagos-banco.ts
//
// PAGOS — archivos de acreditación para el banco (Galicia). Formato auditado
// (JC 11/09): hoja "Empleados" con 3 columnas → Cuenta | Nombre | Importe.
// La CUENTA va como TEXTO (conserva ceros a la izquierda). El importe NO se
// recalcula: sueldos = neto de Visual + sueldo mensual de los excluidos; extras
// = extra fija vigente del mes. Toda la lógica vive en las RPC pagos_*_banco.

export interface FilaBanco { cuenta: string; nombre: string; importe: number }
export interface ArchivoBanco { rows: FilaBanco[]; total: number; error: string | null }

function mapRows(data: any[]): FilaBanco[] {
  return (data ?? []).map((r) => ({
    cuenta: String(r.cuenta ?? '').trim(),
    nombre: String(r.nombre ?? '').trim(),
    importe: Math.round(Number(r.importe ?? 0) * 100) / 100,
  }))
}

export async function filasSueldosBanco(client: any, periodoId: string): Promise<ArchivoBanco> {
  const { data, error } = await client.rpc('pagos_sueldos_banco', { p_periodo_id: periodoId })
  if (error) return { rows: [], total: 0, error: error.message || String(error) }
  const rows = mapRows(data)
  return { rows, total: Math.round(rows.reduce((a, b) => a + b.importe, 0) * 100) / 100, error: null }
}

export async function filasExtrasBanco(client: any, periodoId: string): Promise<ArchivoBanco> {
  const { data, error } = await client.rpc('pagos_extras_banco', { p_periodo_id: periodoId })
  if (error) return { rows: [], total: 0, error: error.message || String(error) }
  const rows = mapRows(data)
  return { rows, total: Math.round(rows.reduce((a, b) => a + b.importe, 0) * 100) / 100, error: null }
}

/**
 * Escribe el .xlsx del banco (SheetJS). Hoja "Empleados", encabezado
 * Cuenta|Nombre|Importe. La cuenta se fuerza como celda de TEXTO.
 */
export async function escribirBancoXLSX(rows: FilaBanco[]): Promise<ArrayBuffer> {
  const XLSX = await import('xlsx')
  const aoa: any[][] = [['Cuenta', 'Nombre', 'Importe']]
  for (const r of rows) aoa.push([r.cuenta, r.nombre, r.importe])
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // Cuenta como texto (ceros a la izquierda). Fila 1 es encabezado.
  for (let i = 2; i <= aoa.length; i++) {
    const ref = `A${i}`
    if (ws[ref]) { ws[ref].t = 's'; ws[ref].z = '@' }
  }
  ws['!cols'] = [{ wch: 24 }, { wch: 34 }, { wch: 14 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Empleados')
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  return out as ArrayBuffer
}
