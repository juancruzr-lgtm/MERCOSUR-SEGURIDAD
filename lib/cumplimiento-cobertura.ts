// SIMULACIÓN — cuánto del modelo se le pudo medir realmente a cada persona.
//
// ⚠️ Nada productivo importa este módulo. El puntaje que la app muestra no lo
// usa. Existe para poder decidir, con números reales, qué hacer con los 10 que
// salen de haber medido dos tercios del servicio.
//
// ── El problema ─────────────────────────────────────────────────────────────
// El X/10 se normaliza sobre las dimensiones que puntúan, que es correcto: a
// nadie se le puede exigir una ronda que no tenía. Pero eso hace que dos 10
// signifiquen cosas muy distintas.
//
// En agosto, de las cuatro personas con 10:
//
//   · una tenía medido el 96 % del peso del modelo, rondas incluidas;
//   · una no tiene rondas asignadas, y sobre lo que SÍ le correspondía tenía
//     medido el 84 %;
//   · dos tienen rondas asignadas que no se pudieron medir: 57 %.
//
// Los cuatro números son 10. Sólo el primero significa "cumplió todo lo que se
// le exigió". Los otros significan "cumplió todo lo que se le pudo medir".
//
// ── Por qué hay DOS coberturas y no una ─────────────────────────────────────
// «No aplica» y «Datos insuficientes» se ven igual en el denominador pero no
// significan lo mismo, y confundirlos castiga a quien no tiene la culpa:
//
//   NO APLICA            no tenía esa obligación. No es una carencia suya ni
//                        nuestra: es el puesto que le tocó.
//   DATOS INSUFICIENTES  la tenía y no pudimos medirla. La carencia es del
//                        sistema de medición, no de la persona — pero tampoco
//                        se puede afirmar que cumplió.
//
// La cobertura BRUTA mide sobre todo el modelo. La AJUSTADA descuenta lo que
// no aplicaba, y es la que hay que mirar para decidir sobre un 10: castigar a
// alguien por no tener rondas asignadas sería inventarle una obligación.

import type { ClaveDimension, Dimension } from './cumplimiento'

export interface Cobertura {
  /** Suma de pesos de las dimensiones que efectivamente puntuaron. */
  medido: number
  /** Suma de todos los pesos positivos del modelo. */
  teorico: number
  /** Peso de las dimensiones que no le aplicaban. */
  noAplica: number
  /** `medido / teorico`, en porcentaje. */
  bruta: number
  /** `medido / (teorico − noAplica)`, en porcentaje. La que decide. */
  ajustada: number | null
}

export function coberturaDe(
  dimensiones: Dimension[], pesos: Record<ClaveDimension, number>,
): Cobertura {
  let medido = 0
  let teorico = 0
  let noAplica = 0

  for (const d of dimensiones) {
    const peso = pesos[d.clave] ?? 0
    if (peso <= 0) continue
    teorico += peso
    if (d.estado === 'no_aplica') noAplica += peso
    if (d.estado === 'puntuable') medido += peso
  }

  const exigible = teorico - noAplica
  const pct = (n: number, d: number) => (d > 0 ? Math.round((1000 * n) / d) / 10 : 0)

  return {
    medido,
    teorico,
    noAplica,
    bruta: pct(medido, teorico),
    ajustada: exigible > 0 ? pct(medido, exigible) : null,
  }
}

// ── Qué hacer con un 10 que salió de medir poco ─────────────────────────────
//
// Lo que NO se hace: bajarle el índice. No cumplió menos por que nosotros
// hayamos podido mirar menos, y restarle puntos por eso sería inventarle un
// incumplimiento. El número se respeta.
//
// Lo que sí: decir sobre cuánto se midió. «10 · Evaluación parcial» es
// defendible frente a la persona —no se le quita nada— y frente a quien decide
// —no se le presenta como excelencia integral algo que no se comprobó—.

export const UMBRALES_COBERTURA = { ninguno: 0, medio: 70, alto: 80 } as const

export type Suficiencia = 'integral' | 'parcial'

/**
 * Un puntaje perfecto sólo se puede llamar integral si se midió lo suficiente
 * de lo que a esa persona le correspondía.
 *
 * Se mira la cobertura AJUSTADA a propósito: quien no tiene rondas asignadas no
 * puede alcanzar nunca el 100 % bruto, y eso no es un mérito menor suyo.
 */
export function suficiencia(c: Cobertura, minimo: number): Suficiencia {
  if (c.ajustada === null) return 'parcial'
  return c.ajustada >= minimo ? 'integral' : 'parcial'
}

/** "10 · Evaluación parcial · se midió el 57 % de lo exigible". */
export function leyendaCobertura(
  puntaje: number | null, c: Cobertura, minimo: number,
): string | null {
  if (puntaje === null) return null
  if (suficiencia(c, minimo) === 'integral') return null
  return `Evaluación parcial · se midió el ${c.ajustada ?? 0} % de lo exigible`
}
