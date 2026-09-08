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
} from '@/lib/resumen-guardia'

export interface GenerarExcelTrabajoResultado {
  buf: ArrayBuffer | null
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
  if (!/^\d{4}-\d{2}$/.test(mes)) return { buf: null, filas: 0, error: 'Mes inválido (esperado YYYY-MM).' }
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
  if (err) return { buf: null, filas: 0, error: err.message || String(err) }

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

  if (resumen.filas.length === 0) return { buf: null, filas: 0, error: 'No hay empleados activos para el período (padrón vacío).' }

  const plantilla = plantillaLiquidacionResumenGuardia(resumen)
  const { escribirPlantillaLiquidacionXLSX } = await import('@/lib/liquidacion-xlsx')
  const buf = await escribirPlantillaLiquidacionXLSX(plantilla)
  return { buf, filas: resumen.filas.length, error: null }
}
