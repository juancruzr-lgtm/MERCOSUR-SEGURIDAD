import { describe, expect, it } from 'vitest'
import {
  NOTA_APROBADO, filaDeEvaluacion, filasDeSnapshot, resumirSnapshot,
} from '@/lib/evaluacion-snapshot'
import type { EntradaSnapshot, FilaEvaluacion } from '@/lib/evaluacion-snapshot'

// El snapshot no calcula: aplana lo que el motor ya produjo. Lo que se fija acá
// es que las cuatro capas viajen separadas y que la muestra insuficiente no se
// convierta nunca en un cero.

const persona = (over: any = {}): EntradaSnapshot => ({
  desempeno: {
    empleadoId: 'e1',
    empleado: 'PEREZ, JUAN',
    objetivos: ['PLANTA'],
    resultado: {} as any,
    cumplimiento: {
      puntaje: over.ponderado ?? 9.4,
      estado: over.estado ?? 'correcto',
      dimensiones: over.dimensiones ?? [{ clave: 'asistencia', nota: 10 }],
    } as any,
    evaluacion: over.evaluacion === null ? null : {
      indice: 94, desempeno: over.indice ?? 8.1, notaFinal: over.nota ?? 8.1,
      concepto: over.concepto ?? 'Muy bueno',
      // `coberturaDe` devuelve porcentajes, no fracciones: 100 es cobertura total.
      cobertura: over.cobertura === null
        ? { medido: 100, teorico: 110, noAplica: 10, bruta: 90.9, ajustada: null }
        : { medido: 100, teorico: 110, noAplica: 10, bruta: 90.9, ajustada: over.cobertura ?? 100 },
      alcance: 'completo', faltas: over.faltas ?? [], explicacion: over.explicacion ?? '',
    } as any,
    jornadas: new Array(over.jornadas ?? 24).fill({}),
  } as any,
  balance: over.balance ?? null,
  contexto: over.contexto,
})

describe('las cuatro capas viajan separadas', () => {
  const f = filaDeEvaluacion(persona(), '2026-08')

  it('el ponderado se guarda de 0 a 100, no de 0 a 10', () => {
    // Guardarlo en 0-10 es lo que permitió confundirlo con una nota.
    expect(f.cumplimiento_ponderado).toBe(94)
  })

  it('la nota final es la calificación y va aparte', () => {
    expect(f.nota_final).toBe(8.1)
    expect(f.nota_final).not.toBe(f.cumplimiento_ponderado)
  })

  it('el índice también se conserva, para poder explicar el tope', () => {
    expect(f.indice).toBe(8.1)
  })

  it('la cobertura se guarda como porcentaje, tal cual la da el motor', () => {
    // `coberturaDe` ya devuelve 0-100. Volver a multiplicar por 100 daba 10.000
    // y `numeric(5,2)` rechazaba la fila entera con "numeric field overflow".
    expect(f.cobertura).toBe(100)
    expect(filaDeEvaluacion(persona({ cobertura: 72.7 }), '2026-08').cobertura).toBe(72.7)
  })

  it('sin nada exigible la cobertura queda en null, no en cero', () => {
    // Cero se leería como "no se midió nada"; null dice que no aplicaba.
    expect(filaDeEvaluacion(persona({ cobertura: null }), '2026-08').cobertura).toBeNull()
  })

  it('arranca en calculada: publicar es un acto aparte', () => {
    expect(f.estado).toBe('calculada')
  })
})

describe('sin muestra suficiente no se inventa una nota', () => {
  const f = filaDeEvaluacion(persona({ evaluacion: null, ponderado: null }), '2026-08')

  it('la nota queda en null, nunca en cero', () => {
    expect(f.nota_final).toBeNull()
    expect(f.indice).toBeNull()
    expect(f.cumplimiento_ponderado).toBeNull()
  })

  it('queda marcado explícitamente', () => {
    expect(f.datos_insuficientes).toBe(true)
  })

  it('con nota, la marca es falsa', () => {
    expect(filaDeEvaluacion(persona(), '2026-08').datos_insuficientes).toBe(false)
  })
})

describe('el contexto viaja con la nota', () => {
  it('guarda las jornadas para poder decir sobre cuánto se midió', () => {
    const f = filaDeEvaluacion(persona({ jornadas: 24 }), '2026-08')
    expect((f.contexto as any).jornadas).toBe(24)
  })

  it('acepta el detalle de rondas, que es lo que explica un 0 %', () => {
    // El caso OYOLA: 0 % sobre UN turno no es 0 % sobre veinte.
    const f = filaDeEvaluacion(persona({
      contexto: { rondasExigibles: 9, rondasCumplidas: 0, turnosConObligacionDeRonda: 1 },
    }), '2026-08')
    expect((f.contexto as any).rondasExigibles).toBe(9)
    expect((f.contexto as any).turnosConObligacionDeRonda).toBe(1)
  })
})

describe('el resumen de Gerencia sale del mismo snapshot', () => {
  const filas: FilaEvaluacion[] = filasDeSnapshot([
    persona({ nota: 9.9, ponderado: 10 }),
    persona({ nota: 8.1, ponderado: 9.4 }),
    persona({ nota: 6.0, ponderado: 8.6, faltas: [{ tope: 6 }] }),
    persona({ nota: 4.0, ponderado: 6.8, faltas: [{ tope: 6 }] }),
    persona({ evaluacion: null, ponderado: null }),
  ], '2026-08')
  const r = resumirSnapshot(filas)

  it('cuenta el total y separa los que no tienen nota', () => {
    expect(r.total).toBe(5)
    expect(r.conNota).toBe(4)
    expect(r.sinDatos).toBe(1)
  })

  it('el promedio de nota y el de ponderado son distintos y no se mezclan', () => {
    expect(r.promedioNota).toBeCloseTo(7, 1)
    expect(r.promedioPonderado).toBeCloseTo(87, 0)
    expect(r.promedioNota).not.toBe(r.promedioPonderado)
  })

  it('distribuye por nota entera', () => {
    expect(r.distribucion[9]).toBe(1)
    expect(r.distribucion[8]).toBe(1)
    expect(r.distribucion[6]).toBe(1)
    expect(r.distribucion[4]).toBe(1)
  })

  it('aprobados y aplazados usan la escala ya aprobada', () => {
    expect(NOTA_APROBADO).toBe(6)
    expect(r.aprobados).toBe(3)
    expect(r.aplazados).toBe(1)
  })

  it('cuenta cuántos tienen tope aplicado', () => {
    expect(r.conTope).toBe(2)
  })

  it('los sin nota no entran en ningún promedio', () => {
    const soloSinDatos = resumirSnapshot(filasDeSnapshot([persona({ evaluacion: null, ponderado: null })], '2026-08'))
    expect(soloSinDatos.promedioNota).toBeNull()
    expect(soloSinDatos.promedioPonderado).toBeNull()
  })
})
