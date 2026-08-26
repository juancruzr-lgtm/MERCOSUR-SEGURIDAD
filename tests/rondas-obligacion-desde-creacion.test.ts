import { describe, expect, it } from 'vitest'
import { mensajeContextoEliminarRonda } from '@/lib/rondas'
import type { ResultadoEliminarRonda } from '@/lib/rondas'

// Una ronda no puede exigir nada de antes de existir, ni sin puntos, y borrarla
// no puede llevarse por delante la historia de que alguien la recorrió.
//
// La regla de las ventanas vive en SQL —rondas_ventanas_programadas es la
// definición única de la obligación— así que acá se prueba el espejo en
// TypeScript de esa misma regla y lo que la pantalla le dice a la persona.

/**
 * La regla, escrita una vez.
 *
 * Es exactamente la condición que aplica la función: la ventana se emite sólo
 * si empieza en o después de la creación de la ronda, y sólo si la ronda tiene
 * puntos activos.
 */
function ventanaExigible(p: {
  ventanaInicio: string
  rondaCreadaEn: string
  puntosActivos: number
  rondaActiva: boolean
}): boolean {
  if (!p.rondaActiva) return false
  if (p.puntosActivos < 1) return false
  return Date.parse(p.ventanaInicio) >= Date.parse(p.rondaCreadaEn)
}

const CREADA = '2026-08-26T16:32:00-03:00'

describe('nada anterior a la creación de la ronda', () => {
  const base = { rondaCreadaEn: CREADA, puntosActivos: 4, rondaActiva: true }

  it('una ventana de dos días antes NO es exigible', () => {
    // Es el caso real: una ronda creada el 26 a las 16:32 generaba obligaciones
    // del 24. Nadie pudo haberlas cumplido.
    expect(ventanaExigible({ ...base, ventanaInicio: '2026-08-24T08:30:00-03:00' })).toBe(false)
  })

  it('una ventana del mismo día pero anterior a la creación tampoco', () => {
    expect(ventanaExigible({ ...base, ventanaInicio: '2026-08-26T13:00:00-03:00' })).toBe(false)
  })

  it('la ventana que arranca justo en el instante de creación SÍ', () => {
    expect(ventanaExigible({ ...base, ventanaInicio: CREADA })).toBe(true)
  })

  it('y todo lo posterior también', () => {
    expect(ventanaExigible({ ...base, ventanaInicio: '2026-08-26T18:00:00-03:00' })).toBe(true)
    expect(ventanaExigible({ ...base, ventanaInicio: '2026-09-02T08:00:00-03:00' })).toBe(true)
  })

  it('una ronda vieja no cambia en nada', () => {
    // La garantía que importa para el resto del sistema: esto no le quita
    // ninguna obligación a las rondas que ya existían.
    const vieja = { ...base, rondaCreadaEn: '2026-07-01T00:00:00-03:00' }
    expect(ventanaExigible({ ...vieja, ventanaInicio: '2026-08-01T08:00:00-03:00' })).toBe(true)
    expect(ventanaExigible({ ...vieja, ventanaInicio: '2026-08-31T23:00:00-03:00' })).toBe(true)
  })
})

describe('una ronda sin puntos no exige nada', () => {
  it('sin puntos activos no hay ventana, aunque esté activa', () => {
    expect(ventanaExigible({
      ventanaInicio: '2026-08-27T08:00:00-03:00',
      rondaCreadaEn: CREADA, puntosActivos: 0, rondaActiva: true,
    })).toBe(false)
  })

  it('desactivada tampoco, tenga puntos o no', () => {
    expect(ventanaExigible({
      ventanaInicio: '2026-08-27T08:00:00-03:00',
      rondaCreadaEn: CREADA, puntosActivos: 4, rondaActiva: false,
    })).toBe(false)
  })

  it('con un solo punto activo ya alcanza', () => {
    expect(ventanaExigible({
      ventanaInicio: '2026-08-27T08:00:00-03:00',
      rondaCreadaEn: CREADA, puntosActivos: 1, rondaActiva: true,
    })).toBe(true)
  })
})

describe('borrar una ronda no se lleva puesta la historia', () => {
  const r = (o: Partial<ResultadoEliminarRonda>): ResultadoEliminarRonda =>
    ({ contexto: 'ok', ...o }) as ResultadoEliminarRonda

  it('sin ejecuciones se borra y no hay nada que avisar', () => {
    expect(mensajeContextoEliminarRonda(r({
      contexto: 'ok', ronda_nombre: 'Portería', puntos_eliminados: 0, alertas_eliminadas: 28,
    }))).toBeNull()
  })

  it('con ejecuciones NO se borra, y el mensaje dice por qué', () => {
    const m = mensajeContextoEliminarRonda(r({ contexto: 'tiene_historia', ejecuciones: 47, activa: true }))
    expect(m).toContain('47 ejecución(es)')
    expect(m).toContain('no se borra')
    expect(m).toContain('Desactivala')
  })

  it('si ya estaba desactivada no le pide desactivarla de nuevo', () => {
    const m = mensajeContextoEliminarRonda(r({ contexto: 'tiene_historia', ejecuciones: 3, activa: false }))
    expect(m).toContain('Ya está desactivada')
    expect(m).not.toContain('Desactivala')
  })

  it('sin permiso lo dice sin sugerir nada', () => {
    expect(mensajeContextoEliminarRonda(r({ contexto: 'sin_permiso' })))
      .toContain('No tenés permiso')
  })
})

describe('el criterio de saneamiento no nombra a nadie', () => {
  it('es una comparación de fechas, no una lista de casos', () => {
    // Toda alerta cuya ventana empieza antes de que su ronda existiera es
    // inválida. No hay ids, ni objetivos, ni personas en la regla.
    const alertas = [
      { ventanaInicio: '2026-08-24T08:30:00-03:00', rondaCreadaEn: CREADA },
      { ventanaInicio: '2026-08-26T13:00:00-03:00', rondaCreadaEn: CREADA },
      { ventanaInicio: '2026-08-27T08:00:00-03:00', rondaCreadaEn: CREADA },
      { ventanaInicio: '2026-08-10T08:00:00-03:00', rondaCreadaEn: '2026-07-01T00:00:00-03:00' },
    ]
    const invalidas = alertas.filter(a => Date.parse(a.ventanaInicio) < Date.parse(a.rondaCreadaEn))
    expect(invalidas).toHaveLength(2)
    // La de la ronda vieja sobrevive: era exigible de verdad.
    expect(invalidas.some(a => a.rondaCreadaEn.startsWith('2026-07'))).toBe(false)
  })
})
