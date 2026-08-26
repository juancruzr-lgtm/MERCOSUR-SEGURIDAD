import { describe, expect, it } from 'vitest'
import {
  ATRIBUCION, CAUSAS_PAUSA, OPCIONES_CAUSA, atribucionDeCausa, esCausaValida, etiquetaCausa,
} from '@/lib/rondas-causas'

// La causa de pausa decide si las rondas de un período se le cuentan a alguien
// como no realizadas. Es la lista más cara del módulo: una causa mal atribuida
// cambia la categoría de una persona.

describe('sólo una causa acusa al vigilador', () => {
  it('"se podía hacer y no se hacía" es la única atribuible', () => {
    const atribuibles = CAUSAS_PAUSA.filter(c => ATRIBUCION[c] === 'atribuible')
    expect(atribuibles).toEqual(['no_se_realiza'])
  })

  it('lo técnico y lo de configuración no se le cuentan a nadie', () => {
    expect(atribucionDeCausa('tecnica_gps')).toBe('no_atribuible')
    expect(atribucionDeCausa('configuracion')).toBe('no_atribuible')
    expect(atribucionDeCausa('no_aplica')).toBe('no_atribuible')
  })

  it('la falta de capacitación es su propia categoría', () => {
    // Ni incumplimiento del vigilador ni falla del sistema: es algo que hay
    // que enseñar, y por eso genera instrucción sin penalizar.
    expect(atribucionDeCausa('capacitacion')).toBe('capacitacion')
  })

  it('"otra" no se clasifica', () => {
    // Contarla como no atribuible sería una salida gratis; como atribuible,
    // una acusación que nadie hizo.
    expect(atribucionDeCausa('otra')).toBe('sin_clasificar')
  })
})

describe('sin causa no se inventa ninguna', () => {
  it('null es sin clasificar', () => {
    expect(atribucionDeCausa(null)).toBe('sin_clasificar')
    expect(atribucionDeCausa(undefined)).toBe('sin_clasificar')
    expect(atribucionDeCausa('')).toBe('sin_clasificar')
  })

  it('un valor desconocido tampoco se interpreta', () => {
    expect(atribucionDeCausa('lo_que_sea')).toBe('sin_clasificar')
    expect(esCausaValida('lo_que_sea')).toBe(false)
  })

  it('la etiqueta de las históricas dice que son anteriores a la clasificación', () => {
    expect(etiquetaCausa(null)).toContain('anterior a la clasificación')
  })
})

describe('la elección tiene que ser informada', () => {
  it('hay una opción por cada causa, ninguna de más', () => {
    expect(OPCIONES_CAUSA.map(o => o.clave).sort()).toEqual([...CAUSAS_PAUSA].sort())
  })

  it('la única que suma incumplimientos lo dice en su ayuda', () => {
    const o = OPCIONES_CAUSA.find(x => x.clave === 'no_se_realiza')
    expect(o?.ayuda).toContain('ATENCIÓN')
    expect(o?.ayuda).toContain('SÍ se cuentan')
  })

  it('las que no penalizan también lo dicen', () => {
    for (const clave of ['tecnica_gps', 'configuracion', 'no_aplica'] as const) {
      expect(OPCIONES_CAUSA.find(x => x.clave === clave)?.ayuda.toLowerCase())
        .toContain('no se le cuentan al vigilador')
    }
  })

  it('cada opción tiene etiqueta y ayuda: ninguna se elige a ciegas', () => {
    for (const o of OPCIONES_CAUSA) {
      expect(o.etiqueta.length).toBeGreaterThan(3)
      expect(o.ayuda.length).toBeGreaterThan(20)
    }
  })
})
