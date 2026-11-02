/**
 * lib/supervision-universo.ts
 *
 * Lecturas compartidas para decidir QUÉ objetivos reclaman supervisión y
 * CUÁNDO fue la última. Las usan el panel del Dashboard, la pantalla admin de
 * Supervisiones (vencidas + ranking), la agenda del supervisor y —exportado
 * para eso— el cron de push (`app/api/_lib/push-notificaciones.ts`).
 *
 * No depende del navegador: recibe el cliente Supabase (anon con sesión en el
 * cliente, service role en el cron).
 *
 * La regla vive en `lib/supervisiones.ts` (`exigibilidadSupervision`). Acá
 * sólo se leen los datos que esa regla necesita.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchPaginado } from '@/lib/fetch-paginado'
import {
  DIAS_SIN_OPERACION,
  ESTADOS_TURNO_SIN_SERVICIO,
  fechaArgentinaDe,
  fechasTurnosPorObjetivo,
  type ContextoExigibilidad,
  type SuspensionObjetivo,
} from '@/lib/supervisiones'

type Cliente = Pick<SupabaseClient, 'from' | 'rpc'>

export type FuenteUltimaSupervision = 'rpc' | 'paginado'

export type UltimaSupervisionResultado = {
  /** objetivo_id → ISO de la última supervisión válida (no `incompleta`). */
  indice: Map<string, string>
  fuente: FuenteUltimaSupervision
  error: unknown | null
}

/** Filas `{ objetivo_id, created_at }` para quien todavía consume la forma vieja. */
export function filasDesdeIndice(indice: Map<string, string>): Array<{ objetivo_id: string; created_at: string }> {
  return Array.from(indice, ([objetivo_id, created_at]) => ({ objetivo_id, created_at }))
}

/**
 * Última supervisión válida por objetivo.
 *
 * 1. RPC `ultima_supervision_por_objetivo()` (migración 20261113120000): una
 *    fila por objetivo, agregada en la base. ~40 filas en vez de ~1.700.
 * 2. Si la RPC no existe todavía (migración SIN APLICAR) o falla, se pagina
 *    `supervisiones` como antes, pero con `estado <> 'incompleta'` y sin el
 *    `.limit(5000)` que PostgREST recortaba a 1000 en silencio.
 *
 * Nunca lanza: devuelve `error` para que quien llama decida. Un índice vacío
 * con error NO significa "nunca supervisado".
 */
export async function cargarUltimaSupervisionPorObjetivo(cliente: Cliente): Promise<UltimaSupervisionResultado> {
  try {
    const { data, error } = await cliente.rpc('ultima_supervision_por_objetivo')
    if (!error && Array.isArray(data)) {
      const indice = new Map<string, string>()
      for (const fila of data as Array<{ objetivo_id?: string | null; ultima_at?: string | null }>) {
        if (fila?.objetivo_id && fila.ultima_at) indice.set(fila.objetivo_id, fila.ultima_at)
      }
      return { indice, fuente: 'rpc', error: null }
    }
  } catch {
    // Cae al paginado.
  }

  try {
    const filas = await fetchPaginado<{ id: string; objetivo_id: string | null; created_at: string | null }>((p0, p1) =>
      cliente.from('supervisiones')
        .select('id, objetivo_id, created_at')
        .neq('estado', 'incompleta')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .range(p0, p1))
    const indice = new Map<string, string>()
    // Vienen ordenadas de la más nueva a la más vieja: la primera gana.
    for (const s of filas) {
      if (s.objetivo_id && s.created_at && !indice.has(s.objetivo_id)) indice.set(s.objetivo_id, s.created_at)
    }
    return { indice, fuente: 'paginado', error: null }
  } catch (error) {
    return { indice: new Map(), fuente: 'paginado', error }
  }
}

function restarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1, d - dias)).toISOString().slice(0, 10)
}

export type ContextoExigibilidadResultado = ContextoExigibilidad & { errorTurnos: unknown | null }

/**
 * Turnos de la ventana (últimos DIAS_SIN_OPERACION días + futuros), quiénes ya
 * operaron antes (sólo para los que tienen únicamente turnos futuros) y
 * suspensiones vigentes o futuras.
 *
 * Si la tabla `objetivo_suspensiones` no existe todavía, se toma como vacía.
 * Si fallan los turnos, `fechasTurnos` queda en `null` y la regla no descarta
 * a nadie por falta de turnos (comportamiento anterior, conservador).
 */
export async function cargarContextoExigibilidad(
  cliente: Cliente,
  ahora: Date = new Date(),
): Promise<ContextoExigibilidadResultado> {
  const hoy = fechaArgentinaDe(ahora)
  const corte = restarDias(hoy, DIAS_SIN_OPERACION)
  const sinServicio = `(${ESTADOS_TURNO_SIN_SERVICIO.join(',')})`

  let fechasTurnos: Map<string, string[]> | null = null
  let errorTurnos: unknown | null = null
  try {
    const turnos = await fetchPaginado<{ id: string; objetivo_id: string | null; fecha: string | null; estado: string | null }>((p0, p1) =>
      cliente.from('turnos')
        .select('id, objetivo_id, fecha, estado')
        .not('estado', 'in', sinServicio)
        .gte('fecha', corte)
        .order('fecha', { ascending: false })
        .order('id', { ascending: false })
        .range(p0, p1))
    fechasTurnos = fechasTurnosPorObjetivo(turnos)
  } catch (error) {
    errorTurnos = error
  }

  const yaOperaron = new Set<string>()
  if (fechasTurnos) {
    const soloFuturos = Array.from(fechasTurnos.entries())
      .filter(([, fechas]) => fechas.length > 0 && fechas.every(f => f.slice(0, 10) > hoy))
      .map(([id]) => id)
    if (soloFuturos.length > 0) {
      // Una consulta de 1 fila por objetivo: son pocos (los recién dados de
      // alta) y así un objetivo con miles de turnos viejos no llena el cupo.
      await Promise.all(soloFuturos.map(async id => {
        try {
          const { data } = await cliente.from('turnos')
            .select('objetivo_id')
            .eq('objetivo_id', id)
            .not('estado', 'in', sinServicio)
            .lt('fecha', hoy)
            .limit(1)
          if ((data ?? []).length > 0) yaOperaron.add(id)
        } catch {
          // Sin el dato queda como "por comenzar": no genera deuda falsa.
        }
      }))
    }
  }

  let suspensiones: SuspensionObjetivo[] = []
  try {
    const { data, error } = await cliente.from('objetivo_suspensiones')
      .select('objetivo_id, desde, hasta, motivo, anulada_at')
      .is('anulada_at', null)
      .or(`hasta.is.null,hasta.gte.${hoy}`)
    if (!error && Array.isArray(data)) suspensiones = data as SuspensionObjetivo[]
  } catch {
    // Tabla ausente (migración sin aplicar): sin suspensiones.
  }

  return { fechasTurnos, yaOperaron, suspensiones, errorTurnos }
}

/** Objetivos con al menos un turno (que preste servicio) en `fecha`. */
export function objetivosConTurnoEn(contexto: ContextoExigibilidad, fecha: string): Set<string> {
  const ids = new Set<string>()
  if (!contexto.fechasTurnos) return ids
  contexto.fechasTurnos.forEach((fechas, id) => {
    if (fechas.some(f => f.slice(0, 10) === fecha)) ids.add(id)
  })
  return ids
}
