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

// ── Selección por servicio: qué patrones completar ESTE mes ─────────────────
//
// La estructura habitual (servicios_objetivo) y lo que se completa este mes
// son cosas distintas: una excepción de un mes —"septiembre va sin el
// nocturno"— se resuelve desmarcando esa línea acá, sin desactivar ni
// re-declarar nada. La selección vive solo en el modal: al abrir otro mes la
// estructura habitual vuelve completa, marcada por defecto.
//
// La clave de selección es el ID del servicio (servicio_objetivo.id), nunca
// el horario: dos puestos legítimamente simultáneos con la misma franja se
// marcan y desmarcan por separado.

/** Una línea de cobertura del mes: un servicio declarado con sus números. */
export interface LineaPrevisionServicio {
  servicio_id: string
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

export function previsionPorServicio(filas: FilaPrevision[]): LineaPrevisionServicio[] {
  const mapa = new Map<string, LineaPrevisionServicio>()
  for (const f of filas) {
    const linea = mapa.get(f.servicio_id) ?? {
      servicio_id: f.servicio_id,
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
    mapa.set(f.servicio_id, linea)
  }
  return Array.from(mapa.values())
    .sort((a, b) => a.puesto.localeCompare(b.puesto) || a.hora_inicio.localeCompare(b.hora_inicio))
}

/** Al abrir el modal, TODOS los patrones activos vienen marcados. */
export function seleccionInicialCompletar(logica: LineaLogicaHabitual[]): Set<string> {
  return new Set(logica.map(l => l.servicio_id))
}

export interface TotalesSeleccion {
  a_crear: number
  existentes: number
  conflictos: number
  fechas_pasadas: number
  nocturnos_a_crear: number
  horas_a_crear: number
}

/** Los números del modal, recalculados en vivo según los servicios marcados. */
export function totalesDeSeleccion(filas: FilaPrevision[], seleccion: Set<string>): TotalesSeleccion {
  const propias = filas.filter(f => seleccion.has(f.servicio_id))
  const validas = propias.filter(f => f.estado === 'valido')
  return {
    a_crear: validas.length,
    existentes: propias.filter(f => f.estado === 'ya_existe').length,
    conflictos: propias.filter(f => f.estado === 'conflicto_horario').length,
    fechas_pasadas: propias.filter(f => f.estado === 'fecha_pasada').length,
    nocturnos_a_crear: validas.filter(f => esTurnoNocturno(f)).length,
    horas_a_crear: validas.reduce((s, f) => s + horasDeFranja(f.hora_inicio, f.hora_fin), 0),
  }
}

/**
 * Payload hacia crear_turnos_programacion_parcial: SOLO las filas válidas de
 * los servicios marcados. No muta nada: excluir un patrón acá jamás toca
 * servicios_objetivo.
 */
export function payloadSeleccionServicios(
  filas: FilaPrevision[],
  seleccion: Set<string>,
): { servicio_id: string; fecha: string }[] {
  return filas
    .filter(f => f.estado === 'valido' && seleccion.has(f.servicio_id))
    .map(f => ({ servicio_id: f.servicio_id, fecha: f.fecha }))
}

export const MENSAJE_SELECCION_VACIA = 'Seleccioná al menos una línea de cobertura.'

/** Por qué no se puede confirmar todavía, o null si se puede. */
export function motivoBloqueoConfirmar(filas: FilaPrevision[], seleccion: Set<string>): string | null {
  if (seleccion.size === 0) return MENSAJE_SELECCION_VACIA
  const totales = totalesDeSeleccion(filas, seleccion)
  if (totales.a_crear === 0) return 'Las líneas seleccionadas no tienen turnos faltantes.'
  return null
}

// ── Aviso: lo declarado vs. lo realmente programado el mes anterior ─────────

export const AVISO_DIVERGENCIA_MES_ANTERIOR =
  'Lo programado el mes anterior difiere de la lógica habitual. ' +
  'Revisá qué líneas querés completar este mes.'

/**
 * Si el análisis del mes anterior de ESTE objetivo (motor de cobertura
 * histórica, con la configuración declarada) marca divergencia, se avisa.
 * La salida normal es elegir qué líneas completar este mes en el propio
 * modal; ir a Lógica detectada es una opción solo si la estructura HABITUAL
 * realmente cambió. Nada se infiere ni se cambia desde la grilla.
 */
export function avisoDivergenciaMesAnterior(analisis: AnalisisObjetivo | null): string | null {
  if (!analisis) return null
  return clasificarLogicaObjetivo(analisis) === 'divergencia' ? AVISO_DIVERGENCIA_MES_ANTERIOR : null
}
