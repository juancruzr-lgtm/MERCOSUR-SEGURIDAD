// lib/excel-trabajo-liquidacion.ts
//
// LIQ2A — Generador del "Excel de trabajo de liquidación" a partir de un MES,
// desacoplado del estado de la pantalla de Reportes. Es el MISMO archivo que
// exportaba `exportarResumenGuardiaMensualXLSX` (el generador de #170), pero
// parametrizado por mes para poder emitirse desde un período de Liquidación
// cuyo mes no es necesariamente el mes cargado en Reportes.
//
// No calcula nada nuevo: reúne exactamente las mismas fuentes del mes que el
// Resumen Guardia (turnos, registros, novedades, supervisores, supervisiones)
// más los globales (objetivos, supervisor_zonas, nocturnidad), arma la
// PlantillaLiquidacion canónica y la escribe con el formato de lib/liquidacion-xlsx.
// La identidad técnica oculta (BD=usuario_id, BE=periodo) viaja en la plantilla
// para el reimport de LIQ2B.
//
// Todo económico → esta función se llama SÓLO desde la pantalla de Liquidación
// (Gerencia). Las consultas usan el cliente que se le pase (navegador o server).

import { fetchPaginadoResult } from '@/lib/fetch-paginado'
import {
  construirResumenGuardia,
  plantillaLiquidacionResumenGuardia,
  type EmpleadoResumen,
  type PlantillaLiquidacion,
  type CeldaPlantilla,
  type ResumenGuardiaMes,
} from '@/lib/resumen-guardia'

export interface GenerarExcelTrabajoResultado {
  buf: ArrayBuffer | null
  filas: number
  error: string | null
}

export interface PlantillaTrabajoResultado {
  plantilla: PlantillaLiquidacion | null
  filas: number
  error: string | null
  /** Resumen crudo (para leer jornadas reales por empleado, etc.). */
  resumen?: ResumenGuardiaMes | null
  /** SUELDO MENSUAL vigente del mes por usuario_id (quien lo tiene cobra fijo). */
  sueldoMensual?: Map<string, number>
}

/** Límites [desde, hasta] (inclusive, formato YYYY-MM-DD) del mes 'YYYY-MM'. */
function limitesDelMes(mes: string): { desde: string; hasta: string; y: number; m: number } {
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(y, m, 0).getDate()
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, '0')}`, y, m }
}

/**
 * Genera el Excel de trabajo del mes. `client` es un cliente de Supabase
 * (el del navegador en la pantalla de Liquidación). Devuelve el buffer del
 * .xlsx listo para descargar, o un error legible.
 */
export async function generarExcelTrabajoLiquidacion(
  client: any,
  mes: string,
  opts?: { periodoId?: string },
): Promise<GenerarExcelTrabajoResultado> {
  // El Excel de trabajo EDITABLE refleja el estado ACTUAL de la liquidación: si
  // el período ya tiene ajustes/reimportaciones cargados, se aplican, para que
  // una nueva descarga no represente el estado previo a las correcciones (JC).
  // Sin periodoId (uso genérico por mes) sale el baseline, como antes.
  const ajustes = opts?.periodoId ? await cargarAjustes(client, opts.periodoId) : undefined
  const { plantilla, filas, error } = await plantillaTrabajoDelMes(client, mes, ajustes)
  if (error || !plantilla) return { buf: null, filas, error }
  const plant2 = await anexarColumnaSindicato(client, plantilla, mes)
  const { escribirPlantillaLiquidacionXLSX } = await import('@/lib/liquidacion-xlsx')
  const buf = await escribirPlantillaLiquidacionXLSX(plant2)
  return { buf, filas, error: null }
}

/**
 * Anexa al FINAL del Excel de trabajo una columna "SINDICATO" (marca específica,
 * NO texto libre): "X" para los empleados que ya tienen el permanente 104
 * (Sindicato) activo y vigente en el mes. El liquidador marca "X" en los que se
 * afilian; al reimportar, la marca da de alta el permanente (ver RPC
 * afiliar_sindicato_permanente). La columna va DESPUÉS de todas las existentes
 * (hoy BG → cae en BH), para no correr los índices fijos del reimport
 * (IDX_SINDICATO en lib/excel-trabajo-reimport.ts debe coincidir con esa posición).
 */
async function anexarColumnaSindicato(
  client: any, plantilla: PlantillaLiquidacion, mes: string,
): Promise<PlantillaLiquidacion> {
  const { desde, hasta } = limitesDelMes(mes)
  const { data } = await client.from('liquidacion_concepto_permanente')
    .select('empleado_id, vigencia_desde, vigencia_hasta, activo, concepto:concepto_id(codigo_visual)')
    .eq('activo', true)
  const afiliados = new Set<string>()
  for (const p of (data ?? []) as any[]) {
    if (p?.concepto?.codigo_visual !== '104' || !p.empleado_id) continue
    const vd = String(p.vigencia_desde ?? '')
    const vh = p.vigencia_hasta ? String(p.vigencia_hasta) : null
    if (vd && vd <= hasta && (!vh || vh >= desde)) afiliados.add(String(p.empleado_id))
  }
  const nextCol = NUM_A_COL(Math.max(...plantilla.columnas.map(c => COL_A_NUM(c.col))) + 1)
  const enc = plantilla.estilos.encabezado
  const celdas = [...plantilla.celdas, { ref: `${nextCol}${enc}`, v: 'SINDICATO' }]
  const bdRow = new Map<number, string>()
  for (const c of plantilla.celdas) { const m = c.ref.match(/^BD(\d+)$/); if (m) bdRow.set(Number(m[1]), String(c.v ?? '')) }
  for (const r of plantilla.estilos.filasDatos) {
    const uid = bdRow.get(r); if (!uid) continue
    if (afiliados.has(uid)) celdas.push({ ref: `${nextCol}${r}`, v: 'X' })
  }
  const columnas = [...plantilla.columnas, { col: nextCol, width: 12 }]
  return { ...plantilla, celdas, columnas }
}

/**
 * LIBRO GENERAL: un solo .xlsx con TODOS los meses, una SOLAPA por período (el
 * último adelante, pedido de JC). Cada solapa = el Excel COMPLETO de ese mes
 * (`plantillaCompletaConNeto`, la MISMA preparación que el botón "Excel completo
 * (con totales)": ajustes guardados, NETO A PAGAR de Visual, totales, formato y
 * gráfico). Excluye los períodos anulados. Se arma en el momento desde los datos
 * guardados de cada período: nunca depende de tener a mano el archivo de un mes
 * anterior. Un mes que no se pudo armar NO se omite en silencio: vuelve en
 * `omitidos` con su motivo.
 */
export async function generarLibroGeneralTrabajo(
  client: any,
): Promise<LibroGeneralResultado> {
  const out: LibroGeneralResultado = {
    buf: null, meses: 0, periodos: [], omitidos: [], visualPendiente: [], difierenDeConsolidada: [], error: null,
  }
  const { data: periodos, error } = await client.from('liquidacion_periodo')
    .select('id, mes, estado').neq('estado', 'anulado').order('mes', { ascending: false })
  if (error) return { ...out, error: error.message || String(error) }
  // Orden explícito (más reciente primero) aunque la consulta ya lo pida: el
  // orden de las solapas es parte del contrato del libro.
  const lista = ((periodos ?? []) as Array<{ id: string; mes: string; estado?: string }>)
    .filter(p => p.estado !== 'anulado')
    .sort((a, b) => String(b.mes).localeCompare(String(a.mes)))
  if (lista.length === 0) return { ...out, error: 'No hay períodos para el libro general.' }

  const hojas: { nombre: string; plantilla: PlantillaLiquidacion }[] = []
  for (const p of lista) {
    const r = await plantillaCompletaConNeto(client, { id: p.id, mes: p.mes })
    if (r.error || !r.plantilla) { out.omitidos.push({ mes: p.mes, error: r.error || 'sin plantilla' }); continue }
    hojas.push({ nombre: p.mes, plantilla: r.plantilla })
    out.periodos.push(p.mes)
    if (r.visualPendiente) out.visualPendiente.push(p.mes)
    if (r.difiereDeConsolidada) out.difierenDeConsolidada.push(p.mes)
  }
  if (hojas.length === 0) return { ...out, error: 'No se pudo construir ningún mes.' }

  const { escribirLibroMultiMes } = await import('@/lib/liquidacion-xlsx')
  const buf = await escribirLibroMultiMes(hojas)
  return { ...out, buf, meses: hojas.length }
}

export interface LibroGeneralResultado {
  buf: ArrayBuffer | null
  meses: number
  /** Meses incluidos, en el orden de las solapas (más reciente primero). */
  periodos: string[]
  /** Meses que no se pudieron armar, con el motivo. */
  omitidos: { mes: string; error: string }[]
  /** Meses sin resultado de Visual: su NETO A PAGAR figura PENDIENTE. */
  visualPendiente: string[]
  /** Meses cuyos importes regenerados difieren del snapshot consolidado. */
  difierenDeConsolidada: string[]
  error: string | null
}

const COL_A_NUM = (col: string): number => { let n = 0; for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64); return n }
const NUM_A_COL = (n: number): string => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26) } return s }

/**
 * Neto de RECIBO (Visual) por usuario_id: sólo los que tienen recibo en Visual.
 * `hayResultado` distingue "el período todavía no tiene resultado de Visual"
 * (neto pendiente) de "tiene resultado pero esta persona no figura".
 */
async function netoReciboPorUsuario(client: any, periodoId: string): Promise<{ map: Map<string, number>; hayResultado: boolean }> {
  const map = new Map<string, number>()
  const { data: rv } = await client.from('liquidacion_resultado_visual')
    .select('id').eq('periodo_id', periodoId).eq('vigente', true).limit(1)
  const resId = ((rv ?? []) as any[])[0]?.id
  if (!resId) return { map, hayResultado: false }
  const [{ data: filas }, { data: personas }] = await Promise.all([
    client.from('liquidacion_resultado_fila').select('cuil, neto').eq('resultado_id', resId),
    client.from('liquidacion_persona').select('cuil, usuario_id'),
  ])
  const usuarioPorCuil = new Map<string, string>()
  for (const p of (personas ?? []) as any[]) if (p.cuil && p.usuario_id) usuarioPorCuil.set(String(p.cuil), String(p.usuario_id))
  for (const f of (filas ?? []) as any[]) {
    if (!f.cuil || f.neto == null) continue
    const uid = usuarioPorCuil.get(String(f.cuil))
    if (uid) map.set(uid, Number(f.neto))
  }
  return { map, hayResultado: true }
}

/**
 * Cuántos importes (empleado × código) del mes regenerado difieren del snapshot
 * CONGELADO en `liquidacion_consolidada` al exportar a Visual. null = el período
 * no tiene snapshot (todavía no se exportó). Verifica que la hoja de un mes
 * histórico coincide con lo que realmente se liquidó ese mes.
 */
async function diferenciasConConsolidada(
  client: any, periodoId: string, plantilla: PlantillaLiquidacion,
): Promise<number | null> {
  const { data } = await client.from('liquidacion_consolidada')
    .select('empleado_id, codigo, importe').eq('periodo_id', periodoId)
  const guardadas = (data ?? []) as any[]
  if (guardadas.length === 0) return null
  const key = (e: string, c: string) => `${e}|${c}`
  const antes = new Map<string, number>()
  for (const g of guardadas) antes.set(key(String(g.empleado_id), String(g.codigo)), Number(g.importe ?? 0))
  const ahora = new Map<string, number>()
  for (const f of filasConsolidadasDePlantilla(plantilla)) ahora.set(key(f.empleado_id, f.codigo), f.importe)
  let difs = 0
  for (const k of Array.from(new Set([...Array.from(antes.keys()), ...Array.from(ahora.keys())]))) {
    if (Math.abs((antes.get(k) ?? 0) - (ahora.get(k) ?? 0)) > 0.005) difs++
  }
  return difs
}

/**
 * Pagos por banco del período por usuario_id (RPC pagos_banco_por_usuario: la
 * MISMA regla que arma los archivos de Galicia). Sin la RPC (migración sin
 * aplicar) devuelve el error para avisarlo en la hoja.
 */
async function pagosBancoPorUsuario(client: any, periodoId: string): Promise<{ porUsuario: Map<string, { sueldo: number | null; extras: number | null }>; error: string | null }> {
  const porUsuario = new Map<string, { sueldo: number | null; extras: number | null }>()
  if (typeof client.rpc !== 'function') return { porUsuario, error: 'sin acceso a pagos' }
  const { data, error } = await client.rpc('pagos_banco_por_usuario', { p_periodo_id: periodoId })
  if (error) return { porUsuario, error: error.message || String(error) }
  for (const d of (data ?? []) as any[]) {
    porUsuario.set(String(d.usuario_id), {
      sueldo: d.sueldo == null ? null : Number(d.sueldo),
      extras: d.extras == null ? null : Number(d.extras),
    })
  }
  return { porUsuario, error: null }
}

export interface PlantillaCompletaResultado {
  plantilla: PlantillaLiquidacion | null
  filas: number
  netos: number
  /** El período no tiene resultado de Visual vigente: el NETO A PAGAR queda PENDIENTE. */
  visualPendiente: boolean
  /** Importes que difieren del snapshot consolidado (null = sin snapshot). */
  difiereDeConsolidada: number | null
  error: string | null
}

/**
 * Plantilla del Excel COMPLETO de un período = el Excel de trabajo (con los
 * ajustes guardados del período) + columna "NETO A PAGAR" AL FINAL con el neto
 * de recibo (Visual) de cada empleado que lo tiene, y el total al pie. FUENTE
 * ÚNICA de los dos botones de Pagos: el Excel completo individual y cada solapa
 * del libro general salen de acá, así no pueden diferir.
 *
 * - Sin resultado de Visual importado: las celdas de neto quedan vacías y el
 *   total dice PENDIENTE (un neto faltante no se presenta como $0 confirmado).
 * - Si el período ya se exportó a Visual, se compara contra el snapshot
 *   congelado (`liquidacion_consolidada`) y una diferencia se avisa en la hoja.
 * Sólo lee: no escribe nada en la base.
 */
export async function plantillaCompletaConNeto(
  client: any,
  periodo: { id: string; mes: string },
): Promise<PlantillaCompletaResultado> {
  const ajustes = await cargarAjustes(client, periodo.id)
  const { plantilla, filas, error, sueldoMensual } = await plantillaTrabajoDelMes(client, periodo.mes, ajustes)
  if (error || !plantilla) {
    return { plantilla: null, filas: 0, netos: 0, visualPendiente: false, difiereDeConsolidada: null, error: error || 'sin plantilla' }
  }

  const [{ map: netoMap, hayResultado }, difs, pagos] = await Promise.all([
    netoReciboPorUsuario(client, periodo.id),
    diferenciasConConsolidada(client, periodo.id, plantilla),
    pagosBancoPorUsuario(client, periodo.id),
  ])
  const sueldoFijo = sueldoMensual ?? new Map<string, number>()
  const base = COL_A_NUM(plantilla.columnas.reduce((m, c) => (COL_A_NUM(c.col) > COL_A_NUM(m) ? c.col : m), 'A'))
  // Al final: PAGO SUELDO | PAGO EXTRAS | TOTAL PAGADO | NETO A PAGAR (última).
  const cSueldo = NUM_A_COL(base + 1), cExtras = NUM_A_COL(base + 2), cTotal = NUM_A_COL(base + 3), cNeto = NUM_A_COL(base + 4)
  const enc = plantilla.estilos.encabezado
  const filaTotal = plantilla.estilos.total
  const celdas: CeldaPlantilla[] = [...plantilla.celdas,
    { ref: `${cSueldo}${enc}`, v: 'PAGO SUELDO' }, { ref: `${cExtras}${enc}`, v: 'PAGO EXTRAS' },
    { ref: `${cTotal}${enc}`, v: 'TOTAL PAGADO' }, { ref: `${cNeto}${enc}`, v: 'NETO A PAGAR' },
  ]
  const bdRow = new Map<number, string>()
  for (const c of plantilla.celdas) { const m = c.ref.match(/^BD(\d+)$/); if (m) bdRow.set(Number(m[1]), String(c.v ?? '')) }
  const r2 = (n: number) => Math.round(n * 100) / 100
  let total = 0, netos = 0, totSueldo = 0, totExtras = 0
  for (const r of plantilla.estilos.filasDatos) {
    const uid = bdRow.get(r); if (!uid) continue
    // NETO A PAGAR: quien tiene SUELDO MENSUAL cobra ese importe fijo (JC 07/10),
    // aunque Visual devuelva otro neto; el resto, el neto de recibo de Visual.
    const neto = sueldoFijo.has(uid) ? sueldoFijo.get(uid)! : netoMap.get(uid)
    if (neto != null) { celdas.push({ ref: `${cNeto}${r}`, v: r2(neto) }); total += neto; netos++ }
    // Pagos por banco (misma regla que los archivos de Galicia).
    const p = pagos.porUsuario.get(uid)
    if (p?.sueldo != null) { celdas.push({ ref: `${cSueldo}${r}`, v: r2(p.sueldo) }); totSueldo += p.sueldo }
    if (p?.extras != null) { celdas.push({ ref: `${cExtras}${r}`, v: r2(p.extras) }); totExtras += p.extras }
    if (p && (p.sueldo != null || p.extras != null)) celdas.push({ ref: `${cTotal}${r}`, v: r2((p.sueldo ?? 0) + (p.extras ?? 0)) })
  }
  // Totales: sin Visual, lo que depende de Visual queda PENDIENTE (no $0).
  const pend = 'PENDIENTE', nd = 'NO DISPONIBLE'
  celdas.push({ ref: `${cNeto}${filaTotal}`, v: hayResultado ? r2(total) : pend })
  celdas.push({ ref: `${cSueldo}${filaTotal}`, v: pagos.error ? nd : (hayResultado ? r2(totSueldo) : pend) })
  celdas.push({ ref: `${cExtras}${filaTotal}`, v: pagos.error ? nd : r2(totExtras) })
  celdas.push({ ref: `${cTotal}${filaTotal}`, v: pagos.error ? nd : (hayResultado ? r2(totSueldo + totExtras) : pend) })

  // Avisos del período en C4 (libre: A1:B4 parámetros, C1 título, C2:D3 auxiliares).
  const avisos: string[] = []
  if (!hayResultado) avisos.push('NETO A PAGAR pendiente: el período todavía no tiene resultado de Visual importado (los sueldos fijos sí figuran).')
  if (difs) avisos.push(`ATENCIÓN: ${difs} importe(s) difieren de lo consolidado al exportar a Visual.`)
  if (pagos.error) avisos.push('Pagos por banco no disponibles: ' + pagos.error)
  if (avisos.length) celdas.push({ ref: 'C4', v: avisos.join(' ') })

  const columnas = [...plantilla.columnas,
    { col: cSueldo, width: 16, numFmt: 'money' as const }, { col: cExtras, width: 14, numFmt: 'money' as const },
    { col: cTotal, width: 16, numFmt: 'money' as const }, { col: cNeto, width: 16, numFmt: 'money' as const },
  ]
  return {
    plantilla: { ...plantilla, celdas, columnas },
    filas, netos, visualPendiente: !hayResultado, difiereDeConsolidada: difs, error: null,
  }
}

/** Excel COMPLETO del mes (una hoja): `plantillaCompletaConNeto` escrita a .xlsx. */
export async function generarExcelCompletoConNeto(
  client: any,
  periodo: { id: string; mes: string },
): Promise<{
  buf: ArrayBuffer | null; filas: number; netos: number
  visualPendiente: boolean; difiereDeConsolidada: number | null; error: string | null
}> {
  const r = await plantillaCompletaConNeto(client, periodo)
  if (r.error || !r.plantilla) {
    return { buf: null, filas: 0, netos: 0, visualPendiente: false, difiereDeConsolidada: null, error: r.error || 'sin plantilla' }
  }
  const { escribirPlantillaLiquidacionXLSX } = await import('@/lib/liquidacion-xlsx')
  const buf = await escribirPlantillaLiquidacionXLSX(r.plantilla)
  return { buf, filas: r.filas, netos: r.netos, visualPendiente: r.visualPendiente, difiereDeConsolidada: r.difiereDeConsolidada, error: null }
}

/**
 * Arma la PlantillaLiquidacion del mes (padrón + resumen + fórmulas) SIN
 * escribirla a bytes. Es la fuente única del "baseline MERCOSUR" que consumen
 * tanto el generador (LIQ2A) como el reimport/comparación (LIQ2B): así el valor
 * contra el que se compara es exactamente el que se generó.
 */
export async function plantillaTrabajoDelMes(
  client: any,
  mes: string,
  ajustesPorEmpleado?: Map<string, Record<string, number | null>>,
): Promise<PlantillaTrabajoResultado> {
  if (!/^\d{4}-\d{2}$/.test(mes)) return { plantilla: null, filas: 0, error: 'Mes inválido (esperado YYYY-MM).' }
  const { desde, hasta, y, m } = limitesDelMes(mes)
  const finExclusivo = `${new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10)}T00:00:00-03:00`

  // Fuentes: mismas consultas que el [mes] effect de Reportes (AppClient) y que
  // el call a construirResumenGuardia. Turnos y registros paginados (PostgREST
  // corta en 1000 sin error). El resto no supera el tope hoy, pero se lee igual
  // con el cliente pasado para no duplicar criterios.
  const [
    usuariosR, objetivosR, zonasR, noctExcR,
    turnosR, registrosR, novedadesR, supGuardiasR, supervisionesR,
  ] = await Promise.all([
    // Contexto Gerencia (ver_finanzas): el Excel de trabajo incluye la columna
    // CUENTA, así que acá SÍ se pide cuenta_bancaria (a diferencia del load
    // general saneado en FASE 0). legajo_visual = etiqueta de Visual.
    fetchPaginadoResult((d, h) => client.from('usuarios')
      .select('id, nombre, apellido, rol, puesto_organizacional, estado, es_prueba, cuil, legajo, legajo_visual, cuenta_bancaria')
      .order('apellido').order('id').range(d, h)),
    client.from('objetivos').select('id, nombre, es_prueba, zona_id, nocturnidad_activa, nocturnidad_desde, nocturnidad_hasta').order('nombre'),
    client.from('supervisor_zonas').select('supervisor_id, zona_id'),
    client.from('nocturnidad_empleado_objetivo').select('*'),
    fetchPaginadoResult((d, h) => client.from('turnos').select('*')
      .gte('fecha', desde).lte('fecha', hasta)
      .order('fecha', { ascending: true }).order('id').range(d, h)),
    fetchPaginadoResult((d, h) => client.from('registros_asistencia')
      .select('*,turno:turnos!inner(fecha)')
      .gte('turno.fecha', desde).lte('turno.fecha', hasta)
      .order('created_at', { ascending: false }).order('id').range(d, h)),
    client.from('novedades_laborales').select('*').eq('estado', 'aprobada').lte('fecha_desde', hasta).gte('fecha_hasta', desde),
    client.from('supervisores_guardia').select('supervisor_id, fecha, hora_inicio, hora_fin, zona, estado')
      .gte('fecha', desde).lte('fecha', hasta).eq('estado', 'activo'),
    client.from('supervisiones').select('supervisor_id, objetivo_id, estado, created_at')
      .gte('created_at', `${desde}T00:00:00-03:00`).lt('created_at', finExclusivo),
  ])

  const err = usuariosR.error || turnosR.error || registrosR.error || novedadesR.error
  if (err) return { plantilla: null, filas: 0, error: err.message || String(err) }

  const usuarios = (usuariosR.data ?? []) as any[]
  const objetivos = (objetivosR.data ?? []) as any[]
  const supervisorZonas = (zonasR.data ?? []) as any[]
  const nocturnidadExcepciones = (noctExcR.data ?? []) as any[]
  const objetivoPorId = new Map<string, any>(objetivos.map(o => [o.id, o]))

  const empleados: EmpleadoResumen[] = usuarios.map(g => ({
    id: g.id, nombre: g.nombre, apellido: g.apellido, rol: g.rol,
    puesto_organizacional: g.puesto_organizacional ?? null, estado: g.estado,
    esPrueba: Boolean(g.es_prueba), cuil: g.cuil, legajo: g.legajo,
    legajoVisual: g.legajo_visual ?? null, cuenta: g.cuenta_bancaria ?? null,
  }))

  // ── SUELDO MENSUAL (grupo A · mensualizados fijos) ────────────────────────
  // Keyed por USUARIO_ID: los mensualizados fijos (administración/gerencia/dir_op)
  // salen del padrón de `usuarios` como cualquier empleado (bloque 3 por puesto);
  // NO se inyecta nada. Sólo se toma su SUELDO MENSUAL vigente del mes. La celda
  // 001 del grupo A la resuelve la plantilla (emitirFila) con este valor.
  const finMes = `${mes}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
  const inicioMes = `${mes}-01`
  const { data: sueldosData } = await client.from('liquidacion_sueldo_mensual')
    .select('usuario_id, importe, vigencia_desde, vigencia_hasta')
  const sueldoMensualPorEmpleado = new Map<string, number>()
  const mejorDesde = new Map<string, string>()
  for (const s of (sueldosData ?? []) as any[]) {
    const d = String(s.vigencia_desde); const h = s.vigencia_hasta ? String(s.vigencia_hasta) : null
    if (d <= finMes && (!h || h >= inicioMes)) {
      const cur = mejorDesde.get(s.usuario_id)
      if (!cur || d > cur) { mejorDesde.set(s.usuario_id, d); sueldoMensualPorEmpleado.set(s.usuario_id, Number(s.importe)) }
    }
  }

  // ── EXTRA fija mensual (concepto "extras" AP) ─────────────────────────────
  // Misma mecánica que SUELDO MENSUAL: por usuario_id, vigencia, arrastre. La
  // celda AP del grupo fijo la resuelve emitirFila con este valor (editable).
  const { data: extrasData } = await client.from('liquidacion_extra_mensual')
    .select('usuario_id, importe, vigencia_desde, vigencia_hasta')
  const extraPorEmpleado = new Map<string, number>()
  const mejorDesdeExtra = new Map<string, string>()
  for (const e of (extrasData ?? []) as any[]) {
    const d = String(e.vigencia_desde); const h = e.vigencia_hasta ? String(e.vigencia_hasta) : null
    if (d <= finMes && (!h || h >= inicioMes)) {
      const cur = mejorDesdeExtra.get(e.usuario_id)
      if (!cur || d > cur) { mejorDesdeExtra.set(e.usuario_id, d); extraPorEmpleado.set(e.usuario_id, Number(e.importe)) }
    }
  }

  const resumen = construirResumenGuardia({
    mes,
    empleados,
    turnos: (turnosR.data ?? []) as any[],
    registros: (registrosR.data ?? []) as any[],
    novedades: (novedadesR.data ?? []) as any[],
    supervisoresGuardia: (supGuardiasR.data ?? []) as any[],
    supervisiones: (supervisionesR.data ?? []) as any[],
    zonaObjetivo: (id?: string | null) => (objetivoPorId.get(id || '') as any)?.zona_id ?? null,
    zonasSupervisor: (empId: string) => supervisorZonas
      .filter(sz => sz.supervisor_id === empId).map(sz => sz.zona_id).filter(Boolean),
    esObjetivoPrueba: (id?: string | null) => Boolean(objetivoPorId.get(id || '')?.es_prueba),
    nombreObjetivo: (id?: string | null) => objetivoPorId.get(id || '')?.nombre ?? '',
    nocturnidadObjetivo: (id?: string | null) => {
      const o = objetivoPorId.get(id || '') as any
      if (!o) return null
      return { activa: Boolean(o.nocturnidad_activa), desde: o.nocturnidad_desde ?? null, hasta: o.nocturnidad_hasta ?? null }
    },
    nocturnidadEmpleadoObjetivo: (empleadoId: string, objetivoId?: string | null) => {
      const fila = nocturnidadExcepciones.find((e: any) => e.empleado_id === empleadoId && e.objetivo_id === objetivoId)
      return (fila?.modo as 'heredar' | 'si' | 'no' | undefined) ?? null
    },
  })

  if (resumen.filas.length === 0) return { plantilla: null, filas: 0, error: 'No hay empleados activos para el período (padrón vacío).' }

  const plantilla = plantillaLiquidacionResumenGuardia(resumen, ajustesPorEmpleado, sueldoMensualPorEmpleado, extraPorEmpleado)
  return { plantilla, filas: resumen.filas.length, error: null, resumen, sueldoMensual: sueldoMensualPorEmpleado }
}

/**
 * Jornadas reales por usuario del mes (para el concepto 000 DÍAS TRABAJADAS):
 * FECHAS DISTINTAS EFECTIVAMENTE TRABAJADAS de la planilla liquidable — la misma
 * verdad con la que se liquida, no los turnos crudos. Una fecha = 1 jornada;
 * dos turnos el mismo día = 1 (lo resuelve `construirResumenGuardia`, que sólo
 * cuenta líneas con horas reconocidas: excluye ausencias y días programados-no-
 * trabajados, y aplica las correcciones de horas). SIN tope de 25 (si trabajó 27
 * fechas, son 27). NO copia el mes anterior ni usa valores históricos de Visual.
 *
 * VIGILADOR vs MENSUALIZADO (regla JC 10/09): el 000 se DERIVA de la actividad
 * real SÓLO para VIGILADORES (sus fechas efectivamente trabajadas). Supervisores
 * y ADMINISTRATIVOS/jerárquicos (mensualizados) NO derivan jornadas de turnos:
 * devuelven 25 fijas. Se usa `jornadasReales` para el vigilador (conteo real).
 *
 * La planilla YA REVISADA manda: si Juan corrigió las jornadas en el Excel de
 * trabajo antes de consolidar (queda en `liquidacion_ajuste`, clave 'jornadas'),
 * ese valor corregido pisa el conteo automático. Trazabilidad:
 * calculado desde planilla → corrección → valor a Visual.
 */
export async function jornadasPorUsuarioDelMes(
  client: any,
  periodo: { id: string; mes: string },
): Promise<{ jornadas: Map<string, number>; corregidos: number; error: string | null }> {
  const { resumen, error } = await plantillaTrabajoDelMes(client, periodo.mes)
  if (error || !resumen) return { jornadas: new Map(), corregidos: 0, error: error || 'sin resumen' }
  const out = new Map<string, number>()
  // Vigiladores → jornadas reales trabajadas. El resto (supervisores +
  // administrativos = mensualizados) → 25 fijas (pedido de JC 10/09).
  for (const f of resumen.filas) {
    const esVigilador = f.grupo === 'vigiladores'
    out.set(f.empleadoId, esVigilador ? Number(f.jornadasReales ?? 0) : 25)
  }
  // Overlay de la planilla revisada: una corrección manual de jornadas hecha en
  // el Excel de trabajo pisa el conteo (es la verdad que se va a liquidar).
  let corregidos = 0
  const { data: aj } = await client.from('liquidacion_ajuste')
    .select('empleado_id, valor_liquidacion').eq('periodo_id', periodo.id).eq('tipo', 'variable').eq('clave', 'jornadas')
  for (const a of (aj ?? []) as any[]) {
    if (a.valor_liquidacion == null) continue
    out.set(a.empleado_id, Number(a.valor_liquidacion)); corregidos++
  }
  return { jornadas: out, corregidos, error: null }
}

// Columnas de concepto del Excel de trabajo (layout de #170) y su código de
// Visual: el código NO se hardcodea acá, se lee de la fila 6 del archivo (viene
// de la plantilla de Juan). Estas letras sí son fijas: definen NUESTRO layout.
// El 001 se EXPORTA desde AJ (horas rec $ = importe en pesos). La columna AG
// ("horas rec") es la CANTIDAD de horas y NO se incluye acá: antes se sumaba al
// 001 e inflaba el importe con el número de horas (JC 05/10: el 001 va con
// cantidad 1 y el importe total, sin sumar las horas).
const COLS_CONCEPTO = ['AC', 'AD', 'AE', 'AF', 'AI', 'AJ', 'AT', 'AU', 'AV', 'AW', 'AX']

export interface FilaConsolidada {
  empleado_id: string
  legajo_visual: string | null
  cuil: string | null
  nombre: string | null
  codigo: string
  cantidad: number
  importe: number
}

/** Ajustes de liquidación (LIQ2C) por empleado_id: { clave → valor_liquidacion }. */
export async function cargarAjustes(
  client: any,
  periodoId: string,
): Promise<Map<string, Record<string, number | null>>> {
  const ajustes = new Map<string, Record<string, number | null>>()
  const { data: aj } = await client.from('liquidacion_ajuste')
    .select('empleado_id, clave, valor_liquidacion').eq('periodo_id', periodoId)
  for (const a of (aj ?? []) as any[]) {
    const m = ajustes.get(a.empleado_id) ?? {}
    m[a.clave] = a.valor_liquidacion === null ? null : Number(a.valor_liquidacion)
    ajustes.set(a.empleado_id, m)
  }
  return ajustes
}

/**
 * Deriva las filas consolidadas (empleado × código de Visual, importe final) de
 * una PlantillaLiquidacion YA CONSTRUIDA. NO lee nada: opera sobre la misma
 * plantilla que después escribe el .xlsx, así el snapshot y el archivo salen de
 * UNA sola preparación. Suma importes de columnas que comparten código. El 001 se
 * toma SÓLO de AJ (horas rec $): la columna AG (cantidad de horas) ya no se incluye
 * en COLS_CONCEPTO, así el 001 no infla el importe con el número de horas. Los
 * códigos y la fila de encabezado se toman de la plantilla, no hardcodeados.
 */
export function filasConsolidadasDePlantilla(plantilla: PlantillaLiquidacion): FilaConsolidada[] {
  const encab = plantilla.estilos.encabezado
  const porRef = new Map<string, string | number | undefined>()
  for (const c of plantilla.celdas) porRef.set(c.ref, c.v)
  const codigoDeCol: Record<string, string> = {}
  for (const col of COLS_CONCEPTO) codigoDeCol[col] = String(porRef.get(`${col}${encab}`) ?? '').trim()

  const filas: FilaConsolidada[] = []
  for (const c of plantilla.celdas) {
    const mm = c.ref.match(/^BD(\d+)$/)
    if (!mm) continue
    // La fila de encabezado también tiene BD ('usuario_id') y en las columnas de
    // concepto lleva los CÓDIGOS como texto: NO es un empleado, se saltea.
    if (Number(mm[1]) === encab) continue
    const empleadoId = String(c.v ?? '').trim()
    if (!empleadoId) continue
    const r = mm[1]
    const porCodigo = new Map<string, number>()
    for (const col of COLS_CONCEPTO) {
      const cod = codigoDeCol[col]
      if (!cod) continue
      const v = Number(porRef.get(`${col}${r}`) ?? 0)
      if (!Number.isFinite(v) || v === 0) continue
      porCodigo.set(cod, (porCodigo.get(cod) ?? 0) + v)
    }
    const legajoVisual = String(porRef.get(`A${r}`) ?? '') || null
    const cuil = String(porRef.get(`B${r}`) ?? '') || null
    const nombre = String(porRef.get(`D${r}`) ?? '') || null
    // Haberes (política 'valor'): Cantidad=1 + Importe=total (práctica confirmada
    // contra las planillas históricas de Visual). El 000 DÍAS TRABAJADAS NO se
    // deriva acá: es un dato mensual editable por persona (liquidacion_dias).
    for (const [codigo, importe] of Array.from(porCodigo.entries())) {
      filas.push({ empleado_id: empleadoId, legajo_visual: legajoVisual, cuil, nombre, codigo, cantidad: 1, importe: Math.round(importe * 100) / 100 })
    }
  }
  return filas
}

/**
 * 000/jornadas por empleado a partir de un resumen YA CONSTRUIDO (sin releer):
 * vigiladores → jornadas reales trabajadas; el resto (supervisores +
 * administrativos = mensualizados) → 25 fijas (pedido de JC 10/09). Un ajuste
 * manual de 'jornadas' desde el Excel sigue pisando este valor aguas arriba.
 */
export function jornadasDeResumen(resumen: ResumenGuardiaMes): Map<string, number> {
  const out = new Map<string, number>()
  for (const f of resumen.filas) {
    const esVigilador = f.grupo === 'vigiladores'
    out.set(f.empleadoId, esVigilador ? Number(f.jornadasReales ?? 0) : 25)
  }
  return out
}

export interface PreparacionLiquidacion {
  plantilla: PlantillaLiquidacion | null
  resumen: ResumenGuardiaMes | null
  snapshotFilas: FilaConsolidada[]
  jornadas: Map<string, number>   // 000 por empleado (operativos) con ajuste 'jornadas' aplicado
  error: string | null
}

/**
 * PREPARACIÓN ÚNICA de la liquidación final (pedido de JC): UNA sola lectura
 * operativa (plantillaTrabajoDelMes con ajustes) de la que salen A) el snapshot
 * consolidado (haberes) y B) las jornadas/000. Quien exporta usa ESTA misma
 * preparación para construir el .xls Visual, sin volver a leer datos operativos
 * entre el snapshot y el archivo. Elimina el doble read que había hoy
 * (consolidar + jornadasPorUsuarioDelMes).
 */
export async function prepararLiquidacionDelMes(
  client: any,
  periodo: { id: string; mes: string },
): Promise<PreparacionLiquidacion> {
  const vacio = { plantilla: null, resumen: null, snapshotFilas: [], jornadas: new Map<string, number>() }
  const ajustes = await cargarAjustes(client, periodo.id)
  const { plantilla, resumen, error } = await plantillaTrabajoDelMes(client, periodo.mes, ajustes)
  if (error || !plantilla || !resumen) return { ...vacio, error: error || 'sin plantilla' }
  const snapshotFilas = filasConsolidadasDePlantilla(plantilla)
  const jornadas = jornadasDeResumen(resumen)
  // Overlay de la planilla revisada: un ajuste manual de 'jornadas' pisa el conteo.
  for (const [emp, campos] of Array.from(ajustes.entries())) {
    const j = campos['jornadas']
    if (j != null) jornadas.set(emp, Number(j))
  }
  return { plantilla, resumen, snapshotFilas, jornadas, error: null }
}

/**
 * Snapshot consolidado (empleado × código, importe final). Wrapper delgado sobre
 * la preparación única, mantenido por compatibilidad con la prevalidación.
 */
export async function snapshotConsolidadoDelMes(
  client: any,
  periodoId: string,
  mes: string,
): Promise<{ filas: FilaConsolidada[]; error: string | null }> {
  const prep = await prepararLiquidacionDelMes(client, { id: periodoId, mes })
  return { filas: prep.snapshotFilas, error: prep.error }
}
