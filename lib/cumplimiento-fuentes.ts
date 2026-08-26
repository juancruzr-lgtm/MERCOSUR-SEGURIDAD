// Rondas y evidencias, para el detalle del Cumplimiento Operativo.
//
// Las cuatro dimensiones que salen de acá —Rondas, Uniforme, Libro de guardia y
// Calidad de evidencias— tienen peso 0. Se muestran igual, con sus números
// reales, porque esconder lo que todavía no se puede puntuar hace pensar que el
// número cubre más de lo que cubre.

import { supabase } from '@/lib/supabase'
import { TIPOS_EVIDENCIA_IA } from '@/lib/cierre-datos'
import { esDecisionHumana, esSaneada, esperaRevision } from '@/lib/ia/revision'

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
  /** Motivo textual de la pausa → cuántas ventanas cubrió. Sin clasificar. */
  motivosPausa: Record<string, number>
}

export const MIN_OBLIGACIONES_RONDAS = 8

export type EstadoRondas = 'no_aplica' | 'datos_insuficientes' | 'medible'

export interface ResumenRondas {
  estado: EstadoRondas
  /** Lo que queda después de sacar saneadas y ventanas bajo pausa. */
  atribuibles: number
  cumplidas: number
  noRealizadas: number
  excluidas: number
  saneadas: number
  bajoPausa: number
  motivosPausa: Record<string, number>
  /** Porcentaje sobre lo atribuible. Descriptivo: hoy no puntúa. */
  porcentaje: number | null
}

/**
 * `no_aplica` y `datos_insuficientes` NO son lo mismo y ninguno es cero.
 *
 *   no_aplica            la persona no tiene rondas asignadas. No hay nada que
 *                        medir y no le falta nada.
 *   datos_insuficientes  tiene obligación de rondas, pero tan poca que un
 *                        número diría más de lo que sabe.
 */
export function resumirRondas(r: RondasEmpleado | null): ResumenRondas {
  const vacio: ResumenRondas = {
    estado: 'no_aplica', atribuibles: 0, cumplidas: 0, noRealizadas: 0,
    excluidas: 0, saneadas: 0, bajoPausa: 0, motivosPausa: {}, porcentaje: null,
  }
  if (!r || r.obligaciones === 0) return vacio

  const noRealizadas = r.noIniciada + r.noFinalizada + r.suspendida
  const atribuibles = r.cumplidas + noRealizadas
  const excluidas = r.saneadas + r.bajoPausa

  // Todas sus obligaciones quedaron excluidas: no es que cumpla mal, es que no
  // hubo nada exigible. Decir "0 %" ahí sería una acusación inventada.
  if (atribuibles === 0) {
    return { ...vacio, excluidas, saneadas: r.saneadas, bajoPausa: r.bajoPausa, motivosPausa: r.motivosPausa }
  }

  return {
    estado: atribuibles >= MIN_OBLIGACIONES_RONDAS ? 'medible' : 'datos_insuficientes',
    atribuibles,
    cumplidas: r.cumplidas,
    noRealizadas,
    excluidas,
    saneadas: r.saneadas,
    bajoPausa: r.bajoPausa,
    motivosPausa: r.motivosPausa,
    porcentaje: Math.round((100 * r.cumplidas) / atribuibles),
  }
}

/** "18 de 20 realizadas · 2 no realizadas · 571 excluidas por pausa". */
export function detalleRondas(x: ResumenRondas): string {
  if (x.estado === 'no_aplica' && x.excluidas === 0) return 'Sin rondas asignadas en el período'
  const partes: string[] = []
  if (x.atribuibles > 0) {
    partes.push(`${x.cumplidas} de ${x.atribuibles} realizadas`)
    if (x.noRealizadas > 0) partes.push(`${x.noRealizadas} no realizadas`)
  }
  if (x.bajoPausa > 0) partes.push(`${x.bajoPausa} bajo ronda pausada`)
  if (x.saneadas > 0) partes.push(`${x.saneadas} saneadas históricas`)
  if (partes.length === 0) return 'Sin obligaciones exigibles en el período'
  return partes.join(' · ')
}

export async function cargarRondasEmpleado(
  mes: string, empleadoId: string, client: any = supabase,
): Promise<{ dato: RondasEmpleado | null; error: string | null }> {
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(y, m, 0).getDate()
  const { data, error } = await client.rpc('cumplimiento_rondas_por_empleado', {
    p_desde: `${mes}-01`,
    p_hasta: `${mes}-${String(ultimo).padStart(2, '0')}`,
  })
  if (error) return { dato: null, error: error.message }

  const fila = ((data ?? []) as any[]).find(f => f.guardia_id === empleadoId)
  if (!fila) return { dato: null, error: null }
  return {
    dato: {
      guardiaId: fila.guardia_id,
      obligaciones: Number(fila.obligaciones ?? 0),
      cumplidas: Number(fila.cumplidas ?? 0),
      noIniciada: Number(fila.no_iniciada ?? 0),
      noFinalizada: Number(fila.no_finalizada ?? 0),
      suspendida: Number(fila.suspendida ?? 0),
      saneadas: Number(fila.saneadas ?? 0),
      bajoPausa: Number(fila.bajo_pausa ?? 0),
      motivosPausa: (fila.motivos_pausa ?? {}) as Record<string, number>,
    },
    error: null,
  }
}

// ── Evidencias: uniforme, libro de guardia y calidad ────────────────────────

export interface EvidenciaCumplimiento {
  analisis_tipo: string
  clasificacion_efectiva?: string | null
  revision_estado?: string | null
  motivos?: string[] | null
}

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
}

export function resumirEvidencias(
  evidencias: EvidenciaCumplimiento[], tipo: string,
): ResumenEvidencia {
  const r: ResumenEvidencia = {
    total: 0, sinObservaciones: 0, observadasPendientes: 0,
    confirmadas: 0, descartadas: 0, saneadas: 0, noEvaluables: 0,
  }
  for (const e of evidencias) {
    if (e.analisis_tipo !== tipo) continue
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
  const ultimo = new Date(y, m, 0).getDate()
  const { data, error } = await client
    .from('evidencia_analisis')
    .select('analisis_tipo, clasificacion_efectiva, revision_estado, motivos')
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
 * problema es la foto. Por eso las no evaluables cuentan acá y NO se convierten
 * en "uniforme incorrecto" allá.
 */
export function resumirCalidad(evidencias: EvidenciaCumplimiento[]): ResumenEvidencia {
  const total: ResumenEvidencia = {
    total: 0, sinObservaciones: 0, observadasPendientes: 0,
    confirmadas: 0, descartadas: 0, saneadas: 0, noEvaluables: 0,
  }
  for (const tipo of TIPOS_EVIDENCIA_IA) {
    const r = resumirEvidencias(evidencias, tipo)
    total.total += r.total
    total.sinObservaciones += r.sinObservaciones
    total.observadasPendientes += r.observadasPendientes
    total.confirmadas += r.confirmadas
    total.descartadas += r.descartadas
    total.saneadas += r.saneadas
    total.noEvaluables += r.noEvaluables
  }
  return total
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
