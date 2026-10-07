// lib/pagos-banco.ts
//
// PAGOS — archivos de acreditación para el banco (Galicia). Formato auditado
// (JC 06/10): hoja "Empleados" con 4 columnas → Cuenta | Nombre | Importe |
// Concepto. La CUENTA va como TEXTO (conserva ceros a la izquierda). El importe
// NO se recalcula: sueldos = SUELDO MENSUAL fijo para quien lo tiene (JC 07/10,
// aunque Visual devuelva otro neto) y neto de Visual para el resto;
// extras = EXTRAS PENDIENTES del mes: columna AP de la planilla (por horas, fija o
// escrita a mano) menos lo ya registrado como pagado (JC 08/10). El CONCEPTO lo
// pide Galicia: 1 = sueldos, 11 = extras.

import { esCuentaGalicia } from '@/lib/cuenta-banco'

// Código de concepto de Galicia por tipo de archivo.
export const CONCEPTO_BANCO = { sueldos: 1, extras: 11 } as const

export interface FilaBanco { cuenta: string; nombre: string; importe: number; usuarioId?: string; motivo?: string | null }
export interface ArchivoBanco {
  rows: FilaBanco[]              // cuentas de Galicia (van al archivo)
  excluidos: FilaBanco[]         // NO entran al archivo, con su motivo (otro banco, sin cuenta, baja…)
  total: number
  error: string | null
}

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

/**
 * Archivo "Galicia — Extras": EXTRAS PENDIENTES de pago por persona, desde la MISMA
 * conciliación que el Excel completo (columna AP de la planilla, menos lo ya
 * registrado como pagado). Los que no entran vuelven en `excluidos` con su motivo.
 */
export async function filasExtrasBanco(
  client: any,
  periodoId: string,
): Promise<ArchivoBanco & { extrasMes: number; registrado: number }> {
  const vacio = { rows: [], excluidos: [], total: 0, extrasMes: 0, registrado: 0 }
  const { data: per } = await client.from('liquidacion_periodo').select('id, mes').eq('id', periodoId).limit(1)
  const p = ((per ?? []) as any[])[0]
  if (!p) return { ...vacio, error: 'Período inexistente' }
  const { extrasDelPeriodo } = await import('@/lib/excel-trabajo-liquidacion')
  const { extras, error } = await extrasDelPeriodo(client, { id: String(p.id), mes: String(p.mes) })
  if (error) return { ...vacio, error }
  const r2 = (n: number) => Math.round(n * 100) / 100
  const conPendiente = extras.filter(e => e.pendiente > 0)
  const rows = conPendiente.filter(e => e.destino === 'galicia')
    .map(e => ({ cuenta: String(e.cuenta ?? ''), nombre: e.nombre, importe: e.pendiente, usuarioId: e.usuarioId }))
  const excluidos = conPendiente.filter(e => e.destino !== 'galicia')
    .map(e => ({ cuenta: String(e.cuenta ?? ''), nombre: e.nombre, importe: e.pendiente, usuarioId: e.usuarioId, motivo: e.motivo }))
  return {
    rows, excluidos, error: null,
    total: r2(rows.reduce((a, b) => a + b.importe, 0)),
    extrasMes: r2(extras.reduce((a, b) => a + b.extrasMes, 0)),
    registrado: r2(extras.reduce((a, b) => a + b.registrado, 0)),
  }
}

/**
 * Registra como PAGADAS las filas de un archivo del banco ya acreditado (acción
 * explícita del usuario, después de pagar). Idempotente por hash del archivo.
 */
export async function registrarPagoBanco(
  client: any, periodoId: string, tipo: 'sueldos' | 'extras', archivo: string, buf: ArrayBuffer, rows: FilaBanco[],
): Promise<{ ok: boolean; yaRegistrado?: boolean; filas?: number; total?: number; error: string | null }> {
  const h = await crypto.subtle.digest('SHA-256', buf)
  const hash = Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('')
  const filas = rows.filter(r => r.usuarioId && r.importe > 0).map(r => ({ usuario_id: r.usuarioId, cuenta: r.cuenta, importe: r.importe }))
  const { data, error } = await client.rpc('registrar_pago_banco', { p_periodo_id: periodoId, p_tipo: tipo, p_archivo: archivo, p_hash: hash, p_filas: filas })
  if (error) return { ok: false, error: error.message || String(error) }
  const d = data as any
  return { ok: true, yaRegistrado: Boolean(d?.ya_registrado), filas: d?.filas, total: d?.total == null ? undefined : Number(d.total), error: null }
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
