// Rondas y evidencias del Cumplimiento Operativo.
//
// Las cuatro dimensiones que salen de acá —Rondas, Uniforme, Libro de guardia y
// Calidad de evidencias— ahora SÍ producen nota, sobre los requerimientos
// reales de cada persona: cumplido sobre requerido válido, nunca cantidad
// absoluta de errores.
//
// Que produzcan nota no significa que entren al X/10. Eso lo decide `PESOS` en
// lib/cumplimiento.ts, y sigue siendo una decisión aparte: una dimensión cuyo
// universo todavía tiene exclusiones que nadie pudo justificar se muestra con
// su nota y la etiqueta "En validación", visible sólo para Administración y
// Supervisión.

import { supabase } from '@/lib/supabase'
import { TIPOS_EVIDENCIA_IA } from '@/lib/cierre-datos'
import { esDecisionHumana, esSaneada, esperaRevision } from '@/lib/ia/revision'
import { detalleMedicion, medir } from '@/lib/cumplimiento-medicion'
import type { CurvaNota, Exclusion, Medicion } from '@/lib/cumplimiento-medicion'
import { etiquetaCausa } from '@/lib/rondas-causas'
import type { FuentesCumplimiento } from '@/lib/cumplimiento'

// ── Rondas ──────────────────────────────────────────────────────────────────

/** Una fila de `cumplimiento_rondas_por_empleado`. */
export interface RondasEmpleado {
  guardiaId: string
  obligaciones: number
  cumplidas: number
  noIniciada: number
  noFinalizada: number
  suspendida: number
  saneadas: number
  bajoPausa: number
  /** Pausa por `no_se_realiza`: la ronda se podía hacer y no se hacía. */
  pausaAtribuible: number
  /** Pausa técnica, de configuración o porque no correspondía. */
  pausaNoAtribuible: number
  /** Pausa por falta de capacitación. No es incumplimiento y sí es una señal. */
  pausaCapacitacion: number
  /** `otra`, y todas las pausas anteriores a que existiera la causa. */
  pausaSinClasificar: number
  /** Motivo textual de la pausa → cuántas ventanas cubrió. Sin clasificar. */
  motivosPausa: Record<string, number>
  /** Causa estructurada → cuántas ventanas cubrió. */
  causasPausa: Record<string, number>
}

export const MIN_OBLIGACIONES_RONDAS = 8

export type EstadoRondas = 'no_aplica' | 'datos_insuficientes' | 'medible'

export interface ResumenRondas {
  estado: EstadoRondas
  medicion: Medicion
  /** Lo que queda después de sacar todo lo no atribuible. */
  atribuibles: number
  cumplidas: number
  noRealizadas: number
  excluidas: number
  saneadas: number
  bajoPausa: number
  pausaAtribuible: number
  pausaNoAtribuible: number
  pausaCapacitacion: number
  pausaSinClasificar: number
  motivosPausa: Record<string, number>
  causasPausa: Record<string, number>
  /** Porcentaje sobre lo atribuible. */
  porcentaje: number | null
  nota: number | null
  /** Quedaron exclusiones que nadie justificó: la nota no se puede sostener. */
  enValidacion: boolean
}

/**
 * `no_aplica` y `datos_insuficientes` NO son lo mismo y ninguno es cero.
 *
 *   no_aplica            la persona no tiene rondas exigibles. No hay nada que
 *                        medir y no le falta nada.
 *   datos_insuficientes  tiene obligación de rondas, pero tan poca que un
 *                        número diría más de lo que sabe.
 *
 * ── Qué sale del universo y qué no ─────────────────────────────────────────
 * Salen: las saneadas administrativamente, las pausadas por causa técnica, de
 * configuración o porque no correspondía, las pausadas por falta de
 * capacitación, y las pausadas sin causa —que son todas las de agosto—.
 *
 * NO sale: la pausada porque la ronda se podía hacer y no se estaba haciendo.
 * Esa es la única que cuenta como no realizada, y sólo porque una persona
 * eligió esa causa al pausar. No se deduce de ninguna palabra del motivo.
 */
export function resumirRondas(
  r: RondasEmpleado | null, curva: CurvaNota = 'proporcional',
): ResumenRondas {
  const vacia = medir({ requeridos: 0, cumplidos: 0, minimo: MIN_OBLIGACIONES_RONDAS, curva })
  const vacio: ResumenRondas = {
    estado: 'no_aplica', medicion: vacia, atribuibles: 0, cumplidas: 0, noRealizadas: 0,
    excluidas: 0, saneadas: 0, bajoPausa: 0, pausaAtribuible: 0, pausaNoAtribuible: 0,
    pausaCapacitacion: 0, pausaSinClasificar: 0, motivosPausa: {}, causasPausa: {},
    porcentaje: null, nota: null, enValidacion: false,
  }
  if (!r || r.obligaciones === 0) return vacio

  const exclusiones: Exclusion[] = [
    { clave: 'saneadas', etiqueta: 'saneadas administrativamente', cantidad: r.saneadas },
    { clave: 'pausa_no_atribuible', etiqueta: 'pausadas por causa técnica o de configuración', cantidad: r.pausaNoAtribuible },
    { clave: 'pausa_capacitacion', etiqueta: 'pausadas por falta de capacitación', cantidad: r.pausaCapacitacion },
    {
      clave: 'pausa_sin_clasificar',
      etiqueta: 'pausadas sin causa registrada',
      cantidad: r.pausaSinClasificar,
      // Es lo que mantiene Rondas en validación. Una pausa sin causa puede
      // haber sido un problema técnico o la ronda que no se hacía, y las dos
      // cosas se leen igual.
      ambigua: true,
    },
  ]

  // Las que no se hicieron: las que el evaluador marcó, MÁS las que quedaron
  // bajo una pausa que dice "se podía hacer y no se hacía".
  const noRealizadas = r.noIniciada + r.noFinalizada + r.suspendida + r.pausaAtribuible

  const medicion = medir({
    requeridos: r.obligaciones,
    cumplidos: r.cumplidas,
    exclusiones,
    minimo: MIN_OBLIGACIONES_RONDAS,
    curva,
  })

  return {
    estado: medicion.estado,
    medicion,
    atribuibles: medicion.validos,
    cumplidas: r.cumplidas,
    noRealizadas,
    excluidas: medicion.excluidos,
    saneadas: r.saneadas,
    bajoPausa: r.bajoPausa,
    pausaAtribuible: r.pausaAtribuible,
    pausaNoAtribuible: r.pausaNoAtribuible,
    pausaCapacitacion: r.pausaCapacitacion,
    pausaSinClasificar: r.pausaSinClasificar,
    motivosPausa: r.motivosPausa,
    causasPausa: r.causasPausa,
    porcentaje: medicion.validos > 0 ? Math.round((100 * r.cumplidas) / medicion.validos) : null,
    nota: medicion.nota,
    enValidacion: medicion.ambigua,
  }
}

/** "18 de 20 realizadas · 2 sin cumplir · 8 pausadas sin causa registrada". */
export function detalleRondas(x: ResumenRondas): string {
  if (x.medicion.requeridos === 0) return 'Sin rondas asignadas en el período'
  const partes: string[] = []
  if (x.atribuibles > 0) {
    partes.push(`${x.cumplidas} de ${x.atribuibles} realizadas`)
    if (x.noRealizadas > 0) partes.push(`${x.noRealizadas} no realizadas`)
    if (x.pausaAtribuible > 0) {
      partes.push(`${x.pausaAtribuible} pausadas porque no se estaban haciendo`)
    }
  }
  for (const e of x.medicion.exclusiones) partes.push(`${e.cantidad} ${e.etiqueta}`)
  if (partes.length === 0) return 'Sin obligaciones exigibles en el período'
  return partes.join(' · ')
}

/** Las causas de pausa, en texto legible y ordenadas por peso. */
export function causasLegibles(x: ResumenRondas): Array<{ causa: string; etiqueta: string; cantidad: number }> {
  return Object.entries(x.causasPausa)
    .map(([causa, cantidad]) => ({ causa, etiqueta: etiquetaCausa(causa), cantidad: Number(cantidad) }))
    .sort((a, b) => b.cantidad - a.cantidad)
}

export async function cargarRondasEmpleado(
  mes: string, empleadoId: string, client: any = supabase,
): Promise<{ dato: RondasEmpleado | null; error: string | null }> {
  const { datos, error } = await cargarRondasDelMes(mes, client)
  if (error) return { dato: null, error }
  return { dato: datos.find(d => d.guardiaId === empleadoId) ?? null, error: null }
}

/** Todas las filas del mes. Una consulta, para la tabla y para la simulación. */
export async function cargarRondasDelMes(
  mes: string, client: any = supabase,
): Promise<{ datos: RondasEmpleado[]; error: string | null }> {
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const { data, error } = await client.rpc('cumplimiento_rondas_por_empleado', {
    p_desde: `${mes}-01`,
    p_hasta: `${mes}-${String(ultimo).padStart(2, '0')}`,
  })
  if (error) return { datos: [], error: error.message }

  return {
    datos: ((data ?? []) as any[]).map(fila => ({
      guardiaId: fila.guardia_id,
      obligaciones: Number(fila.obligaciones ?? 0),
      cumplidas: Number(fila.cumplidas ?? 0),
      noIniciada: Number(fila.no_iniciada ?? 0),
      noFinalizada: Number(fila.no_finalizada ?? 0),
      suspendida: Number(fila.suspendida ?? 0),
      saneadas: Number(fila.saneadas ?? 0),
      bajoPausa: Number(fila.bajo_pausa ?? 0),
      pausaAtribuible: Number(fila.pausa_atribuible ?? 0),
      pausaNoAtribuible: Number(fila.pausa_no_atribuible ?? 0),
      pausaCapacitacion: Number(fila.pausa_capacitacion ?? 0),
      pausaSinClasificar: Number(fila.pausa_sin_clasificar ?? 0),
      motivosPausa: (fila.motivos_pausa ?? {}) as Record<string, number>,
      causasPausa: (fila.causas_pausa ?? {}) as Record<string, number>,
    })),
    error: null,
  }
}

// ── Evidencias: uniforme, libro de guardia y calidad ────────────────────────

export interface EvidenciaCumplimiento {
  analisis_tipo: string
  clasificacion_efectiva?: string | null
  revision_estado?: string | null
  motivos?: string[] | null
  guardia_id?: string | null
}

/** Debajo de esto no se da nota. Cinco evidencias es poco, pero es algo. */
export const MIN_EVIDENCIAS = 5

export interface ResumenEvidencia {
  total: number
  /** La IA no observó nada. */
  sinObservaciones: number
  /** La IA marcó algo y todavía nadie lo miró. NO penaliza. */
  observadasPendientes: number
  /** Una persona confirmó la observación. Es la única incidencia válida. */
  confirmadas: number
  /** Una persona la descartó: falso positivo de la IA, no falta del vigilador. */
  descartadas: number
  /** Cerradas administrativamente. Ni penalizan ni entran al aprendizaje. */
  saneadas: number
  /** La foto no permitió evaluar. El problema es la evidencia, no lo que muestra. */
  noEvaluables: number
  medicion: Medicion
  nota: number | null
  enValidacion: boolean
}

function contar(evidencias: EvidenciaCumplimiento[], tipo: string | null) {
  const r = {
    total: 0, sinObservaciones: 0, observadasPendientes: 0,
    confirmadas: 0, descartadas: 0, saneadas: 0, noEvaluables: 0,
  }
  for (const e of evidencias) {
    if (tipo !== null && e.analisis_tipo !== tipo) continue
    if (tipo === null && (TIPOS_EVIDENCIA_IA as readonly string[]).indexOf(e.analisis_tipo) < 0) continue
    r.total += 1
    if (e.clasificacion_efectiva === 'EVIDENCIA_INSUFICIENTE') { r.noEvaluables += 1; continue }
    if (e.clasificacion_efectiva === 'SIN_OBSERVACIONES') { r.sinObservaciones += 1; continue }
    // Observada por la IA: lo que decide es la persona.
    if (esSaneada(e.revision_estado)) { r.saneadas += 1; continue }
    if (esperaRevision(e.revision_estado)) { r.observadasPendientes += 1; continue }
    if (esDecisionHumana(e.revision_estado)) {
      if (e.revision_estado === 'CORRECTO') r.confirmadas += 1
      else r.descartadas += 1
    }
  }
  return r
}

/**
 * Uniforme y Libro de guardia: sólo las fotos que SÍ subió.
 *
 * ── Por qué el requerido son las fotos existentes ──────────────────────────
 * Si no hay foto porque no fichó, eso ya es una incidencia de Procedimiento y
 * contarla otra vez acá sería castigar dos veces el mismo hecho. Y afirmar
 * "uniforme incorrecto" sobre una foto que nunca existió sería inventar.
 *
 * ── Qué sale del universo ──────────────────────────────────────────────────
 *   no evaluables   el problema es la foto: cuenta en Calidad, no acá.
 *   sin revisar     la IA observó algo y nadie lo confirmó. No es una falta.
 *   saneadas        cierre administrativo. Nadie las miró.
 *
 * Queda: sin observaciones + confirmada por una persona + descartada por una
 * persona. Cumplidas son las dos primeras — una observación descartada es un
 * error de la IA, no del vigilador.
 */
export function resumirEvidencias(
  evidencias: EvidenciaCumplimiento[], tipo: string, curva: CurvaNota = 'proporcional',
): ResumenEvidencia {
  const c = contar(evidencias, tipo)

  const exclusiones: Exclusion[] = [
    { clave: 'no_evaluables', etiqueta: 'no permitieron evaluar', cantidad: c.noEvaluables },
    {
      clave: 'sin_revisar',
      etiqueta: 'observadas y sin revisar',
      cantidad: c.observadasPendientes,
      // Sin decisión humana no se sabe si la observación era cierta. La nota
      // que sale de acá describe sólo lo que alguien miró.
      ambigua: true,
    },
    { clave: 'saneadas', etiqueta: 'saneadas, sin revisar', cantidad: c.saneadas },
  ]

  const medicion = medir({
    requeridos: c.total,
    cumplidos: c.sinObservaciones + c.descartadas,
    exclusiones,
    minimo: MIN_EVIDENCIAS,
    curva,
  })

  return { ...c, medicion, nota: medicion.nota, enValidacion: medicion.ambigua }
}

/**
 * El texto de una dimensión de evidencia.
 *
 * Dice explícitamente qué NO penaliza. Alguien que lee "3 observadas" sin más
 * asume que son tres faltas, y hasta que una persona las mire no son nada.
 */
export function detalleEvidencia(r: ResumenEvidencia): string {
  if (r.total === 0) return 'Sin evidencias del período'
  const partes = [`${r.total} evidencia${r.total === 1 ? '' : 's'}`]
  if (r.sinObservaciones > 0) partes.push(`${r.sinObservaciones} sin observaciones`)
  if (r.confirmadas > 0) partes.push(`${r.confirmadas} observación(es) confirmada(s) por una persona`)
  if (r.descartadas > 0) partes.push(`${r.descartadas} descartada(s): falso positivo de la IA`)
  if (r.observadasPendientes > 0) partes.push(`${r.observadasPendientes} sin revisar, no penalizan`)
  if (r.saneadas > 0) partes.push(`${r.saneadas} saneadas, no penalizan`)
  if (r.noEvaluables > 0) partes.push(`${r.noEvaluables} no evaluables`)
  return partes.join(' · ')
}

export async function cargarEvidenciasEmpleado(
  mes: string, empleadoId: string, client: any = supabase,
): Promise<{ evidencias: EvidenciaCumplimiento[]; error: string | null }> {
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const { data, error } = await client
    .from('evidencia_analisis')
    .select('analisis_tipo, clasificacion_efectiva, revision_estado, motivos, guardia_id')
    .eq('guardia_id', empleadoId)
    .eq('estado', 'completado')
    .gte('evidencia_created_at', `${mes}-01T00:00:00`)
    .lte('evidencia_created_at', `${mes}-${String(ultimo).padStart(2, '0')}T23:59:59`)
  if (error) return { evidencias: [], error: error.message }
  return {
    evidencias: ((data ?? []) as any[]).filter(
      e => (TIPOS_EVIDENCIA_IA as readonly string[]).indexOf(e.analisis_tipo) >= 0,
    ),
    error: null,
  }
}

/**
 * Calidad de evidencias: mira TODAS, sin importar el tipo.
 *
 * El hecho primario manda: si una foto no permite evaluar el uniforme, el
 * problema es la foto. Por eso las no evaluables son la INCIDENCIA acá y en
 * Uniforme salen del universo. El mismo hecho cuenta una sola vez, y cuenta
 * donde de verdad ocurrió.
 */
export function resumirCalidad(
  evidencias: EvidenciaCumplimiento[], curva: CurvaNota = 'proporcional',
): ResumenEvidencia {
  const c = contar(evidencias, null)

  const medicion = medir({
    requeridos: c.total,
    // Cualquier foto que se pudo leer es una foto de calidad suficiente, diga
    // lo que diga sobre el uniforme o el libro. Eso se juzga en otra dimensión.
    cumplidos: c.total - c.noEvaluables,
    minimo: MIN_EVIDENCIAS,
    curva,
  })

  return { ...c, medicion, nota: medicion.nota, enValidacion: false }
}

export function detalleCalidad(r: ResumenEvidencia): string {
  if (r.total === 0) return 'Sin evidencias del período'
  const evaluables = r.total - r.noEvaluables
  const partes = [`${evaluables} de ${r.total} evaluables`]
  if (r.noEvaluables > 0) {
    partes.push(`${r.noEvaluables} no permitieron evaluar — el problema es la foto, no lo que muestra`)
  }
  return partes.join(' · ')
}

export { detalleMedicion }

// ── El puente hacia lib/cumplimiento ────────────────────────────────────────

/**
 * Las cuatro dimensiones externas, listas para `calcularCumplimiento`.
 *
 * Una sola función para la tabla, la ficha y el panel. Cuando cada pantalla
 * armaba lo suyo, la lista y la tabla mostraban números distintos de la misma
 * persona durante un mes.
 */
export function fuentesDeEmpleado(
  rondas: RondasEmpleado | null,
  evidencias: EvidenciaCumplimiento[],
  curva: CurvaNota = 'proporcional',
): {
  fuentes: FuentesCumplimiento
  rondas: ResumenRondas
  uniforme: ResumenEvidencia
  libro: ResumenEvidencia
  calidad: ResumenEvidencia
} {
  const r = resumirRondas(rondas, curva)
  const uniforme = resumirEvidencias(evidencias, 'uniforme', curva)
  const libro = resumirEvidencias(evidencias, 'libro_guardia', curva)
  const calidad = resumirCalidad(evidencias, curva)

  const fuentes: FuentesCumplimiento = {
    rondas: {
      nota: r.nota,
      detalle: detalleRondas(r),
      enValidacion: r.enValidacion,
      noAplica: r.estado === 'no_aplica',
    },
    uniforme: {
      nota: uniforme.nota,
      detalle: detalleEvidencia(uniforme),
      enValidacion: uniforme.enValidacion,
      noAplica: uniforme.total === 0,
    },
    libro_guardia: {
      nota: libro.nota,
      detalle: detalleEvidencia(libro),
      enValidacion: libro.enValidacion,
      // Sin ninguna foto de libro en el período no se afirma nada: puede ser un
      // objetivo móvil, donde no hay libro que fotografiar.
      noAplica: libro.total === 0,
    },
    evidencias: {
      nota: calidad.nota,
      detalle: detalleCalidad(calidad),
      // Calidad se queda descriptiva por decisión, no por falta de datos: mide
      // si la foto se podía leer, y eso no debe bajarle el puntaje a nadie.
      enValidacion: true,
      noAplica: calidad.total === 0,
    },
  }

  return { fuentes, rondas: r, uniforme, libro, calidad }
}

/** Todas las evidencias del mes, sin filtrar por persona. Para la lista. */
export async function cargarEvidenciasDelMes(
  mes: string, client: any = supabase,
): Promise<{ evidencias: EvidenciaCumplimiento[]; error: string | null }> {
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const salida: EvidenciaCumplimiento[] = []
  // Paginado: el mes entero pasa holgadamente el límite de 1000 filas de
  // PostgREST, y una página silenciosamente truncada haría que a la mitad de la
  // gente le falten evidencias sin ningún error a la vista.
  const TAM = 1000
  for (let desde = 0; ; desde += TAM) {
    const { data, error } = await client
      .from('evidencia_analisis')
      .select('analisis_tipo, clasificacion_efectiva, revision_estado, motivos, guardia_id')
      .eq('estado', 'completado')
      .gte('evidencia_created_at', `${mes}-01T00:00:00`)
      .lte('evidencia_created_at', `${mes}-${String(ultimo).padStart(2, '0')}T23:59:59`)
      .order('evidencia_created_at', { ascending: true })
      .range(desde, desde + TAM - 1)
    if (error) return { evidencias: [], error: error.message }
    const pagina = (data ?? []) as any[]
    salida.push(...pagina.filter(
      e => (TIPOS_EVIDENCIA_IA as readonly string[]).indexOf(e.analisis_tipo) >= 0,
    ))
    if (pagina.length < TAM) break
  }
  return { evidencias: salida, error: null }
}

/** Agrupa por guardia, para no filtrar la lista completa una vez por persona. */
export function evidenciasPorEmpleado(
  evidencias: EvidenciaCumplimiento[],
): Map<string, EvidenciaCumplimiento[]> {
  const m = new Map<string, EvidenciaCumplimiento[]>()
  for (const e of evidencias) {
    const id = String(e.guardia_id ?? '')
    if (!id) continue
    const arr = m.get(id) ?? []
    arr.push(e)
    m.set(id, arr)
  }
  return m
}
