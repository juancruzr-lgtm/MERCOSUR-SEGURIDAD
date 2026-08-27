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
 * `cumplidas` y `exigibles` son las que quedaron DESPUÉS de las reglas de
 * atribución: sin las técnicas, sin las de configuración, sin las anteriores a
 * la creación de la ronda, sin las de jornadas con ausencia registrada y sin
 * las ambiguas que no se pueden resolver.
 */
export function faltaPorRondas(cumplidas: number, exigibles: number): FaltaCritica | null {
  if (exigibles < MINIMO_RONDAS_EXIGIBLES) return null
  const pct = (100 * cumplidas) / exigibles
  if (pct >= RONDAS_GRAVE) return null

  const hecho = `Realizó ${cumplidas} de ${exigibles} rondas exigibles `
    + `(${Math.round(pct * 10) / 10} %)`
  return { clave: 'rondas_incumplidas', hecho, tope: pct < RONDAS_CRITICO ? 4 : 6 }
}

/**
 * Inasistencia injustificada confirmada.
 *
 * ⚠️ NO ESTÁ ACTIVA. Pide el dato ya clasificado en vez de deducirlo, y hoy
 * nadie se lo pasa: ver `INASISTENCIA_ACTIVA` abajo.
 *
 * Una ausencia en `registros_asistencia` (tipo_registro = 'ausencia') dice que
 * no vino, NO por qué. El motivo estructurado vive en `novedades_laborales`
 * —tipo 'falta_injustificada' con estado 'aprobada', con aprobador, fecha y
 * comprobante— y el módulo de Cumplimiento todavía no la cruza. Mientras eso no
 * exista, "no vino" y "faltó sin aviso" son indistinguibles, y confundirlas
 * aplaza a alguien que estaba de vacaciones.
 *
 * Lo que NUNCA es una inasistencia: trabajar sin dejar registro propio, que el
 * supervisor confirme la asistencia, o un cierre automático de salida. En los
 * tres casos la persona estuvo.
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
 * El interruptor de la regla de inasistencia. Encenderlo requiere ANTES:
 *
 *   1. cruzar `novedades_laborales` (tipo = 'falta_injustificada',
 *      estado = 'aprobada') contra la fecha del turno;
 *   2. verificar en producción que la tabla existe y está poblada;
 *   3. resolver qué pasa cuando el rango de la novedad cubre parcialmente el
 *      turno, que es el caso ambiguo que queda.
 *
 * Sin las tres, el tope no se puede sostener frente a alguien.
 */
export const INASISTENCIA_ACTIVA = false

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
