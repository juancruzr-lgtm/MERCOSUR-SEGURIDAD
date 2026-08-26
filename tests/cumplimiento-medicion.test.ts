import { describe, expect, it } from 'vitest'
import {
  CURVAS, detalleMedicion, faltanteDeMedicion, medir, notaDe,
} from '@/lib/cumplimiento-medicion'

// La unidad de medida de todas las dimensiones: cumplido sobre requerido
// válido. Lo que se prueba acá es que nadie reciba un cero por algo que nunca
// tuvo que hacer, y que una exclusión no desaparezca de la vista.

describe('cumplido sobre requerido válido, no cantidad de errores', () => {
  it('tres incidencias sobre cuatro no es lo mismo que tres sobre cuarenta', () => {
    const poco = medir({ requeridos: 4, cumplidos: 1, minimo: 1 })
    const mucho = medir({ requeridos: 40, cumplidos: 37, minimo: 1 })
    expect(poco.incidencias).toBe(mucho.incidencias)
    expect(poco.nota).toBe(2.5)
    expect(mucho.nota).toBe(9.25)
  })

  it('lo excluido sale del denominador', () => {
    const m = medir({
      requeridos: 30, cumplidos: 18, minimo: 5,
      exclusiones: [{ clave: 'x', etiqueta: 'pausadas', cantidad: 10 }],
    })
    expect(m.validos).toBe(20)
    expect(m.incidencias).toBe(2)
    expect(m.nota).toBe(9)
  })

  it('las exclusiones viajan con su etiqueta y su cantidad', () => {
    const m = medir({
      requeridos: 10, cumplidos: 5, minimo: 1,
      exclusiones: [
        { clave: 'a', etiqueta: 'saneadas', cantidad: 3 },
        { clave: 'b', etiqueta: 'pausadas', cantidad: 0 },
      ],
    })
    // La de cantidad 0 no se muestra: "0 pausadas" es ruido.
    expect(m.exclusiones).toHaveLength(1)
    expect(m.exclusiones[0].etiqueta).toBe('saneadas')
    expect(m.excluidos).toBe(3)
  })
})

describe('no_aplica, datos_insuficientes y cero son tres cosas distintas', () => {
  it('sin requerimientos: no aplica, sin nota', () => {
    const m = medir({ requeridos: 0, cumplidos: 0, minimo: 8 })
    expect(m.estado).toBe('no_aplica')
    expect(m.nota).toBeNull()
  })

  it('todo excluido tampoco es cero', () => {
    const m = medir({
      requeridos: 40, cumplidos: 0, minimo: 8,
      exclusiones: [{ clave: 'p', etiqueta: 'pausadas', cantidad: 40 }],
    })
    expect(m.estado).toBe('no_aplica')
    expect(m.nota).toBeNull()
  })

  it('con muestra chica no se inventa un número', () => {
    const m = medir({ requeridos: 5, cumplidos: 3, minimo: 8 })
    expect(m.estado).toBe('datos_insuficientes')
    expect(m.nota).toBeNull()
    expect(faltanteDeMedicion(m, 'rondas')).toContain('al menos 8')
  })

  it('un cero SÓLO cuando tuvo requerimientos válidos y no cumplió ninguno', () => {
    const m = medir({ requeridos: 10, cumplidos: 0, minimo: 5 })
    expect(m.estado).toBe('medible')
    expect(m.nota).toBe(0)
  })
})

describe('las tres curvas, para poder comparar antes de elegir', () => {
  it('un fallo sobre treinta no destruye el mes', () => {
    expect(notaDe(29, 30, 'proporcional')).toBeGreaterThan(9.5)
    expect(notaDe(29, 30, 'tolerancia_uno')).toBe(10)
    expect(notaDe(29, 30, 'exigente')).toBeGreaterThan(9.4)
  })

  it('diez sobre veinte son evidentes en las tres', () => {
    for (const c of CURVAS) expect(notaDe(10, 20, c)).toBeLessThanOrEqual(5.5)
  })

  it('la exigente castiga más que la proporcional cuando falla mucho', () => {
    expect(notaDe(10, 20, 'exigente')).toBeLessThan(notaDe(10, 20, 'proporcional') as number)
  })

  it('la de tolerancia perdona exactamente un fallo, no dos', () => {
    expect(notaDe(19, 20, 'tolerancia_uno')).toBe(10)
    expect(notaDe(18, 20, 'tolerancia_uno')).toBe(9.5)
  })

  it('sin válidos ninguna curva devuelve número', () => {
    for (const c of CURVAS) expect(notaDe(0, 0, c)).toBeNull()
  })
})

describe('el número nunca va solo', () => {
  it('el detalle dice cuántos de cuántos y qué quedó afuera', () => {
    const m = medir({
      requeridos: 25, cumplidos: 18, minimo: 5,
      exclusiones: [{ clave: 'p', etiqueta: 'pausadas sin causa', cantidad: 3 }],
    })
    const texto = detalleMedicion(m, 'ronda', 'rondas')
    expect(texto).toContain('18 de 22 rondas')
    expect(texto).toContain('4 sin cumplir')
    expect(texto).toContain('3 pausadas sin causa')
  })

  it('sin requerimientos el detalle lo dice, no muestra un cero', () => {
    const m = medir({ requeridos: 0, cumplidos: 0, minimo: 8 })
    expect(detalleMedicion(m, 'ronda', 'rondas')).toBe('Sin rondas en el período')
  })
})

describe('una exclusión que nadie justificó deja la medición en validación', () => {
  it('la marca ambigua se propaga', () => {
    const m = medir({
      requeridos: 20, cumplidos: 15, minimo: 5,
      exclusiones: [{ clave: 'x', etiqueta: 'sin causa', cantidad: 4, ambigua: true }],
    })
    expect(m.ambigua).toBe(true)
    expect(m.nota).not.toBeNull()
  })

  it('sin exclusiones ambiguas la medición no queda en validación', () => {
    const m = medir({
      requeridos: 20, cumplidos: 15, minimo: 5,
      exclusiones: [{ clave: 'x', etiqueta: 'técnicas', cantidad: 4 }],
    })
    expect(m.ambigua).toBe(false)
  })
})
