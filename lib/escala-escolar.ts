// SIMULACIÓN — traducir el índice objetivo a una nota escolar de 1 a 10.
//
// ⚠️ Este módulo NO lo importa nada productivo. Existe para poder simular
// escalas sobre los números reales antes de decidir si alguna se adopta. El
// puntaje que la app calcula y muestra sigue siendo el de `lib/cumplimiento.ts`.
//
// ── Por qué la traducción es un problema aparte ─────────────────────────────
// El índice mide "qué porcentaje de lo que le tocaba cumplió". Un 90 % es
// literalmente eso. Pero una nota de 1 a 10 en Argentina no se lee como un
// porcentaje: se lee contra la escala de la escuela, donde 6 aprueba, 8 es muy
// bueno y 10 es raro.
//
// Si se muestra el índice directamente como nota, un 90 % —que operativamente
// es "una de cada diez obligaciones sin cumplir"— aparece como un 9, y un 9 en
// la escuela significa excelente. La traducción existe para que el número diga
// lo que la gente va a entender que dice.
//
// ── Lo que la traducción NO puede hacer ─────────────────────────────────────
// Fabricar malas notas. Si todos cumplen, todos pueden tener 10. Ninguna de
// estas escalas fuerza una curva ni reparte cupos: son funciones del índice de
// cada persona y nada más.

/** El índice objetivo, 0 a 100. Es el X/10 del modelo multiplicado por 10. */
export type Indice = number

export function indiceDesdePuntaje(puntaje: number): Indice {
  return Math.round(puntaje * 1000) / 100
}

export interface Banda {
  /** Piso inclusive del índice. */
  desde: number
  nota: number
}

/**
 * Las tres escalas por bandas, tal como se pidieron.
 *
 * Cada una es una lista ordenada de mayor a menor: se toma la primera banda
 * cuyo piso el índice alcanza.
 */
export const ESCALAS: Record<'A' | 'B' | 'C', { nombre: string; bandas: Banda[] }> = {
  A: {
    nombre: 'Conservadora',
    bandas: [
      { desde: 98, nota: 10 }, { desde: 94, nota: 9 }, { desde: 88, nota: 8 },
      { desde: 80, nota: 7 },  { desde: 70, nota: 6 }, { desde: 60, nota: 5 },
      { desde: 50, nota: 4 },  { desde: 40, nota: 3 }, { desde: 25, nota: 2 },
      { desde: 0,  nota: 1 },
    ],
  },
  B: {
    nombre: 'Más exigente',
    bandas: [
      { desde: 99, nota: 10 }, { desde: 96, nota: 9 }, { desde: 90, nota: 8 },
      { desde: 82, nota: 7 },  { desde: 72, nota: 6 }, { desde: 62, nota: 5 },
      { desde: 52, nota: 4 },  { desde: 42, nota: 3 }, { desde: 30, nota: 2 },
      { desde: 0,  nota: 1 },
    ],
  },
  C: {
    nombre: 'Más suave',
    bandas: [
      { desde: 97, nota: 10 }, { desde: 92, nota: 9 }, { desde: 86, nota: 8 },
      { desde: 78, nota: 7 },  { desde: 68, nota: 6 }, { desde: 58, nota: 5 },
      { desde: 48, nota: 4 },  { desde: 38, nota: 3 }, { desde: 25, nota: 2 },
      { desde: 0,  nota: 1 },
    ],
  },
}

export function notaPorBandas(indice: Indice, escala: 'A' | 'B' | 'C'): number {
  for (const b of ESCALAS[escala].bandas) {
    if (indice >= b.desde) return b.nota
  }
  return 1
}

// ── La cuarta opción: nota continua ─────────────────────────────────────────

/**
 * Los anclajes pedidos. La curva pasa exactamente por estos puntos y entre
 * ellos interpola en línea recta.
 *
 *   70 % → 6      80 % → 7      90 % → 8      95 % → 9      100 % → 10
 *
 * ── Por qué una interpolación por tramos y no una fórmula cerrada ───────────
 * Se puede escribir una potencia que pase cerca de los cinco puntos, pero no
 * por todos: los tramos no son parejos —de 6 a 7 hay 10 puntos de índice, de 8
 * a 9 hay 5, y de 9 a 10 hay otros 5—. Cualquier curva suave que respete los
 * extremos se desvía en el medio, y esa desviación es justo donde está la mitad
 * de la gente.
 *
 * Una recta entre anclajes hace exactamente lo prometido y se puede explicar en
 * una frase: "de 90 a 95 vas del 8 al 9, medio punto cada 2,5 %".
 *
 * Debajo de 70 se sigue con la misma pendiente del primer tramo hasta 1, para
 * que un índice bajo no colapse a 1 de golpe.
 */
export const ANCLAJES: Array<{ indice: number; nota: number }> = [
  { indice: 0,   nota: 1 },
  { indice: 70,  nota: 6 },
  { indice: 80,  nota: 7 },
  { indice: 90,  nota: 8 },
  { indice: 95,  nota: 9 },
  { indice: 100, nota: 10 },
]

export function notaContinua(indice: Indice): number {
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

// ── Lo que se mira para elegir ──────────────────────────────────────────────

export interface Reparto {
  /** Cuántas personas por nota entera, de 10 a 1. */
  porNota: Record<number, number>
  /** Con nota: tenían índice. */
  conNota: number
  /** Sin índice: datos insuficientes o sin jornadas. */
  sinNota: number
  /** Qué proporción cae en 9 o 10. Si es alta, esas notas pierden significado. */
  proporcionTop: number
  /** Qué proporción queda debajo de 6, o sea "debe mejorar". */
  proporcionDesaprueba: number
}

export function repartir(
  indices: Array<number | null>,
  nota: (i: Indice) => number,
): Reparto {
  const porNota: Record<number, number> = {}
  for (let n = 1; n <= 10; n++) porNota[n] = 0
  let conNota = 0
  let sinNota = 0
  let top = 0
  let bajo = 0

  for (const i of indices) {
    if (i === null || !Number.isFinite(i)) { sinNota += 1; continue }
    conNota += 1
    const n = Math.floor(nota(i))
    porNota[Math.max(1, Math.min(10, n))] += 1
    if (nota(i) >= 9) top += 1
    if (nota(i) < 6) bajo += 1
  }

  return {
    porNota,
    conNota,
    sinNota,
    proporcionTop: conNota > 0 ? Math.round((1000 * top) / conNota) / 10 : 0,
    proporcionDesaprueba: conNota > 0 ? Math.round((1000 * bajo) / conNota) / 10 : 0,
  }
}

/** "6 = aprobado" y el resto de la lectura, para poder explicarla. */
export const SIGNIFICADO: Record<number, string> = {
  10: 'Sobresaliente — prácticamente impecable',
  9:  'Excelente',
  8:  'Muy bueno',
  7:  'Bueno',
  6:  'Aprobado — cumple',
  5:  'Debe mejorar',
  4:  'Debe mejorar',
  3:  'Incumplimiento serio',
  2:  'Incumplimiento serio',
  1:  'Incumplimiento grave',
}
