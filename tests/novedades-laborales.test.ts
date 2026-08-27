import { describe, expect, it } from 'vitest'
import {
  JORNADAS_JUSTIFICADAS_SALEN_DEL_UNIVERSO, clasificarDia,
  inasistenciasInjustificadas, novedadesAprobadas,
} from '@/lib/novedades-laborales'
import type { NovedadLaboral } from '@/lib/novedades-laborales'
import { INASISTENCIA_ACTIVA, evaluar, faltaPorInasistencia } from '@/lib/evaluacion-final'
import { PESOS } from '@/lib/cumplimiento'
import type { ClaveDimension } from '@/lib/cumplimiento'

// La fuente de la falta crítica por inasistencia. Todo lo que se afirma acá
// sale de lo que una persona de Administración eligió en Reportes: un valor de
// una lista cerrada, aprobado con su usuario. Nada se deduce de un comentario
// ni de la falta de un fichaje.

const nov = (o: Partial<NovedadLaboral> = {}): NovedadLaboral => ({
  empleado_id: 'e1', tipo: 'falta_injustificada',
  fecha_desde: '2026-08-10', fecha_hasta: '2026-08-10', estado: 'aprobada',
  ...o,
})

const dims = () => (Object.keys(PESOS) as ClaveDimension[]).map(clave => ({
  clave, etiqueta: clave, nota: null, peso: PESOS[clave],
  estado: 'puntuable' as any, detalle: '',
}))

describe('la regla está activa y la fuente es la de Reportes', () => {
  it('INASISTENCIA_ACTIVA quedó encendida', () => {
    expect(INASISTENCIA_ACTIVA).toBe(true)
  })

  it('el franco y la licencia no salen todavía del denominador', () => {
    // Pendiente declarado: mover el denominador de todas las dimensiones no se
    // pudo medir contra producción.
    expect(JORNADAS_JUSTIFICADAS_SALEN_DEL_UNIVERSO).toBe(false)
  })
})

describe('clasificar un día', () => {
  it('falta injustificada aprobada → injustificada', () => {
    expect(clasificarDia([nov()], 'e1', '2026-08-10')).toBe('injustificada')
  })

  it('los motivos que explican la ausencia → justificada', () => {
    for (const tipo of ['parte_medico', 'accidente', 'licencia', 'vacaciones',
      'falta_justificada', 'dia_estudio', 'suspension', 'franco']) {
      expect(clasificarDia([nov({ tipo })], 'e1', '2026-08-10')).toBe('justificada')
    }
  })

  it('PENDIENTE no es una falta confirmada', () => {
    expect(clasificarDia([nov({ estado: 'pendiente' })], 'e1', '2026-08-10')).toBe('sin_clasificar')
    expect(novedadesAprobadas([nov({ estado: 'pendiente' })])).toHaveLength(0)
  })

  it('RECHAZADA tampoco', () => {
    expect(clasificarDia([nov({ estado: 'rechazada' })], 'e1', '2026-08-10')).toBe('sin_clasificar')
  })

  it('sin novedad no se afirma nada: no es una falta', () => {
    expect(clasificarDia([], 'e1', '2026-08-10')).toBe('sin_clasificar')
    expect(clasificarDia([nov()], 'e1', '2026-08-11')).toBe('sin_clasificar')
  })

  it('"otra" no justifica ni acusa: es un cajón de sastre', () => {
    expect(clasificarDia([nov({ tipo: 'otra' })], 'e1', '2026-08-10')).toBe('sin_clasificar')
  })

  it('la novedad de otra persona no lo toca', () => {
    expect(clasificarDia([nov({ empleado_id: 'e2' })], 'e1', '2026-08-10')).toBe('sin_clasificar')
  })

  it('el rango se respeta por bordes inclusive', () => {
    const rango = [nov({ fecha_desde: '2026-08-10', fecha_hasta: '2026-08-12' })]
    expect(clasificarDia(rango, 'e1', '2026-08-09')).toBe('sin_clasificar')
    expect(clasificarDia(rango, 'e1', '2026-08-10')).toBe('injustificada')
    expect(clasificarDia(rango, 'e1', '2026-08-11')).toBe('injustificada')
    expect(clasificarDia(rango, 'e1', '2026-08-12')).toBe('injustificada')
    expect(clasificarDia(rango, 'e1', '2026-08-13')).toBe('sin_clasificar')
  })

  it('ante dos novedades del mismo día, la justificación gana', () => {
    // Alguien cargó "falta injustificada" y después el parte médico. En la duda
    // no se aplaza.
    const dos = [nov(), nov({ tipo: 'parte_medico' })]
    expect(clasificarDia(dos, 'e1', '2026-08-10')).toBe('justificada')
    expect(clasificarDia([...dos].reverse(), 'e1', '2026-08-10')).toBe('justificada')
  })
})

describe('contar inasistencias del período', () => {
  const turnos = ['2026-08-10', '2026-08-11', '2026-08-12']

  it('cuenta sólo los días en que tenía turno', () => {
    const rango = [nov({ fecha_desde: '2026-08-01', fecha_hasta: '2026-08-31' })]
    // La novedad cubre todo agosto, pero sólo trabajó tres días.
    expect(inasistenciasInjustificadas(rango, 'e1', turnos)).toBe(3)
  })

  it('cuenta días y no filas', () => {
    const rango = [nov({ fecha_desde: '2026-08-10', fecha_hasta: '2026-08-11' })]
    expect(inasistenciasInjustificadas(rango, 'e1', turnos)).toBe(2)
  })

  it('no cuenta dos veces la misma fecha repetida', () => {
    expect(inasistenciasInjustificadas([nov()], 'e1',
      ['2026-08-10', '2026-08-10', '2026-08-10'])).toBe(1)
  })

  it('sin novedades, cero', () => {
    expect(inasistenciasInjustificadas([], 'e1', turnos)).toBe(0)
  })

  it('las justificadas no suman', () => {
    const mix = [
      nov({ fecha_desde: '2026-08-10', fecha_hasta: '2026-08-10' }),
      nov({ tipo: 'vacaciones', fecha_desde: '2026-08-11', fecha_hasta: '2026-08-12' }),
    ]
    expect(inasistenciasInjustificadas(mix, 'e1', turnos)).toBe(1)
  })
})

describe('de la clasificación al tope', () => {
  it('una falta injustificada confirmada topea en 4, y el desempeño se conserva', () => {
    const n = inasistenciasInjustificadas([nov()], 'e1', ['2026-08-10'])
    const e = evaluar(100, dims(), PESOS, [faltaPorInasistencia(n)])
    expect(e.desempeno).toBe(10)
    expect(e.notaFinal).toBe(4)
    expect(e.explicacion).toContain('1 inasistencia injustificada confirmada')
  })

  it('unas vacaciones aprobadas NO topean nada', () => {
    const n = inasistenciasInjustificadas([nov({ tipo: 'vacaciones' })], 'e1', ['2026-08-10'])
    expect(n).toBe(0)
    const e = evaluar(100, dims(), PESOS, [faltaPorInasistencia(n)])
    expect(e.notaFinal).toBe(10)
    expect(e.faltas).toHaveLength(0)
  })

  it('una falta injustificada PENDIENTE tampoco', () => {
    const n = inasistenciasInjustificadas([nov({ estado: 'pendiente' })], 'e1', ['2026-08-10'])
    expect(n).toBe(0)
    expect(faltaPorInasistencia(n)).toBeNull()
  })

  it('tres faltas topean igual que una, y se dice cuántas', () => {
    const tres = inasistenciasInjustificadas(
      [nov({ fecha_desde: '2026-08-10', fecha_hasta: '2026-08-12' })], 'e1',
      ['2026-08-10', '2026-08-11', '2026-08-12'])
    expect(tres).toBe(3)
    const f = faltaPorInasistencia(tres)!
    expect(f.tope).toBe(4)
    expect(f.hecho).toBe('3 inasistencias injustificadas confirmadas')
  })
})
