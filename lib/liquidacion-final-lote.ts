// lib/liquidacion-final-lote.ts
//
// Liquidaciones finales EN LOTE (pedido de JC 20/10): a mitad de mes se baja un
// Excel de trabajo con todas las finales que se generaron solas al confirmar
// bajas, se completa lo que falte, se vuelve a subir (la app lee SÓLO lo que
// cambió: vacaciones, período de Visual y Cantidad/Importe con motivo) y se baja
// UN archivo de Visual con los empleados de baja aprobados («Exportar
// liquidaciones finales»). El resultado de Visual se reimporta para todo el lote.
//
// Nada se aplica sin motivo ni sobre una versión vieja del borrador; las
// exportaciones usan las mismas RPC (doble pago, sin duplicar, historial).

import type { AjusteManual, EntradasFinal } from '@/lib/liquidacion-final'
import { FILA_ENCABEZADO } from '@/lib/liquidacion-final-excel'

/** Lo que trae una hoja del Excel de trabajo (por persona). */
export interface HojaFinal {
  hoja: string
  finalId: string
  version: number
  vacaciones: { saldo: number | null; tomadas: number | null }
  visualPeriodo: string | null
  lineas: { fila: number; codigo: string; cantidad: number | null; importe: number | null; esFormulaC: boolean; esFormulaD: boolean; motivo: string | null }[]
}

export interface LineaGuardada { codigo: string; entrada: string; cantidad: number | null; importe: number | null; total: number }

export interface DiferenciasHoja {
  hoja: string
  finalId: string
  version: number
  cambios: string[]
  errores: string[]
  /** Entradas a guardar (null = no hay nada que aplicar). */
  entradas: EntradasFinal | null
}

const TOL = 0.005
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'object' && v && 'result' in (v as any)) return num((v as any).result)
  // Número de Excel, o texto «1.234,56» / «1234.56».
  const t = String(v).trim()
  const n = typeof v === 'number' ? v : Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
  return Number.isFinite(n) ? n : null
}
const texto = (v: unknown): string | null => {
  if (v === null || v === undefined) return null
  if (typeof v === 'object' && v && 'richText' in (v as any)) return ((v as any).richText as { text: string }[]).map(t => t.text).join('').trim() || null
  if (typeof v === 'object' && v && 'result' in (v as any)) return texto((v as any).result)
  const t = String(v).trim()
  return t || null
}
const esFormula = (v: unknown) => typeof v === 'object' && v !== null && ('formula' in (v as any) || 'sharedFormula' in (v as any))

/** Lee las hojas de liquidación final de un libro exceljs ya cargado (ignora el Índice). */
export function leerHojasLiquidacionFinal(wb: any): HojaFinal[] {
  const out: HojaFinal[] = []
  wb.eachSheet((ws: any) => {
    const finalId = texto(ws.getCell('J1').value)
    if (!finalId || !/^[0-9a-f-]{36}$/i.test(finalId)) return
    const lineas: HojaFinal['lineas'] = []
    for (let r = FILA_ENCABEZADO + 1; r < FILA_ENCABEZADO + 200; r++) {
      const a = texto(ws.getCell(`A${r}`).value)
      if (a === 'TOTAL') break
      if (!a) continue
      const c = ws.getCell(`C${r}`).value, d = ws.getCell(`D${r}`).value
      // El motivo es lo que se escribió en H; si ya era un ajuste, se saca la nota «(calculado: …)».
      const motivo = texto(ws.getCell(`H${r}`).value)?.replace(/\s*\((calculado:|línea agregada a mano).*\)\s*$/, '').trim() || null
      lineas.push({ fila: r, codigo: a.replace(/\D/g, '') || a, cantidad: num(c), importe: num(d), esFormulaC: esFormula(c), esFormulaD: esFormula(d), motivo })
    }
    out.push({
      hoja: ws.name, finalId, version: num(ws.getCell('J2').value) ?? -1,
      vacaciones: { saldo: num(ws.getCell('B12').value), tomadas: num(ws.getCell('B13').value) },
      visualPeriodo: texto(ws.getCell('B19').value),
      lineas,
    })
  })
  return out
}

/**
 * Compara una hoja con el borrador guardado y arma las entradas a guardar.
 *  · Vacaciones (B12/B13) y período (B19): se toman si cambiaron.
 *  · Cantidad/Importe: sólo cuenta como cambio una celda escrita a mano (no una
 *    fórmula, que la app recalcula) que difiere del borrador; exige motivo en H.
 *  · Fila nueva con código: se agrega como ajuste (exige motivo).
 *  · Versión distinta de la guardada: no se aplica (el borrador cambió después de bajar el Excel).
 */
export function diferenciasDeHoja(
  h: HojaFinal,
  guardado: { version: number; estado: string; entradas: EntradasFinal; vacaciones: { saldo: number | null; tomadas: number | null }; visualPeriodo: string | null },
  lineas: LineaGuardada[],
): DiferenciasHoja {
  const cambios: string[] = []
  const errores: string[] = []
  const base = { hoja: h.hoja, finalId: h.finalId, version: h.version }
  if (!['pendiente_calculo', 'borrador', 'lista'].includes(guardado.estado)) {
    return { ...base, cambios, errores: [`Ya está ${guardado.estado}: no se modifica.`], entradas: null }
  }
  const entradas: EntradasFinal = { ...guardado.entradas, ajustes: [...(guardado.entradas.ajustes ?? [])] }

  if (h.vacaciones.saldo !== guardado.vacaciones.saldo || h.vacaciones.tomadas !== guardado.vacaciones.tomadas) {
    if (h.vacaciones.saldo == null || h.vacaciones.tomadas == null) {
      if (h.vacaciones.saldo != null || h.vacaciones.tomadas != null) errores.push('Vacaciones: completá las dos celdas (B12 saldo y B13 tomadas); vacías no se asumen cero.')
    } else {
      entradas.vacaciones = { saldoDias: h.vacaciones.saldo, tomadasDias: h.vacaciones.tomadas, nota: 'cargadas en el Excel de trabajo' }
      cambios.push(`Vacaciones: devengadas ${h.vacaciones.saldo}, tomadas ${h.vacaciones.tomadas}.`)
    }
  }
  if ((h.visualPeriodo ?? null) !== (guardado.visualPeriodo ?? null) && h.visualPeriodo) {
    entradas.visualPeriodo = h.visualPeriodo
    cambios.push(`Período de Visual: «${h.visualPeriodo}».`)
  }

  const porCodigo = new Map(lineas.map(l => [l.codigo, l]))
  const vistos = new Set<string>()
  for (const l of h.lineas) {
    if (!/^\d{3,9}$/.test(l.codigo)) { errores.push(`Fila ${l.fila}: código «${l.codigo}» inválido.`); continue }
    if (vistos.has(l.codigo)) { errores.push(`El código ${l.codigo} está dos veces en la hoja.`); continue }
    vistos.add(l.codigo)
    const g = porCodigo.get(l.codigo)
    const ajuste: AjusteManual = { codigo: l.codigo, cantidad: null, importe: null, motivo: l.motivo && l.motivo.length >= 3 ? l.motivo : 'Editado en el Excel de trabajo' }
    let cambio = false
    if (!g) {
      if (l.importe == null && l.cantidad == null) continue
      ajuste.cantidad = l.cantidad ?? 1; ajuste.importe = l.importe
      cambio = true
      cambios.push(`Concepto nuevo ${l.codigo}: ${ajuste.cantidad} × ${l.importe ?? '—'}.`)
    } else {
      if (!l.esFormulaC && l.cantidad !== null && Math.abs((g.cantidad ?? 0) - l.cantidad) >= TOL) { ajuste.cantidad = l.cantidad; cambio = true }
      if (!l.esFormulaD && l.importe !== null && Math.abs((g.importe ?? 0) - l.importe) >= TOL) { ajuste.importe = l.importe; cambio = true }
      if (!l.esFormulaD && l.importe === null && g.importe) { ajuste.importe = 0; cambio = true }
      if (cambio) cambios.push(`${l.codigo}: ${g.cantidad ?? '—'} × ${g.importe ?? '—'} → ${ajuste.cantidad ?? g.cantidad ?? '—'} × ${ajuste.importe ?? g.importe ?? '—'}.`)
    }
    if (!cambio) continue
    entradas.ajustes = [...(entradas.ajustes ?? []).filter(a => a.codigo !== l.codigo), ajuste]
  }

  if (h.version !== guardado.version && (cambios.length || errores.length)) {
    return { ...base, cambios, errores: [`El borrador cambió después de bajar el Excel (v${h.version} → v${guardado.version}). Bajalo de nuevo.`, ...errores], entradas: null }
  }
  return { ...base, cambios, errores, entradas: cambios.length && !errores.length ? entradas : null }
}

/** Filas del .xls de Visual de varias personas (mismo orden que la lista). */
export function filasVisualDeLote<T>(items: { filas: T[] }[]): T[] {
  return items.flatMap(i => i.filas)
}
