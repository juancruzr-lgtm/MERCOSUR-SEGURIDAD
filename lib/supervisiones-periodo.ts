/**
 * lib/supervisiones-periodo.ts
 *
 * Supervisiones por período (mes argentino) y por día argentino, para la
 * pantalla Supervisiones y la carga común del dashboard.
 *
 * ── Por qué existe ───────────────────────────────────────────────────────────
 * El 06/10/2026 la pantalla mostraba "Supervisiones hoy: 0" y "Por objetivo:
 * sin historial" con 8 visitas hechas ese día y 121 en el mes. La consulta de
 * detalle traía las 500 últimas con TODAS sus respuestas de checklist
 * embebidas; desde la Fase 2C (#241) cada respuesta pasa por una función de
 * alcance en RLS, y la consulta superaba el statement_timeout (8 s) del rol
 * authenticated. El error se descartaba y la lista quedaba vacía.
 *
 * Acá: la ventana siempre está acotada por fecha, las respuestas embebidas se
 * filtran a 'observado' (lo único que la pantalla cuenta), se pagina y el
 * error se devuelve.
 *
 * Los cortes de día y de mes son de Argentina, nunca `created_at.slice(...)`
 * (que es UTC y adelanta el día y el mes tres horas).
 */

import { fetchPaginadoResult } from './fetch-paginado'
import { fechaArgentina, mesArgentina, rangoFechasMes, rangoInstantesMesArgentina } from './periodo-argentina'

/**
 * Detalle de una supervisión para las tablas: objetivo, supervisor, ítems
 * observados y fotos. Se usa SIEMPRE junto con el filtro
 * `.eq('respuestas.resultado', 'observado')`: sin él vuelven todas las
 * respuestas y la consulta vuelve a ser la que se pasaba de tiempo.
 */
export const SELECT_SUPERVISION_DETALLE =
  '*, objetivo:objetivos(nombre), supervisor:usuarios(nombre, apellido), respuestas:supervision_respuestas(resultado), fotos:supervision_fotos(id, storage_path)'

export const FILTRO_RESPUESTAS_OBSERVADAS: [string, string] = ['respuestas.resultado', 'observado']

/** Primer período ofrecido en el selector (no hay supervisiones anteriores relevantes). */
export const PRIMER_PERIODO_SUPERVISIONES = '2026-06'

type ConFecha = { created_at?: string | null }

/** Las de un mes argentino. */
export function supervisionesDelPeriodo<T extends ConFecha>(lista: readonly T[], periodo: string): T[] {
  return lista.filter(s => Boolean(s.created_at) && mesArgentina(s.created_at as string) === periodo)
}

/** Las de un día argentino (YYYY-MM-DD). */
export function supervisionesDelDia<T extends ConFecha>(lista: readonly T[], fecha: string): T[] {
  return lista.filter(s => Boolean(s.created_at) && fechaArgentina(s.created_at as string) === fecha)
}

/** Une dos listas sin repetir por id (la de hoy y la del período elegido). */
export function unirPorId<T extends { id: string }>(...listas: readonly (readonly T[])[]): T[] {
  const vistos = new Map<string, T>()
  for (const lista of listas) for (const s of lista) if (!vistos.has(s.id)) vistos.set(s.id, s)
  return Array.from(vistos.values())
}

function mensaje(error: any): string {
  return error?.message ?? String(error)
}

/** Supervisiones con detalle de un mes argentino, paginadas. */
export async function cargarSupervisionesDelPeriodo<T = any>(
  db: any, periodo: string,
): Promise<{ data: T[]; error: string | null }> {
  const ventana = rangoInstantesMesArgentina(periodo)
  const r = await fetchPaginadoResult<T>((desde, hasta) =>
    db.from('supervisiones')
      .select(SELECT_SUPERVISION_DETALLE)
      .eq(...FILTRO_RESPUESTAS_OBSERVADAS)
      .gte('created_at', ventana.desde)
      .lt('created_at', ventana.hasta)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(desde, hasta))
  return r.error ? { data: [], error: `supervisiones: ${mensaje(r.error)}` } : { data: r.data, error: null }
}

/**
 * Turnos de un mes, con lo que necesitan la carga operativa por zona y el
 * conteo de vigiladores del ranking. Para el mes en curso el dashboard ya los
 * tiene; esto es para consultar meses anteriores.
 */
export async function cargarTurnosDelPeriodo<T = any>(
  db: any, periodo: string,
): Promise<{ data: T[]; error: string | null }> {
  const r = rangoFechasMes(periodo)
  const res = await fetchPaginadoResult<T>((desde, hasta) =>
    db.from('turnos')
      .select('id, fecha, hora_inicio, hora_fin, estado, objetivo_id, guardia_id, guardia_real_id, guardia_original_id')
      .gte('fecha', r.desde)
      .lt('fecha', r.hastaExclusivo)
      .order('fecha', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, hasta))
  return res.error ? { data: [], error: `turnos: ${mensaje(res.error)}` } : { data: res.data, error: null }
}

type FilaRankingMes = {
  id: string
  objetivo_id?: string | null
  supervisor_id?: string | null
  estado?: string | null
  created_at?: string | null
}

/**
 * Las supervisiones del mes en curso para el ranking del panel, derivadas de
 * la carga de detalle (que ya cubre mes anterior + actual, paginada y con el
 * mismo orden created_at desc, id desc). Evita una segunda consulta a
 * `supervisiones` sólo con 5 columnas: la ventana del mes es un subconjunto
 * exacto de la del detalle, y el filtro de respuestas observadas del detalle
 * filtra el embed, no las visitas.
 *
 * `desde`/`hastaExclusivo` son instantes ISO (inicio del mes argentino y del
 * siguiente). Se compara por instante, no por texto: PostgREST devuelve
 * `+00:00` y los límites vienen con `Z`.
 */
export function supervisionesMesDesdeDetalle<T extends FilaRankingMes>(
  detalle: readonly T[],
  desde: string,
  hastaExclusivo: string,
): Array<Pick<T, 'id' | 'objetivo_id' | 'supervisor_id' | 'estado' | 'created_at'>> {
  const d = Date.parse(desde)
  const h = Date.parse(hastaExclusivo)
  const salida: Array<Pick<T, 'id' | 'objetivo_id' | 'supervisor_id' | 'estado' | 'created_at'>> = []
  for (const s of detalle) {
    if (!s.created_at) continue
    const t = Date.parse(s.created_at)
    if (!(t >= d && t < h)) continue
    salida.push({ id: s.id, objetivo_id: s.objetivo_id, supervisor_id: s.supervisor_id, estado: s.estado, created_at: s.created_at } as Pick<T, 'id' | 'objetivo_id' | 'supervisor_id' | 'estado' | 'created_at'>)
  }
  return salida
}
