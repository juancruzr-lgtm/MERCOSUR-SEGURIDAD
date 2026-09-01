/**
 * lib/completar-mes.ts
 *
 * "Completar mes" desde la grilla del objetivo: la experiencia principal de
 * programación mensual. El administrador abre el legajo de un objetivo, ve su
 * lógica habitual declarada, cuántos turnos del mes existen y cuántos faltan,
 * y completa SOLO ese objetivo con confirmación previa.
 *
 * No es otra grilla ni otro generador. PURO: no consulta ni escribe nada.
 * Reutiliza, sin reescribirlos:
 *   · previsualizarMes (lib/programacion): misma vista previa, misma
 *     deduplicación por puesto+fecha+horario, mismos estados por fila,
 *     acá acotada a UN objetivo;
 *   · la creación sigue siendo crear_turnos_programacion_parcial (la RPC
 *     idempotente y auditada de siempre) con las filas válidas de este
 *     objetivo — payloadCreacionParcial ya arma ese payload;
 *   · esTurnoNocturno (lib/turnos): el nocturno pertenece al día en que
 *     empieza, por eso el 30/09 19–07 es un turno de septiembre completo;
 *   · la estructura declarada en servicios_objetivo es la ÚNICA fuente:
 *     sin estructura declarada no se completa nada — se ofrece ir a
 *     Lógica detectada, nunca inferir ni declarar desde la grilla;
 *   · clasificarLogicaObjetivo (lib/logica-detectada) para avisar si lo
 *     declarado difiere de lo realmente programado el mes anterior (p. ej.
 *     el mes pasado se quitó un turno): el aviso pide revisar, no cambia
 *     nada solo.
 */

import { previsualizarMes } from '@/lib/programacion'
import type {
  FilaPrevision, ObjetivoPrevision, ResultadoPrevision,
  ServicioPrevision, TurnoExistentePrevision,
} from '@/lib/programacion'
import { esTurnoNocturno } from '@/lib/turnos'
import { etiquetaDias } from '@/lib/cobertura-historica'
import type { AnalisisObjetivo } from '@/lib/cobertura-historica'
import { clasificarLogicaObjetivo } from '@/lib/logica-detectada'
import type { EstadoPuestos } from '@/lib/puestos'

// ── Bloqueos ─────────────────────────────────────────────────────────────────

export type BloqueoCompletarMes = 'sin_estructura' | 'objetivo_inactivo' | 'objetivo_prueba'

export const MENSAJE_BLOQUEO_COMPLETAR: Record<BloqueoCompletarMes, string> = {
  sin_estructura: 'No hay lógica habitual declarada para este objetivo.',
  objetivo_inactivo: 'El objetivo no está activo: no se completa programación.',
  objetivo_prueba: 'Objetivo de prueba: excluido de la programación.',
}

/**
 * Por qué no se puede completar el mes, o null si se puede. El servidor
 * (crear_turnos_programacion_parcial) vuelve a validar todo esto: acá solo
 * se decide qué ofrecer en la pantalla.
 */
export function bloqueoCompletarMes(
  objetivo: Pick<ObjetivoPrevision, 'estado' | 'es_prueba'>,
  serviciosActivos: ServicioPrevision[],
): BloqueoCompletarMes | null {
  if (objetivo.estado !== 'activo') return 'objetivo_inactivo'
  if (objetivo.es_prueba) return 'objetivo_prueba'
  if (serviciosActivos.length === 0) return 'sin_estructura'
  return null
}

// ── Lógica habitual declarada (lo que se muestra arriba de la grilla) ───────

export interface LineaLogicaHabitual {
  servicio_id: string
  puesto: string
  hora_inicio: string
  hora_fin: string
  etiqueta_dias: string
  nocturno: boolean
}

const hora5 = (h?: string | null) => (h ?? '').slice(0, 5)

/** Los servicios activos del objetivo como líneas legibles, agrupadas por puesto. */
export function logicaHabitualDeclarada(servicios: ServicioPrevision[]): LineaLogicaHabitual[] {
  return servicios
    .filter(s => s.activo)
    .map(s => ({
      servicio_id: s.id,
      puesto: s.puesto?.nombre ?? '—',
      hora_inicio: hora5(s.turno_base?.hora_inicio),
      hora_fin: hora5(s.turno_base?.hora_fin),
      etiqueta_dias: etiquetaDias(s.dias_semana ?? []),
      nocturno: esTurnoNocturno({
        hora_inicio: hora5(s.turno_base?.hora_inicio),
        hora_fin: hora5(s.turno_base?.hora_fin),
      }),
    }))
    .sort((a, b) => a.puesto.localeCompare(b.puesto) || a.hora_inicio.localeCompare(b.hora_inicio))
}

// ── Horas ────────────────────────────────────────────────────────────────────

/** Duración en horas de una franja; un fin menor o igual al inicio cruza medianoche. */
export function horasDeFranja(horaInicio: string, horaFin: string): number {
  const [hi, mi] = hora5(horaInicio).split(':').map(Number)
  const [hf, mf] = hora5(horaFin).split(':').map(Number)
  if ([hi, mi, hf, mf].some(n => Number.isNaN(n))) return 0
  let minutos = (hf * 60 + mf) - (hi * 60 + mi)
  if (minutos <= 0) minutos += 24 * 60
  return minutos / 60
}

// ── Resumen del bloque y vista previa del objetivo ───────────────────────────

export interface ResumenCompletarMes {
  /** La vista previa completa de ESTE objetivo (filas listas para la RPC). */
  prevision: ResultadoPrevision
  faltantes: number
  existentes: number
  conflictos: number
  fechas_pasadas: number
  /** De las filas a crear. */
  nocturnos_a_crear: number
  horas_a_crear: number
}

/**
 * Todo lo que el bloque de la grilla necesita, de una sola pasada y solo con
 * datos que la grilla ya tiene cargados. Si hay bloqueo, no hay resumen.
 */
export function resumenCompletarMes(params: {
  objetivo: ObjetivoPrevision
  mes: string // YYYY-MM
  servicios: ServicioPrevision[]
  puestos: EstadoPuestos
  turnosExistentes: TurnoExistentePrevision[]
  fechaActual: string
  horaActual: string
}): { bloqueo: BloqueoCompletarMes | null; logica: LineaLogicaHabitual[]; resumen: ResumenCompletarMes | null } {
  const { objetivo, mes, servicios, puestos, turnosExistentes, fechaActual, horaActual } = params
  const activos = servicios.filter(s => s.activo && s.objetivo_id === objetivo.id)
  const logica = logicaHabitualDeclarada(activos)
  const bloqueo = bloqueoCompletarMes(objetivo, activos)
  if (bloqueo) return { bloqueo, logica, resumen: null }

  const [anio, mesNum] = mes.split('-').map(Number)
  const prevision = previsualizarMes({
    anio,
    mes: mesNum,
    servicios: activos,
    objetivos: [objetivo],
    puestosPorObjetivo: new Map([[objetivo.id, puestos]]),
    // Solo los turnos de ESTE objetivo participan de la deduplicación: la
    // vista previa no puede marcar "ya existe" por un turno ajeno.
    turnosExistentes: turnosExistentes.filter(t => t.objetivo_id === objetivo.id),
    fechaActual,
    horaActual,
  })

  const validas = prevision.filas.filter(f => f.estado === 'valido')
  return {
    bloqueo: null,
    logica,
    resumen: {
      prevision,
      faltantes: prevision.resumen.validos,
      existentes: prevision.resumen.existentes,
      conflictos: prevision.resumen.conflictos,
      fechas_pasadas: prevision.resumen.fechas_pasadas,
      nocturnos_a_crear: validas.filter(f => esTurnoNocturno(f)).length,
      horas_a_crear: validas.reduce((s, f) => s + horasDeFranja(f.hora_inicio, f.hora_fin), 0),
    },
  }
}

/** Resumen por franja para el modal de vista previa (fechas ya expandidas en filas). */
export interface LineaPrevisionFranja {
  puesto: string
  hora_inicio: string
  hora_fin: string
  nocturno: boolean
  a_crear: number
  existentes: number
  fechas_pasadas: number
  conflictos: number
  horas: number
}

export function previsionPorFranja(filas: FilaPrevision[]): LineaPrevisionFranja[] {
  const mapa = new Map<string, LineaPrevisionFranja>()
  for (const f of filas) {
    const clave = `${f.puesto_nombre ?? '—'}|${f.hora_inicio}|${f.hora_fin}`
    const linea = mapa.get(clave) ?? {
      puesto: f.puesto_nombre ?? '—',
      hora_inicio: f.hora_inicio,
      hora_fin: f.hora_fin,
      nocturno: esTurnoNocturno(f),
      a_crear: 0, existentes: 0, fechas_pasadas: 0, conflictos: 0, horas: 0,
    }
    if (f.estado === 'valido') {
      linea.a_crear++
      linea.horas += horasDeFranja(f.hora_inicio, f.hora_fin)
    } else if (f.estado === 'ya_existe') linea.existentes++
    else if (f.estado === 'fecha_pasada') linea.fechas_pasadas++
    else if (f.estado === 'conflicto_horario') linea.conflictos++
    mapa.set(clave, linea)
  }
  return Array.from(mapa.values())
    .sort((a, b) => a.puesto.localeCompare(b.puesto) || a.hora_inicio.localeCompare(b.hora_inicio))
}

// ── Aviso: lo declarado vs. lo realmente programado el mes anterior ─────────

export const AVISO_DIVERGENCIA_MES_ANTERIOR =
  'La estructura declarada difiere de lo realmente programado el mes anterior. ' +
  'Revisala en Lógica detectada antes de completar: puede que un turno se haya agregado o quitado.'

/**
 * Si el análisis del mes anterior de ESTE objetivo (motor de cobertura
 * histórica, con la configuración declarada) marca divergencia, se avisa.
 * Solo un aviso: nada se infiere ni se cambia desde la grilla.
 */
export function avisoDivergenciaMesAnterior(analisis: AnalisisObjetivo | null): string | null {
  if (!analisis) return null
  return clasificarLogicaObjetivo(analisis) === 'divergencia' ? AVISO_DIVERGENCIA_MES_ANTERIOR : null
}
