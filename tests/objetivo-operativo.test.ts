import { describe, expect, it } from 'vitest'
import {
  objetivoEstaOperativo,
  turnoSinCoberturaOperativa,
  turnoSinCoberturaEnObjetivoOperativo,
} from '@/lib/turnos'

// Criterio ÚNICO de objetivo operativo. El espejo SQL es `o.estado = 'activo'`
// en rondas_ventanas_programadas y en asignar_vigilador_turnos. Si cambia acá,
// tiene que cambiar allá.

const turnoSinGuardia = { id: 't1', fecha: '2026-08-12', hora_inicio: '08:00', hora_fin: '16:00', guardia_id: null, estado: 'programado' }
const activo = { estado: 'activo' }
const pausado = { estado: 'inactivo' }

describe('objetivoEstaOperativo', () => {
  it('activo es operativo', () => expect(objetivoEstaOperativo(activo)).toBe(true))
  it('inactivo no lo es', () => expect(objetivoEstaOperativo(pausado)).toBe(false))

  it('sin dato de objetivo se asume operativo: no silenciar alertas por las dudas', () => {
    expect(objetivoEstaOperativo(undefined)).toBe(true)
    expect(objetivoEstaOperativo(null)).toBe(true)
    expect(objetivoEstaOperativo({})).toBe(true)
  })

  it('cualquier estado distinto de activo queda fuera de operacion', () => {
    expect(objetivoEstaOperativo({ estado: 'suspendido' })).toBe(false)
  })
})

describe('turnoSinCoberturaEnObjetivoOperativo', () => {
  it('objetivo activo + turno sin guardia = puesto descubierto', () => {
    expect(turnoSinCoberturaEnObjetivoOperativo(turnoSinGuardia as any, activo)).toBe(true)
  })

  it('objetivo pausado: el turno se conserva pero NO es puesto descubierto', () => {
    expect(turnoSinCoberturaEnObjetivoOperativo(turnoSinGuardia as any, pausado)).toBe(false)
  })

  it('no rompe la regla de estados sin obligacion que ya existia', () => {
    const anulado = { ...turnoSinGuardia, estado: 'anulado' }
    expect(turnoSinCoberturaOperativa(anulado as any)).toBe(false)
    expect(turnoSinCoberturaEnObjetivoOperativo(anulado as any, activo)).toBe(false)
    // Doble motivo para no ser descubierto: sigue sin serlo.
    expect(turnoSinCoberturaEnObjetivoOperativo(anulado as any, pausado)).toBe(false)
  })

  it('turno con guardia nunca es descubierto, este el objetivo como este', () => {
    const conGuardia = { ...turnoSinGuardia, guardia_id: 'g1' }
    expect(turnoSinCoberturaEnObjetivoOperativo(conGuardia as any, activo)).toBe(false)
    expect(turnoSinCoberturaEnObjetivoOperativo(conGuardia as any, pausado)).toBe(false)
  })
})
