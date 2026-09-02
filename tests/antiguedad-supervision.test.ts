import { describe, it, expect } from 'vitest'
import { antiguedadSupervision, indexarUltimaSupervision } from '@/lib/supervisiones'

const AHORA = new Date('2026-09-02T12:00:00Z').getTime()
const hace = (horas: number) => new Date(AHORA - horas * 3600_000).toISOString()

describe('antigüedad de la última supervisión', () => {
  it('sin fecha devuelve null: "nunca supervisado" lo dice quien llama', () => {
    expect(antiguedadSupervision(null, AHORA)).toBeNull()
    expect(antiguedadSupervision(undefined, AHORA)).toBeNull()
  })

  it('una fecha ilegible no se presenta como antigüedad', () => {
    expect(antiguedadSupervision('ayer a la tarde', AHORA)).toBeNull()
  })

  it('dentro de la hora', () => {
    expect(antiguedadSupervision(hace(0.5), AHORA)).toBe('hace menos de 1 h')
  })

  it('una fecha futura no se anuncia en negativo', () => {
    expect(antiguedadSupervision(hace(-5), AHORA)).toBe('hace menos de 1 h')
  })

  it('horas y días', () => {
    expect(antiguedadSupervision(hace(5), AHORA)).toBe('hace 5 h')
    expect(antiguedadSupervision(hace(23.9), AHORA)).toBe('hace 23 h')
    expect(antiguedadSupervision(hace(25), AHORA)).toBe('hace 1 día')
    expect(antiguedadSupervision(hace(72), AHORA)).toBe('hace 3 días')
  })

  it('el caso que motivó el cambio: supervisado el mes pasado', () => {
    // Laromet rosario 2: última el 30/08 y el panel no mostraba fecha alguna.
    expect(antiguedadSupervision('2026-08-30T08:45:00Z', AHORA)).toBe('hace 3 días')
  })

  it('meses', () => {
    expect(antiguedadSupervision(hace(24 * 45), AHORA)).toBe('hace más de 1 mes')
    expect(antiguedadSupervision(hace(24 * 100), AHORA)).toBe('hace más de 3 meses')
  })
})

describe('lo que la tarjeta de vencidos recibe del índice', () => {
  // El índice devuelve el ISO como TEXTO, no la fila de la supervisión. La
  // tarjeta leía `.created_at` sobre ese texto —undefined— y escribía '—'
  // justamente para los objetivos que SÍ tenían una supervisión previa.
  it('el valor del índice es el ISO, y no tiene created_at', () => {
    const indice = indexarUltimaSupervision([
      { objetivo_id: 'o1', created_at: '2026-08-30T08:45:00Z' },
    ])
    const valor = indice.get('o1')

    expect(typeof valor).toBe('string')
    expect(valor).toBe('2026-08-30T08:45:00Z')
    expect((valor as any).created_at).toBeUndefined()
    expect(antiguedadSupervision(valor, AHORA)).toBe('hace 3 días')
  })

  it('un objetivo nunca supervisado no está en el índice', () => {
    const indice = indexarUltimaSupervision([])
    expect(indice.get('o1')).toBeUndefined()
    expect(antiguedadSupervision(indice.get('o1'), AHORA)).toBeNull()
  })
})
