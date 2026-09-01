/**
 * lib/logica-detectada.ts
 *
 * Puente entre el motor de cobertura histórica y la programación mensual:
 * histórico del mes anterior → propuesta de lógica → revisión humana →
 * servicios_objetivo → vista previa → generador existente.
 *
 * `servicios_objetivo` es la estructura declarada AUTORITATIVA. Este módulo
 * no genera turnos ni escribe nada: clasifica el análisis, arma propuestas y
 * produce el plan de escritura que el administrador confirma. La inferencia
 * propone y compara; nunca se convierte en una programación paralela.
 *
 * Reutiliza, sin reescribirlas:
 *   · el motor de análisis completo: lib/cobertura-historica (ventana
 *     observable, exclusión de excepciones, niveles de confianza, múltiples
 *     franjas y posiciones simultáneas, comparación con configuración);
 *   · turnoCuentaParaPatron y ESTADOS_SIN_OBLIGACION para contar excepciones
 *     con el mismo criterio del motor;
 *   · la creación real de turnos sigue siendo previsualizarMes +
 *     crear_turnos_programacion_parcial (no se toca desde acá).
 */

import type {
  AnalisisObjetivo,
  ComparacionConfig,
  PatronCobertura,
  TurnoHistorico,
} from '@/lib/cobertura-historica'
import { turnoCuentaParaPatron } from '@/lib/cobertura-historica'
import { ESTADOS_SIN_OBLIGACION } from '@/lib/revision-operativa'
import { caracteristicaTurno } from '@/lib/caracteristica-turno'

// ── Mes de referencia ────────────────────────────────────────────────────────

export interface MesReferencia {
  anio: number
  mes: number // 1–12
  mesStr: string // YYYY-MM
  desde: string // YYYY-MM-01
  hasta: string // último día del mes
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/**
 * Mes anterior al mes que se quiere programar ('YYYY-MM'), o null si el
 * formato no sirve. La lógica siempre se infiere del mes previo al destino.
 */
export function mesAnteriorDe(mesDestino: string): MesReferencia | null {
  const m = /^(\d{4})-(\d{2})$/.exec(mesDestino ?? '')
  if (!m) return null
  let anio = Number(m[1])
  let mes = Number(m[2])
  if (mes < 1 || mes > 12) return null
  mes -= 1
  if (mes === 0) { mes = 12; anio -= 1 }
  const ultimo = new Date(anio, mes, 0).getDate()
  return {
    anio,
    mes,
    mesStr: `${anio}-${pad2(mes)}`,
    desde: `${anio}-${pad2(mes)}-01`,
    hasta: `${anio}-${pad2(mes)}-${pad2(ultimo)}`,
  }
}

// ── Estado por objetivo ──────────────────────────────────────────────────────

export type EstadoLogica = 'coincide' | 'propuesta' | 'divergencia' | 'sin_logica'

export const ETIQUETA_ESTADO_LOGICA: Record<EstadoLogica, string> = {
  coincide: 'Configuración coincide',
  propuesta: 'Propuesta detectada',
  divergencia: 'Divergencia',
  sin_logica: 'Sin lógica única',
}

export const DETALLE_ESTADO_LOGICA: Record<EstadoLogica, string> = {
  coincide: 'La estructura declarada coincide con lo observado: lista para Generar mes.',
  propuesta: 'Hay estructura habitual observada sin configuración declarada.',
  divergencia: 'La configuración declarada difiere de lo observado: revisá y elegí.',
  sin_logica: 'No se pudo determinar una lógica única. Revisar manualmente desde la grilla del objetivo.',
}

/**
 * Umbral de DECLARACIÓN: más exigente que el 'fuerte' del motor (80%).
 *
 * La auditoría de agosto 2026 (aprobada) definió "patrón inequívoco" al 90%,
 * y el caso testigo son los objetivos genuinamente irregulares (LAROMET):
 * su franja dominante llega al 80–81% — 'fuerte' para el motor — pero
 * declararles estructura sería inventar un patrón donde la confianza no
 * alcanza. Entre 60 y 90% el patrón se muestra como información; solo desde
 * el 90% se habilita la declaración. Esos casos van a "Sin lógica única →
 * revisar manualmente".
 */
export const UMBRAL_DECLARABLE = 0.9

/** Patrón con confianza suficiente para proponer estructura declarable. */
export const esPatronConfiable = (p: PatronCobertura) =>
  p.clasificacion === 'fuerte' &&
  p.dias_observados > 0 &&
  p.dias_con_registro / p.dias_observados >= UMBRAL_DECLARABLE

const DIVERGENTES: ReadonlySet<ComparacionConfig> =
  new Set<ComparacionConfig>(['horario_diferente', 'dias_diferentes', 'cantidad_diferente'])

/**
 * Estado simple del objetivo para la pantalla. La confianza la decide el
 * motor; acá solo se resume: sin patrones confiables no se propone nada.
 */
export function clasificarLogicaObjetivo(analisis: AnalisisObjetivo): EstadoLogica {
  const confiables = analisis.patrones.filter(esPatronConfiable)
  if (confiables.length === 0) return 'sin_logica'
  if (
    confiables.some(p => p.comparacion !== null && DIVERGENTES.has(p.comparacion)) ||
    analisis.configuracion_adicional.length > 0
  ) return 'divergencia'
  if (confiables.some(p => p.comparacion === 'falta_configuracion')) return 'propuesta'
  return 'coincide'
}

// ── Excepciones ignoradas por el análisis ────────────────────────────────────

export interface ExcluidosAnalisis {
  sin_obligacion: number // reemplazados / anulados / cancelados
  capacitaciones: number
}

/** Cuántos turnos del histórico NO participan del patrón, con el mismo criterio del motor. */
export function contarExcluidos(turnos: TurnoHistorico[], objetivoId?: string): ExcluidosAnalisis {
  let sin_obligacion = 0
  let capacitaciones = 0
  for (const t of turnos) {
    if (objetivoId && t.objetivo_id !== objetivoId) continue
    if (turnoCuentaParaPatron(t)) continue
    if (ESTADOS_SIN_OBLIGACION.has(t.estado || '')) sin_obligacion++
    else if (caracteristicaTurno(t.tipo_evento) === 'capacitacion') capacitaciones++
  }
  return { sin_obligacion, capacitaciones }
}

// ── Propuestas de estructura ─────────────────────────────────────────────────

export interface TurnoBaseCatalogo {
  id: string
  nombre?: string | null
  hora_inicio?: string | null
  hora_fin?: string | null
  activo?: boolean | null
}

export interface PuestoCatalogo {
  id: string
  nombre?: string | null
}

export interface PuestoSugerido {
  puesto_id: string
  nombre: string
  veces: number
  ultima_fecha: string
}

/**
 * Una franja confiable del histórico traducida a lo que habría que declarar:
 * franja + días + cantidad de posiciones, con los puestos observados como
 * sugerencia y el turno base existente si ya hay uno con ese horario.
 */
export interface PropuestaFranja {
  objetivo_id: string
  objetivo_nombre: string
  hora_inicio: string
  hora_fin: string
  dias_semana: number[]
  etiqueta_dias: string
  posiciones: number
  clasificacion: PatronCobertura['clasificacion']
  porcentaje: number
  dias_con_registro: number
  dias_observados: number
  comparacion: ComparacionConfig | null
  puestos_sugeridos: PuestoSugerido[]
  turno_base_id: string | null
  turno_base_nombre: string | null
  /**
   * TODAS las franjas del objetivo con algún registro en el mes analizado
   * (cualquier clasificación). Al resolver un horario_diferente, solo puede
   * desactivarse una franja declarada que NO esté acá: una franja declarada
   * y observada nunca se toca, aunque su propuesta no se haya marcado.
   */
  franjas_observadas: string[]
}

const hora5 = (h?: string | null) => (h ?? '').slice(0, 5)

/** Clave estable de una propuesta (selección y elecciones en la pantalla). */
export const clavePropuesta = (p: Pick<PropuestaFranja, 'objetivo_id' | 'hora_inicio' | 'hora_fin' | 'dias_semana'>) =>
  `${p.objetivo_id}|${p.hora_inicio}|${p.hora_fin}|${p.dias_semana.join(',')}`

/**
 * Propuestas declarables de un objetivo: solo patrones confiables que NO
 * coinciden ya con la configuración. Los puestos sugeridos salen de contar
 * los turnos observados de esa franja (más registros y más recientes
 * primero, para que un cambio de puesto a mitad de mes proponga los puestos
 * vigentes y no los históricos).
 */
export function armarPropuestasObjetivo(params: {
  analisis: AnalisisObjetivo
  turnos: TurnoHistorico[]
  turnosBase: TurnoBaseCatalogo[]
  puestos: PuestoCatalogo[]
}): PropuestaFranja[] {
  const { analisis, turnos, turnosBase, puestos } = params
  const puestoPorId = new Map(puestos.map(p => [p.id, p.nombre ?? '—']))
  const franjasObservadas = Array.from(new Set(
    analisis.patrones.map(p => `${p.hora_inicio}|${p.hora_fin}`)))

  const propuestas: PropuestaFranja[] = []
  for (const patron of analisis.patrones) {
    if (!esPatronConfiable(patron)) continue
    if (patron.comparacion === 'coincide') continue

    // Puestos observados en la franja, dentro de los días del patrón.
    const conteo = new Map<string, { veces: number; ultima: string }>()
    for (const t of turnos) {
      if (t.objetivo_id !== analisis.objetivo_id) continue
      if (!turnoCuentaParaPatron(t)) continue
      if (hora5(t.hora_inicio) !== patron.hora_inicio || hora5(t.hora_fin) !== patron.hora_fin) continue
      if (!t.puesto_id || !puestoPorId.has(t.puesto_id)) continue
      const previo = conteo.get(t.puesto_id)
      conteo.set(t.puesto_id, {
        veces: (previo?.veces ?? 0) + 1,
        ultima: previo && previo.ultima > t.fecha ? previo.ultima : t.fecha,
      })
    }
    const puestos_sugeridos: PuestoSugerido[] = Array.from(conteo.entries())
      .map(([puesto_id, c]) => ({
        puesto_id,
        nombre: puestoPorId.get(puesto_id) ?? '—',
        veces: c.veces,
        ultima_fecha: c.ultima,
      }))
      // Más reciente primero y, a igual actualidad, el de más registros: un
      // puesto reemplazado a mitad de mes queda detrás de los vigentes.
      .sort((a, b) => b.ultima_fecha.localeCompare(a.ultima_fecha) || b.veces - a.veces)

    const base = turnosBase.find(tb =>
      tb.activo !== false &&
      hora5(tb.hora_inicio) === patron.hora_inicio &&
      hora5(tb.hora_fin) === patron.hora_fin)

    propuestas.push({
      objetivo_id: analisis.objetivo_id,
      objetivo_nombre: analisis.objetivo_nombre,
      hora_inicio: patron.hora_inicio,
      hora_fin: patron.hora_fin,
      dias_semana: [...patron.dows],
      etiqueta_dias: patron.etiqueta_dias,
      posiciones: patron.posiciones,
      clasificacion: patron.clasificacion,
      porcentaje: patron.porcentaje,
      dias_con_registro: patron.dias_con_registro,
      dias_observados: patron.dias_observados,
      comparacion: patron.comparacion,
      puestos_sugeridos,
      turno_base_id: base?.id ?? null,
      turno_base_nombre: base?.nombre ?? null,
      franjas_observadas: franjasObservadas,
    })
  }
  return propuestas
}

// ── Plan de declaración (lo que se escribe al confirmar) ────────────────────

/** Servicio ya declarado, como sale de la tabla (con su franja resuelta). */
export interface ServicioDeclarado {
  id: string
  objetivo_id: string
  puesto_id?: string | null
  dias_semana?: number[] | null
  activo: boolean
  turno_base?: { hora_inicio?: string | null; hora_fin?: string | null } | null
}

/** Elección del administrador sobre una propuesta marcada para declarar. */
export interface EleccionPropuesta {
  propuesta: PropuestaFranja
  /** Un puesto por posición simultánea (longitud = posiciones, sin repetir). */
  puesto_ids: string[]
}

export interface ServicioACrear {
  objetivo_id: string
  puesto_id: string
  hora_inicio: string
  hora_fin: string
  /** Turno base existente, o null si hay que crearlo primero (ver turnos_base_a_crear). */
  turno_base_id: string | null
  dias_semana: number[]
}

export interface TurnoBaseACrear {
  nombre: string
  hora_inicio: string
  hora_fin: string
}

export interface PlanDeclaracion {
  crear_servicios: ServicioACrear[]
  crear_turnos_base: TurnoBaseACrear[]
  /** dias_diferentes resuelto a favor del histórico: se actualizan los días. */
  actualizar_dias: { servicio_id: string; dias_semana: number[] }[]
  /** horario_diferente resuelto a favor del histórico: franjas declaradas que no se observaron. */
  desactivar_servicios: string[]
  advertencias: string[]
  errores: string[]
}

const franjaDe = (s: ServicioDeclarado) => `${hora5(s.turno_base?.hora_inicio)}|${hora5(s.turno_base?.hora_fin)}`

/**
 * Traduce las elecciones confirmables a operaciones concretas sobre
 * servicios_objetivo. PURO: no escribe; la pantalla muestra este plan en la
 * confirmación y recién ahí ejecuta. Nada se reemplaza silenciosamente: toda
 * actualización o desactivación sale listada acá.
 */
export function planDeclaracion(params: {
  elecciones: EleccionPropuesta[]
  serviciosExistentes: ServicioDeclarado[]
  turnosBase: TurnoBaseCatalogo[]
}): PlanDeclaracion {
  const { elecciones, serviciosExistentes, turnosBase } = params
  const plan: PlanDeclaracion = {
    crear_servicios: [], crear_turnos_base: [], actualizar_dias: [],
    desactivar_servicios: [], advertencias: [], errores: [],
  }
  const basesACrear = new Map<string, TurnoBaseACrear>()

  for (const { propuesta, puesto_ids } of elecciones) {
    const etiqueta = `${propuesta.objetivo_nombre} ${propuesta.hora_inicio}–${propuesta.hora_fin}`
    if (puesto_ids.length !== propuesta.posiciones) {
      plan.errores.push(`${etiqueta}: elegí ${propuesta.posiciones} puesto(s), hay ${puesto_ids.length}.`)
      continue
    }
    if (new Set(puesto_ids).size !== puesto_ids.length) {
      plan.errores.push(`${etiqueta}: hay puestos repetidos.`)
      continue
    }
    if (puesto_ids.some(id => !id)) {
      plan.errores.push(`${etiqueta}: falta elegir un puesto.`)
      continue
    }

    const franja = `${propuesta.hora_inicio}|${propuesta.hora_fin}`
    const activosDeFranja = serviciosExistentes.filter(s =>
      s.activo && s.objetivo_id === propuesta.objetivo_id && franjaDe(s) === franja)

    let turnoBaseId = propuesta.turno_base_id
    if (!turnoBaseId) {
      const existente = turnosBase.find(tb =>
        tb.activo !== false &&
        hora5(tb.hora_inicio) === propuesta.hora_inicio &&
        hora5(tb.hora_fin) === propuesta.hora_fin)
      turnoBaseId = existente?.id ?? null
    }
    if (!turnoBaseId && !basesACrear.has(franja)) {
      basesACrear.set(franja, {
        nombre: `${propuesta.hora_inicio}–${propuesta.hora_fin}`,
        hora_inicio: propuesta.hora_inicio,
        hora_fin: propuesta.hora_fin,
      })
    }

    if (propuesta.comparacion === 'dias_diferentes') {
      // Declarar el histórico actualiza SOLO los servicios de la franja cuyo
      // puesto fue elegido en esta propuesta. Otro puesto de la misma franja
      // con su propio esquema de días (p. ej. uno de lunes a viernes y otro
      // de fin de semana) no se toca; queda avisado, nunca modificado.
      const elegidos = new Set(puesto_ids)
      const cubiertos = new Set(activosDeFranja.map(s => s.puesto_id ?? ''))
      let noTocados = 0
      for (const s of activosDeFranja) {
        if (s.puesto_id && elegidos.has(s.puesto_id)) {
          plan.actualizar_dias.push({ servicio_id: s.id, dias_semana: [...propuesta.dias_semana] })
        } else {
          noTocados++
        }
      }
      // Puesto elegido sin servicio declarado en la franja: se crea, para que
      // la configuración termine igual a la estructura aceptada.
      for (const puesto_id of puesto_ids.filter(id => !cubiertos.has(id))) {
        plan.crear_servicios.push({
          objetivo_id: propuesta.objetivo_id,
          puesto_id,
          hora_inicio: propuesta.hora_inicio,
          hora_fin: propuesta.hora_fin,
          turno_base_id: turnoBaseId,
          dias_semana: [...propuesta.dias_semana],
        })
      }
      if (noTocados > 0) {
        plan.advertencias.push(
          `${etiqueta}: ${noTocados} servicio(s) de la misma franja con otro puesto no se modifican.`)
      }
      continue
    }

    // falta_configuracion, horario_diferente y cantidad_diferente crean los
    // servicios que faltan; los puestos ya cubiertos por la franja no se
    // duplican.
    const puestosCubiertos = new Set(activosDeFranja.map(s => s.puesto_id ?? ''))
    const nuevos = puesto_ids.filter(id => !puestosCubiertos.has(id))
    if (nuevos.length === 0 && propuesta.comparacion !== 'horario_diferente') {
      plan.advertencias.push(`${etiqueta}: los puestos elegidos ya están declarados en esa franja.`)
    }
    for (const puesto_id of nuevos) {
      plan.crear_servicios.push({
        objetivo_id: propuesta.objetivo_id,
        puesto_id,
        hora_inicio: propuesta.hora_inicio,
        hora_fin: propuesta.hora_fin,
        turno_base_id: turnoBaseId,
        dias_semana: [...propuesta.dias_semana],
      })
    }
    if (activosDeFranja.length > propuesta.posiciones) {
      plan.advertencias.push(
        `${etiqueta}: hay ${activosDeFranja.length} servicios declarados y lo habitual observado es ${propuesta.posiciones}. Revisá los sobrantes a mano (no se desactiva nada automáticamente).`)
    }

    if (propuesta.comparacion === 'horario_diferente') {
      // Se desactiva EXACTAMENTE la divergencia que se está resolviendo: las
      // franjas declaradas que el mes analizado no registró nunca. Una franja
      // declarada y observada no se toca, aunque su propuesta no se haya
      // marcado — que una propuesta quede sin seleccionar jamás desactiva
      // otra franja válida. Todo sale listado en el plan de confirmación.
      const observadas = new Set(propuesta.franjas_observadas)
      const noObservados = serviciosExistentes.filter(s =>
        s.activo && s.objetivo_id === propuesta.objetivo_id && !observadas.has(franjaDe(s)))
      for (const s of noObservados) {
        if (!plan.desactivar_servicios.includes(s.id)) plan.desactivar_servicios.push(s.id)
      }
      if (noObservados.length === 0) {
        plan.advertencias.push(`${etiqueta}: no se encontró qué franja declarada desactivar; revisá la configuración.`)
      }
    }
  }

  plan.crear_turnos_base = Array.from(basesACrear.values())
  return plan
}

/** Resumen en una línea para el diálogo de confirmación. */
export function resumenPlan(plan: PlanDeclaracion): string {
  const partes: string[] = []
  if (plan.crear_servicios.length) partes.push(`${plan.crear_servicios.length} servicio(s) a crear`)
  if (plan.crear_turnos_base.length) partes.push(`${plan.crear_turnos_base.length} turno(s) base a crear`)
  if (plan.actualizar_dias.length) partes.push(`${plan.actualizar_dias.length} servicio(s) a actualizar`)
  if (plan.desactivar_servicios.length) partes.push(`${plan.desactivar_servicios.length} servicio(s) a desactivar`)
  return partes.length ? partes.join(' · ') : 'Nada para declarar'
}
