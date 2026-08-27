import { describe, expect, it } from 'vitest'
import {
  ANCLAJES, ESCALAS, indiceDesdePuntaje, notaContinua, notaPorBandas, repartir,
} from '@/lib/escala-escolar'

// SIMULACIÓN. Nada de esto está conectado al puntaje que la app calcula.
//
// Lo que se prueba es que las tres escalas hagan exactamente lo que dicen sus
// tablas —los bordes son lo único que importa en una escala por bandas— y que
// la curva continua pase por los cinco anclajes pedidos.

describe('el índice sale del puntaje sin reinterpretarlo', () => {
  it('es el X/10 por diez', () => {
    expect(indiceDesdePuntaje(9.3)).toBe(93)
    expect(indiceDesdePuntaje(5.56)).toBe(55.6)
    expect(indiceDesdePuntaje(10)).toBe(100)
  })
})

describe('escala A · conservadora', () => {
  const n = (i: number) => notaPorBandas(i, 'A')

  it('los bordes caen del lado declarado', () => {
    expect(n(100)).toBe(10); expect(n(98)).toBe(10); expect(n(97.99)).toBe(9)
    expect(n(94)).toBe(9);   expect(n(93.99)).toBe(8)
    expect(n(88)).toBe(8);   expect(n(87.99)).toBe(7)
    expect(n(80)).toBe(7);   expect(n(79.99)).toBe(6)
    expect(n(70)).toBe(6);   expect(n(69.99)).toBe(5)
    expect(n(60)).toBe(5);   expect(n(50)).toBe(4)
    expect(n(40)).toBe(3);   expect(n(25)).toBe(2)
    expect(n(24.99)).toBe(1); expect(n(0)).toBe(1)
  })
})

describe('escala B · más exigente', () => {
  const n = (i: number) => notaPorBandas(i, 'B')

  it('los bordes caen del lado declarado', () => {
    expect(n(100)).toBe(10); expect(n(99)).toBe(10); expect(n(98.99)).toBe(9)
    expect(n(96)).toBe(9);   expect(n(95.99)).toBe(8)
    expect(n(90)).toBe(8);   expect(n(89.99)).toBe(7)
    expect(n(82)).toBe(7);   expect(n(81.99)).toBe(6)
    expect(n(72)).toBe(6);   expect(n(71.99)).toBe(5)
    expect(n(30)).toBe(2);   expect(n(29.99)).toBe(1)
  })

  it('es más dura que A en todo el rango, nunca más blanda', () => {
    for (let i = 0; i <= 100; i += 0.5) {
      expect(notaPorBandas(i, 'B')).toBeLessThanOrEqual(notaPorBandas(i, 'A'))
    }
  })
})

describe('escala C · más suave', () => {
  const n = (i: number) => notaPorBandas(i, 'C')

  it('los bordes caen del lado declarado', () => {
    expect(n(97)).toBe(10); expect(n(96.99)).toBe(9)
    expect(n(92)).toBe(9);  expect(n(91.99)).toBe(8)
    expect(n(86)).toBe(8);  expect(n(85.99)).toBe(7)
    expect(n(78)).toBe(7);  expect(n(77.99)).toBe(6)
    expect(n(68)).toBe(6);  expect(n(67.99)).toBe(5)
  })

  it('es más blanda que A en todo el rango, nunca más dura', () => {
    for (let i = 0; i <= 100; i += 0.5) {
      expect(notaPorBandas(i, 'C')).toBeGreaterThanOrEqual(notaPorBandas(i, 'A'))
    }
  })
})

describe('nota continua · pasa por los anclajes pedidos', () => {
  it('exactamente por los cinco', () => {
    expect(notaContinua(70)).toBe(6)
    expect(notaContinua(80)).toBe(7)
    expect(notaContinua(90)).toBe(8)
    expect(notaContinua(95)).toBe(9)
    expect(notaContinua(100)).toBe(10)
  })

  it('interpola en línea recta entre anclajes', () => {
    // De 90 a 95 se va del 8 al 9: medio punto cada 2,5 %.
    expect(notaContinua(92.5)).toBe(8.5)
    // De 70 a 80, un punto cada 10 %.
    expect(notaContinua(75)).toBe(6.5)
  })

  it('nunca baja de 1 ni sube de 10', () => {
    expect(notaContinua(0)).toBe(1)
    expect(notaContinua(-50)).toBe(1)
    expect(notaContinua(140)).toBe(10)
  })

  it('es monótona: más índice nunca da menos nota', () => {
    let previa = -Infinity
    for (let i = 0; i <= 100; i += 0.25) {
      const n = notaContinua(i)
      expect(n).toBeGreaterThanOrEqual(previa)
      previa = n
    }
  })

  it('los anclajes son los declarados y están ordenados', () => {
    for (let i = 1; i < ANCLAJES.length; i++) {
      expect(ANCLAJES[i].indice).toBeGreaterThan(ANCLAJES[i - 1].indice)
      expect(ANCLAJES[i].nota).toBeGreaterThan(ANCLAJES[i - 1].nota)
    }
  })
})

describe('ninguna escala fabrica malas notas', () => {
  it('si todos cumplen todo, todos sacan 10 en las cuatro', () => {
    const todosPerfectos = Array.from({ length: 40 }, () => 100)
    for (const e of ['A', 'B', 'C'] as const) {
      const r = repartir(todosPerfectos, i => notaPorBandas(i, e))
      expect(r.porNota[10]).toBe(40)
      expect(r.proporcionDesaprueba).toBe(0)
    }
    expect(repartir(todosPerfectos, notaContinua).porNota[10]).toBe(40)
  })

  it('no hay cupos ni curva: la nota depende sólo del índice de cada uno', () => {
    // El mismo índice da la misma nota, esté rodeado de buenos o de malos.
    const solo = repartir([90], i => notaPorBandas(i, 'A'))
    const acompanado = repartir([90, 100, 100, 30, 30], i => notaPorBandas(i, 'A'))
    expect(solo.porNota[8]).toBe(1)
    expect(acompanado.porNota[8]).toBe(1)
  })
})

describe('el reparto separa a quien no tiene índice', () => {
  it('sin dato no es nota 1', () => {
    const r = repartir([95, null, null, 70], i => notaPorBandas(i, 'A'))
    expect(r.conNota).toBe(2)
    expect(r.sinNota).toBe(2)
    expect(r.porNota[1]).toBe(0)
  })

  it('mide qué proporción cae en 9 o 10, que es lo que decide si esas notas significan algo', () => {
    const r = repartir([100, 99, 95, 80, 70], i => notaPorBandas(i, 'A'))
    // 100 y 99 dan 10; 95 da 9. Tres de cinco.
    expect(r.proporcionTop).toBe(60)
  })
})

describe('las tablas son las que se pidieron', () => {
  it('cada escala tiene diez bandas y termina en 1', () => {
    for (const e of ['A', 'B', 'C'] as const) {
      expect(ESCALAS[e].bandas).toHaveLength(10)
      expect(ESCALAS[e].bandas[9]).toEqual({ desde: 0, nota: 1 })
    }
  })

  it('las bandas están ordenadas de mayor a menor, sin huecos de nota', () => {
    for (const e of ['A', 'B', 'C'] as const) {
      const notas = ESCALAS[e].bandas.map(b => b.nota)
      expect(notas).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1])
      for (let i = 1; i < ESCALAS[e].bandas.length; i++) {
        expect(ESCALAS[e].bandas[i].desde).toBeLessThan(ESCALAS[e].bandas[i - 1].desde)
      }
    }
  })
})
