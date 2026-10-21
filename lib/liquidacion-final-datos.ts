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
import { diferenciasDeHoja, leerHojasLiquidacionFinal, type DiferenciasHoja } from '@/lib/liquidacion-final-lote'
import { plantillaLiquidacionResumenGuardia, type FilaResumenGuardia, type ParametrosLiquidacion, type PlantillaLiquidacion } from '@/lib/resumen-guardia'

/** Parámetros del mes con los editados en el Excel de las finales (hora/día null = vuelven a la fórmula). */
export function conParametros(P: ParametrosLiquidacion, extra?: EntradasFinal['parametros'] | null): ParametrosLiquidacion {
  if (!extra) return P
  const out: ParametrosLiquidacion = { ...P }
  for (const [k, v] of Object.entries(extra)) {
    if (k === 'hora' || k === 'dia') (out as any)[k] = v ?? null
    else if (v != null) (out as any)[k] = Number(v)
  }
  return out
}
import {
  COL_FINAL, SIN_USUARIO, anexarColumnasFinal, codigosDeColumnas, correccionesDeVista, diferenciasFinalMensual, leerHojaFinalMensual,
  type DiferenciaMensual, type FilaFinalMensual, type GuardadoFinal, type HojaFinalMensual,
} from '@/lib/liquidacion-final-mensual'

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
async function ordinarios(client: any, empleadoId: string, fechaBaja: string, advertencias: string[], correcciones?: Record<string, number | null> | null, parametros?: ParametrosLiquidacion): Promise<OrdinariosHastaBaja | null> {
  const mes = fechaBaja.slice(0, 7)
  const ajustes = correcciones && Object.keys(correcciones).length ? new Map([[empleadoId, correcciones]]) : undefined
  const r = await plantillaTrabajoDelMes(client, mes, ajustes, { parametros, recorte: { empleadoId, hasta: finDelMes(fechaBaja), hastaNovedades: fechaBaja } })
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
    // Jornadas corregidas en el Excel de trabajo (columna G) mandan sobre el conteo.
    jornadas: correcciones?.jornadas != null ? Number(correcciones.jornadas) : Number(fila?.jornadasReales ?? 0),
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
  const P = conParametros(await cargarParametrosDelMes(client, mes ?? new Date().toISOString().slice(0, 7)), f.entradas?.parametros)
  const hora = P.hora != null ? Number(P.hora) : P.basico / 200
  const valorDia = P.dia != null ? Number(P.dia) : hora * 8

  let ord: OrdinariosHastaBaja | null = null
  if (b.fecha_baja && b.empleado_id) ord = await ordinarios(client, b.empleado_id, b.fecha_baja, avisos, f.entradas?.ordinarios, f.entradas?.parametros ? P : undefined)
  if (f.entradas?.parametros && Object.keys(f.entradas.parametros).length) avisos.push(`Parámetros editados en el Excel de las finales: ${Object.entries(f.entradas.parametros).map(([k, v]) => `${k} ${v ?? 'fórmula'}`).join(', ')}.`)
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
  // Si se completaron después (Excel de trabajo o pantalla), mandan esas; si no, las
  // confirmadas en la baja. Sin ninguna, 208 queda pendiente (nunca se asume cero).
  const e = f.entradas?.vacaciones
  const vacaciones = e && e.saldoDias != null && e.tomadasDias != null
    ? { saldoDias: e.saldoDias, tomadasDias: e.tomadasDias, nota: e.nota ?? 'cargadas después de la baja' }
    : v && v.verificadas
      ? { saldoDias: v.devengadas ?? null, tomadasDias: v.tomadas ?? null, nota: v.nota ?? `método ${v.metodo ?? 'empresa'}` }
      : undefined
  if (!vacaciones) avisos.push('Faltan las vacaciones (no se confirmaron en la baja ni se cargaron después): 208 queda pendiente.')

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

// ── Lote: todas las finales a la vez (Excel de trabajo ida y vuelta + Visual) ──

/** Excel de trabajo con todas las finales indicadas (una hoja por persona). */
export async function excelDeLote(client: any, finales: FinalFila[]): Promise<{ buf: ArrayBuffer | null; nombre: string; error: string | null }> {
  const items = []
  for (const f of finales) {
    if (!f.calculo) continue
    const { data: lineas, error } = await lineasDeFinal(client, f.id)
    if (error) return { buf: null, nombre: '', error }
    const p = await persona(client, f.baja)
    items.push({
      cab: { finalId: f.id, version: f.version, nombre: p.nombre, cuil: p.cuil, legajoVisual: p.legajoVisual, causa: f.calculo.causal?.nombre ?? f.baja.causa, fuente: f.baja.origen, visualPeriodo: f.calculo.visualPeriodo },
      res: { lineas: lineas as any, faltantes: f.faltantes, advertencias: f.advertencias, calculo: f.calculo },
      estado: f.estado, fechaBaja: f.baja.fecha_baja,
    })
  }
  if (!items.length) return { buf: null, nombre: '', error: 'No hay liquidaciones finales calculadas para bajar.' }
  const { escribirLibroLiquidacionesFinales } = await import('@/lib/liquidacion-final-excel')
  const hoy = new Date().toISOString().slice(0, 10)
  return { buf: await escribirLibroLiquidacionesFinales(items), nombre: `liquidaciones_finales_${hoy}.xlsx`, error: null }
}

export type DiferenciaLote = DiferenciasHoja & { persona?: string | null }

/** Lee el Excel de trabajo devuelto y arma las diferencias por persona (no guarda nada). */
export async function analizarExcelLote(client: any, buf: ArrayBuffer): Promise<{ diferencias: DiferenciaLote[]; error: string | null }> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const hojas = leerHojasLiquidacionFinal(wb)
  if (!hojas.length) return { diferencias: [], error: 'El archivo no tiene hojas de liquidación final (bajalo desde Liquidaciones finales).' }
  const diferencias: DiferenciaLote[] = []
  for (const h of hojas) {
    const { data: f } = await leerFinal(client, h.finalId)
    if (!f) { diferencias.push({ hoja: h.hoja, finalId: h.finalId, version: h.version, cambios: [], errores: ['No se encontró esa liquidación final (¿anulada?).'], entradas: null }); continue }
    const { data: lineas } = await lineasDeFinal(client, f.id)
    diferencias.push({
      ...diferenciasDeHoja(h, {
        version: f.version, estado: f.estado, entradas: f.entradas ?? {},
        vacaciones: { saldo: f.calculo?.vacaciones.saldo ?? null, tomadas: f.calculo?.vacaciones.tomadas ?? null },
        visualPeriodo: f.calculo?.visualPeriodo ?? f.entradas?.visualPeriodo ?? null,
      }, lineas as any),
      persona: f.baja.nombre,
    })
  }
  return { diferencias, error: null }
}

/**
 * Aplica las diferencias sin errores: guarda el legajo de Visual escrito en el
 * Excel (si vino), las entradas (con control de versión) y recalcula.
 */
export async function aplicarDiferenciasLote(client: any, diferencias: { finalId: string; version: number; entradas: EntradasFinal | null; legajoVisual?: { usuarioId: string; valor: string } | null }[]) {
  const resultado: { finalId: string; ok: boolean; error: string | null }[] = []
  for (const d of diferencias) {
    if (!d.entradas && !d.legajoVisual) continue
    if (d.legajoVisual) {
      const { error } = await client.rpc('actualizar_identidad_usuario', { p_usuario_id: d.legajoVisual.usuarioId, p_cuil: null, p_legajo_visual: d.legajoVisual.valor, p_cuenta: null })
      if (error) { resultado.push({ finalId: d.finalId, ok: false, error: 'Legajo de Visual: ' + error.message }); continue }
    }
    if (d.entradas) {
      const { error } = await client.rpc('liquidacion_final_guardar_entradas', { p_final_id: d.finalId, p_entradas: d.entradas, p_version: d.version })
      if (error) { resultado.push({ finalId: d.finalId, ok: false, error: error.message }); continue }
    }
    const { data: f } = await leerFinal(client, d.finalId)
    const r = f ? await calcularYGuardar(client, f) : { error: 'No se pudo releer' }
    resultado.push({ finalId: d.finalId, ok: !r.error, error: r.error ?? null })
  }
  return resultado
}

/** Aprueba (marca lista) los borradores calculados sin pendientes. */
export async function aprobarSinPendientes(client: any, finales: FinalFila[]) {
  const out: { finalId: string; ok: boolean; error: string | null }[] = []
  for (const f of finales.filter(x => x.estado === 'borrador' && !x.requiere_recalculo && (x.faltantes?.length ?? 0) === 0)) {
    const { error } = await client.rpc('liquidacion_final_marcar_lista', { p_final_id: f.id, p_version: f.version })
    out.push({ finalId: f.id, ok: !error, error: error?.message ?? null })
  }
  return out
}

/**
 * EXPORTAR LIQUIDACIONES FINALES: un solo .xls de Visual con las personas
 * indicadas (aprobadas, o ya exportadas para volver a bajarlo). Cada una se
 * registra con su hash de contenido (las mismas reglas de doble pago que el
 * individual); las rechazadas no entran al archivo y se informan.
 */
export async function exportarLote(client: any, finales: FinalFila[]): Promise<{ bytes: Uint8Array | null; nombre: string; incluidas: string[]; rechazadas: { persona: string; error: string }[] }> {
  const hoy = new Date().toISOString().slice(0, 10)
  const nombre = `visual_liquidaciones_finales_${hoy}.xls`
  const incluidas: string[] = []
  const rechazadas: { persona: string; error: string }[] = []
  const filas: ReturnType<typeof filasVisualFinal> = []
  for (const f of finales.filter(x => ['lista', 'exportada'].includes(x.estado))) {
    const quien = f.baja.nombre ?? f.baja.cuil ?? f.id
    const { data: lineas, error } = await lineasDeFinal(client, f.id)
    if (error || !lineas.length) { rechazadas.push({ persona: quien, error: error ?? 'sin conceptos' }); continue }
    const p = await persona(client, f.baja)
    if (!p.cuil || !p.legajoVisual) { rechazadas.push({ persona: quien, error: 'falta CUIL o legajo de Visual' }); continue }
    const propias = filasVisualFinal(lineas as any, p)
    const hash = await sha256Hex(jsonEstable(propias))
    const { error: e } = await client.rpc('liquidacion_final_exportar', { p_final_id: f.id, p_version: f.version, p_archivo: nombre, p_hash: hash })
    if (e) { rechazadas.push({ persona: quien, error: e.message }); continue }
    filas.push(...propias)
    incluidas.push(quien)
  }
  if (!filas.length) return { bytes: null, nombre, incluidas, rechazadas }
  const { escribirLibroVisualXls } = await import('@/lib/visual-export')
  return { bytes: await escribirLibroVisualXls(filas), nombre, incluidas, rechazadas }
}

/** Reimporta la Planilla de Sueldos de Visual para todas las finales exportadas que figuran en el archivo. */
export async function importarResultadoLote(client: any, finales: FinalFila[], archivo: string, buf: ArrayBuffer) {
  const XLSX: any = await import('xlsx')
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
  const grid: CeldaVisual[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null })
  const hash = await sha256Hex(buf)
  const out: { persona: string; ok: boolean; detalle: string }[] = []
  for (const f of finales.filter(x => x.estado === 'exportada')) {
    const p = await persona(client, f.baja)
    if (!p.cuil) continue
    const r = conceptosDePersona(grid, p.cuil)
    if (r.error) { if (!/no trae/.test(r.error)) out.push({ persona: p.nombre, ok: false, detalle: r.error }); continue }
    const { data, error } = await client.rpc('liquidacion_final_importar_resultado', { p_final_id: f.id, p_archivo: archivo, p_hash: hash, p_conceptos: r.conceptos })
    out.push({ persona: p.nombre, ok: !error, detalle: error ? error.message : (data as any)?.repetido ? 'ya estaba importado' : `versión ${(data as any)?.version}` })
  }
  return out
}

// ── Lote en el FORMATO DEL EXCEL DE TRABAJO MENSUAL (JC 21/10) ──────────────────

/** Fila vacía (sin actividad en el mes o sin usuario): mismas columnas, en cero. */
function filaSinActividad(id: string, p: Persona): FilaResumenGuardia {
  return {
    empleadoId: id, grupo: 'vigiladores', nombre: p.nombre, cuil: p.cuil, legajo: null, legajoVisual: p.legajoVisual, cuenta: null,
    objetivos: [], jornadas: 0, jornadasReales: 0, fechasConActividad: 0, horasReales: 0, horasLiquidables: 0,
    feriadosTrabajados: 0, horasEnFeriado: 0, horasNocturnas: 0, horasNocturnasCalculadas: 0, nocturnidadOrigen: null,
    licencias: null, art: null, vacaciones: null, parteMedico: null, ausenciasSuspensiones: null,
    notas: ['sin actividad registrada en el mes'], supervisiones: 0, horasSupervision: 0, jornadasSupervision: 0, hsVigilanciaZona: 0,
    observaciones: [], origen: { turnoIds: [], registroIds: [], novedadIds: [] },
  } as FilaResumenGuardia
}

interface PlanillaFinales {
  /** Planilla mensual con las filas de baja (sin las columnas de la final). */
  base: PlantillaLiquidacion
  /** La misma con las columnas de la liquidación final. */
  conFinal: PlantillaLiquidacion
  /** Rearma la planilla con correcciones adicionales por fila (para leer lo editado). */
  armar: (extra: Map<string, Record<string, number | null>>, parametros?: Partial<ParametrosLiquidacion>) => PlantillaLiquidacion
  guardados: Map<string, GuardadoFinal>
}

/**
 * Planilla del mes con una fila por baja, cada una con el MISMO recorte que usa
 * el cálculo de la final (jornadas efectivamente trabajadas del mes, novedades
 * cortadas en la fecha efectiva) y sus correcciones guardadas.
 */
async function planillaFinalesDelMes(client: any, mes: string, finales: FinalFila[]): Promise<{ data: PlanillaFinales | null; error: string | null }> {
  const filas: FilaResumenGuardia[] = []
  const sueldo = new Map<string, number>()
  const extra = new Map<string, number>()
  const ajustesBase = new Map<string, Record<string, number | null>>()
  const porFinal: { f: FinalFila; uid: string; conUsuario: boolean; p: Persona; lineas: any[] }[] = []
  // Parámetros: los del mes con los editados en este Excel (iguales para todas las finales de la hoja).
  const P = conParametros(await cargarParametrosDelMes(client, mes), finales.find(f => f.entradas?.parametros)?.entradas?.parametros)
  const plantillaVacia = plantillaLiquidacionResumenGuardia({ mes, filas: [], totales: { empleados: 0, jornadas: 0, horasReales: 0, horasLiquidables: 0, horasNocturnas: 0, feriadosTrabajados: 0 } }, undefined, undefined, undefined, P)
  const colsPorCodigo = codigosDeColumnas(plantillaVacia)
  for (const f of finales) {
    const b = f.baja
    const p = await persona(client, b)
    const { data: lineas, error: le } = await lineasDeFinal(client, f.id)
    if (le) return { data: null, error: le }
    let fila: FilaResumenGuardia | null = null
    if (b.empleado_id && b.fecha_baja) {
      const r = await plantillaTrabajoDelMes(client, mes, undefined, { recorte: { empleadoId: b.empleado_id, hasta: finDelMes(b.fecha_baja), hastaNovedades: b.fecha_baja } })
      if (r.error) return { data: null, error: `${p.nombre}: ${r.error}` }
      fila = r.resumen?.filas.find(x => x.empleadoId === b.empleado_id) ?? null
      if (r.sueldoMensual?.has(b.empleado_id)) sueldo.set(b.empleado_id, r.sueldoMensual.get(b.empleado_id)!)
      if (r.extraMensual?.has(b.empleado_id)) extra.set(b.empleado_id, r.extraMensual.get(b.empleado_id)!)
    }
    const uid = fila ? fila.empleadoId : (b.empleado_id ?? `${SIN_USUARIO}${b.id}`)
    // La columna A muestra el legajo con que se exporta (padrón de Visual o usuario).
    filas.push(fila ? { ...fila, legajoVisual: p.legajoVisual } : filaSinActividad(uid, p))
    const ajustes = (f.entradas?.ajustes ?? []).map(a => ({ codigo: String(a.codigo), total: Number((lineas as any[]).find(l => l.codigo === String(a.codigo))?.total ?? 0) }))
    ajustesBase.set(uid, {
      ...(fila ? (f.entradas?.ordinarios ?? {}) : {}),
      ...correccionesDeVista(colsPorCodigo, ajustes, f.calculo?.presentismo ?? null),
    })
    porFinal.push({ f, uid, conUsuario: Boolean(fila), p, lineas: lineas as any[] })
  }
  const resumen = { mes, filas, totales: { empleados: filas.length, jornadas: 0, horasReales: 0, horasLiquidables: 0, horasNocturnas: 0, feriadosTrabajados: 0 } }
  const armar = (mas: Map<string, Record<string, number | null>>, parametros?: Partial<ParametrosLiquidacion>) => {
    const unidos = new Map(ajustesBase)
    for (const [uid, m] of Array.from(mas.entries())) unidos.set(uid, { ...(unidos.get(uid) ?? {}), ...m })
    return plantillaLiquidacionResumenGuardia(resumen, unidos, sueldo, extra, conParametros(P, parametros as any))
  }
  const base = armar(new Map())
  const filasFinal = new Map<string, FilaFinalMensual>()
  for (const { f, uid, p } of porFinal) {
    const c = f.calculo
    const ajustados: FilaFinalMensual['ajustados'] = {}
    for (const a of f.entradas?.ajustes ?? []) {
      const cod = String(a.codigo)
      if (cod === '120003' || cod === '208' || cod === '217' || cod === '212') ajustados[cod] = Number(porFinal.find(x => x.f.id === f.id)!.lineas.find(l => l.codigo === cod)?.total ?? 0)
    }
    const avisos = (f.faltantes ?? []).map(x => x.detalle)
    if (!p.legajoVisual) avisos.unshift('Falta el legajo de Visual: escribilo en la columna A cuando Visual lo asigne.')
    if (f.requiere_recalculo) avisos.push('Borrador con cambios sin recalcular: abrí Liquidaciones finales para recalcular y volvé a bajar el Excel.')
    filasFinal.set(uid, {
      finalId: f.id, version: f.version, usuarioId: uid, fechaBaja: f.baja.fecha_baja,
      causa: c?.causal?.nombre ?? f.baja.causa ?? null,
      vacSaldo: c?.vacaciones.saldo ?? null, vacTomadas: c?.vacaciones.tomadas ?? null, diasSAC: c?.fechas.diasSAC ?? null,
      sueldoFijo: Boolean(ordinariosDePlantilla(base, uid)?.sueldoFijo), extrasPagadas: Number(c?.extras.pagado ?? 0),
      ajustados, totalApp: Number(c?.total ?? 0), visualPeriodo: c?.visualPeriodo ?? f.entradas?.visualPeriodo ?? null, avisos,
    })
  }
  const conFinal = { ...anexarColumnasFinal(base, filasFinal), nombreHoja: `Finales ${mes}` }
  const valorEn = new Map(conFinal.celdas.map(x => [x.ref, x.v]))
  const filaDe = new Map<string, number>()
  for (const x of conFinal.celdas) { const m = x.ref.match(/^BD(\d+)$/); if (m) filaDe.set(String(x.v ?? ''), Number(m[1])) }
  const guardados = new Map<string, GuardadoFinal>()
  for (const { f, uid, conUsuario, p } of porFinal) {
    const r = filaDe.get(uid)
    const leer = (col: string) => { if (r == null) return null; const v = valorEn.get(`${col}${r}`); return v === undefined || v === '' ? null : Number(v) }
    guardados.set(f.id, {
      finalId: f.id, version: f.version, estado: f.estado, persona: p.nombre, conUsuario,
      entradas: f.entradas ?? {},
      vacaciones: { saldo: f.calculo?.vacaciones.saldo ?? null, tomadas: f.calculo?.vacaciones.tomadas ?? null },
      visualPeriodo: f.calculo?.visualPeriodo ?? f.entradas?.visualPeriodo ?? null,
      mostrado: { '120003': leer(COL_FINAL.c120003), '208': leer(COL_FINAL.c208), '217': leer(COL_FINAL.c217), '212': leer(COL_FINAL.c212) },
    })
  }
  return { data: { base, conFinal, armar, guardados }, error: null }
}

/** Mes de la baja de cada final (las que no tienen fecha no van al Excel). */
const mesDeFinal = (f: FinalFila) => (f.baja.fecha_baja ? f.baja.fecha_baja.slice(0, 7) : null)

/**
 * EXCEL DE TRABAJO de las finales con el formato del mensual: una solapa por mes
 * de baja, una fila por persona y, al final, las columnas de la liquidación.
 */
export async function excelDeLoteMensual(client: any, finales: FinalFila[]): Promise<{ buf: ArrayBuffer | null; nombre: string; error: string | null; omitidas: string[] }> {
  const omitidas: string[] = []
  const porMes = new Map<string, FinalFila[]>()
  for (const f of finales) {
    const mes = mesDeFinal(f)
    if (!f.calculo || !mes) { omitidas.push(f.baja.nombre ?? f.baja.cuil ?? f.id); continue }
    porMes.set(mes, [...(porMes.get(mes) ?? []), f])
  }
  if (!porMes.size) return { buf: null, nombre: '', error: 'No hay liquidaciones finales calculadas para bajar.', omitidas }
  const hojas: { nombre: string; plantilla: PlantillaLiquidacion }[] = []
  for (const mes of Array.from(porMes.keys()).sort().reverse()) {
    const r = await planillaFinalesDelMes(client, mes, porMes.get(mes)!)
    if (r.error || !r.data) return { buf: null, nombre: '', error: r.error ?? 'No se pudo armar la planilla', omitidas }
    hojas.push({ nombre: `Finales ${mes}`, plantilla: r.data.conFinal })
  }
  const { escribirLibroMultiMes } = await import('@/lib/liquidacion-xlsx')
  const hoy = new Date().toISOString().slice(0, 10)
  return { buf: await escribirLibroMultiMes(hojas), nombre: `liquidaciones_finales_${hoy}.xlsx`, error: null, omitidas }
}

/**
 * Lee el Excel de finales en formato mensual. `formato: 'otro'` = el archivo no
 * es de este formato (puede ser el de una hoja por persona).
 */
export async function analizarExcelLoteMensual(client: any, buf: ArrayBuffer): Promise<{ formato: 'mensual' | 'otro'; diferencias: DiferenciaMensual[]; avisos: string[]; error: string | null }> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buf)
  const hojas: HojaFinalMensual[] = []
  wb.eachSheet((ws: any) => { const h = leerHojaFinalMensual(ws); if (h) hojas.push(h) })
  if (!hojas.length) return { formato: 'otro', diferencias: [], avisos: [], error: null }
  const diferencias: DiferenciaMensual[] = []
  const avisos: string[] = []
  for (const h of hojas) {
    const finales: FinalFila[] = []
    for (const l of h.filas) {
      const { data: f } = await leerFinal(client, l.finalId)
      if (f) finales.push(f)
      else diferencias.push({ hoja: h.nombre, finalId: l.finalId, version: l.version, persona: l.usuarioId, cambios: [], errores: ['No se encontró esa liquidación final (¿anulada?).'], noTomados: [], entradas: null, legajoVisual: null })
    }
    const meses = Array.from(new Set(finales.map(mesDeFinal).filter(Boolean))) as string[]
    for (const mes of meses) {
      const delMes = finales.filter(f => mesDeFinal(f) === mes)
      const r = await planillaFinalesDelMes(client, mes, delMes)
      if (r.error || !r.data) return { formato: 'mensual', diferencias: [], avisos, error: r.error ?? 'No se pudo armar la planilla' }
      const ids = new Set(delMes.map(f => f.id))
      const res = diferenciasFinalMensual({ ...h, filas: h.filas.filter(l => ids.has(l.finalId)) }, r.data.base, r.data.armar, r.data.guardados)
      diferencias.push(...res.diferencias)
      avisos.push(...res.avisos)
    }
  }
  return { formato: 'mensual', diferencias, avisos, error: null }
}
