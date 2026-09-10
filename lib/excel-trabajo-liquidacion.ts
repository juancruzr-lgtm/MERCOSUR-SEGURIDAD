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
  const { escribirPlantillaLiquidacionXLSX } = await import('@/lib/liquidacion-xlsx')
  const buf = await escribirPlantillaLiquidacionXLSX(plantilla)
  return { buf, filas, error: null }
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

  const plantilla = plantillaLiquidacionResumenGuardia(resumen, ajustesPorEmpleado, sueldoMensualPorEmpleado)
  return { plantilla, filas: resumen.filas.length, error: null, resumen }
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
 * OPERATIVO vs MENSUALIZADO (regla JC): el 000 se DERIVA de la actividad real
 * SÓLO para personal operativo — vigiladores y SUPERVISORES (un supervisor que
 * hace guardias tiene 000 de sus fechas reales). Los ADMINISTRATIVOS/jerárquicos
 * (BLOQUE 3, mensualizados) NO derivan jornadas de turnos: devuelven 0 → quedan
 * pendientes de carga manual (no se inventan fichajes). Un operativo sin
 * actividad también da 0 (pendiente). Se usa `jornadasReales` (conteo real, sin
 * el 0 de mensualizados), no `jornadas` (que va en 0 para el sueldo mensualizado).
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
  // Operativos (vigiladores + supervisores) → jornadas reales trabajadas.
  // Administrativos (mensualizados) → 0 (no se derivan de turnos; carga manual).
  for (const f of resumen.filas) {
    const operativo = f.grupo === 'vigiladores' || f.grupo === 'supervisores'
    out.set(f.empleadoId, operativo ? Number(f.jornadasReales ?? 0) : 0)
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
const COLS_CONCEPTO = ['AC', 'AD', 'AE', 'AF', 'AG', 'AI', 'AJ', 'AT', 'AU', 'AV', 'AW', 'AX']

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
 * UNA sola preparación. Suma importes de columnas que comparten código (212 =
 * AE+AI, 001 = AG+AJ). Los códigos y la fila de encabezado se toman de la propia
 * plantilla (estilos.encabezado), no hardcodeados.
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
 * operativos (vigiladores + supervisores) → jornadas reales trabajadas;
 * mensualizados (administrativos) → 0 (carga manual). Misma regla que
 * jornadasPorUsuarioDelMes, pero sin volver a leer turnos/planillas.
 */
export function jornadasDeResumen(resumen: ResumenGuardiaMes): Map<string, number> {
  const out = new Map<string, number>()
  for (const f of resumen.filas) {
    const operativo = f.grupo === 'vigiladores' || f.grupo === 'supervisores'
    out.set(f.empleadoId, operativo ? Number(f.jornadasReales ?? 0) : 0)
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
