import { describe, expect, it } from 'vitest'
import { evaluar, faltaPorRondas, notaEscolar } from '@/lib/evaluacion-final'
import { ETIQUETA_DIMENSION, PESOS } from '@/lib/cumplimiento'
import type { ClaveDimension, Dimension } from '@/lib/cumplimiento'

// La lista de Cumplimiento mostraba `cumplimiento.puntaje` con el sufijo "/ 10"
// y la ficha del legajo mostraba `evaluacion.notaFinal`. Son dos capas del
// MISMO modelo, y la pantalla las presentaba como si fueran el mismo número.
//
//   dimensiones → cumplimiento ponderado → escala escolar → índice
//                → topes / Modelo C → NOTA FINAL → concepto
//
// Estos tests fijan los dos casos reales de agosto 2026 que lo destaparon.

const dims = (notas: Partial<Record<ClaveDimension, number | null>>): Dimension[] =>
  (Object.keys(PESOS) as ClaveDimension[]).map(clave => {
    const nota = clave in notas ? notas[clave]! : 10
    return {
      clave, etiqueta: ETIQUETA_DIMENSION[clave], nota, peso: PESOS[clave],
      estado: nota === null ? 'no_aplica' : 'puntuable', detalle: '',
    }
  })

// Las seis dimensiones que puntúan, con Rondas en el valor que corresponda.
const cuadro = (rondas: number) => dims({ rondas, evidencias: null })

describe('cumplimiento ponderado y nota final son cosas distintas', () => {
  it('la escala escolar es la aprobada, en sus puntos de anclaje', () => {
    expect(notaEscolar(68)).toBeCloseTo(4, 1)
    expect(notaEscolar(80)).toBeCloseTo(6, 1)
    expect(notaEscolar(88)).toBeCloseTo(7, 1)
    expect(notaEscolar(94)).toBeCloseTo(8, 1)
    expect(notaEscolar(98)).toBeCloseTo(9, 1)
    expect(notaEscolar(100)).toBeCloseTo(10, 1)
  })

  it('94 % de cumplimiento NO es nota 9,4: es 8', () => {
    // Es el punto de la escala que se decidió a propósito. Un 9,4 mostrado como
    // nota estaría inflando en más de un punto.
    expect(notaEscolar(94)).toBeLessThan(8.5)
    expect(notaEscolar(94)).toBeGreaterThan(7.5)
  })
})

// ── OYOLA, agosto 2026 ──────────────────────────────────────────────────────
// 24 jornadas · obligación de ronda en 1 solo turno · 0 de 9 rondas exigibles
// · incumplimiento en 1 de 1 turno evaluado → episodio aislado.

describe('OYOLA: la nota baja por la escala, no por el tope', () => {
  const evaluacion = evaluar(68, cuadro(0), PESOS, [faltaPorRondas(0, 9, 1)])

  it('el cumplimiento ponderado es 68 %', () => {
    // 20·10 + 25·10 + 35·0 + 8·10 + 4·10 + 18·10 = 750 sobre 110 = 68,2
    expect(evaluacion.desempeno).toBeCloseTo(notaEscolar(68), 5)
  })

  it('Modelo C lo trata como episodio aislado: tope 6, no 4', () => {
    const falta = faltaPorRondas(0, 9, 1)
    expect(falta).not.toBeNull()
    expect(falta!.tope).toBe(6)
  })

  it('la nota final es 4,0 y la fija la escala, no el tope', () => {
    expect(evaluacion.notaFinal).toBeCloseTo(4, 1)
    // El tope de 6 nunca llega a actuar: el índice ya estaba por debajo.
    expect(evaluacion.desempeno).toBeLessThan(6)
  })

  it('con un solo turno incumplido no se lo considera reincidente', () => {
    expect(faltaPorRondas(0, 9, 1)!.tope).toBeGreaterThan(faltaPorRondas(0, 9, 3)!.tope)
  })
})

// ── PIÑERO, agosto 2026 ─────────────────────────────────────────────────────
// 25 jornadas · obligación en 16 turnos · 19 de 52 rondas (36,5 %)
// · incumplimiento en 3 de 7 turnos evaluados → reiterado.

describe('PIÑERO: acá sí manda el tope del Modelo C', () => {
  const evaluacion = evaluar(74, cuadro(3.6), PESOS, [faltaPorRondas(19, 52, 3)])

  it('Modelo C lo trata como reiterado: tope 4', () => {
    expect(faltaPorRondas(19, 52, 3)!.tope).toBe(4)
  })

  it('el índice era 5,0 y el tope lo baja a 4,0', () => {
    expect(evaluacion.desempeno).toBeCloseTo(5, 1)
    expect(evaluacion.notaFinal).toBeCloseTo(4, 1)
    expect(evaluacion.notaFinal).toBeLessThan(evaluacion.desempeno)
  })

  it('la explicación dice que hubo un tope', () => {
    expect(evaluacion.faltas.length).toBeGreaterThan(0)
    expect(evaluacion.explicacion.length).toBeGreaterThan(0)
  })
})

// ── El contraste que justifica el Modelo C ──────────────────────────────────

describe('mismo 0 % de rondas, distinta severidad', () => {
  it('un episodio aislado no se topea igual que un patrón', () => {
    const aislado = faltaPorRondas(0, 9, 1)!
    const patron = faltaPorRondas(0, 9, 5)!
    expect(aislado.tope).toBe(6)
    expect(patron.tope).toBe(4)
  })

  it('sin el dato de turnos no se absuelve a nadie', () => {
    // La ausencia de dato no puede ser una ventaja: se asume reincidencia.
    expect(faltaPorRondas(0, 9)!.tope).toBe(4)
  })
})

// ── La nota final nunca sube ────────────────────────────────────────────────

describe('un tope sólo puede bajar la nota', () => {
  it('sin faltas, la nota final es el índice', () => {
    const e = evaluar(94, cuadro(10), PESOS, [])
    expect(e.notaFinal).toBeCloseTo(e.desempeno, 5)
  })

  it('con faltas, la nota final es el mínimo entre índice y tope', () => {
    const e = evaluar(94, cuadro(10), PESOS, [faltaPorRondas(19, 52, 3)])
    expect(e.notaFinal).toBeLessThanOrEqual(e.desempeno)
    expect(e.notaFinal).toBeCloseTo(4, 1)
  })
})
