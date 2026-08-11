import { describe, expect, it } from 'vitest'
import {
  estadoPunto, estadoRonda, gpsFueraRadio, leerCoincidencia,
  requiereRevision, resumirRonda, type EntradaPunto,
} from '../lib/ia/rondas'

const base: EntradaPunto = {
  cumplido: true,
  fotoRequerida: true,
  fotoRecibida: true,
  tieneReferencia: true,
  clasificacion: 'SIN_OBSERVACIONES',
  coincide: 'PRESENTE',
  dentroRadio: true,
}
const p = (over: Partial<EntradaPunto> = {}): EntradaPunto => ({ ...base, ...over })

describe('estadoPunto', () => {
  it('cumplido con foto que coincide es OK', () => {
    expect(estadoPunto(p())).toBe('OK')
  })

  it('un punto no registrado manda sobre todo lo demás', () => {
    expect(estadoPunto(p({ cumplido: false, fotoRecibida: false }))).toBe('PUNTO_FALTANTE')
  })

  it('foto exigida y no recibida es foto faltante', () => {
    expect(estadoPunto(p({ fotoRecibida: false }))).toBe('FOTO_FALTANTE')
  })

  it('si el punto no exigía foto y no la mandó, sigue OK', () => {
    expect(estadoPunto(p({ fotoRequerida: false, fotoRecibida: false }))).toBe('OK')
  })

  it('foto no evaluable es insuficiente, no incumplimiento', () => {
    expect(estadoPunto(p({ clasificacion: 'EVIDENCIA_INSUFICIENTE' }))).toBe('FOTO_INSUFICIENTE')
  })

  it('sin referencia cargada NO se afirma que la foto esté mal', () => {
    expect(estadoPunto(p({ tieneReferencia: false }))).toBe('SIN_REFERENCIA')
    expect(estadoPunto(p({ tieneReferencia: false, coincide: 'NO_DETERMINABLE' }))).toBe('SIN_REFERENCIA')
  })

  it('con referencia y comparación negativa, no coincide', () => {
    expect(estadoPunto(p({ coincide: 'AUSENTE' }))).toBe('FOTO_NO_COINCIDE')
  })

  it('la IA no pudo comparar aunque haya referencia: no se afirma nada', () => {
    expect(estadoPunto(p({ coincide: 'NO_DETERMINABLE' }))).toBe('SIN_REFERENCIA')
  })

  it('foto recibida y todavía sin analizar queda pendiente', () => {
    expect(estadoPunto(p({ clasificacion: null }))).toBe('PENDIENTE')
  })

  it('la foto no evaluable pesa más que la falta de referencia', () => {
    expect(estadoPunto(p({ clasificacion: 'EVIDENCIA_INSUFICIENTE', tieneReferencia: false })))
      .toBe('FOTO_INSUFICIENTE')
  })
})

describe('GPS como control independiente', () => {
  it('el GPS fuera de radio no cambia el estado de la foto', () => {
    const punto = p({ dentroRadio: false })
    expect(estadoPunto(punto)).toBe('OK')
    expect(gpsFueraRadio(punto)).toBe(true)
  })

  it('pero sí obliga a revisar', () => {
    expect(requiereRevision(p({ dentroRadio: false }))).toBe(true)
  })

  it('sin dato de GPS no se asume que esté mal', () => {
    expect(gpsFueraRadio(p({ dentroRadio: null }))).toBe(false)
  })
})

describe('estadoRonda', () => {
  it('todo bien es RONDA_OK', () => {
    expect(estadoRonda([p(), p()])).toBe('RONDA_OK')
  })

  it('un punto sin registrar deja la ronda incompleta', () => {
    expect(estadoRonda([p(), p({ cumplido: false, fotoRecibida: false })])).toBe('RONDA_INCOMPLETA')
  })

  it('una foto requerida faltante deja la ronda incompleta', () => {
    expect(estadoRonda([p(), p({ fotoRecibida: false })])).toBe('RONDA_INCOMPLETA')
  })

  it('lo incompleto pesa más que lo dudoso', () => {
    // Un hecho verificable manda sobre un juicio de la IA sin confirmar.
    expect(estadoRonda([p({ coincide: 'AUSENTE' }), p({ cumplido: false, fotoRecibida: false })]))
      .toBe('RONDA_INCOMPLETA')
  })

  it('una foto que no coincide pide revisión', () => {
    expect(estadoRonda([p(), p({ coincide: 'AUSENTE' })])).toBe('REVISAR')
  })

  it('el GPS fuera de radio pide revisión aunque la foto esté perfecta', () => {
    expect(estadoRonda([p(), p({ dentroRadio: false })])).toBe('REVISAR')
  })

  it('sin referencia no ensucia el estado de la ronda', () => {
    expect(estadoRonda([p({ tieneReferencia: false }), p()])).toBe('RONDA_OK')
  })

  it('una ronda sin puntos queda pendiente, no OK', () => {
    expect(estadoRonda([])).toBe('PENDIENTE')
  })
})

describe('resumirRonda', () => {
  it('cuenta cada categoría por separado', () => {
    const r = resumirRonda([
      p(),
      p({ coincide: 'AUSENTE' }),
      p({ clasificacion: 'EVIDENCIA_INSUFICIENTE' }),
      p({ tieneReferencia: false }),
      p({ cumplido: false, fotoRecibida: false }),
      p({ dentroRadio: false }),
    ])
    expect(r.puntosTotales).toBe(6)
    expect(r.cumplidos).toBe(5)
    expect(r.faltantes).toBe(1)
    expect(r.fotosRequeridas).toBe(6)
    expect(r.fotosRecibidas).toBe(5)
    expect(r.fotosNoCoinciden).toBe(1)
    expect(r.fotosInsuficientes).toBe(1)
    expect(r.sinReferencia).toBe(1)
    expect(r.gpsFueraRadio).toBe(1)
    expect(r.estado).toBe('RONDA_INCOMPLETA')
  })
})

describe('leerCoincidencia', () => {
  it('extrae el veredicto del JSON del modelo', () => {
    const json = { elementos: [{ clave: 'coincide_con_referencia', valor: 'AUSENTE' }] }
    expect(leerCoincidencia(json)).toBe('AUSENTE')
  })

  it('devuelve null si no está el elemento', () => {
    expect(leerCoincidencia({ elementos: [{ clave: 'otra_cosa', valor: 'PRESENTE' }] })).toBeNull()
    expect(leerCoincidencia(null)).toBeNull()
    expect(leerCoincidencia({})).toBeNull()
  })

  it('ignora valores fuera del vocabulario', () => {
    expect(leerCoincidencia({ elementos: [{ clave: 'coincide_con_referencia', valor: 'QUIZAS' }] }))
      .toBeNull()
  })
})
