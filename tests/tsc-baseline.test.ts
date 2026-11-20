import { describe, expect, it } from 'vitest'
import { comparar, contar, total } from '../scripts/tsc-baseline.mjs'

const salida = [
  'lib/a.ts(1,2): error TS2339: Property x does not exist.',
  'lib/a.ts(3,4): error TS2339: Property y does not exist.',
  'app\\b.tsx(5,6): error TS2802: Type cannot be iterated.',
  'otra línea que no es error',
].join('\n')

describe('tsc-baseline', () => {
  it('cuenta errores por archivo y código, normalizando rutas', () => {
    const { conteo } = contar(salida)
    expect(conteo).toEqual({ 'lib/a.ts': { TS2339: 2 }, 'app/b.tsx': { TS2802: 1 } })
    expect(total(conteo)).toBe(3)
  })
  it('los errores históricos no fallan; los nuevos sí', () => {
    const base = { 'lib/a.ts': { TS2339: 2 }, 'app/b.tsx': { TS2802: 1 } }
    expect(comparar(contar(salida).conteo, base).nuevos).toEqual([])
    const mas = contar(salida + '\nlib/a.ts(9,9): error TS2339: otra.\nlib/c.ts(1,1): error TS2304: nuevo.').conteo
    expect(comparar(mas, base).nuevos).toEqual([
      { archivo: 'lib/a.ts', codigo: 'TS2339', antes: 2, ahora: 3 },
      { archivo: 'lib/c.ts', codigo: 'TS2304', antes: 0, ahora: 1 },
    ])
  })
  it('informa lo resuelto para fijar la mejora', () => {
    const base = { 'lib/a.ts': { TS2339: 2 }, 'app/b.tsx': { TS2802: 1 }, 'lib/viejo.ts': { TS1: 1 } }
    expect(comparar(contar(salida).conteo, base).resueltos).toEqual([{ archivo: 'lib/viejo.ts', codigo: 'TS1', antes: 1, ahora: 0 }])
  })
})
