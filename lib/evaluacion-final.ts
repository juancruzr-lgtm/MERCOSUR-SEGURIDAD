// La segunda capa de la evaluación: de índice a nota final.
//
// ── Por qué hay dos capas ───────────────────────────────────────────────────
// Un promedio ponderado puede decir "esto es peor". No puede decir "esto es
// inaceptable". Medido sobre agosto con los pesos vigentes: alguien que hizo 20
// de 50 rondas exigibles —el 40 % del servicio— y tiene el resto del mes
// impecable termina con índice 8,09 y nota escolar 6,11. Aprueba.
//
// Y no es un error de los pesos: con Rondas en 35 de 110, las otras cinco
// dimensiones en 10 alcanzan para sostenerlo. Para que el promedio solo lo
// aplazara habría que darle a Rondas un peso que destruiría a cualquiera con
// una sola ronda pausada.
//
// De ahí la separación:
//
//   CAPA 1  Desempeño calculado. Dimensiones, pesos, normalización.
//           Es `lib/cumplimiento.ts` y no cambia.
//   CAPA 2  Faltas críticas: hechos confirmados que imponen un TOPE y que no se
//           compensan con uniforme perfecto ni con buen uso de la app.
//
// Las dos se conservan y se muestran juntas. "4,0 con 9,1 de desempeño" es una
// decisión auditable; "4,0" a secas parece un error de cuentas.
//
// ── Lo que esta capa NO hace ────────────────────────────────────────────────
// Afirmar por qué pasó lo que pasó. El sistema sabe que alguien realizó 19 de
// 52 rondas exigibles. No sabe si estaba dormido, si abandonó el puesto o si
// hubo una emergencia que nadie cargó. El hecho se enuncia; la interpretación
// disciplinaria es de Administración.

import type { ClaveDimension, Dimension } from './cumplimiento'

// ── La escala escolar argentina ─────────────────────────────────────────────
//
// Continua, sin bandas: 0,1 de índice no puede mover un punto entero.
//
// ⚠️ NO es la de `lib/escala-escolar.ts`. Aquella —la primera simulación, con
// 70 → 6— quedó obsoleta y nunca se aprobó: hacía que cumplir el 70 % de lo
// exigido alcanzara para aprobar. Estos anclajes son los que se auditaron
// contra los datos reales de agosto.
//
// La diferencia vive en la parte baja, que es la que decide quién aprueba:
//
//   índice 70  →  vieja 6,00   ·  ésta 4,33
//   índice 80  →  vieja 7,00   ·  ésta 6,00
//   índice 90  →  vieja 8,00   ·  ésta 7,33
export const ANCLAJES: Array<{ indice: number; nota: number }> = [
  { indice: 0, nota: 1 },
  { indice: 68, nota: 4 },
  { indice: 80, nota: 6 },
  { indice: 88, nota: 7 },
  { indice: 94, nota: 8 },
  { indice: 98, nota: 9 },
  { indice: 100, nota: 10 },
]

export const CONCEPTO: Record<number, string> = {
  10: 'Sobresaliente', 9: 'Excelente', 8: 'Muy bueno', 7: 'Bueno',
  6: 'Aprobado', 5: 'Insuficiente', 4: 'Aplazado', 3: 'Aplazado',
  2: 'Aplazado', 1: 'Aplazado',
}

/** El concepto que corresponde a una nota, redondeando hacia abajo. */
export function conceptoDe(nota: number): string {
  return CONCEPTO[Math.max(1, Math.min(10, Math.floor(nota)))]
}

/** Del índice 0-100 a la nota escolar, interpolando en recta entre anclajes. */
export function notaEscolar(indice: number): number {
  const x = Math.max(0, Math.min(100, indice))
  for (let i = 1; i < ANCLAJES.length; i++) {
    const a = ANCLAJES[i - 1]
    const b = ANCLAJES[i]
    if (x <= b.indice) {
      const t = (x - a.indice) / (b.indice - a.indice)
      return Math.round((a.nota + t * (b.nota - a.nota)) * 100) / 100
    }
  }
  return 10
}

// ── Cobertura de la evaluación ──────────────────────────────────────────────
//
// «No aplica» y «Datos insuficientes» se ven igual en el denominador y no
// significan lo mismo:
//
//   NO APLICA            no tenía esa obligación. Es el puesto que le tocó, no
//                        una carencia suya ni nuestra.
//   DATOS INSUFICIENTES  la tenía y no pudimos medirla. La carencia es del
//                        sistema de medición — pero tampoco se puede afirmar
//                        que cumplió.
//
// La cobertura AJUSTADA descuenta lo que no aplicaba, y es la que decide.
// Castigar a alguien por no tener rondas asignadas sería inventarle una
// obligación.

export interface Cobertura {
  medido: number
  teorico: number
  noAplica: number
  bruta: number
  /** `medido / (teorico − noAplica)`. La que decide. */
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
    medido, teorico, noAplica,
    bruta: pct(medido, teorico),
    ajustada: exigible > 0 ? pct(medido, exigible) : null,
  }
}

/**
 * Debajo de esto no se afirma un concepto integral — ni "Sobresaliente" ni
 * "Aplazado".
 *
 * Es el mismo criterio que ya rige la ambigüedad de Rondas y la cobertura de
 * Puntualidad: cuando no alcanza para sostener una afirmación, no se afirma. En
 * agosto, tres de las ocho personas que quedarían aplazadas tienen menos del
 * 57 % de su evaluación medida, y lo estarían casi enteramente por Registro en
 * App. Llamar "mal vigilador" a alguien de quien medimos la mitad del servicio
 * y ninguna ronda es exactamente lo que este umbral impide.
 */
export const COBERTURA_MINIMA = 70

export type Alcance = 'integral' | 'parcial'

export function alcanceDe(c: Cobertura): Alcance {
  if (c.ajustada === null) return 'parcial'
  return c.ajustada >= COBERTURA_MINIMA ? 'integral' : 'parcial'
}

// ── Faltas críticas ─────────────────────────────────────────────────────────

export type ClaveFalta = 'inasistencia_injustificada' | 'rondas_incumplidas'

export interface FaltaCritica {
  clave: ClaveFalta
  /** El HECHO probado, sin interpretación disciplinaria. */
  hecho: string
  tope: number
}

/**
 * Mínimo de rondas exigibles para que el porcentaje signifique algo.
 *
 * Con menos, "la mitad" puede ser 1 de 2. La distribución real de agosto es
 * bimodal —nadie entre el 50 % y el 69 %— así que el porcentaje no es lo que
 * decide: lo que decide es este mínimo. Con 12 en vez de 8, el peor caso real
 * —0 de 9 rondas— quedaría sin falta crítica.
 */
export const MINIMO_RONDAS_EXIGIBLES = 8

/** Debajo de esto, aplaza. Entre esto y el siguiente, tope 6. */
export const RONDAS_CRITICO = 50
export const RONDAS_GRAVE = 60

/**
 * Turnos distintos con incumplimiento a partir de los cuales el hecho deja de
 * ser un episodio y describe cómo trabaja la persona.
 *
 * Dos. Con dos turnos distintos ya no puede ser el día que pasó algo, el
 * objetivo con la ronda mal configurada o el turno donde hubo una emergencia:
 * son dos jornadas separadas en las que la ronda no se hizo. Pedir tres dejaría
 * dos noches seguidas malas sin ninguna consecuencia sobre la nota final.
 */
export const MINIMO_TURNOS_INCUMPLIDOS = 2

/**
 * `cumplidas` y `exigibles` son las que quedaron DESPUÉS de las reglas de
 * atribución: sin las técnicas, sin las de configuración, sin las anteriores a
 * la creación de la ronda, sin las de jornadas con ausencia registrada y sin
 * las ambiguas que no se pueden resolver.
 *
 * ── Por qué el tercer parámetro ─────────────────────────────────────────────
 * El porcentaje dice qué proporción de lo exigible se hizo. NO dice sobre
 * cuánta operación se midió eso, y esos son dos hechos distintos:
 *
 *   0 de 9 rondas, todas en UN turno, de 23 turnos trabajados en el mes
 *   0 de 33 rondas, repartidas en CUATRO turnos, los cuatro incumplidos
 *
 * Los dos dan 0 %. Hasta acá los dos recibían el mismo tope 4, que es la
 * afirmación más fuerte que hace el modelo: "de este mes no se puede decir
 * nada bueno". Una sola jornada no alcanza para afirmar eso.
 *
 * LO QUE NO CAMBIA: la NOTA de Rondas. El porcentaje sigue siendo
 * cumplidas/exigibles y sigue pesando lo mismo; un 0 % sigue arrastrando la
 * dimensión a cero. El volumen de turnos no mejora el porcentaje de nadie.
 * Lo único que gradúa es la SEVERIDAD del tope sobre la nota final.
 *
 * `turnosConIncumplimiento` indefinido —dato no disponible— aplica el tope
 * duro: ante la falta del dato no se absuelve a nadie.
 */
export function faltaPorRondas(
  cumplidas: number,
  exigibles: number,
  turnosConIncumplimiento?: number | null,
): FaltaCritica | null {
  if (exigibles < MINIMO_RONDAS_EXIGIBLES) return null
  const pct = (100 * cumplidas) / exigibles
  if (pct >= RONDAS_GRAVE) return null

  // Sin el dato, se asume reincidencia: no absolver por falta de información.
  const turnos = turnosConIncumplimiento ?? MINIMO_TURNOS_INCUMPLIDOS
  const reincidente = turnos >= MINIMO_TURNOS_INCUMPLIDOS

  // Entre 50 y 60 el tope es 6 con o sin reincidencia: el incumplimiento existe
  // pero la mayoría de las rondas se hizo, y ahí el volumen no agrega nada.
  const tope = pct < RONDAS_CRITICO ? (reincidente ? 4 : 6) : 6

  const hecho = `Realizó ${cumplidas} de ${exigibles} rondas exigibles `
    + `(${Math.round(pct * 10) / 10} %)`
    + (turnosConIncumplimiento == null ? ''
      : `, con incumplimiento en ${turnosConIncumplimiento} turno${turnosConIncumplimiento === 1 ? '' : 's'}`)

  return { clave: 'rondas_incumplidas', hecho, tope }
}

/**
 * Inasistencia injustificada confirmada.
 *
 * El dato viene ya clasificado, no deducido: `lib/novedades-laborales.ts` lo
 * saca de lo que Administración eligió en Reportes —`falta_injustificada` con
 * estado `aprobada`—, que es un valor de una lista cerrada, con autor y fecha
 * de aprobación. No sale de un comentario ni de la falta de un fichaje.
 *
 * Lo que NUNCA es una inasistencia: trabajar sin dejar registro propio, que el
 * supervisor confirme la asistencia, o un cierre automático de salida. En los
 * tres casos la persona estuvo, y el hecho pertenece a Registro en App.
 *
 * No escalona: una falta y tres faltas topean igual en 4. La cantidad se
 * muestra, porque tres no es lo mismo que una para quien tiene que decidir,
 * pero no hay datos para calibrar un segundo escalón y ponerlo sería inventar.
 */
export function faltaPorInasistencia(injustificadasConfirmadas: number): FaltaCritica | null {
  if (injustificadasConfirmadas < 1) return null
  return {
    clave: 'inasistencia_injustificada',
    hecho: injustificadasConfirmadas === 1
      ? '1 inasistencia injustificada confirmada'
      : `${injustificadasConfirmadas} inasistencias injustificadas confirmadas`,
    tope: 4,
  }
}

/**
 * La regla de inasistencia está ACTIVA.
 *
 * Se encendió después de auditar el flujo real: Reportes escribe el motivo
 * estructurado en `novedades_laborales`, con rango de un solo día y aprobación
 * en el acto. La fuente es determinística y la eligió una persona.
 *
 * Lo que NO se hizo todavía, y está en
 * `JORNADAS_JUSTIFICADAS_SALEN_DEL_UNIVERSO`: que un franco o una licencia
 * saquen esa jornada del denominador de las demás dimensiones. Eso mueve el
 * denominador de mucha gente a la vez y no se pudo medir contra producción.
 */
export const INASISTENCIA_ACTIVA = true

// ── La composición, en orden ────────────────────────────────────────────────

export interface Evaluacion {
  /** CAPA 1, intacta. */
  indice: number
  desempeno: number
  cobertura: Cobertura
  alcance: Alcance
  /** CAPA 2. */
  faltas: FaltaCritica[]
  /** `min(desempeño, topes)`. Nunca sube una nota. */
  notaFinal: number
  concepto: string
  /** Una línea que explica por qué la nota final es la que es. */
  explicacion: string
}

/**
 * El orden importa y es éste:
 *
 *   1. las dimensiones ya vienen calculadas y con su estado;
 *   2. cobertura ajustada sobre las que aplican;
 *   3. índice ponderado (ya viene);
 *   4. nota escolar;
 *   5. faltas críticas;
 *   6. tope = el más restrictivo;
 *   7. nota final = min(desempeño, tope).
 *
 * Un tope NUNCA sube una nota: quien ya está debajo del tope se queda donde
 * está.
 */
export function evaluar(
  indice: number, dimensiones: Dimension[], pesos: Record<ClaveDimension, number>,
  faltas: Array<FaltaCritica | null> = [],
): Evaluacion {
  const cobertura = coberturaDe(dimensiones, pesos)
  const alcance = alcanceDe(cobertura)
  const activas = faltas.filter((f): f is FaltaCritica => f !== null)
  const desempeno = notaEscolar(indice)
  const tope = activas.reduce((min, f) => Math.min(min, f.tope), Infinity)
  const notaFinal = Math.min(desempeno, tope)

  const partes: string[] = []
  if (activas.length > 0 && notaFinal < desempeno) {
    partes.push(`${desempeno} de desempeño · ${notaFinal} final por `
      + activas.map(f => f.hecho.toLowerCase()).join(' y '))
  } else {
    partes.push(`${desempeno} de desempeño`)
  }
  if (alcance === 'parcial') {
    partes.push(`Evaluación parcial: se pudo evaluar el ${cobertura.ajustada ?? 0} % `
      + 'de los requerimientos aplicables')
  }

  return {
    indice, desempeno, cobertura, alcance, faltas: activas, notaFinal,
    // Con cobertura parcial el concepto es orientativo, y por eso se dice
    // aparte en vez de estamparlo sobre el número.
    concepto: alcance === 'integral' ? conceptoDe(notaFinal) : 'Evaluación parcial',
    explicacion: partes.join(' · '),
  }
}
