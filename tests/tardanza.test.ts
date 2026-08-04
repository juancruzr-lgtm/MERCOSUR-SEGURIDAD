import { describe, it, expect } from 'vitest'
import { calcularMinutosTardanza, calcularMinutosTardanzaRegistro } from '@/lib/revision-operativa'

describe('calcularMinutosTardanza', () => {
  it('18:00-07:00, entrada 17:58 → 0 (anticipación nocturna)', () => {
    expect(calcularMinutosTardanza('18:00', '07:00', '17:58')).toBe(0)
  })

  it('17:00-08:00, entrada 16:49 → 0 (anticipación nocturna)', () => {
    expect(calcularMinutosTardanza('17:00', '08:00', '16:49')).toBe(0)
  })

  it('22:00-06:00, entrada 21:49 → 0 (anticipación nocturna)', () => {
    expect(calcularMinutosTardanza('22:00', '06:00', '21:49')).toBe(0)
  })

  it('21:00-07:00, entrada 20:42 → 0 (anticipación nocturna)', () => {
    expect(calcularMinutosTardanza('21:00', '07:00', '20:42')).toBe(0)
  })

  it('17:00-08:00, entrada 16:44 → 0 (anticipación nocturna)', () => {
    expect(calcularMinutosTardanza('17:00', '08:00', '16:44')).toBe(0)
  })

  it('19:00-07:00, entrada 18:43 → 0 (anticipación nocturna)', () => {
    expect(calcularMinutosTardanza('19:00', '07:00', '18:43')).toBe(0)
  })

  it('22:00-06:00, entrada 22:05 → 5 (tardanza real nocturna)', () => {
    expect(calcularMinutosTardanza('22:00', '06:00', '22:05')).toBe(5)
  })

  it('22:00-06:00, entrada 00:15 → 135 (entrada post-medianoche)', () => {
    expect(calcularMinutosTardanza('22:00', '06:00', '00:15')).toBe(135)
  })

  it('08:00-20:00, entrada 08:10 → 10 (tardanza diurna)', () => {
    expect(calcularMinutosTardanza('08:00', '20:00', '08:10')).toBe(10)
  })

  it('08:00-16:00, entrada 07:55 → 0 (anticipación diurna)', () => {
    expect(calcularMinutosTardanza('08:00', '16:00', '07:55')).toBe(0)
  })
})

describe('calcularMinutosTardanzaRegistro', () => {
  it('prioriza hora_entrada_final sobre hora_entrada_real', () => {
    const turno = { hora_inicio: '08:00', hora_fin: '16:00' }
    const registro = { hora_entrada_real: '08:30', hora_entrada_final: '08:05' }
    expect(calcularMinutosTardanzaRegistro(turno, registro)).toBe(5)
  })

  it('usa hora_entrada_real cuando hora_entrada_final es null', () => {
    const turno = { hora_inicio: '08:00', hora_fin: '16:00' }
    const registro = { hora_entrada_real: '08:10', hora_entrada_final: null }
    expect(calcularMinutosTardanzaRegistro(turno, registro)).toBe(10)
  })

  it('devuelve 0 si no hay registro', () => {
    const turno = { hora_inicio: '08:00', hora_fin: '16:00' }
    expect(calcularMinutosTardanzaRegistro(turno, null)).toBe(0)
    expect(calcularMinutosTardanzaRegistro(turno, undefined)).toBe(0)
  })

  it('devuelve 0 si no hay hora de entrada', () => {
    const turno = { hora_inicio: '08:00', hora_fin: '16:00' }
    const registro = { hora_entrada_real: null, hora_entrada_final: null }
    expect(calcularMinutosTardanzaRegistro(turno, registro)).toBe(0)
  })

  it('caso real nocturno: 18:00-07:00 con entrada 17:58 → 0', () => {
    const turno = { hora_inicio: '18:00', hora_fin: '07:00' }
    const registro = { hora_entrada_real: '17:58:25', hora_entrada_final: null }
    expect(calcularMinutosTardanzaRegistro(turno, registro)).toBe(0)
  })

  it('caso real nocturno con final corregido', () => {
    const turno = { hora_inicio: '22:00', hora_fin: '06:00' }
    const registro = { hora_entrada_real: '21:49:16', hora_entrada_final: '22:03' }
    expect(calcularMinutosTardanzaRegistro(turno, registro)).toBe(3)
  })
})
