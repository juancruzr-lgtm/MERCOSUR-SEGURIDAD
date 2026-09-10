// lib/liquidacion-cambios.ts
//
// Detección READ-ONLY de cambios operativos posteriores al archivo enviado a
// Visual. NO reabre, NO reconsolida, NO modifica liquidacion_enviado_visual, NO
// regenera desde vivo: sólo informa. La re-descarga del Visual sigue saliendo
// del enviado histórico (regenerarVisualDesdeEnviado).
//
// Compara, por (CUIL, código), lo que se ENVIÓ (liquidacion_enviado_visual,
// congelado) contra lo que se enviaría HOY (lineasVisualEnVivo, recomputado con
// la preparación única). El comparador es PURO para poder testearse sin mocks.

export interface LineaComparable {
  cuil: string
  codigo: string
  cantidad: number | null
  importe: number | null
}

export interface DiferenciaLinea {
  cuil: string
  codigo: string
  tipo: 'agregado' | 'quitado' | 'modificado'
  campo?: 'cantidad' | 'importe'
  antes?: number | null
  ahora?: number | null
}

export interface DiffCambios {
  hayCambios: boolean
  cantidad: number   // nº de líneas con diferencia
  personas: number   // nº de CUIL afectados
  detalle: DiferenciaLinea[]
}

const clave = (cuil: string, codigo: string) => `${String(cuil ?? '').trim()}|${String(codigo ?? '').trim()}`
const casiIgual = (a: number, b: number) => Math.abs(a - b) < 0.005  // tolerancia de centavo

/**
 * Agrega por (cuil, código) sumando cantidad/importe. Normaliza ambos lados de la
 * misma forma para que la comparación sea simétrica y no dependa de cómo se
 * hayan partido las líneas.
 */
function agrupar(lineas: LineaComparable[]): Map<string, { cuil: string; codigo: string; cantidad: number; importe: number }> {
  const m = new Map<string, { cuil: string; codigo: string; cantidad: number; importe: number }>()
  for (const l of lineas) {
    const k = clave(l.cuil, l.codigo)
    const acc = m.get(k) ?? { cuil: String(l.cuil ?? '').trim(), codigo: String(l.codigo ?? '').trim(), cantidad: 0, importe: 0 }
    acc.cantidad += Number(l.cantidad ?? 0)
    acc.importe += Number(l.importe ?? 0)
    m.set(k, acc)
  }
  return m
}

/**
 * Diff PURO entre lo enviado (congelado) y lo actual (vivo). Determinístico y
 * sin IO: apto para tests. `enviado` = liquidacion_enviado_visual; `actual` =
 * lineasVisualEnVivo.
 */
export function compararEnviadoVsActual(enviado: LineaComparable[], actual: LineaComparable[]): DiffCambios {
  const e = agrupar(enviado)
  const a = agrupar(actual)
  const detalle: DiferenciaLinea[] = []
  const personas = new Set<string>()

  // Líneas que estaban y cambiaron o se quitaron.
  for (const [k, ev] of Array.from(e.entries())) {
    const av = a.get(k)
    if (!av) {
      detalle.push({ cuil: ev.cuil, codigo: ev.codigo, tipo: 'quitado', campo: 'importe', antes: ev.importe, ahora: null })
      personas.add(ev.cuil)
      continue
    }
    if (!casiIgual(ev.cantidad, av.cantidad)) {
      detalle.push({ cuil: ev.cuil, codigo: ev.codigo, tipo: 'modificado', campo: 'cantidad', antes: ev.cantidad, ahora: av.cantidad })
      personas.add(ev.cuil)
    }
    if (!casiIgual(ev.importe, av.importe)) {
      detalle.push({ cuil: ev.cuil, codigo: ev.codigo, tipo: 'modificado', campo: 'importe', antes: ev.importe, ahora: av.importe })
      personas.add(ev.cuil)
    }
  }
  // Líneas nuevas que hoy aparecerían y no se habían enviado.
  for (const [k, av] of Array.from(a.entries())) {
    if (e.has(k)) continue
    detalle.push({ cuil: av.cuil, codigo: av.codigo, tipo: 'agregado', campo: 'importe', antes: null, ahora: av.importe })
    personas.add(av.cuil)
  }

  return { hayCambios: detalle.length > 0, cantidad: detalle.length, personas: personas.size, detalle }
}

/**
 * Orquesta la detección (sólo lectura): lee lo enviado y recomputa lo actual, y
 * devuelve el diff. No escribe nada. Pensada para el banner de un período ya
 * exportado/liquidado.
 */
export async function detectarCambiosPosteriores(
  client: any,
  periodo: { id: string; mes: string },
): Promise<DiffCambios & { error: string | null }> {
  const vacio: DiffCambios & { error: string | null } = { hayCambios: false, cantidad: 0, personas: 0, detalle: [], error: null }
  const envR = await client.from('liquidacion_enviado_visual')
    .select('cuil, codigo, cantidad, importe').eq('periodo_id', periodo.id)
  if (envR.error) return { ...vacio, error: envR.error.message }
  const enviado: LineaComparable[] = ((envR.data ?? []) as any[]).map(x => ({
    cuil: String(x.cuil ?? ''), codigo: String(x.codigo), cantidad: x.cantidad, importe: x.importe,
  }))

  const { lineasVisualEnVivo } = await import('@/lib/visual-generar')
  const vivo = await lineasVisualEnVivo(client, periodo)
  if (vivo.error) return { ...vacio, error: vivo.error }
  const actual: LineaComparable[] = vivo.lineas.map(l => ({ cuil: l.cuil, codigo: l.codigo, cantidad: l.cantidad, importe: l.importe }))

  return { ...compararEnviadoVsActual(enviado, actual), error: null }
}
