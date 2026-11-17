import { describe, expect, it } from 'vitest'
import { coberturaPreventiva, esNocturna, localDe } from '@/lib/tablero-gerencia/supervision-preventiva'

// Período: 7 días, 01/11 00:00 AR → 08/11 00:00 AR (03:00Z)
const DESDE = '2026-11-01T03:00:00.000Z'
const HASTA = '2026-11-08T03:00:00.000Z'
const v = (id: string, obj: string, iso: string, sup = 's1', estado = 'ok') => ({ id, objetivo_id: obj, supervisor_id: sup, estado, created_at: iso })

describe('supervisión preventiva', () => {
  it('hora local y franja nocturna', () => {
    expect(localDe('2026-11-02T02:30:00Z')).toEqual({ hora: 23, diaSemana: 7, fecha: '2026-11-01' })
    expect(esNocturna(23)).toBe(true)
    expect(esNocturna(5)).toBe(true)
    expect(esNocturna(6)).toBe(false)
  })

  it('frecuencia por objetivo: 72 h en 7 días espera 2,3 visitas; 3 visitas repartidas es adecuada', () => {
    const r = coberturaPreventiva({
      desdeIso: DESDE, hastaIso: HASTA,
      objetivos: [{ id: 'o1', nombre: 'A', frecuencia_supervision_horas: 72 }],
      supervisiones: [v('1', 'o1', '2026-11-02T13:00:00Z'), v('2', 'o1', '2026-11-04T18:00:00Z'), v('3', 'o1', '2026-11-06T22:00:00Z')],
    })
    const o = r.objetivos[0]
    expect(o.visitasEsperadas).toBe(2.3)
    expect(o.clase).toBe('adecuada')
    expect(o.brechasExcedidas).toBe(0)
  })

  it('visita sin observaciones no penaliza; incompletas se miden aparte (calidad)', () => {
    const r = coberturaPreventiva({
      desdeIso: DESDE, hastaIso: HASTA,
      objetivos: [{ id: 'o1', nombre: 'A', frecuencia_supervision_horas: 72 }],
      supervisiones: [v('1', 'o1', '2026-11-02T13:00:00Z'), v('2', 'o1', '2026-11-04T18:00:00Z', 's1', 'incompleta'), v('3', 'o1', '2026-11-06T22:00:00Z')],
    })
    expect(r.objetivos[0].clase).toBe('adecuada')
    expect(r.objetivos[0].incompletas).toBe(1)
    expect(r.totales.pctIncompletas).toBe(33.3)
  })

  it('servicio nocturno sin ninguna visita de noche = insuficiente', () => {
    const r = coberturaPreventiva({
      desdeIso: DESDE, hastaIso: HASTA,
      objetivos: [{ id: 'o1', nombre: 'A', frecuencia_supervision_horas: 72 }],
      turnos: [{ objetivo_id: 'o1', fecha: '2026-11-03', hora_inicio: '20:00', hora_fin: '08:00' }],
      supervisiones: [v('1', 'o1', '2026-11-02T13:00:00Z'), v('2', 'o1', '2026-11-04T15:00:00Z'), v('3', 'o1', '2026-11-06T16:00:00Z')],
    })
    expect(r.objetivos[0].servicioNocturno).toBe(true)
    expect(r.objetivos[0].sinCoberturaNocturna).toBe(true)
    expect(r.objetivos[0].clase).toBe('insuficiente')
  })

  it('hueco de presencia mayor al doble de la frecuencia', () => {
    const r = coberturaPreventiva({
      desdeIso: DESDE, hastaIso: HASTA,
      objetivos: [{ id: 'o1', nombre: 'A', frecuencia_supervision_horas: 24 }],
      supervisiones: [v('1', 'o1', '2026-11-01T13:00:00Z'), v('2', 'o1', '2026-11-07T13:00:00Z')],
    })
    expect(r.objetivos[0].brechasExcedidas).toBe(1)
    expect(r.objetivos[0].clase).toBe('insuficiente')
  })

  it('exceso, previsibilidad y visitas agrupadas', () => {
    const vs = Array.from({ length: 8 }, (_, i) => v(String(i), 'o1', `2026-11-0${1 + (i % 7)}T13:${String(10 + i).padStart(2, '0')}:00Z`))
    vs.push(v('x', 'o1', '2026-11-01T13:30:00Z'))
    const r = coberturaPreventiva({
      desdeIso: DESDE, hastaIso: HASTA,
      objetivos: [{ id: 'o1', nombre: 'A', frecuencia_supervision_horas: 72 }],
      supervisiones: vs,
    })
    const o = r.objetivos[0]
    expect(o.clase).toBe('excesiva')
    expect(o.previsible).toBe(true)
    expect(o.agrupadas).toBeGreaterThan(0)
  })

  it('objetivo sin visitas y resumen por supervisor', () => {
    const r = coberturaPreventiva({
      desdeIso: DESDE, hastaIso: HASTA,
      objetivos: [{ id: 'o1', nombre: 'A', frecuencia_supervision_horas: 72 }, { id: 'o2', nombre: 'B', frecuencia_supervision_horas: 72 }],
      supervisiones: [v('1', 'o1', '2026-11-02T02:00:00Z', 's2'), v('2', 'o1', '2026-11-08T05:00:00Z')],
    })
    expect(r.objetivos[1].clase).toBe('sin_visitas')
    expect(r.supervisores).toEqual([expect.objectContaining({ supervisorId: 's2', visitas: 1, nocturnas: 1, finde: 1 })])
    expect(r.totales.sinVisitas).toBe(1)
  })
})
