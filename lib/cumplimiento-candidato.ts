// CANDIDATO — reglas propuestas el 27/08 a partir de la auditoría de agosto.
//
// ⚠️ NADA DE ESTE MÓDULO ESTÁ ACTIVO. No lo importa ninguna pantalla, ninguna
// ruta y ningún cálculo productivo. El puntaje que la app muestra sigue siendo
// el de `lib/cumplimiento.ts` con `PESOS` (Modelo E). Este archivo existe para
// que la propuesta se pueda leer, discutir y probar antes de decidir si se
// adopta, sin que nadie la vea aplicada por accidente.
//
// ── Qué encontró la auditoría ───────────────────────────────────────────────
// Revisando uno por uno a los que sacaban 10 y a los que quedaban debajo de 6
// aparecieron dos defectos que NO se arreglan cambiando pesos. Los pesos
// resultaron ser casi irrelevantes: mover Rondas de 30 a 40 no cambió la nota
// de ninguna persona. Lo que decide es si una dimensión puntúa o no.
//
//   1. La ambigüedad funciona como amnistía, y beneficia más al que peor está.
//   2. Un solo hecho —no dejar registro propio— castiga dos veces.
//
// Las dos reglas de abajo atacan exactamente eso, y ninguna inventa un
// incumplimiento: las dos se resuelven siempre a favor del empleado.

import type { ClaveDimension } from './cumplimiento'

/**
 * El interruptor. Mientras esté en `false` este módulo es documentación
 * ejecutable: se puede testear, no se puede aplicar.
 *
 * Encenderlo NO alcanza para que la app cambie —hay que cablear las funciones
 * en `lib/cumplimiento.ts`—, y es a propósito: la constante sola no puede
 * cambiar el número de nadie por un descuido.
 */
export const MODELO_CANDIDATO_ACTIVO = false

// ── Regla 1 · La ambigüedad no puede ser una amnistía ───────────────────────
//
// Hoy, cuando quedan exclusiones que nadie pudo justificar, la dimensión pasa a
// `en_validacion` y sale del promedio. La intención era buena: no afirmar un
// número que describe un universo recortado a ciegas.
//
// El efecto medido en agosto es el contrario del buscado. Un vigilador con 0
// rondas hechas de 9 exigibles —y 0 de 16 si no se excluyera nada— terminó con
// 100 de índice y nota 10, porque sus 7 exclusiones sin causa sacaron Rondas
// del cálculo. La ficha mostraba "Rondas 0" al lado de un 10. Otro con 19 de 52
// quedó también sin puntuar. Cuanto más sucia la medición, más protegido el
// peor cumplimiento.
//
// ── La regla ────────────────────────────────────────────────────────────────
// Se comparan las dos puntas del rango que la ambigüedad deja abierto:
//
//   techo  la nota sobre el universo saneado — lo más favorable posible, es la
//          que la ficha ya muestra hoy.
//   piso   la nota si no se excluyera nada.
//
// Si ni siquiera el techo aprueba, la conclusión no depende de lo que no
// sabemos: está mal de cualquier forma que se lo mire, y la dimensión puntúa
// —con el techo, nunca con el piso—. Si el techo aprueba y el piso no, la
// diferencia sí depende de lo que nadie clasificó: sigue en validación.
//
// Dicho en una frase, que es como hay que poder defenderlo:
// «si aun contando sólo lo que le podemos exigir con certeza no llega a
//  aprobar, no sirve alegar que el resto no se sabe».
//
// Esta regla NUNCA puede bajar a alguien por debajo de su mejor medición, y
// nunca puede empeorar a quien no tiene exclusiones ambiguas.

/** La nota mínima que se considera cumplimiento. Es el 6 de la escala escolar. */
export const APRUEBA_DESDE = 6

export interface RangoAmbiguo {
  /** Nota sobre el universo saneado. Lo más favorable. */
  techo: number
  /** Nota si no se excluyera nada. Lo más desfavorable. */
  piso: number
}

export function rangoAmbiguo(
  cumplidos: number, universoSaneado: number, universoTotal: number,
): RangoAmbiguo | null {
  if (universoSaneado <= 0 || universoTotal <= 0) return null
  const c = Math.max(0, Math.min(cumplidos, universoSaneado))
  return {
    techo: Math.round((1000 * c) / universoSaneado) / 100,
    piso: Math.round((1000 * c) / universoTotal) / 100,
  }
}

export interface ResolucionAmbiguedad {
  /** Si la dimensión entra al promedio pese a la ambigüedad. */
  puntua: boolean
  /** Con qué nota entra. Siempre el techo: lo más favorable. */
  nota: number | null
  motivo: string
}

/**
 * `null` cuando no hay ambigüedad: la dimensión sigue el camino normal y esta
 * regla no opina.
 */
export function resolverAmbiguedad(r: RangoAmbiguo | null): ResolucionAmbiguedad | null {
  if (!r) return null
  if (r.techo >= APRUEBA_DESDE) {
    return {
      puntua: false, nota: r.techo,
      motivo: `Entre ${r.piso} y ${r.techo} según qué haya sido lo no clasificado. `
        + 'La diferencia cambia la conclusión, así que no se afirma ninguna.',
    }
  }
  return {
    puntua: true, nota: r.techo,
    motivo: `Ni contando sólo lo exigible con certeza llega a ${APRUEBA_DESDE} `
      + `(${r.techo}). Lo no clasificado sólo podría empeorarlo, hasta ${r.piso}.`,
  }
}

// ── Regla 2 · Un hecho, un castigo ──────────────────────────────────────────
//
// La puntualidad sólo se puede medir en las jornadas donde hay fichaje propio:
// sin marca de entrada no hay hora que comparar. Eso es correcto y no se
// discute. El problema es lo que produce cuando el fichaje falta muchas veces.
//
// El caso que lo mostró: 25 jornadas trabajadas, 20 sin registro propio.
// Procedimiento lo penaliza —correctamente— por esas 20. Pero además
// Puntualidad se calcula sobre las 5 restantes, y 2 llegadas tarde sobre 5 dan
// una nota de 5, como si fuera impuntual en el 40 % de su mes. Sobre las 25
// jornadas reales serían 2 de 25.
//
// El mismo hecho —no fichar— produjo la penalización de Procedimiento y además
// deformó el denominador de Puntualidad. Es un castigo doble por un hecho
// único, y el segundo no está sostenido: no hay ninguna evidencia de cómo llegó
// esos 20 días.
//
// ── La regla ────────────────────────────────────────────────────────────────
// Si la puntualidad se pudo medir en menos de esta proporción de las jornadas,
// no se da nota: `datos_insuficientes`. La dimensión sale del denominador —no
// suma ni resta— y el hecho sigue penalizado una sola vez, donde corresponde.

export const COBERTURA_MINIMA_PUNTUALIDAD = 0.5

export function puntualidadEsSostenible(evaluadas: number, jornadas: number): boolean {
  if (jornadas <= 0) return false
  return evaluadas / jornadas >= COBERTURA_MINIMA_PUNTUALIDAD
}

// ── Pesos candidatos ────────────────────────────────────────────────────────
//
// Prácticamente idénticos al Modelo E que está en producción, y a propósito:
// las seis variantes simuladas sobre agosto (Rondas en 30, 35 y 40, cruzadas
// con tres escalas) no cambiaron la nota escolar de NADIE. Con Rondas medible
// en 12 personas de 65, su peso no tiene de dónde mover el agregado.
//
// El único ajuste es Rondas 30 → 35 contra Procedimiento 25 → 20, y no se
// propone por lo que produce en los números sino por lo que declara: recorrer
// el objetivo es el servicio, registrar en la app es el instrumento con que se
// verifica. Que el instrumento pesara casi lo mismo que el servicio era difícil
// de defender frente a un vigilador.
//
// Con las Reglas 1 y 2 aplicadas, este peso SÍ pasa a tener efecto real, porque
// deja de haber gente con Rondas mal y fuera del cálculo.
export const PESOS_CANDIDATOS: Record<ClaveDimension, number> = {
  asistencia: 25, rondas: 35, puntualidad: 25, procedimiento: 20,
  uniforme: 8, libro_guardia: 4, evidencias: 0,
}
