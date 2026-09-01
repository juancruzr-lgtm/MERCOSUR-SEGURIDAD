/**
 * lib/adopcion-app.ts
 *
 * Quién usa bien la aplicación, quién necesita entrenamiento y quién viene
 * usándola mal de forma reiterada.
 *
 * ── Por qué es una vista aparte de la nota ───────────────────────────────────
 * La calificación mensual necesita muestra suficiente; la adopción no. Alguien
 * con cinco jornadas no puede tener nota, pero si en cuatro de esas cinco no
 * fichó, eso ya se sabe y hay que actuar. Por eso esta clasificación se calcula
 * también sobre las filas marcadas `datos_insuficientes`.
 *
 * ── Qué mide, y qué NO ───────────────────────────────────────────────────────
 * Sólo `Registro en la app`: jornadas trabajadas contra jornadas sin registro
 * propio del vigilador —las que hubo que regularizar por vía administrativa
 * porque el fichaje que le correspondía hacer a él no estaba.
 *
 * Las Rondas quedan fuera a propósito. Una ronda sin hacer es incumplimiento
 * del servicio, no mal uso de la aplicación, y mezclarlas haría que alguien que
 * ficha siempre bien apareciera como mal usuario de la app por un problema de
 * otra naturaleza.
 *
 * ── Por qué no hay fórmula nueva ─────────────────────────────────────────────
 * Los umbrales son los de `lib/entrenador-operativo.ts`, ya acordados: dos
 * veces es reincidencia, cuatro o el 30 % de sus jornadas es patrón. Inventar
 * un segundo criterio habría dejado a la misma persona clasificada de dos
 * maneras distintas según qué pantalla se mirara.
 */

import { severidadDe, UMBRAL, type Severidad } from '@/lib/entrenador-operativo'
import type { FilaPublicada } from '@/lib/mi-desempeno'

export type ClaseAdopcion =
  /** No hay jornadas sin registro propio. */
  | 'uso_correcto'
  /** Pasó, una o dos veces. Corresponde enseñar, no sancionar. */
  | 'necesita_entrenamiento'
  /** Pasa seguido o en una proporción alta de sus jornadas. */
  | 'uso_deficiente_reiterado'

export const ETIQUETA_ADOPCION: Record<ClaseAdopcion, string> = {
  uso_correcto: 'Uso correcto',
  necesita_entrenamiento: 'Necesita entrenamiento',
  uso_deficiente_reiterado: 'Uso deficiente reiterado',
}

export interface AdopcionEmpleado {
  empleadoId: string
  periodo: string
  /** Jornadas evaluadas del período. */
  jornadas: number
  /** Jornadas sin registro propio de entrada o salida. */
  sinRegistroPropio: number
  /** `null` cuando no hubo jornadas: no se divide por cero ni se inventa un 0 %. */
  proporcion: number | null
  severidad: Severidad | null
  clase: ClaseAdopcion
  hechos: string[]
  /**
   * La muestra es chica para hablar de proporciones, pero la clasificación vale
   * igual: se dice, no se oculta.
   */
  muestraChica: boolean
  /** La persona no llegó a tener nota mensual. No impide clasificar la adopción. */
  sinNota: boolean
}

const lista = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const objeto = (v: unknown): any => (v && typeof v === 'object' ? (v as any) : {})

export function claseDeSeveridad(s: Severidad | null): ClaseAdopcion {
  if (s === null) return 'uso_correcto'
  if (s === 'patron') return 'uso_deficiente_reiterado'
  return 'necesita_entrenamiento'
}

/**
 * Clasifica a una persona a partir de su evaluación congelada.
 *
 * Devuelve `null` cuando el período no midió el registro en la app: sin ese
 * bloque no hay nada que afirmar, y clasificar a alguien como "uso correcto"
 * porque no se lo midió sería inventar un dato favorable.
 */
export function adopcionDeFila(fila: FilaPublicada): AdopcionEmpleado | null {
  const bloque = lista(objeto(fila.balance).bloques)
    .find(b => b?.clave === 'procedimiento')
  if (!bloque) return null

  const jornadas = Number(bloque.requeridos ?? 0)
  const sinRegistroPropio = Number(bloque.incidencias ?? 0)
  if (jornadas <= 0) return null

  const severidad = severidadDe(sinRegistroPropio, jornadas)

  return {
    empleadoId: fila.empleado_id,
    periodo: fila.periodo,
    jornadas,
    sinRegistroPropio,
    proporcion: Math.round((sinRegistroPropio / jornadas) * 1000) / 10,
    severidad,
    clase: claseDeSeveridad(severidad),
    hechos: lista(bloque.hechos).map(String),
    muestraChica: jornadas < UMBRAL.minimoParaProporcion,
    sinNota: fila.datos_insuficientes || fila.nota_final === null,
  }
}

export interface ResumenAdopcion {
  total: number
  porClase: Record<ClaseAdopcion, number>
  /** El porcentaje de cada clase sobre el total clasificado. */
  porcentaje: Record<ClaseAdopcion, number>
  /** Jornadas sin registro propio, sumadas, y sobre cuántas trabajadas. */
  jornadasSinRegistro: number
  jornadasEvaluadas: number
  /** Los casos que hay que mirar, del más reiterado al menos. */
  casos: AdopcionEmpleado[]
  /** Cuántos de los casos no tienen nota mensual: se detectan igual. */
  sinNota: number
}

const CLASES: ClaseAdopcion[] = [
  'uso_correcto', 'necesita_entrenamiento', 'uso_deficiente_reiterado',
]

export function resumirAdopcion(items: readonly AdopcionEmpleado[]): ResumenAdopcion {
  const porClase = { uso_correcto: 0, necesita_entrenamiento: 0, uso_deficiente_reiterado: 0 }
  const porcentaje = { uso_correcto: 0, necesita_entrenamiento: 0, uso_deficiente_reiterado: 0 }
  for (const i of items) porClase[i.clase] += 1
  for (const c of CLASES) {
    porcentaje[c] = items.length === 0
      ? 0
      : Math.round((porClase[c] / items.length) * 1000) / 10
  }

  return {
    total: items.length,
    porClase,
    porcentaje,
    jornadasSinRegistro: items.reduce((s, i) => s + i.sinRegistroPropio, 0),
    jornadasEvaluadas: items.reduce((s, i) => s + i.jornadas, 0),
    casos: items
      .filter(i => i.clase !== 'uso_correcto')
      .sort((a, b) =>
        b.sinRegistroPropio - a.sinRegistroPropio
        || (b.proporcion ?? 0) - (a.proporcion ?? 0)),
    sinNota: items.filter(i => i.sinNota).length,
  }
}
