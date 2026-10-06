/**
 * lib/novedades-laborales-mes.ts
 *
 * La consulta de novedades laborales APROBADAS que solapan un mes. La usan la
 * lista de Cumplimiento (y por lo tanto el congelado de la evaluación), la
 * ficha de cumplimiento del legajo y el balance del panel de Empleados.
 *
 * Antes cada pantalla la escribía a mano con `.lte('fecha_desde', `${mes}-31`)`:
 * en un mes de 30 días Postgres rechaza la fecha y la pantalla tomaba el error
 * como "no hay novedades". Con INASISTENCIA_ACTIVA eso convierte vacaciones,
 * partes médicos y suspensiones en inasistencias injustificadas. Por eso acá
 * el error se DEVUELVE y quien llama tiene que decidir qué hacer con él —
 * nunca se confunde con una lista vacía.
 */

import { rangoFechasMes } from './periodo-argentina'

export type NovedadLaboralMes = {
  empleado_id: string
  tipo: string
  fecha_desde: string
  fecha_hasta: string
  estado: string
}

export async function cargarNovedadesAprobadasDelMes(
  db: any,
  mes: string,
  empleadoId?: string | null,
): Promise<{ data: NovedadLaboralMes[]; error: string | null }> {
  let rango: ReturnType<typeof rangoFechasMes>
  try {
    rango = rangoFechasMes(mes)
  } catch (e) {
    return { data: [], error: e instanceof Error ? e.message : String(e) }
  }
  // Solapamiento de rangos: empieza antes de que termine el mes y termina
  // después de que empieza. `ultimoDia` es el día real (30, 31, 28 o 29).
  let q = db.from('novedades_laborales')
    .select('empleado_id, tipo, fecha_desde, fecha_hasta, estado')
    .eq('estado', 'aprobada')
    .lte('fecha_desde', rango.ultimoDia)
    .gte('fecha_hasta', rango.desde)
  if (empleadoId) q = q.eq('empleado_id', empleadoId)
  const { data, error } = await q
  if (error) return { data: [], error: `novedades laborales: ${error.message ?? String(error)}` }
  return { data: (data ?? []) as NovedadLaboralMes[], error: null }
}
