// lib/liquidacion-final-datos.ts
//
// Lecturas y escrituras del borrador de liquidación final (migración
// 20261110120000). El cálculo es puro (lib/liquidacion-final.ts); acá se juntan
// los datos con las MISMAS fuentes del Excel de trabajo mensual (recortadas a la
// persona y a la fecha de baja) y se guardan por RPC. Nada de esto paga, exporta
// ni cierra por su cuenta: cada paso lo dispara una persona desde la pantalla.

import {
  CONTEO_SAC_CONFIRMADO, calcularLiquidacionFinal, filasVisualFinal, jsonEstable, ordinariosDePlantilla,
  type CausaBaja, type ConceptoCatalogo, type DatosLiquidacionFinal, type EntradasFinal,
  type OrdinariosHastaBaja, type ReglaCausal, type ResultadoLiquidacionFinal,
} from '@/lib/liquidacion-final'
import { cargarParametrosDelMes, plantillaTrabajoDelMes } from '@/lib/excel-trabajo-liquidacion'
import { parsearPlanillaVisual, type CeldaVisual } from '@/lib/liquidacion-visual'

/** Fila de baja_laboral (el registro de baja único). */
export interface BajaFila {
  id: string
  empleado_id: string
  nombre: string | null
  dni: string | null
  cuil: string | null
  legajo: string | null
  fecha_ingreso: string | null
  causa: CausaBaja | null
  fecha_notificacion: string | null
  fecha_baja: string | null
  observaciones: string | null
  estado: 'borrador' | 'confirmada' | 'anulada'
  origen: 'guardias' | 'legajo' | 'arca' | 'cambio_estado'
  vacaciones: { devengadas?: number | null; tomadas?: number | null; pendientes?: number | null; metodo?: string | null; verificadas?: boolean; nota?: string | null } | null
  turnos_futuros: { turno_id: string; fecha: string; hora_inicio: string | null; hora_fin: string | null; objetivo: string | null; estado: string | null }[]
  registrada_at: string
  confirmada_at: string | null
}

export interface FinalFila {
  id: string
  baja_id: string
  mes: string | null
  estado: 'pendiente_calculo' | 'borrador' | 'lista' | 'exportada' | 'conciliada' | 'anulada'
  version: number
  requiere_recalculo: boolean
  entradas: EntradasFinal
  calculo: ResultadoLiquidacionFinal['calculo'] | null
  faltantes: { clave: string; detalle: string }[]
  advertencias: string[]
  calculado_at: string | null
  exportada_at: string | null
  export_archivo: string | null
  conciliada_at: string | null
  baja: BajaFila
}

const SEL_FINAL = 'id, baja_id, mes, estado, version, requiere_recalculo, entradas, calculo, faltantes, advertencias, calculado_at, exportada_at, export_archivo, conciliada_at, baja:baja_laboral(*)'

export async function listarFinales(client: any, verAnuladas = false): Promise<{ data: FinalFila[]; error: string | null }> {
  let q = client.from('liquidacion_final').select(SEL_FINAL).order('created_at', { ascending: false }).limit(200)
  if (!verAnuladas) q = q.neq('estado', 'anulada')
  const { data, error } = await q
  return { data: (data ?? []) as FinalFila[], error: error?.message ?? null }
}

export async function leerFinal(client: any, finalId: string): Promise<{ data: FinalFila | null; error: string | null }> {
  const { data, error } = await client.from('liquidacion_final').select(SEL_FINAL).eq('id', finalId).maybeSingle()
  return { data: (data as FinalFila) ?? null, error: error?.message ?? null }
}

export async function lineasDeFinal(client: any, finalId: string) {
  const { data, error } = await client.from('liquidacion_final_linea')
    .select('codigo, concepto, entrada, cantidad, importe, total, detalle').eq('final_id', finalId).order('codigo')
  return { data: (data ?? []) as any[], error: error?.message ?? null }
}

export async function historialDeFinal(client: any, finalId: string) {
  const { data, error } = await client.from('liquidacion_final_historial')
    .select('id, version, accion, datos, por, at').eq('final_id', finalId).order('id', { ascending: false }).limit(100)
  return { data: (data ?? []) as any[], error: error?.message ?? null }
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data)
  const h = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── Contexto del cálculo ─────────────────────────────────────────────────────

interface Persona { cuil: string | null; legajoVisual: string | null; nombre: string; empleadoId: string | null }

async function persona(client: any, baja: BajaFila): Promise<Persona> {
  const digitos = (s: any) => String(s ?? '').replace(/\D/g, '') || null
  let cuil = digitos(baja.cuil)
  let nombre = (baja.nombre ?? '').replace(/,\s*/, ' ')
  let legajoVisual: string | null = null
  if (baja.empleado_id) {
    const { data: u } = await client.from('usuarios').select('nombre, apellido, cuil, legajo_visual').eq('id', baja.empleado_id).maybeSingle()
    if (u) {
      cuil = cuil ?? digitos(u.cuil)
      nombre = `${u.apellido ?? ''} ${u.nombre ?? ''}`.trim() || nombre
      legajoVisual = u.legajo_visual ?? null
    }
  }
  // Padrón de liquidación (personas con o sin usuario): COD_INTERNO de Visual.
  if (cuil) {
    const { data: p } = await client.from('liquidacion_persona').select('cod_interno, nombre').eq('cuil', cuil).maybeSingle()
    if (p?.cod_interno) legajoVisual = String(p.cod_interno)
    if (!nombre && p?.nombre) nombre = p.nombre
  }
  return { cuil, legajoVisual, nombre: nombre || cuil || 'sin nombre', empleadoId: baja.empleado_id }
}

/** Último día del mes de una fecha ISO. */
export const finDelMes = (iso: string) => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0)).toISOString().slice(0, 10)

/**
 * Ordinarios del mes de la baja: misma planilla del Excel de trabajo, sólo de esa
 * persona. REGLA JC (20/10/2026): se liquidan las jornadas EFECTIVAMENTE
 * trabajadas del mes, aunque sean posteriores a la fecha efectiva (caso
 * Paniagua: baja 03/10, trabajó hasta el 08/10 y se pagan las 6 jornadas). Sólo
 * cuentan las horas reconocidas: lo programado y no trabajado no suma. Las
 * novedades (licencias, vacaciones, ART) se cortan en la fecha efectiva. SAC y
 * vacaciones siguen usando la fecha efectiva.
 */
async function ordinarios(client: any, empleadoId: string, fechaBaja: string, advertencias: string[]): Promise<OrdinariosHastaBaja | null> {
  const mes = fechaBaja.slice(0, 7)
  const r = await plantillaTrabajoDelMes(client, mes, undefined, { recorte: { empleadoId, hasta: finDelMes(fechaBaja), hastaNovedades: fechaBaja } })
  if (r.error) { advertencias.push(`No se pudo armar la planilla del mes: ${r.error}`); return null }
  const fila = r.resumen?.filas.find(f => f.empleadoId === empleadoId)
  if (fila && fechaBaja < finDelMes(fechaBaja)) {
    const hastaBaja = await plantillaTrabajoDelMes(client, mes, undefined, { recorte: { empleadoId, hasta: fechaBaja } })
    const antes = Number(hastaBaja.resumen?.filas.find(f => f.empleadoId === empleadoId)?.jornadasReales ?? 0)
    const despues = Number(fila.jornadasReales ?? 0) - antes
    if (despues > 0) advertencias.push(`Trabajó ${despues} jornada${despues === 1 ? '' : 's'} después de la fecha efectiva (${fechaBaja.split('-').reverse().join('/')}): se liquidan porque fueron efectivamente trabajadas. Verificar la fecha de baja.`)
  }
  let base = { conceptos: [] as any[], horasExtra: 0, extraFija: null as number | null, sueldoFijo: false }
  if (r.plantilla) base = ordinariosDePlantilla(r.plantilla, empleadoId) ?? base
  const { data: inf } = await client.from('novedades_laborales').select('id')
    .eq('empleado_id', empleadoId).eq('estado', 'aprobada').not('dias_informados', 'is', null)
    .lte('fecha_desde', fechaBaja).gte('fecha_hasta', `${mes}-01`).limit(1)
  // Correcciones manuales del período mensual (Excel de trabajo) valen para el mes
  // completo: no se trasladan solas a un recorte. Se avisan.
  const { data: per } = await client.from('liquidacion_periodo').select('id').eq('mes', mes).neq('estado', 'anulado').limit(1)
  if (per?.[0]?.id) {
    const { data: aj } = await client.from('liquidacion_ajuste').select('clave').eq('periodo_id', per[0].id).eq('empleado_id', empleadoId).limit(1)
    if (aj?.length) advertencias.push('El período mensual tiene correcciones manuales de esta persona: no se copian al recorte. Revisarlas y, si corresponden, cargarlas como ajuste.')
  }
  return {
    jornadas: Number(fila?.jornadasReales ?? 0),
    conceptos: base.conceptos,
    horasExtra: base.horasExtra,
    extraFija: base.extraFija,
    sueldoFijo: base.sueldoFijo,
    novedadInformada: Boolean(inf?.length),
  }
}

export async function contextoDeFinal(client: any, f: FinalFila): Promise<{ datos: DatosLiquidacionFinal | null; avisos: string[]; error: string | null }> {
  const avisos: string[] = []
  const b = f.baja
  const p = await persona(client, b)
  let ingreso = b.fecha_ingreso
  if (!ingreso && b.empleado_id) {
    const { data: l } = await client.from('legajo_datos_personales').select('fecha_ingreso').eq('empleado_id', b.empleado_id).maybeSingle()
    ingreso = l?.fecha_ingreso ?? null
  }
  const mes = b.fecha_baja ? b.fecha_baja.slice(0, 7) : null
  const P = await cargarParametrosDelMes(client, mes ?? new Date().toISOString().slice(0, 7))
  const hora = P.hora != null ? Number(P.hora) : P.basico / 200
  const valorDia = P.dia != null ? Number(P.dia) : hora * 8

  let ord: OrdinariosHastaBaja | null = null
  if (b.fecha_baja && b.empleado_id) ord = await ordinarios(client, b.empleado_id, b.fecha_baja, avisos)
  else if (b.fecha_baja && !b.empleado_id) {
    ord = { jornadas: 0, conceptos: [], horasExtra: 0 }
    avisos.push('La persona no tiene usuario en la app: no hay días ni horas registrados para el mes de la baja.')
  }

  let yaLiquidado: DatosLiquidacionFinal['yaLiquidado'] = []
  let extrasPagadas = 0
  if (mes && p.cuil) {
    const { data, error } = await client.rpc('liquidacion_final_ya_liquidado', { p_cuil: p.cuil, p_mes: mes })
    if (error) return { datos: null, avisos, error: 'No se pudo leer lo ya liquidado: ' + error.message }
    yaLiquidado = (data ?? []) as any[]
  }
  if (mes && b.empleado_id) {
    const { data, error } = await client.rpc('liquidacion_final_extras_pagadas', { p_empleado_id: b.empleado_id, p_mes: mes })
    if (error) return { datos: null, avisos, error: 'No se pudieron leer las extras pagadas: ' + error.message }
    extrasPagadas = Number(data ?? 0)
  }
  const { data: cat, error: catErr } = await client.from('liquidacion_concepto_catalogo').select('codigo_visual, politica, entrada, nombre, tipo_visual')
  if (catErr) return { datos: null, avisos, error: 'No se pudo leer el catálogo de Visual: ' + catErr.message }
  const catalogo = new Map<string, ConceptoCatalogo>(((cat ?? []) as any[]).map(c => [String(c.codigo_visual), { politica: c.politica, entrada: c.entrada, nombre: c.nombre, tipo_visual: c.tipo_visual }]))

  // Regla de la causal (catálogo baja_causa).
  let causal: ReglaCausal | null = null
  if (b.causa) {
    const { data: c } = await client.from('baja_causa').select('codigo, nombre, presentismo, evaluar').eq('codigo', b.causa).maybeSingle()
    if (c) causal = { codigo: c.codigo, nombre: c.nombre, presentismo: c.presentismo, evaluar: c.evaluar ?? [] }
  }

  // Vacaciones: las confirmadas en el registro de baja (no se piden de nuevo acá).
  const v = b.vacaciones
  const vacaciones = v && v.verificadas
    ? { saldoDias: v.devengadas ?? null, tomadasDias: v.tomadas ?? null, nota: v.nota ?? `método ${v.metodo ?? 'empresa'}` }
    : undefined
  if (!vacaciones) avisos.push('Las vacaciones no se confirmaron en el registro de baja: 208 queda pendiente.')

  const controlSAC = b.fecha_baja && p.cuil ? await mejorRemuneracionSemestre(client, p.cuil, b.fecha_baja) : null

  return {
    datos: {
      persona: p,
      baja: { fecha: b.fecha_baja, causa: b.causa, fechaIngreso: ingreso, causal },
      controlSAC,
      parametros: { basico: P.basico, horaExtra: P.horaExtra, valorDia, conteoSAC: CONTEO_SAC_CONFIRMADO },
      ordinarios: ord,
      yaLiquidado,
      extrasPagadas,
      catalogo,
      entradas: { ...(f.entradas ?? {}), vacaciones },
    },
    avisos,
    error: null,
  }
}

/**
 * Mejor remuneración imponible del semestre de la baja según los resultados de
 * Visual importados (base legal del SAC). Sólo control: si no hay datos, null.
 */
async function mejorRemuneracionSemestre(client: any, cuil: string, fechaBaja: string): Promise<{ mejorRemuneracion: number; mes: string } | null> {
  try {
    const anio = fechaBaja.slice(0, 4)
    const desde = Number(fechaBaja.slice(5, 7)) <= 6 ? `${anio}-01` : `${anio}-07`
    const hasta = fechaBaja.slice(0, 7)
    const { data, error } = await client.from('liquidacion_resultado_fila')
      .select('imponible, resultado:liquidacion_resultado_visual!inner(vigente, periodo:liquidacion_periodo!inner(mes))')
      .eq('cuil', cuil).eq('resultado.vigente', true)
    if (error || !data) return null
    let mejor: { mejorRemuneracion: number; mes: string } | null = null
    for (const r of data as any[]) {
      const mes = r?.resultado?.periodo?.mes
      const imp = Number(r?.imponible ?? 0)
      if (!mes || mes < desde || mes > hasta || !(imp > 0)) continue
      if (!mejor || imp > mejor.mejorRemuneracion) mejor = { mejorRemuneracion: imp, mes }
    }
    return mejor
  } catch {
    return null
  }
}

/** Calcula y guarda una versión nueva (o nada, si el cálculo no cambió). */
export async function calcularYGuardar(client: any, f: FinalFila): Promise<{ resultado: ResultadoLiquidacionFinal | null; version: number | null; sinCambios: boolean; error: string | null }> {
  const ctx = await contextoDeFinal(client, f)
  if (ctx.error || !ctx.datos) return { resultado: null, version: null, sinCambios: false, error: ctx.error ?? 'sin datos' }
  const res = calcularLiquidacionFinal(ctx.datos)
  res.advertencias.unshift(...ctx.avisos)
  const hash = await sha256Hex(jsonEstable({ lineas: res.lineas, faltantes: res.faltantes, advertencias: res.advertencias, calculo: res.calculo }))
  const { data, error } = await client.rpc('liquidacion_final_guardar_calculo', {
    p_final_id: f.id, p_version: f.version, p_hash: hash, p_calculo: res.calculo,
    p_lineas: res.lineas, p_faltantes: res.faltantes, p_advertencias: res.advertencias,
  })
  if (error) return { resultado: res, version: null, sinCambios: false, error: error.message }
  return { resultado: res, version: Number((data as any)?.version ?? 0), sinCambios: Boolean((data as any)?.sin_cambios), error: null }
}

/** Excel de trabajo del borrador guardado (no recalcula: muestra lo guardado). */
export async function excelDeFinal(client: any, f: FinalFila): Promise<{ buf: ArrayBuffer | null; nombre: string; error: string | null }> {
  if (!f.calculo) return { buf: null, nombre: '', error: 'El borrador todavía no se calculó.' }
  const { data: lineas, error } = await lineasDeFinal(client, f.id)
  if (error) return { buf: null, nombre: '', error }
  const p = await persona(client, f.baja)
  const { escribirExcelLiquidacionFinal } = await import('@/lib/liquidacion-final-excel')
  const buf = await escribirExcelLiquidacionFinal(
    { finalId: f.id, version: f.version, nombre: p.nombre, cuil: p.cuil, legajoVisual: p.legajoVisual, causa: f.calculo.causal?.nombre ?? f.baja.causa, fuente: f.baja.origen, visualPeriodo: f.calculo.visualPeriodo },
    { lineas: lineas as any, faltantes: f.faltantes, advertencias: f.advertencias, calculo: f.calculo },
  )
  return { buf, nombre: `liquidacion_final_${(p.nombre || 'persona').replace(/\W+/g, '_')}_v${f.version}.xlsx`, error: null }
}

/**
 * Genera el .xls de Visual con las líneas guardadas y registra la exportación.
 * El hash es del CONTENIDO (líneas), así un reintento genera el mismo hash.
 */
export async function exportarFinal(client: any, f: FinalFila): Promise<{ bytes: Uint8Array | null; nombre: string; repetida: boolean; error: string | null }> {
  const { data: lineas, error } = await lineasDeFinal(client, f.id)
  if (error) return { bytes: null, nombre: '', repetida: false, error }
  if (!lineas.length) return { bytes: null, nombre: '', repetida: false, error: 'El borrador no tiene conceptos.' }
  const p = await persona(client, f.baja)
  if (!p.cuil || !p.legajoVisual) return { bytes: null, nombre: '', repetida: false, error: 'Falta CUIL o legajo de Visual.' }
  const filas = filasVisualFinal(lineas as any, p)
  const hash = await sha256Hex(jsonEstable(filas))
  const periodo = (f.calculo?.visualPeriodo ?? f.mes ?? '').replace(/[^\w]+/g, '_')
  const nombre = `visual_liquidacion_final_${p.legajoVisual.replace(/\W+/g, '_')}_${periodo}.xls`
  const { escribirLibroVisualXls } = await import('@/lib/visual-export')
  const bytes = await escribirLibroVisualXls(filas)
  const { data, error: e2 } = await client.rpc('liquidacion_final_exportar', { p_final_id: f.id, p_version: f.version, p_archivo: nombre, p_hash: hash })
  if (e2) return { bytes: null, nombre, repetida: false, error: e2.message }
  return { bytes, nombre, repetida: Boolean((data as any)?.repetida), error: null }
}

/**
 * Conceptos de la persona en la Planilla de Sueldos de Visual. Una columna del
 * mismo código que vuelve en cero junto a otra con importe (Visual repite el 212
 * con dos nombres) se descarta y se avisa; dos con importe se dejan y la base
 * rechaza el archivo (no se suman a ciegas).
 */
export function conceptosDePersona(grid: CeldaVisual[][], cuil: string): { conceptos: { codigo: string; nombre: string; cantidad: number | null; importe: number | null }[]; avisos: string[]; error: string | null } {
  const p = parsearPlanillaVisual(grid)
  if (p.filaEncabezado < 0) return { conceptos: [], avisos: p.advertencias, error: 'No se reconoció la Planilla de Sueldos de Visual.' }
  const propias = p.lineas.filter(l => String(l.cuil ?? '').replace(/\D/g, '') === cuil)
  if (!propias.length) return { conceptos: [], avisos: [], error: `El archivo no trae al CUIL ${cuil}.` }
  const avisos: string[] = []
  const porCodigo = new Map<string, typeof propias>()
  for (const l of propias) porCodigo.set(l.codigo, [...(porCodigo.get(l.codigo) ?? []), l])
  const conceptos: { codigo: string; nombre: string; cantidad: number | null; importe: number | null }[] = []
  for (const [codigo, ls] of Array.from(porCodigo.entries())) {
    let usar = ls
    if (ls.length > 1) {
      const conImporte = ls.filter(l => Number(l.importe ?? 0) !== 0)
      if (conImporte.length >= 1) { usar = conImporte; avisos.push(`${codigo}: Visual lo trae ${ls.length} veces; se toma la columna con importe.`) }
    }
    for (const l of usar) conceptos.push({ codigo, nombre: l.concepto, cantidad: l.cantidad, importe: l.importe })
  }
  return { conceptos, avisos, error: null }
}

export async function importarResultadoFinal(client: any, f: FinalFila, archivo: string, buf: ArrayBuffer) {
  const p = await persona(client, f.baja)
  if (!p.cuil) return { error: 'La baja no tiene CUIL.', avisos: [] as string[], version: null as number | null, repetido: false }
  const XLSX: any = await import('xlsx')
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
  const grid: CeldaVisual[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null })
  const r = conceptosDePersona(grid, p.cuil)
  if (r.error) return { error: r.error, avisos: r.avisos, version: null, repetido: false }
  const hash = await sha256Hex(buf)
  const { data, error } = await client.rpc('liquidacion_final_importar_resultado', { p_final_id: f.id, p_archivo: archivo, p_hash: hash, p_conceptos: r.conceptos })
  if (error) return { error: error.message, avisos: r.avisos, version: null, repetido: false }
  return { error: null, avisos: r.avisos, version: Number((data as any)?.version ?? 0), repetido: Boolean((data as any)?.repetido) }
}

export async function conciliacionFinal(client: any, finalId: string) {
  const { data, error } = await client.rpc('liquidacion_final_conciliacion', { p_final_id: finalId })
  return { data: (data ?? []) as { codigo: string; entrada: string | null; cantidad_enviada: number | null; total_enviado: number | null; cantidad_visual: number | null; importe_visual: number | null; estado: string }[], error: error?.message ?? null }
}
