/**
 * lib/generacion-grilla.ts
 *
 * Programación desde la grilla del objetivo: crear los turnos de una posición
 * operativa para un rango de fechas y un patrón de días, sin salir del legajo
 * del objetivo.
 *
 * No reemplaza ni modifica "Generar mes" (vista previa global de todos los
 * objetivos): son dos caminos distintos que conviven. Este resuelve el caso
 * cotidiano —un objetivo, una posición, "de lunes a viernes de 22 a 06"—
 * donde salir a la pantalla de Programación era un rodeo.
 *
 * PURO: no escribe en Supabase. Arma el plan que se muestra ANTES de
 * confirmar; la escritura vive en la RPC crear_turnos_posicion_objetivo, que
 * vuelve a validar todo en servidor y no confía en este plan.
 *
 * Reutiliza, sin reescribirlas:
 *   · fechasEnRango, diasDelPatron, esTurnoFuturo y el tipo PatronDias de
 *     lib/asignacion-mensual — misma grilla, mismo criterio de días y la
 *     misma definición de "turno que todavía no empezó";
 *   · ESTADOS_SIN_OBLIGACION de lib/revision-operativa — un turno anulado,
 *     reemplazado o cancelado NO ocupa el lugar: esa fecha vuelve a estar
 *     libre para programar;
 *   · caracteristicaTurno de lib/caracteristica-turno — solo los turnos
 *     'normal' ocupan cobertura; una capacitación no bloquea la generación;
 *   · la deduplicación por objetivo+puesto+fecha+horario y la etiqueta
 *     DETALLE_COBERTURA_EQUIVALENTE de lib/programacion — mismo criterio y
 *     mismo texto que ya usa la vista previa mensual;
 *   · diaSemanaCorto de lib/programacion para las etiquetas de día.
 */

import { diasDelPatron, esTurnoFuturo, fechasEnRango } from '@/lib/asignacion-mensual'
import type { PatronDias } from '@/lib/asignacion-mensual'
import { DETALLE_COBERTURA_EQUIVALENTE, diaSemanaCorto } from '@/lib/programacion'
import { ESTADOS_SIN_OBLIGACION } from '@/lib/revision-operativa'
import { caracteristicaTurno } from '@/lib/caracteristica-turno'

// ── Clasificación de cada fecha del rango ────────────────────────────────────

export type EstadoGeneracionCelda =
  | 'valido'          // se crea
  | 'ya_existe'       // ya hay un turno vigente en esa posición, fecha y horario
  | 'fecha_pasada'    // no se programa retroactivamente
  | 'fuera_de_patron' // el día no entra en el patrón elegido
  | 'excluido'        // fecha excluida a mano

export const ETIQUETA_GENERACION_CELDA: Record<EstadoGeneracionCelda, string> = {
  valido: 'Se va a crear',
  ya_existe: 'Ya existe',
  fecha_pasada: 'Fecha pasada',
  fuera_de_patron: 'Fuera del patrón elegido',
  excluido: 'Fecha excluida',
}

/** Mismo criterio que la vista previa mensual: los días pasados no se programan desde acá. */
export const DETALLE_GENERACION_FECHA_PASADA =
  'Los días pasados se resuelven por regularización administrativa, no desde la programación.'

export const DETALLE_GENERACION_YA_EXISTE =
  'Ya hay un turno cargado para esa posición, fecha y horario.'

/** Puesto doblado: se agrega otro turno sobre los que ya hay, a propósito. */
export const detalleSeSuma = (cuantos: number) =>
  `Ya hay ${cuantos} turno${cuantos !== 1 ? 's' : ''} en esta posición y horario: se agrega uno más.`

// ── Entradas ─────────────────────────────────────────────────────────────────

/** Turno ya cargado del objetivo, para deduplicar y avisar coberturas equivalentes. */
export interface TurnoExistenteGrilla {
  puesto_id?: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado?: string | null
  tipo_evento?: string | null
}

// ── Salidas ──────────────────────────────────────────────────────────────────

export interface FilaGeneracion {
  fecha: string
  dia_semana: string
  estado: EstadoGeneracionCelda
  detalle: string | null
}

export interface ResumenGeneracion {
  total: number
  validos: number
  ya_existen: number
  fechas_pasadas: number
  omitidos: number
}

export interface PlanGeneracionGrilla {
  /** Solo las fechas 'valido': exactamente lo que se envía a la RPC. */
  fechas_a_crear: string[]
  filas: FilaGeneracion[]
  resumen: ResumenGeneracion
}

// ── Validación del formulario ────────────────────────────────────────────────

const HORA_VALIDA = /^\d{1,2}:\d{2}/
const hora5 = (h?: string | null) => (h ?? '').slice(0, 5)

/**
 * Motivo por el que todavía no se puede planificar, o null si los datos
 * alcanzan. Se usa para deshabilitar el botón con un mensaje concreto en vez
 * de dejar al usuario adivinando.
 *
 * Un horario con fin <= inicio NO es un error: es un turno nocturno
 * (22:00→06:00), soportado en todo el sistema. Lo único inválido es fin igual
 * a inicio, que no define ninguna duración.
 */
export function motivoBloqueoGeneracion(params: {
  puestoId?: string | null
  horaInicio?: string | null
  horaFin?: string | null
  desde?: string | null
  hasta?: string | null
}): string | null {
  if (!params.puestoId) return 'Elegí una posición operativa.'
  const inicio = hora5(params.horaInicio)
  const fin = hora5(params.horaFin)
  if (!HORA_VALIDA.test(inicio) || !HORA_VALIDA.test(fin)) return 'Completá el horario del turno.'
  if (inicio === fin) return 'El horario de fin no puede ser igual al de inicio.'
  if (!params.desde || !params.hasta) return 'Elegí desde y hasta qué fecha.'
  if (params.desde > params.hasta) return 'La fecha "desde" no puede ser posterior a "hasta".'
  return null
}

// ── Plan ─────────────────────────────────────────────────────────────────────

/** Turno existente que sigue ocupando el lugar (no anulado/reemplazado/cancelado). */
const ocupaCobertura = (t: TurnoExistenteGrilla) =>
  !ESTADOS_SIN_OBLIGACION.has(t.estado || '') && caracteristicaTurno(t.tipo_evento) === 'normal'

/**
 * Expande el rango elegido a fechas y clasifica cada una. No crea nada.
 *
 * El orden de las comprobaciones sigue el de la vista previa mensual: primero
 * lo que el usuario eligió excluir, después el patrón, después si ya existe, y
 * recién al final el bloqueo retroactivo — así una fecha pasada que YA tiene
 * turno se muestra como "Ya existe" y no como un problema a resolver.
 */
export function planificarGeneracionGrilla(params: {
  puestoId: string
  horaInicio: string
  horaFin: string
  desde: string
  hasta: string
  patron: PatronDias
  diasSeleccionados?: string[]
  excluir?: string[]
  /** Turnos ya cargados del objetivo (cualquier posición). */
  turnosExistentes: TurnoExistenteGrilla[]
  fechaActual: string
  horaActual: string
  /**
   * Puesto doblado: agregar turnos aunque la posición ya tenga uno ese día en
   * ese horario. Sin esto, un objetivo que lleva 3 vigiladores en la misma
   * posición los fines de semana no se puede cargar desde acá.
   *
   * La protección contra duplicados accidentales sigue activa por defecto: hay
   * que pedirlo explícitamente, igual que el "Crear de todos modos" del alta
   * manual de turnos.
   */
  permitirDuplicado?: boolean
}): PlanGeneracionGrilla {
  const {
    puestoId, desde, hasta, patron, diasSeleccionados, excluir,
    turnosExistentes, fechaActual, horaActual, permitirDuplicado = false,
  } = params
  const horaInicio = hora5(params.horaInicio)
  const horaFin = hora5(params.horaFin)

  const excluidas = new Set(excluir ?? [])
  const enPatron = diasDelPatron(patron, diasSeleccionados)

  // Ocupado: cuántos turnos vigentes hay ya en esta posición, fecha y horario.
  // Se cuenta —no es un booleano— porque un puesto puede estar doblado con
  // más de dos, y hay que poder decir cuántos hay al agregar otro.
  //
  // Equivalente: mismo horario y fecha en OTRA posición — nunca bloquea (dos
  // posiciones simultáneas son legítimas), solo se informa.
  const ocupado = new Map<string, number>()
  const equivalente = new Set<string>()
  for (const t of turnosExistentes) {
    if (!ocupaCobertura(t)) continue
    const franja = `${t.fecha}|${hora5(t.hora_inicio)}|${hora5(t.hora_fin)}`
    if ((t.puesto_id ?? '') === puestoId) ocupado.set(franja, (ocupado.get(franja) ?? 0) + 1)
    else equivalente.add(franja)
  }

  const filas: FilaGeneracion[] = []
  for (const fecha of fechasEnRango(desde, hasta)) {
    const base = { fecha, dia_semana: diaSemanaCorto(fecha) }
    const franja = `${fecha}|${horaInicio}|${horaFin}`

    if (excluidas.has(fecha)) {
      filas.push({ ...base, estado: 'excluido', detalle: null })
      continue
    }
    if (!enPatron(fecha)) {
      filas.push({ ...base, estado: 'fuera_de_patron', detalle: null })
      continue
    }
    const yaHay = ocupado.get(franja) ?? 0
    if (yaHay > 0 && !permitirDuplicado) {
      filas.push({ ...base, estado: 'ya_existe', detalle: DETALLE_GENERACION_YA_EXISTE })
      continue
    }
    if (!esTurnoFuturo({ fecha, hora_inicio: horaInicio }, fechaActual, horaActual)) {
      filas.push({ ...base, estado: 'fecha_pasada', detalle: DETALLE_GENERACION_FECHA_PASADA })
      continue
    }
    filas.push({
      ...base,
      estado: 'valido',
      detalle: yaHay > 0
        ? detalleSeSuma(yaHay)
        : equivalente.has(franja) ? DETALLE_COBERTURA_EQUIVALENTE : null,
    })
  }

  const contar = (estado: EstadoGeneracionCelda) => filas.filter(f => f.estado === estado).length
  return {
    fechas_a_crear: filas.filter(f => f.estado === 'valido').map(f => f.fecha),
    filas,
    resumen: {
      total: filas.length,
      validos: contar('valido'),
      ya_existen: contar('ya_existe'),
      fechas_pasadas: contar('fecha_pasada'),
      omitidos: contar('fuera_de_patron') + contar('excluido'),
    },
  }
}

// ── Resultado de la RPC ──────────────────────────────────────────────────────

export interface FilaResultadoGeneracion {
  fecha: string
  resultado: 'creada' | 'ya_existe' | 'omitida'
  motivo: string | null
  turno_id: string | null
}

export interface ResultadoGeneracionGrilla {
  operacion_id: string
  solicitadas: number
  creadas: number
  ya_existentes: number
  omitidas: number
  turnos_creados: string[]
  filas: FilaResultadoGeneracion[]
  /** true si la RPC devolvió el resultado guardado de la misma operación. */
  repetida?: boolean
}

/** Resumen en una línea para mostrar después de crear. */
export function resumenResultadoGeneracion(r: ResultadoGeneracionGrilla): string {
  const partes = [`${r.creadas} turno${r.creadas !== 1 ? 's' : ''} creado${r.creadas !== 1 ? 's' : ''}`]
  if (r.ya_existentes > 0) partes.push(`${r.ya_existentes} ya existía${r.ya_existentes !== 1 ? 'n' : ''}`)
  if (r.omitidas > 0) partes.push(`${r.omitidas} omitido${r.omitidas !== 1 ? 's' : ''}`)
  return partes.join(' · ')
}
