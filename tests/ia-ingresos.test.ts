import { describe, expect, it } from 'vitest'
import { estadoIngreso, resumirIngresos, type EstadoFoto, type Ingreso } from '../lib/ia/ingresos'

const ok: EstadoFoto = { recibida: true, clasificacion: 'SIN_OBSERVACIONES', revision: 'PENDIENTE' }
const falta: EstadoFoto = { recibida: false, clasificacion: null, revision: null }
const sinAnalizar: EstadoFoto = { recibida: true, clasificacion: null, revision: 'PENDIENTE' }
const insuf: EstadoFoto = { recibida: true, clasificacion: 'EVIDENCIA_INSUFICIENTE', revision: 'PENDIENTE' }
const revisar: EstadoFoto = { recibida: true, clasificacion: 'REVISAR', revision: 'PENDIENTE' }
const mal: EstadoFoto = { recibida: true, clasificacion: 'REVISAR', revision: 'INCORRECTO' }
const perdonada: EstadoFoto = { recibida: true, clasificacion: 'REVISAR', revision: 'CORRECTO' }

const ing = (uniforme: EstadoFoto, libro: EstadoFoto): Ingreso => ({ uniforme, libro })

describe('estadoIngreso', () => {
  it('las dos fotos limpias dan completo', () => {
    expect(estadoIngreso(ing(ok, ok))).toBe('COMPLETO_SIN_OBSERVACIONES')
  })

  it('una foto faltante da falta de evidencia', () => {
    expect(estadoIngreso(ing(falta, ok))).toBe('FALTA_EVIDENCIA')
    expect(estadoIngreso(ing(ok, falta))).toBe('FALTA_EVIDENCIA')
  })

  it('una foto ilegible no es incumplimiento: es evidencia insuficiente', () => {
    expect(estadoIngreso(ing(insuf, ok))).toBe('EVIDENCIA_INSUFICIENTE')
  })

  it('marcada REVISAR y sin mirar queda pendiente', () => {
    expect(estadoIngreso(ing(revisar, ok))).toBe('PENDIENTE_DE_REVISION')
  })

  it('recibida pero sin analizar todavía también queda pendiente', () => {
    expect(estadoIngreso(ing(sinAnalizar, ok))).toBe('PENDIENTE_DE_REVISION')
  })

  it('si el humano dijo CORRECTO deja de estar pendiente', () => {
    expect(estadoIngreso(ing(perdonada, ok))).toBe('COMPLETO_SIN_OBSERVACIONES')
  })

  it('una decisión humana de INCORRECTO manda sobre todo lo demás', () => {
    expect(estadoIngreso(ing(mal, ok))).toBe('INCORRECTO_CONFIRMADO')
    expect(estadoIngreso(ing(mal, falta))).toBe('INCORRECTO_CONFIRMADO')
    expect(estadoIngreso(ing(mal, insuf))).toBe('INCORRECTO_CONFIRMADO')
  })

  it('falta de evidencia pesa más que evidencia insuficiente', () => {
    // Una foto que no existe es un hecho; una foto ilegible es un límite de la IA.
    expect(estadoIngreso(ing(falta, insuf))).toBe('FALTA_EVIDENCIA')
  })
})

describe('resumirIngresos', () => {
  it('cuenta las categorías básicas', () => {
    const r = resumirIngresos([ing(ok, ok), ing(falta, ok), ing(ok, falta), ing(falta, falta), ing(mal, ok)])
    expect(r.total).toBe(5)
    expect(r.completos).toBe(2)          // (ok,ok) y (mal,ok): las dos fotos llegaron
    expect(r.sinUniforme).toBe(1)
    expect(r.sinLibro).toBe(1)
    expect(r.sinNinguna).toBe(1)
    expect(r.incorrectos).toBe(1)
  })

  it('un ingreso sin ninguna foto no infla los contadores por tipo', () => {
    const r = resumirIngresos([ing(falta, falta)])
    expect(r.sinNinguna).toBe(1)
    expect(r.sinUniforme).toBe(0)
    expect(r.sinLibro).toBe(0)
  })

  it('sin ingresos devuelve todo en cero', () => {
    expect(resumirIngresos([])).toEqual({
      total: 0, completos: 0, sinUniforme: 0, sinLibro: 0,
      sinNinguna: 0, pendientes: 0, incorrectos: 0,
    })
  })
})

describe('objetivo movil: el libro no aplica', () => {
  // Maquinas que se trasladan todos los dias. Sin garita no hay libro, y el
  // vigilador igual sube una foto del puesto en ese campo porque el fichaje se
  // la exige. Antes esa foto se juzgaba con los criterios del libro y cada
  // ingreso terminaba marcado.
  const movil = (over: Partial<EstadoFoto> = {}): Ingreso => ({
    uniforme: { recibida: true, clasificacion: 'SIN_OBSERVACIONES', revision: 'PENDIENTE' },
    libro: { recibida: true, clasificacion: null, revision: null, noAplica: true, ...over },
  })

  it('no queda pendiente esperando un analisis que nunca va a ocurrir', () => {
    expect(estadoIngreso(movil())).toBe('COMPLETO_SIN_OBSERVACIONES')
  })

  it('tampoco cuenta como falta de evidencia si no llego', () => {
    expect(estadoIngreso(movil({ recibida: false }))).toBe('COMPLETO_SIN_OBSERVACIONES')
  })

  it('el uniforme sigue controlandose igual', () => {
    const ing = movil()
    ing.uniforme = { recibida: true, clasificacion: 'REVISAR', revision: 'PENDIENTE' }
    expect(estadoIngreso(ing)).toBe('PENDIENTE_DE_REVISION')
  })

  it('el uniforme faltante sigue siendo falta de evidencia', () => {
    const ing = movil()
    ing.uniforme = { recibida: false, clasificacion: null, revision: null }
    expect(estadoIngreso(ing)).toBe('FALTA_EVIDENCIA')
  })

  it('no infla el contador de "sin libro" del informe diario', () => {
    const r = resumirIngresos([movil({ recibida: false }), movil()])
    expect(r.sinLibro).toBe(0)
    expect(r.completos).toBe(2)
  })

  it('un objetivo fijo sin libro sigue contando como falta', () => {
    const fijo: Ingreso = {
      uniforme: { recibida: true, clasificacion: 'SIN_OBSERVACIONES', revision: 'PENDIENTE' },
      libro: { recibida: false, clasificacion: null, revision: null },
    }
    expect(estadoIngreso(fijo)).toBe('FALTA_EVIDENCIA')
    expect(resumirIngresos([fijo]).sinLibro).toBe(1)
  })
})
