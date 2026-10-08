// La nota oficial es la PUBLICADA. Todo lo demás es cálculo.
//
// ── Por qué existe ───────────────────────────────────────────────────────────
// La ficha del legajo recalcula el mes en vivo desde turnos, rondas y
// novedades. Mi Desempeño y el Tablero de Gerencia leen la evaluación
// publicada (`evaluaciones_mensuales`). Mientras las dos cuentas coinciden
// nadie lo nota; el día que Gerencia corrige una evaluación publicada —el caso
// MENA, septiembre 2026, tope 4 por salidas anticipadas— la ficha diría 10 y
// Mi Desempeño 4 sobre la misma persona y el mismo mes.
//
// Regla (Gerencia, 08/10/2026): todas las pantallas muestran la misma nota
// oficial publicada. El cálculo en vivo sólo puede mostrarse identificado como
// lo que es, y nunca con el formato de la nota oficial.

export interface EvaluacionOficial {
  estado: string
  nota_final: number | null
  indice: number | null
  faltas: unknown
  corregida_at?: string | null
}

export type RelacionCalculo = 'igual' | 'antes_del_tope' | 'distinto' | 'sin_calculo'

/** Es oficial sólo si está publicada y tiene nota. */
export function esOficial(e: EvaluacionOficial | null | undefined): e is EvaluacionOficial & { nota_final: number } {
  return Boolean(e) && e!.estado === 'publicada' && e!.nota_final !== null && Number.isFinite(Number(e!.nota_final))
}

const coma = (n: number) => n.toFixed(2).replace('.', ',')
const mismo = (a: number, b: number) => Math.abs(a - b) < 0.005

/**
 * Cómo se relaciona el cálculo en vivo con la nota oficial, y cómo decirlo.
 *
 *   igual           no se dice nada: no hay dos números.
 *   antes_del_tope  el cálculo es el desempeño publicado y la oficial quedó
 *                   limitada por una falta crítica (p. ej. la corrección de
 *                   Gerencia): "resultado anterior al tope crítico".
 *   distinto        los datos cambiaron después de publicar, o el motor ya no
 *                   aplica la misma regla: se dice que no es la oficial.
 */
export function relacionConCalculo(
  oficial: EvaluacionOficial,
  notaCalculada: number | null,
): { relacion: RelacionCalculo; texto: string | null } {
  if (notaCalculada === null || !Number.isFinite(notaCalculada)) {
    return { relacion: 'sin_calculo', texto: null }
  }
  const nota = Number(oficial.nota_final)
  if (mismo(notaCalculada, nota)) return { relacion: 'igual', texto: null }

  const faltas = Array.isArray(oficial.faltas) ? oficial.faltas as Array<{ tope?: unknown }> : []
  const tope = faltas.reduce((min, f) => Math.min(min, Number(f?.tope ?? Infinity)), Infinity)
  const indice = oficial.indice === null ? null : Number(oficial.indice)
  if (indice !== null && mismo(notaCalculada, indice) && tope < notaCalculada) {
    return {
      relacion: 'antes_del_tope',
      texto: `Resultado anterior al tope crítico: ${coma(notaCalculada)}. `
        + `No es la nota oficial: la falta crítica la limita a ${coma(nota)}.`,
    }
  }
  return {
    relacion: 'distinto',
    texto: `Cálculo con los datos actuales: ${coma(notaCalculada)}. No es la nota oficial: `
      + (oficial.corregida_at
        ? 'la oficial es la publicada y corregida por Gerencia.'
        : 'la oficial es la publicada. Si los datos del mes cambiaron, hay que volver a congelar y publicar.'),
  }
}
