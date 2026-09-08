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
): Promise<GenerarExcelTrabajoResultado> {
  const { plantilla, filas, error } = await plantillaTrabajoDelMes(client, mes)
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

  const plantilla = plantillaLiquidacionResumenGuardia(resumen, ajustesPorEmpleado)
  return { plantilla, filas: resumen.filas.length, error: null }
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
  importe: number
}

/**
 * Arma el snapshot consolidado del período (LIQ2C): por (empleado, código de
 * Visual) el importe final, tomando el baseline + los ajustes de liquidación
 * guardados. Suma los importes de columnas que comparten código (212 = AE+AI,
 * 001 = AG+AJ). Los códigos se leen de la fila 6 de la plantilla. Es la versión
 * concreta y auditable que después consume el export a Visual (LIQ2D).
 */
export async function snapshotConsolidadoDelMes(
  client: any,
  periodoId: string,
  mes: string,
): Promise<{ filas: FilaConsolidada[]; error: string | null }> {
  const { data: aj, error: eAj } = await client.from('liquidacion_ajuste')
    .select('empleado_id, clave, valor_liquidacion').eq('periodo_id', periodoId)
  if (eAj) return { filas: [], error: eAj.message }
  const ajustes = new Map<string, Record<string, number | null>>()
  for (const a of (aj ?? []) as any[]) {
    const m = ajustes.get(a.empleado_id) ?? {}
    m[a.clave] = a.valor_liquidacion === null ? null : Number(a.valor_liquidacion)
    ajustes.set(a.empleado_id, m)
  }

  const { plantilla, error } = await plantillaTrabajoDelMes(client, mes, ajustes)
  if (error || !plantilla) return { filas: [], error: error || 'sin plantilla' }

  const porRef = new Map<string, string | number | undefined>()
  for (const c of plantilla.celdas) porRef.set(c.ref, c.v)
  const codigoDeCol: Record<string, string> = {}
  for (const col of COLS_CONCEPTO) codigoDeCol[col] = String(porRef.get(`${col}6`) ?? '').trim()

  const filas: FilaConsolidada[] = []
  for (const c of plantilla.celdas) {
    const mm = c.ref.match(/^BD(\d+)$/)
    if (!mm) continue
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
    for (const [codigo, importe] of Array.from(porCodigo.entries())) {
      filas.push({ empleado_id: empleadoId, legajo_visual: legajoVisual, cuil, nombre, codigo, importe: Math.round(importe * 100) / 100 })
    }
  }
  return { filas, error: null }
}
