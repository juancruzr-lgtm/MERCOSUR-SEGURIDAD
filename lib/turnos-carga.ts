/**
 * lib/turnos-carga.ts
 *
 * Carga de la grilla de Turnos (Admin → «📅 Turnos»). PostgREST corta en 1000
 * filas sin devolver error: noviembre 2026 tenía 1.120 turnos y «Mes actual»
 * mostraba 1.000 (auditoría funcional 19/11, F-03). Se pagina con
 * lib/fetch-paginado y orden estable (fecha desc + id) para que las páginas no
 * repitan ni salteen filas.
 *
 * No depende del navegador: recibe el cliente de Supabase por parámetro, así
 * se prueba con un builder falso.
 */

import { fetchPaginadoResult } from './fetch-paginado'
import { sumarDiasFecha } from './turnos'

/**
 * Ventana de fechas que la pantalla de Turnos necesita tener cargada, a partir
 * de hoy en Argentina (`YYYY-MM-DD`):
 *  - desde: el día anterior al 1° del mes (igual que la carga global del
 *    dashboard, para no achicar el estado compartido: los nocturnos que
 *    empiezan el último día del mes anterior terminan en éste).
 *  - hastaExclusivo: el 1° del mes siguiente, o hoy + 7 si es más tarde, para
 *    que «Próximos 7 días» no quede vacío a fin de mes.
 */
export function ventanaTurnosPantalla(hoy: string): { desde: string; hastaExclusivo: string } {
  const [anio, mes] = hoy.slice(0, 7).split('-').map(Number)
  const primero = `${anio}-${String(mes).padStart(2, '0')}-01`
  const sigAnio = mes === 12 ? anio + 1 : anio
  const sigMes = mes === 12 ? 1 : mes + 1
  const primeroSiguiente = `${sigAnio}-${String(sigMes).padStart(2, '0')}-01`
  const finSemana = sumarDiasFecha(hoy, 7)
  return {
    desde: sumarDiasFecha(primero, -1),
    hastaExclusivo: finSemana > primeroSiguiente ? finSemana : primeroSiguiente,
  }
}

/**
 * Columnas de turnos que usa el estado compartido del panel admin (Turnos,
 * Dashboard, Objetivos, Asistencia, Revisión, Reportes, GPS, cobertura,
 * programación y publicación). Antes era `select('*')` (27 columnas, ~630 ms
 * por pedido): se dejan afuera los textos libres y la auditoría que ninguna
 * de esas pantallas lee — observacion, observacion_guardia,
 * observacion_supervisor, motivo_reemplazo, origen, estado_revision,
 * editado_por y updated_at. El detalle de un turno sigue pidiendo `*`.
 *
 * Si una pantalla empieza a leer otra columna del turno del estado global,
 * hay que agregarla acá (tests/turnos-carga.test.ts fija la lista).
 */
// Un solo literal (sin `.join` ni `+`): supabase-js tipa el resultado a
// partir del texto del select; con un `string` cualquiera lo marca como error.
export const SELECT_TURNO_PANTALLA = 'id, guardia_id, guardia_original_id, guardia_real_id, objetivo_id, puesto_id, servicio_base_id, reemplaza_turno_id, fecha, hora_inicio, hora_fin, estado, tipo_evento, created_at, revisado_por, revisado_at, publicado, publicado_at, publicado_por'

export const COLUMNAS_TURNO_PANTALLA: readonly string[] = SELECT_TURNO_PANTALLA.split(', ')

/** Forma mínima del cliente que usa la carga (supabase-js la cumple). */
type ClienteTurnos = { from: (tabla: 'turnos') => any }

/**
 * Todos los turnos con `desde <= fecha < hastaExclusivo`, paginados de a 1000.
 * Devuelve `{ data, error }` (no lanza) para que la pantalla muestre el error
 * en vez de quedarse con una lista truncada o vacía sin aviso.
 */
export function cargarTurnosVentana<T = any>(
  cliente: ClienteTurnos,
  desde: string,
  hastaExclusivo: string,
): Promise<{ data: T[]; error: any }> {
  return fetchPaginadoResult<T>((d, h) =>
    cliente
      .from('turnos')
      .select(SELECT_TURNO_PANTALLA)
      .gte('fecha', desde)
      .lt('fecha', hastaExclusivo)
      .order('fecha', { ascending: false })
      .order('id')
      .range(d, h),
  )
}
