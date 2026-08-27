// SIMULACIÓN — las dos capas de la evaluación y las faltas críticas.
//
// ⚠️ Nada productivo importa este módulo. El puntaje que la app calcula y
// muestra sigue siendo el promedio ponderado de `lib/cumplimiento.ts`, sin
// topes de ninguna clase. Esto existe para poder decidir con números.
//
// ── Por qué hacen falta dos capas ───────────────────────────────────────────
// Un promedio ponderado no puede decir "esto es inaceptable". Puede decir
// "esto es peor", que no es lo mismo.
//
// Medido sobre el Modelo 6: alguien que hizo 20 de 50 rondas exigibles —el
// 40 %— y tiene el resto del mes impecable termina con índice 8,09 y nota
// escolar 6,11. APRUEBA. Y no por un error de los pesos: con Rondas en 35 de
// 110, las otras cinco dimensiones en 10 alcanzan para sostenerlo. Para que el
// promedio solo lo aplazara habría que darle a Rondas un peso que destruiría a
// cualquiera que tenga una sola ronda pausada.
//
// De ahí las dos capas:
//
//   CAPA 1  Desempeño calculado. Dimensiones, pesos, normalización. Es el
//           número que describe el mes completo.
//   CAPA 2  Faltas críticas. Hechos confirmados que imponen un TOPE, y que no
//           se compensan con uniforme perfecto ni con buen uso de la app.
//
// Las dos se conservan. La nota final nunca reemplaza al desempeño calculado:
// se muestran juntas, porque "4,0 con 9,1 de desempeño" es una decisión
// auditable y "4,0" a secas parece un error de cuentas.

import type { CurvaNota } from './cumplimiento-medicion'

// ── La escala escolar argentina, continua ───────────────────────────────────
//
// Sin bandas abruptas: 0,1 de índice no puede mover un punto entero. Los
// anclajes son los de la D2-c ya simulada.
export const ANCLAJES_D2C: Array<{ indice: number; nota: number }> = [
  { indice: 0, nota: 1 },
  { indice: 68, nota: 4 },
  { indice: 80, nota: 6 },
  { indice: 88, nota: 7 },
  { indice: 94, nota: 8 },
  { indice: 98, nota: 9 },
  { indice: 100, nota: 10 },
]

export const SIGNIFICADO_ESCALA: Record<number, string> = {
  10: 'Sobresaliente', 9: 'Excelente', 8: 'Muy bueno', 7: 'Bueno',
  6: 'Aprobado', 5: 'Insuficiente', 4: 'Aplazado', 3: 'Aplazado',
  2: 'Aplazado', 1: 'Aplazado',
}

/** Del índice 0-100 a la nota escolar, interpolando entre anclajes. */
export function notaEscolar(indice: number): number {
  const x = Math.max(0, Math.min(100, indice))
  for (let i = 1; i < ANCLAJES_D2C.length; i++) {
    const a = ANCLAJES_D2C[i - 1]
    const b = ANCLAJES_D2C[i]
    if (x <= b.indice) {
      const t = (x - a.indice) / (b.indice - a.indice)
      return Math.round((a.nota + t * (b.nota - a.nota)) * 100) / 100
    }
  }
  return 10
}

// ── Faltas críticas ─────────────────────────────────────────────────────────

export type ClaveFalta = 'inasistencia_injustificada' | 'rondas_incumplidas'

export interface FaltaCritica {
  clave: ClaveFalta
  /** El HECHO, sin interpretación disciplinaria. */
  hecho: string
  /** La nota máxima que impone. */
  tope: number
}

/**
 * Inasistencia injustificada confirmada.
 *
 * ⚠️ NO se puede calcular con los datos de hoy, y por eso esta función pide el
 * dato ya clasificado en vez de deducirlo.
 *
 * Una ausencia en `registros_asistencia` (tipo_registro = 'ausencia') dice que
 * no vino, NO por qué. El motivo estructurado vive en `novedades_laborales`
 * —tipo 'falta_injustificada' con estado 'aprobada'—, una tabla que el módulo
 * de Cumplimiento no consume. Mientras no se crucen, "no vino" y "faltó sin
 * aviso" son indistinguibles, y confundirlas aplaza a alguien de vacaciones.
 *
 * Lo que NUNCA es una inasistencia: trabajar sin dejar registro propio. Eso es
 * Registro en App y ya se penaliza ahí.
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

export interface ReglaRondas {
  /** Debajo de este porcentaje de cumplimiento, hay falta crítica. */
  porcentaje: number
  /** Y sólo con al menos esta cantidad de rondas exigibles. */
  minimoExigibles: number
  tope: number
}

/**
 * Las cinco alternativas simuladas. La muestra mínima es lo que impide que
 * "1 de 2 rondas" se convierta en un aplazo.
 */
export const REGLAS_RONDAS: Record<string, ReglaRondas[]> = {
  R1: [{ porcentaje: 50, minimoExigibles: 8, tope: 4 }],
  R2: [{ porcentaje: 60, minimoExigibles: 8, tope: 4 }],
  R3: [{ porcentaje: 50, minimoExigibles: 12, tope: 4 }],
  R4: [{ porcentaje: 60, minimoExigibles: 12, tope: 4 }],
  // Progresivo: el escalón de 50-59 % avisa antes de aplazar.
  R5: [
    { porcentaje: 50, minimoExigibles: 8, tope: 4 },
    { porcentaje: 60, minimoExigibles: 8, tope: 6 },
  ],
}

/**
 * `cumplidas` y `exigibles` son las que quedaron DESPUÉS de las reglas de
 * atribución: sin las técnicas, sin las de configuración, sin las anteriores a
 * la creación de la ronda y sin las ambiguas que no se pueden resolver.
 */
export function faltaPorRondas(
  cumplidas: number, exigibles: number, reglas: ReglaRondas[],
): FaltaCritica | null {
  if (exigibles <= 0) return null
  const pct = (100 * cumplidas) / exigibles
  // De la más grave a la más leve: la primera que aplica manda.
  const ordenadas = [...reglas].sort((a, b) => a.tope - b.tope)
  for (const r of ordenadas) {
    if (exigibles >= r.minimoExigibles && pct < r.porcentaje) {
      return {
        clave: 'rondas_incumplidas',
        // El hecho y nada más. Que estuviera dormido o hubiera abandonado el
        // puesto son interpretaciones que el sistema no puede sostener.
        hecho: `Realizó ${cumplidas} de ${exigibles} rondas exigibles `
          + `(${Math.round(pct * 10) / 10} %)`,
        tope: r.tope,
      }
    }
  }
  return null
}

// ── La composición de las dos capas ─────────────────────────────────────────

export interface Evaluacion {
  /** CAPA 1, intacta. Nunca se pisa. */
  indice: number
  desempeno: number
  /** CAPA 2. */
  faltas: FaltaCritica[]
  /** El mínimo entre el desempeño y todos los topes. */
  notaFinal: number
  /** Para poder explicarlo en una línea. */
  explicacion: string
}

export function evaluar(indice: number, faltas: Array<FaltaCritica | null>): Evaluacion {
  const activas = faltas.filter((f): f is FaltaCritica => f !== null)
  const desempeno = notaEscolar(indice)
  const tope = activas.reduce((min, f) => Math.min(min, f.tope), Infinity)
  const notaFinal = Math.min(desempeno, tope)

  return {
    indice,
    desempeno,
    faltas: activas,
    notaFinal,
    explicacion: activas.length === 0
      ? `${desempeno} de desempeño`
      : `${desempeno} de desempeño · ${notaFinal} final por `
        + activas.map(f => f.hecho.toLowerCase()).join(' y '),
  }
}

// ── El límite que la simulación encontró ────────────────────────────────────
//
// Los topes resuelven el extremo alto: impiden que un incumplimiento grave
// quede tapado por cinco dimensiones en 10. No resuelven el extremo bajo.
//
// Sobre agosto, con Modelo 6 y esta escala, 8 personas quedan aplazadas. Tres
// de ellas —cobertura ajustada de 50 %, 53 % y 57 %— quedan aplazadas casi
// enteramente por Registro en App, sin rondas exigibles y sin puntualidad
// medible. Es decir: el sistema las aplaza por lo que NO pudo medir.
//
// La propuesta es que la cobertura opere en los dos extremos, con el mismo
// criterio que ya rige las Reglas 1 y 2: debajo del mínimo no se afirma. Ni un
// 10 integral, ni un aplazo.
export const COBERTURA_MINIMA_PARA_CALIFICAR = 70

export type Suficiencia = 'integral' | 'parcial'

export function suficienciaDe(coberturaAjustada: number | null): Suficiencia {
  if (coberturaAjustada === null) return 'parcial'
  return coberturaAjustada >= COBERTURA_MINIMA_PARA_CALIFICAR ? 'integral' : 'parcial'
}

/** Nunca baja el número: sólo dice qué se puede sostener con él. */
export function leyenda(e: Evaluacion, coberturaAjustada: number | null): string {
  const suf = suficienciaDe(coberturaAjustada)
  if (suf === 'integral') return e.explicacion
  return `${e.explicacion} · Evaluación parcial: se midió el ${coberturaAjustada ?? 0} % `
    + 'de lo exigible'
}

/** Sólo para que el tipo se use y quede claro de dónde vienen las notas. */
export const CURVA_DE_LAS_DIMENSIONES: CurvaNota = 'proporcional'
