import { describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => new Proxy({}, { get: () => () => ({ data: { subscription: { unsubscribe() {} } } }) }),
}))

import { filasHistoricas, INDICADORES, resumenEnPalabras, valor, variacion } from '@/lib/tablero-gerencia/historico'

const t = (id: string, fecha: string, extra = {}) => ({ id, objetivo_id: 'o1', guardia_id: 'e1', fecha, hora_inicio: '08:00', hora_fin: '20:00', estado: 'programado', ...extra })
const r = (turno_id: string, extra = {}) => ({ id: `r${turno_id}`, turno_id, hora_entrada_real: '08:00', hora_salida_real: '20:00', ...extra })

describe('comparación mes a mes', () => {
  const datos = {
    ahoraIso: '2026-11-17T15:00:00Z',
    turnos: [
      t('a1', '2026-09-10'), t('a2', '2026-09-11'),
      t('b1', '2026-10-10'), t('b2', '2026-10-11'), t('b3', '2026-10-12'), t('bx', '2026-10-13', { estado: 'anulado' }),
      t('c1', '2026-11-10'), t('c2', '2026-11-30'), // c2 todavía no ocurrió
      t('p1', '2026-10-10', { objetivo_id: 'prueba' }),
    ],
    registros: [r('a1'), r('a2', { alerta_entrada: 'tarde' }), r('b1'), r('b2', { gps_ingreso_estado: 'fuera_radio' }), r('c1')],
    supervisiones: [{ objetivo_id: 'o1', created_at: '2026-10-05T15:00:00Z' }, { objetivo_id: 'o1', created_at: '2026-10-06T15:00:00Z' }],
    alertasRonda: [{ ventana_inicio: '2026-09-05T15:00:00Z' }],
    facturacion: [{ mes: '2026-10', total: 1000 }],
    objetivoValido: (id: string | null) => id !== 'prueba',
  }
  const filas = filasHistoricas(datos)

  it('un renglón por mes; excluye anulados, prueba y turnos que no terminaron', () => {
    expect(filas.map(f => f.mes)).toEqual(['2026-09', '2026-10', '2026-11'])
    const oct = filas[1]
    expect(oct).toMatchObject({ turnos: 3, conFichaje: 2, sinFichaje: 1, fueraRadio: 1, supervisiones: 2, objetivosSupervisados: 1, facturado: 1000, horas: 24 })
    expect(filas[0]).toMatchObject({ tarde: 1, alertasRonda: 1, horas: 24 })
    expect(filas[2]).toMatchObject({ turnos: 1, parcial: true, hastaDia: 17 })
  })

  it('variación con sentido: menos turnos sin fichaje es mejora', () => {
    const sinFichaje = INDICADORES.find(i => i.clave === 'sinFichaje')!
    expect(variacion(1, 3, sinFichaje)).toMatchObject({ delta: -2, mejora: true })
    const horas = INDICADORES.find(i => i.clave === 'horas')!
    expect(variacion(24, 24, horas)!.mejora).toBeNull()
    expect(valor(filas[1], 'pctFichaje')).toBe(66.7)
  })

  it('resumen en palabras con los dos últimos meses completos', () => {
    const p = resumenEnPalabras(filas, { ...filas[1], mes: '2026-10', horas: 10 })
    expect(p[0]).toMatch(/octubre de 2026 se trabajaron 24 horas, 0 más que en septiembre/)
    expect(p.some(x => /Mes en curso: hasta el día 17 van 12 horas, 2 más/.test(x))).toBe(true)
  })

  it('mes sin fichajes cargados queda avisado', () => {
    const f = filasHistoricas({ ...datos, turnos: [t('z1', '2026-03-10')], registros: [] })
    expect(f[0].avisos[0]).toMatch(/Sin fichajes/)
  })
})
