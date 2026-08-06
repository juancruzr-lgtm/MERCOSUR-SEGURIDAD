/**
 * lib/publicacion-programacion.ts
 *
 * Publicación del estado "Publicado" sobre turnos ya programados (Bloque E).
 * Cambia únicamente la marca de publicación de un turno; nunca su horario,
 * posición, vigilador, asistencia, GPS ni horas, y nunca crea ni elimina
 * turnos. La escritura real vive en la RPC publicar_turnos_programacion; acá
 * solo se arma el plan que el usuario revisa antes de confirmar.
 *
 * PURO: no toca Supabase.
 */

import type { TurnoGrilla } from '@/lib/asignacion-mensual'

// ── Elegibilidad de un turno para publicarse ────────────────────────────────

export type MotivoOmisionPublicacion = 'sin_obligacion' | 'sin_posicion' | 'inconsistente'

export const ETIQUETA_MOTIVO_OMISION_PUBLICACION: Record<MotivoOmisionPublicacion, string> = {
  sin_obligacion: 'Turno anulado, cancelado o reemplazado',
  sin_posicion: 'Turno sin posición operativa',
  inconsistente: 'Turno con datos inconsistentes (fecha u horario incompletos)',
}

/** Mismo criterio que la RPC: estos estados no tienen obligación de cobertura. */
const ESTADOS_SIN_OBLIGACION = new Set(['reemplazado', 'anulado', 'cancelado'])

export interface EvaluacionPublicacion {
  publicable: boolean
  yaPublicado: boolean
  motivo: MotivoOmisionPublicacion | null
}

export function esTurnoPublicable(
  t: Pick<TurnoGrilla, 'estado' | 'puesto_id' | 'fecha' | 'hora_inicio' | 'hora_fin' | 'publicado'>,
): EvaluacionPublicacion {
  if (t.publicado) return { publicable: false, yaPublicado: true, motivo: null }
  if (ESTADOS_SIN_OBLIGACION.has(t.estado)) return { publicable: false, yaPublicado: false, motivo: 'sin_obligacion' }
  if (!t.puesto_id) return { publicable: false, yaPublicado: false, motivo: 'sin_posicion' }
  if (!t.fecha || !t.hora_inicio || !t.hora_fin || t.hora_inicio === t.hora_fin) {
    return { publicable: false, yaPublicado: false, motivo: 'inconsistente' }
  }
  return { publicable: true, yaPublicado: false, motivo: null }
}

// ── Alcance elegido por el usuario ──────────────────────────────────────────
// "Todo el mes" y "Rango de fechas" son el mismo modo (rango), variando solo
// las fechas por defecto que arma la UI; "posiciones seleccionadas" agrega un
// filtro de puesto_id sobre ese mismo rango; "turnos seleccionados" ignora
// rango/posiciones y usa exactamente los ids elegidos a mano.

export type FiltroPublicacion =
  | { modo: 'rango'; desde: string; hasta: string; puestoIds?: string[] | null }
  | { modo: 'turnos'; turnoIds: string[] }

export function etiquetaAlcancePublicacion(filtro: FiltroPublicacion, nombresPosiciones?: string[]): string {
  if (filtro.modo === 'turnos') {
    return `${filtro.turnoIds.length} turno(s) seleccionado(s) manualmente`
  }
  const rango = filtro.desde === filtro.hasta ? filtro.desde : `${filtro.desde} a ${filtro.hasta}`
  if (filtro.puestoIds && filtro.puestoIds.length > 0) {
    const nombres = nombresPosiciones?.length ? nombresPosiciones.join(', ') : `${filtro.puestoIds.length} posición(es)`
    return `${rango} · Posiciones: ${nombres}`
  }
  return `${rango} · Todas las posiciones`
}

// ── Plan de publicación (antes de confirmar) ────────────────────────────────

export interface FilaPlanPublicacion {
  turno_id: string
  fecha: string
  resultado: 'valido' | 'ya_publicado' | 'omitido'
  motivo: MotivoOmisionPublicacion | null
}

export interface ResumenPlanPublicacion {
  total: number
  validos: number
  ya_publicados: number
  omitidos: number
  omitidos_por_motivo: Record<MotivoOmisionPublicacion, number>
}

export interface PlanPublicacion {
  turno_ids: string[] // solo los válidos: lo que se envía a la RPC
  filas: FilaPlanPublicacion[]
  resumen: ResumenPlanPublicacion
}

/**
 * Arma el plan de publicación: qué turnos quedan válidos, cuáles ya estaban
 * publicados (informativo, no se reenvían) y cuáles se omiten con motivo. No
 * escribe nada — es el "antes de confirmar" que se muestra en pantalla.
 */
export function planificarPublicacion(turnos: TurnoGrilla[], filtro: FiltroPublicacion): PlanPublicacion {
  const candidatos = filtro.modo === 'turnos'
    ? turnos.filter(t => filtro.turnoIds.includes(t.id))
    : turnos.filter(t =>
        t.fecha >= filtro.desde && t.fecha <= filtro.hasta &&
        (!filtro.puestoIds?.length || (t.puesto_id != null && filtro.puestoIds.includes(t.puesto_id))))

  const filas: FilaPlanPublicacion[] = candidatos
    .map(t => {
      const ev = esTurnoPublicable(t)
      const resultado: FilaPlanPublicacion['resultado'] = ev.yaPublicado ? 'ya_publicado' : ev.publicable ? 'valido' : 'omitido'
      return { turno_id: t.id, fecha: t.fecha, resultado, motivo: ev.motivo }
    })
    .sort((a, b) => a.fecha.localeCompare(b.fecha))

  const omitidos_por_motivo: Record<MotivoOmisionPublicacion, number> = { sin_obligacion: 0, sin_posicion: 0, inconsistente: 0 }
  for (const f of filas) if (f.resultado === 'omitido' && f.motivo) omitidos_por_motivo[f.motivo]++

  return {
    turno_ids: filas.filter(f => f.resultado === 'valido').map(f => f.turno_id),
    filas,
    resumen: {
      total: filas.length,
      validos: filas.filter(f => f.resultado === 'valido').length,
      ya_publicados: filas.filter(f => f.resultado === 'ya_publicado').length,
      omitidos: filas.filter(f => f.resultado === 'omitido').length,
      omitidos_por_motivo,
    },
  }
}

/** Mismo modelo de permisos que asignar_vigilador_turnos: admin o supervisor. No se amplía. */
export const puedePublicarProgramacion = (rol?: string | null): boolean => rol === 'admin' || rol === 'supervisor'
