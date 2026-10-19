import { describe, expect, it } from 'vitest'
import {
  duracionLegible, ordenarRanking, periodoPorDefecto, tasas, validarRango,
  cargarEvaluacionSupervisores, cargarDetalleSupervisor,
} from '@/lib/evaluacion-supervisores'
import type { FilaEvaluacionSupervisor } from '@/lib/evaluacion-supervisores'

function fila(p: Partial<FilaEvaluacionSupervisor>): FilaEvaluacionSupervisor {
  return {
    supervisor_id: 'x', supervisor: 'X', puesto: 'supervisor', zonas: 'Rosario', es_referencia: false,
    horas_guardia: 0, jornadas_guardia: 0, supervisiones: 0, vencimientos_supervision: 0,
    horas_objetivo_vencidas: 0, rondas_alertas: 0, rondas_intervenidas_propias: 0,
    rondas_intervenidas_por_otro: 0, rondas_cerradas_sin_intervencion: 0, rondas_sin_atender: 0,
    mediana_min_intervencion: null, reincidencias_sin_accion: 0, asistencia_avisos: 0, asistencia_acciones: 0,
    ...p,
  }
}


describe('período por defecto (P3: arranca el 08/10/2026)', () => {
  it('en octubre 2026 arranca el 08/10, no el 01/10', () => {
    expect(periodoPorDefecto(new Date('2026-10-16T15:00:00Z'))).toEqual({ desde: '2026-10-08', hasta: '2026-10-16' })
  })
  it('en noviembre arranca el 1º del mes', () => {
    expect(periodoPorDefecto(new Date('2026-11-20T15:00:00Z'))).toEqual({ desde: '2026-11-01', hasta: '2026-11-20' })
  })
  it('usa el día argentino: 01/11 02:00 UTC todavía es 31/10', () => {
    expect(periodoPorDefecto(new Date('2026-11-01T02:00:00Z'))).toEqual({ desde: '2026-10-08', hasta: '2026-10-31' })
  })
})

describe('validarRango', () => {
  it('acepta un rango normal', () => expect(validarRango('2026-10-08', '2026-10-16')).toBeNull())
  it('rechaza invertido, vacío y más de 92 días', () => {
    expect(validarRango('2026-10-16', '2026-10-08')).toMatch(/anterior/)
    expect(validarRango('', '2026-10-08')).toMatch(/fechas/)
    expect(validarRango('2026-01-01', '2026-10-08')).toMatch(/92/)
  })
})

describe('tasas y ranking', () => {
  it('atención propia vs equipo (P1: «intervino otro» no resta, pero no es propia)', () => {
    const t = tasas(fila({ rondas_alertas: 10, rondas_intervenidas_propias: 2, rondas_intervenidas_por_otro: 6, rondas_sin_atender: 2 }))
    expect(t).toEqual({ atencionPropia: 20, atencionEquipo: 80, sinAtender: 20 })
  })
  it('sin alertas no hay tasa (null, no 0)', () => {
    expect(tasas(fila({})).atencionPropia).toBeNull()
  })
  it('ordena por atención propia, sin alertas al final, desempata por sin atender', () => {
    const r = ordenarRanking([
      fila({ supervisor: 'Sin alertas' }),
      fila({ supervisor: 'Baja', rondas_alertas: 10, rondas_intervenidas_propias: 1 }),
      fila({ supervisor: 'Alta', rondas_alertas: 10, rondas_intervenidas_propias: 8 }),
      fila({ supervisor: 'Baja2', rondas_alertas: 10, rondas_intervenidas_propias: 1, rondas_sin_atender: 5 }),
    ]).map(f => f.supervisor)
    expect(r).toEqual(['Alta', 'Baja', 'Baja2', 'Sin alertas'])
  })
})

describe('duracionLegible', () => {
  it('formatea minutos, horas y días', () => {
    expect(duracionLegible(null)).toBe('—')
    expect(duracionLegible(45)).toBe('45 min')
    expect(duracionLegible(200)).toBe('3 h 20 min')
    expect(duracionLegible(1153)).toBe('19 h 13 min')
    expect(duracionLegible(3000)).toBe('2 d 2 h')
  })
})

describe('carga: el error de la base se propaga, nunca lista vacía silenciosa', () => {
  it('resumen', async () => {
    const db = { rpc: async () => ({ data: null, error: { message: 'sin permiso para ver la evaluación de supervisores' } }) }
    const r = await cargarEvaluacionSupervisores(db, '2026-10-08', '2026-10-16')
    expect(r.error).toMatch(/sin permiso/)
    expect(r.data).toEqual([])
  })
  it('resumen normaliza numeric que llega como string', async () => {
    const db = { rpc: async () => ({ data: [{ ...fila({}), horas_guardia: '108.0', horas_objetivo_vencidas: '276.2', mediana_min_intervencion: '801' }], error: null }) }
    const r = await cargarEvaluacionSupervisores(db, '2026-10-08', '2026-10-16')
    expect(r.data[0].horas_guardia).toBe(108)
    expect(r.data[0].horas_objetivo_vencidas).toBe(276.2)
    expect(r.data[0].mediana_min_intervencion).toBe(801)
  })
  it('detalle junta los errores de las dos fuentes', async () => {
    const db = { rpc: async (fn: string) => (fn.endsWith('vencimientos') ? { data: null, error: { message: 'timeout' } } : { data: [], error: null }) }
    const r = await cargarDetalleSupervisor(db, 's', '2026-10-08', '2026-10-16')
    expect(r.error).toBe('vencimientos: timeout')
  })
})
