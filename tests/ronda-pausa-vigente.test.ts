import { describe, expect, it } from 'vitest'
import { estadoTecnicoRonda } from '@/lib/rondas'
import type { RondaProgramada } from '@/lib/rondas'

// Una ronda tiene DOS preguntas distintas sobre pausas y no dan lo mismo:
//
//   pausada       — ¿esta ventana transcurrió bajo una pausa? (historial)
//   pausa_vigente — ¿esa pausa sigue activa ahora?            (operativo)
//
// El estado técnico responde la segunda. Con la primera, una pausa reanudada
// dejaba la tarjeta en "Pausada" para siempre mientras el panel de rondas
// pausadas —que sí mira solo las activas— decía que no había ninguna. Las dos
// pantallas se contradecían sobre los mismos datos.
//
// Caso real del 2026-08-14: ECCO y NACION SANTA FE, pausadas el 01/08 y
// reanudadas el 14/08 a las 14:28, seguían mostrándose pausadas en la ventana
// de las 06:00. CIRSE, reanudada el 03/08, ya no aparecía: el mecanismo se
// corregía solo cuando nacía una ventana posterior a la reanudación.

const AHORA = Date.parse('2026-08-14T18:00:00.000Z')

const ronda = (over: Partial<RondaProgramada> = {}): RondaProgramada => ({
  ronda_base_id: 'rb1',
  ronda_nombre: 'Ronda nocturna',
  puesto_id: 'p1',
  puesto_nombre: 'Principal',
  turno_id: 't1',
  guardia_id: 'g1',
  guardia_nombre: 'ROMERO, FACUNDO',
  ventana_inicio: '2026-08-14T09:00:00.000Z',
  ventana_fin: '2026-08-14T11:00:00.000Z',
  vencimiento_at: '2026-08-14T11:00:00.000Z',
  estado: 'no_iniciada',
  inicio_tardio: false,
  ejecucion_id: null,
  iniciada_at: null,
  finalizada_at: null,
  resultado: null,
  puntos_total: 5,
  puntos_cumplidos: 0,
  puntos_incumplidos: 0,
  puntos_omitidos: 0,
  cerrada_por: null,
  cerrada_at: null,
  cerrada_motivo: null,
  es_cierre_administrativo: false,
  alerta_id: null,
  alerta_tipo: null,
  alerta_estado: null,
  alerta_suspendida: false,
  alerta_motivo_vigilador: null,
  alerta_accion: null,
  alerta_comentario: null,
  alerta_resuelta_por_nombre: null,
  alerta_resuelta_at: null,
  alerta_intervenciones: 0,
  pausada: false,
  pausa_vigente: false,
  pausa_id: null,
  pausa_motivo: null,
  pausa_desde: null,
  pausa_hasta: null,
  pausada_por_nombre: null,
  ...over,
} as RondaProgramada)

describe('estadoTecnicoRonda — pausa vigente vs pausa histórica', () => {
  it('pausa vigente y sin ejecución: pausada', () => {
    const r = ronda({ pausada: true, pausa_vigente: true })
    expect(estadoTecnicoRonda(r, AHORA)).toBe('pausada')
  })

  it('pausa YA REANUDADA: no está pausada, aunque el historial la marque', () => {
    const r = ronda({ pausada: true, pausa_vigente: false })
    expect(estadoTecnicoRonda(r, AHORA)).toBe('no_iniciada')
  })

  it('el historial no se pierde: `pausada` sigue en true para auditar', () => {
    const r = ronda({ pausada: true, pausa_vigente: false, pausa_motivo: 'Obra en el objetivo' })
    expect(estadoTecnicoRonda(r, AHORA)).not.toBe('pausada')
    expect(r.pausada).toBe(true)
    expect(r.pausa_motivo).toBe('Obra en el objetivo')
  })

  it('sin pausa alguna: el estado sale de la programación', () => {
    expect(estadoTecnicoRonda(ronda(), AHORA)).toBe('no_iniciada')
  })
})

describe('estadoTecnicoRonda — la ejecución gana sobre la pausa', () => {
  it('con ejecución en curso, una pausa vigente no la tapa', () => {
    const r = ronda({ pausada: true, pausa_vigente: true, ejecucion_id: 'e1', estado: 'en_curso' })
    expect(estadoTecnicoRonda(r, AHORA)).toBe('en_curso')
  })

  it('con ejecución completada, tampoco', () => {
    const r = ronda({
      pausada: true, pausa_vigente: true,
      ejecucion_id: 'e1', estado: 'completada', puntos_cumplidos: 5,
    })
    expect(estadoTecnicoRonda(r, AHORA)).toBe('cumplida')
  })
})

// Los tres objetivos que motivaron el cambio, con sus datos reales.
describe('estadoTecnicoRonda — los casos de producción del 14/08/2026', () => {
  it('ECCO: pausada 01/08, reanudada 14/08 14:28 → deja de estar pausada', () => {
    const ecco = ronda({
      ronda_nombre: 'ECCO',
      pausada: true,          // la ventana de las 06:00 sí transcurrió bajo la pausa
      pausa_vigente: false,   // pero la pausa se levantó a las 14:28
      pausa_desde: '2026-08-01T12:00:00.000Z',
    })
    expect(estadoTecnicoRonda(ecco, AHORA)).not.toBe('pausada')
  })

  it('NACION SANTA FE: mismo caso, mismo resultado', () => {
    const nacion = ronda({
      ronda_nombre: 'NACION SANTA FE',
      pausada: true,
      pausa_vigente: false,
      pausa_desde: '2026-08-01T12:00:00.000Z',
    })
    expect(estadoTecnicoRonda(nacion, AHORA)).not.toBe('pausada')
  })

  it('CIRSE: reanudada el 03/08, la ventana ni siquiera la alcanza', () => {
    const cirse = ronda({ ronda_nombre: 'CIRSE', pausada: false, pausa_vigente: false })
    expect(estadoTecnicoRonda(cirse, AHORA)).not.toBe('pausada')
  })

  it('una pausa puesta hoy y todavía sin levantar SÍ pausa', () => {
    const nueva = ronda({
      pausada: true,
      pausa_vigente: true,
      pausa_desde: '2026-08-14T10:00:00.000Z',
      pausa_hasta: null,
    })
    expect(estadoTecnicoRonda(nueva, AHORA)).toBe('pausada')
  })
})
