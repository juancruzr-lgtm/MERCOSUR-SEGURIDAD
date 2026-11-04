import { describe, expect, it } from 'vitest'
import { aprobacionDelMes } from '@/lib/facturacion/revision'

const ap = (contrato_id: string, periodo_desde: string, periodo_hasta_excl: string) => ({ contrato_id, objetivo_id: 'o', periodo_desde, periodo_hasta_excl })

describe('aprobación de horas del mes de facturación', () => {
  const octubre = ap('k', '2026-10-01', '2026-11-01')
  it('la aprobación de octubre corresponde a octubre y NO a noviembre', () => {
    expect(aprobacionDelMes([octubre], { id: 'k', regla_periodo: 'mes_calendario' }, 'o', '2026-10')).toBe(octubre)
    expect(aprobacionDelMes([octubre], { id: 'k', regla_periodo: 'mes_calendario' }, 'o', '2026-11')).toBeNull()
    expect(aprobacionDelMes([octubre], { id: 'k' }, 'o', '2026-09')).toBeNull()
  })
  it('contrato con corte (Hagana, 26 al 25): sólo su período', () => {
    const corte = ap('k', '2026-09-26', '2026-10-26')
    const k = { id: 'k', regla_periodo: 'corte', dia_corte: 26 }
    expect(aprobacionDelMes([corte], k, 'o', '2026-10')).toBe(corte)
    expect(aprobacionDelMes([corte], k, 'o', '2026-09')).toBeNull()
    expect(aprobacionDelMes([corte], k, 'o', '2026-11')).toBeNull()
  })
  it('otro contrato u objetivo no cuenta; corte inválido no rompe', () => {
    expect(aprobacionDelMes([octubre], { id: 'otro' }, 'o', '2026-10')).toBeNull()
    expect(aprobacionDelMes([octubre], { id: 'k' }, 'x', '2026-10')).toBeNull()
    expect(aprobacionDelMes([octubre], { id: 'k', regla_periodo: 'corte', dia_corte: null }, 'o', '2026-10')).toBeNull()
  })
})
