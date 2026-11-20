import { describe, expect, it } from 'vitest'
import { duracionProgramadaHoras, hayCoberturaPrevia, horasParaCargaManual } from '../lib/carga-manual'

describe('carga manual de asistencia', () => {
  it('turno vacío: no manda horas (la base liquida la duración programada, regla vigente)', () => {
    expect(horasParaCargaManual({ coberturaPrevia: false, entrada: '14:00', salida: '20:00' })).toBeNull()
  })
  it('relevo: manda las horas del tramo, también cruzando medianoche', () => {
    expect(horasParaCargaManual({ coberturaPrevia: true, entrada: '14:00', salida: '20:00' })).toBe(6)
    expect(horasParaCargaManual({ coberturaPrevia: true, entrada: '02:00', salida: '08:00' })).toBe(6)
    expect(horasParaCargaManual({ coberturaPrevia: true, entrada: '22:30', salida: '06:00' })).toBe(7.5)
  })
  it('las ausencias no cuentan como cobertura previa (igual que la base)', () => {
    expect(hayCoberturaPrevia([{ tipo_registro: 'ausencia' }])).toBe(false)
    expect(hayCoberturaPrevia([{ tipo_registro: 'fichaje_gps' }])).toBe(true)
    expect(hayCoberturaPrevia([{ tipo_registro: null }])).toBe(true)
    expect(hayCoberturaPrevia([])).toBe(false)
  })
  it('duración programada', () => {
    expect(duracionProgramadaHoras('08:00:00', '20:00:00')).toBe(12)
    expect(duracionProgramadaHoras('20:00', '08:00')).toBe(12)
  })
})
