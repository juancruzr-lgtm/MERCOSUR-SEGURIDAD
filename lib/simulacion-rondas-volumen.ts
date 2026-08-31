// SIMULACIÓN. Nada de esto está conectado a la evaluación productiva.
//
// ── La pregunta ─────────────────────────────────────────────────────────────
// Un 0 % de rondas repartido en DOS turnos y un 0 % repartido en VEINTE no son
// el mismo historial, y hoy el sistema los puntúa igual. El porcentaje mide
// qué proporción de lo exigible se hizo; no dice sobre cuánta operación se
// midió eso.
//
// El caso real de agosto que lo muestra:
//
//   OYOLA   0 de 9 rondas atribuibles · 1 turno con obligación · 23 turnos en el mes
//   GOMEZ   0 de 33 rondas atribuibles · 4 turnos con obligación, los 4 incumplidos
//
// Los dos dan 0 %. Los dos reciben hoy la misma falta crítica con tope 4. Pero
// GOMEZ dejó de hacer rondas en cuatro noches distintas y OYOLA en una sola:
// uno es un patrón y el otro es un episodio.
//
// ── Lo que NO se busca ──────────────────────────────────────────────────────
// Que tener pocos turnos sea un premio. Un 0 % en un turno sigue siendo un 0 %
// y la nota de Rondas tiene que reflejarlo. Lo que se discute es distinto: si
// UN turno alcanza para tapar la nota del mes entero con un tope de 4.
//
// La cantidad de turnos no entra como mérito. Entra como CONFIANZA: cuánta
// evidencia hay de que esto es la conducta habitual y no un día.

/** Lo medido de una persona en el período, después de las reglas de atribución. */
export interface MuestraRondas {
  /** Ventanas exigibles, ya sin las excluidas (técnicas, saneadas, ambiguas). */
  atribuibles: number
  cumplidas: number
  /** Turnos distintos en los que tuvo al menos una ronda exigible. */
  turnosConObligacion: number
  /** Turnos distintos en los que dejó al menos una ronda sin hacer. */
  turnosConIncumplimiento: number
}

export interface ResultadoModelo {
  /** Porcentaje de cumplimiento. `null` si no hay nada atribuible. */
  porcentaje: number | null
  /** Tope de nota final que impone la falta crítica. `null` si no hay falta. */
  tope: number | null
  /** El hecho, en palabras, sin interpretación disciplinaria. */
  hecho: string
}

export const MINIMO_RONDAS = 8
export const CRITICO = 50
export const GRAVE = 60

export function porcentaje(m: MuestraRondas): number | null {
  return m.atribuibles > 0 ? (100 * m.cumplidas) / m.atribuibles : null
}

const pctTexto = (p: number) => `${Math.round(p * 10) / 10} %`

const hechoBase = (m: MuestraRondas, p: number) =>
  `Realizó ${m.cumplidas} de ${m.atribuibles} rondas exigibles (${pctTexto(p)}), `
  + `distribuidas en ${m.turnosConObligacion} turno${m.turnosConObligacion === 1 ? '' : 's'}; `
  + `incumplió en ${m.turnosConIncumplimiento} de ${m.turnosConObligacion}`

// ── MODELO A — el productivo de hoy ─────────────────────────────────────────
// Sólo porcentaje y mínimo de rondas. El volumen de turnos no participa.

export function modeloA(m: MuestraRondas): ResultadoModelo {
  const p = porcentaje(m)
  if (p === null || m.atribuibles < MINIMO_RONDAS) {
    return { porcentaje: p, tope: null, hecho: 'Muestra insuficiente para exigir' }
  }
  if (p >= GRAVE) return { porcentaje: p, tope: null, hecho: hechoBase(m, p) }
  return { porcentaje: p, tope: p < CRITICO ? 4 : 6, hecho: hechoBase(m, p) }
}

// ── MODELO B — mínimo de turnos evaluados ───────────────────────────────────
// Igual que A, pero además exige haber medido al menos N turnos. Es el más
// simple de explicar y el más fácil de gambetear: alcanza con tener obligación
// en un solo turno largo para quedar fuera de toda falta crítica, por mal que
// haya salido. VILLA, con 16 rondas exigibles en un turno, entraría ahí.

export function modeloB(m: MuestraRondas, minimoTurnos = 2): ResultadoModelo {
  const a = modeloA(m)
  if (a.tope === null) return a
  if (m.turnosConObligacion < minimoTurnos) {
    return {
      porcentaje: a.porcentaje, tope: null,
      hecho: `${a.hecho} — sin falta crítica: obligación medida en menos de ${minimoTurnos} turnos`,
    }
  }
  return a
}

// ── MODELO C — severidad por porcentaje Y por reincidencia ──────────────────
// El tope depende de las dos cosas. Un porcentaje malo en un turno aplica el
// tope más benigno; el mismo porcentaje repetido en varios turnos aplica el
// duro. Diferencia bien, pero introduce una escala nueva de dos ejes que hay
// que explicar a cada encargado.

export function modeloC(m: MuestraRondas): ResultadoModelo {
  const a = modeloA(m)
  if (a.tope === null) return a
  const p = a.porcentaje as number
  const reincidente = m.turnosConIncumplimiento >= 3
  const tope = p < CRITICO ? (reincidente ? 4 : 6) : (reincidente ? 6 : 7)
  return { porcentaje: p, tope, hecho: `${a.hecho} — ${reincidente ? 'patrón reiterado' : 'incumplimiento concentrado'}` }
}

// ── MODELO D — propuesta: la falta crítica pide reincidencia ────────────────
//
// La falta crítica de Rondas exige las TRES cosas:
//   1. al menos 8 rondas atribuibles  (que el porcentaje signifique algo)
//   2. porcentaje por debajo del umbral   (que haya incumplimiento real)
//   3. incumplimiento en 2 o más turnos DISTINTOS  (que sea conducta, no un día)
//
// Por qué 2 y no 3: dos turnos distintos ya descartan el hecho aislado —el
// problema del día, el objetivo con la ronda mal configurada, el turno donde
// pasó algo— sin necesitar media quincena de historial. Pedir 3 dejaría a
// OYOLA y a cualquiera con dos noches seguidas malas fuera de toda consecuencia.
//
// LO QUE NO CAMBIA: la nota de Rondas. OYOLA sigue teniendo 0 % y esa
// dimensión sigue valiendo 0 con su peso completo. Lo único que no se dispara
// es el TOPE sobre la nota final del mes, que es una afirmación mucho más
// fuerte: "de este mes no se puede decir nada bueno". Un turno no alcanza para
// afirmar eso; dos ya empiezan a describir cómo trabaja.

export const MINIMO_TURNOS_INCUMPLIDOS = 2

export function modeloD(m: MuestraRondas): ResultadoModelo {
  const a = modeloA(m)
  if (a.tope === null) return a
  if (m.turnosConIncumplimiento < MINIMO_TURNOS_INCUMPLIDOS) {
    return {
      porcentaje: a.porcentaje, tope: null,
      hecho: `${a.hecho} — incumplimiento en un solo turno: la nota de Rondas lo refleja, `
        + 'pero no alcanza para topear el mes',
    }
  }
  return a
}

export const MODELOS = {
  A: { nombre: 'Porcentaje puro (productivo hoy)', fn: modeloA },
  B: { nombre: 'Porcentaje + mínimo de turnos con obligación', fn: (m: MuestraRondas) => modeloB(m) },
  C: { nombre: 'Severidad por porcentaje y reincidencia', fn: modeloC },
  D: { nombre: 'Falta crítica exige reincidencia (propuesta)', fn: modeloD },
} as const

export type ClaveModelo = keyof typeof MODELOS

/** Corre los cuatro modelos sobre la misma muestra. Para comparar de un vistazo. */
export function compararModelos(m: MuestraRondas): Record<ClaveModelo, ResultadoModelo> {
  return {
    A: MODELOS.A.fn(m), B: MODELOS.B.fn(m), C: MODELOS.C.fn(m), D: MODELOS.D.fn(m),
  }
}

/**
 * La línea que pide la orden de trabajo, para que Rondas deje de informar sólo
 * un porcentaje:
 *
 *   0/9 realizadas · 0 %
 *   Obligación distribuida en 1 turno.
 *   Incumplimiento en 1 de 1 turnos evaluados.
 */
export function detalleConVolumen(m: MuestraRondas): string {
  const p = porcentaje(m)
  const pct = p === null ? 'sin base' : pctTexto(p)
  const t = (n: number) => `${n} turno${n === 1 ? '' : 's'}`
  return `${m.cumplidas}/${m.atribuibles} realizadas · ${pct}\n`
    + `Obligación distribuida en ${t(m.turnosConObligacion)}.\n`
    + `Incumplimiento en ${m.turnosConIncumplimiento} de ${t(m.turnosConObligacion)} evaluados.`
}
