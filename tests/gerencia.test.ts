import { describe, expect, it } from 'vitest'
import { evolucionMensual, hayTendencia, resumirGerencia } from '@/lib/gerencia'
import type { FilaPublicada } from '@/lib/mi-desempeno'

const fila = (over: Partial<FilaPublicada> = {}): FilaPublicada => ({
  empleado_id: Math.random().toString(36).slice(2),
  periodo: '2026-08',
  cumplimiento_ponderado: 97.1,
  indice: 8.78,
  nota_final: 8.78,
  concepto: 'Muy bueno',
  datos_insuficientes: false,
  cobertura: 100,
  alcance: 'integral',
  estado_desempeno: 'excelente',
  dimensiones: [
    { clave: 'rondas', etiqueta: 'Rondas', nota: 6, peso: 35, estado: 'puntuable' },
    { clave: 'asistencia', etiqueta: 'Asistencia', nota: 10, peso: 20, estado: 'puntuable' },
    { clave: 'evidencias', etiqueta: 'Calidad', nota: 10, peso: 0, estado: 'en_validacion' },
  ],
  faltas: [],
  explicacion: null,
  balance: null,
  contexto: {},
  estado: 'publicada',
  ...over,
})

describe('las dos magnitudes no se mezclan', () => {
  const r = resumirGerencia([fila(), fila({ nota_final: 6, cumplimiento_ponderado: 80 })], '2026-08')

  it('la nota promedio va sobre 10', () => {
    expect(r.notaPromedio).toBe(7.39)
    expect(r.notaPromedio!).toBeLessThanOrEqual(10)
  })

  it('el ponderado promedio va en porcentaje y es otro numero', () => {
    expect(r.ponderadoPromedio).toBe(88.55)
    expect(r.ponderadoPromedio).not.toBe(r.notaPromedio)
  })

  it('el ponderado nunca se devuelve en escala 0-10', () => {
    expect(r.ponderadoPromedio!).toBeGreaterThan(10)
  })
})

describe('los conteos que pide Gerencia', () => {
  const filas = [
    fila({ nota_final: 9 }),
    fila({ nota_final: 6 }),
    fila({ nota_final: 4, faltas: [{ clave: 'rondas_incumplidas', tope: 4 }] }),
    fila({ nota_final: 3.89, alcance: 'parcial', cobertura: 53.5 }),
    fila({ datos_insuficientes: true, nota_final: null, cumplimiento_ponderado: null, cobertura: null }),
  ]
  const r = resumirGerencia(filas, '2026-08')

  it('total, con nota y sin muestra', () => {
    expect(r.total).toBe(5)
    expect(r.conNota).toBe(4)
    expect(r.sinMuestra).toBe(1)
  })

  it('aprobados y aplazados con el corte en 6', () => {
    expect(r.aprobados).toBe(2)
    expect(r.aplazados).toBe(2)
  })

  it('las parciales se cuentan aparte', () => {
    expect(r.parciales).toBe(1)
  })

  it('los topes se cuentan', () => {
    expect(r.conTope).toBe(1)
  })

  it('la distribucion agrupa por nota entera', () => {
    expect(r.distribucion).toEqual({ 9: 1, 6: 1, 4: 1, 3: 1 })
  })

  it('sin muestra no entra en los promedios', () => {
    // Si entrara como cero, el promedio caeria sin que nadie sacara un cero.
    expect(r.notaPromedio).toBe(5.72)
  })
})

describe('las dimensiones que explican el resultado', () => {
  const r = resumirGerencia([fila(), fila()], '2026-08')

  it('vienen de peor a mejor promedio', () => {
    expect(r.dimensiones.map(d => d.clave)).toEqual(['rondas', 'asistencia'])
    expect(r.dimensiones[0].promedio).toBe(6)
  })

  it('las que no pesan quedan afuera', () => {
    expect(r.dimensiones.map(d => d.clave)).not.toContain('evidencias')
  })

  it('un no_aplica no cuenta como cero', () => {
    const r2 = resumirGerencia([
      fila(),
      fila({ dimensiones: [{ clave: 'rondas', etiqueta: 'Rondas', nota: null, peso: 35, estado: 'no_aplica' }] }),
    ], '2026-08')
    const rondas = r2.dimensiones.find(d => d.clave === 'rondas')!
    expect(rondas.promedio).toBe(6)
    expect(rondas.medidas).toBe(1)
  })
})

describe('no se inventa una tendencia con un solo mes', () => {
  it('un mes da un punto y nada mas', () => {
    const serie = evolucionMensual([fila(), fila()])
    expect(serie).toHaveLength(1)
    expect(hayTendencia(serie)).toBe(false)
  })

  it('con dos meses ya hay serie, ordenada', () => {
    const serie = evolucionMensual([
      fila({ periodo: '2026-09', nota_final: 8 }),
      fila({ periodo: '2026-08', nota_final: 7 }),
    ])
    expect(serie.map(p => p.periodo)).toEqual(['2026-08', '2026-09'])
    expect(hayTendencia(serie)).toBe(true)
  })
})

describe('sin filas no rompe', () => {
  it('todo en cero y promedios nulos', () => {
    const r = resumirGerencia([], '2026-08')
    expect(r.total).toBe(0)
    expect(r.notaPromedio).toBeNull()
    expect(r.ponderadoPromedio).toBeNull()
    expect(r.dimensiones).toEqual([])
  })
})
