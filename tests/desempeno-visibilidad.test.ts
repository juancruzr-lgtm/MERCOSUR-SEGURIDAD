import { describe, expect, it } from 'vitest'
import {
  CLAVE_VISIBLE_VIGILADOR,
  VISIBLE_VIGILADOR_POR_DEFECTO,
  puedeAbrirDesempeno,
  puedeVerDesempeno,
} from '@/lib/desempeno-visibilidad'

// Etapa 1: el vigilador NO tiene acceso. El modelo está en validación y
// mostrarle una evaluación a alguien es difícil de deshacer.

describe('el default es no mostrar', () => {
  it('el flag arranca apagado', () => {
    expect(VISIBLE_VIGILADOR_POR_DEFECTO).toBe(false)
  })

  it('la clave sigue el patrón de app_config', () => {
    expect(CLAVE_VISIBLE_VIGILADOR).toBe('desempeno_visible_vigilador')
  })
})

describe('quién ve el indicador en Etapa 1', () => {
  const flagApagado = { visibleParaVigilador: false }

  it('administración: siempre', () => {
    expect(puedeVerDesempeno({ rol: 'admin', esPropio: false, ...flagApagado })).toBe(true)
    expect(puedeVerDesempeno({ rol: 'ADMIN', esPropio: false, ...flagApagado })).toBe(true)
  })

  it('supervisor: sí — el alcance por zona lo resuelve la carga de filas', () => {
    expect(puedeVerDesempeno({ rol: 'supervisor', esPropio: false, ...flagApagado })).toBe(true)
  })

  it('vigilador: NO, ni siquiera lo suyo', () => {
    expect(puedeVerDesempeno({ rol: 'vigilador', esPropio: true, ...flagApagado })).toBe(false)
    expect(puedeVerDesempeno({ rol: 'guardia', esPropio: true, ...flagApagado })).toBe(false)
  })

  it('vigilador mirando a otro: NO, con el flag prendido o apagado', () => {
    expect(puedeVerDesempeno({ rol: 'vigilador', esPropio: false, visibleParaVigilador: true })).toBe(false)
    expect(puedeVerDesempeno({ rol: 'vigilador', esPropio: false, ...flagApagado })).toBe(false)
  })

  it('un rol desconocido no ve nada', () => {
    expect(puedeVerDesempeno({ rol: 'lo_que_sea', esPropio: true, ...flagApagado })).toBe(false)
    expect(puedeVerDesempeno({ rol: null, esPropio: true, ...flagApagado })).toBe(false)
    expect(puedeVerDesempeno({ rol: undefined, esPropio: true, ...flagApagado })).toBe(false)
  })
})

describe('la puerta futura, cuando se decida abrirla', () => {
  it('con el flag prendido el vigilador ve LO SUYO', () => {
    expect(puedeVerDesempeno({ rol: 'vigilador', esPropio: true, visibleParaVigilador: true })).toBe(true)
  })

  it('pero nunca lo de otro', () => {
    expect(puedeVerDesempeno({ rol: 'vigilador', esPropio: false, visibleParaVigilador: true })).toBe(false)
  })

  it('prender el flag no cambia nada para admin ni supervisor', () => {
    for (const rol of ['admin', 'supervisor']) {
      expect(puedeVerDesempeno({ rol, esPropio: false, visibleParaVigilador: false })).toBe(true)
      expect(puedeVerDesempeno({ rol, esPropio: false, visibleParaVigilador: true })).toBe(true)
    }
  })
})

describe('puedeAbrirDesempeno — si se le ofrece la pantalla', () => {
  it('admin y supervisor sí; vigilador no', () => {
    expect(puedeAbrirDesempeno('admin', false)).toBe(true)
    expect(puedeAbrirDesempeno('supervisor', false)).toBe(true)
    expect(puedeAbrirDesempeno('vigilador', false)).toBe(false)
    expect(puedeAbrirDesempeno('guardia', false)).toBe(false)
  })

  it('Administración no depende del flag: audita con la visibilidad apagada', () => {
    expect(puedeAbrirDesempeno('admin', false)).toBe(true)
  })
})
