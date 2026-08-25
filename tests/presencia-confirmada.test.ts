/**
 * Presencia confirmada sin fichaje propio.
 *
 * Caso real (LA CASONA, 25/08/2026): el vigilador no fichó con la app. Un
 * supervisor confirmó la cobertura a las 10:33, lo que dejó el turno en
 * 'cubierto' con 12 horas liquidables guardadas — pero SIN hora de entrada,
 * a propósito: no se inventa un fichaje que no ocurrió.
 *
 * Turnos y el Panel Principal preguntaban "¿hay hora de entrada?" en vez de
 * "¿está confirmada la presencia?", así que mostraban "entrada pendiente" en
 * un turno que la liquidación ya pagaba completo.
 */
import { describe, it, expect } from 'vitest'
import {
  registroTieneEntradaConfirmada,
  esConfirmacionHumana,
  ORIGENES_CONFIRMACION_HUMANA,
} from '../lib/turnos'

describe('presencia confirmada', () => {
  it('el fichaje propio confirma', () => {
    expect(registroTieneEntradaConfirmada({ hora_entrada_real: '07:02:46' })).toBe(true)
  })

  it('la corrección del supervisor confirma', () => {
    expect(registroTieneEntradaConfirmada({ hora_entrada_final: '07:00:00' })).toBe(true)
  })

  it('LA CASONA: la confirmación del supervisor confirma, aunque no haya hora', () => {
    const registro = {
      hora_entrada_real: null,
      hora_entrada_final: null,
      tipo_registro: 'carga_manual',
      origen_cobertura: 'confirmacion_supervisor',
    }
    expect(registroTieneEntradaConfirmada(registro)).toBe(true)
  })

  it('sin fichaje ni confirmación no hay presencia', () => {
    expect(registroTieneEntradaConfirmada({})).toBe(false)
    expect(registroTieneEntradaConfirmada({ hora_entrada_real: null })).toBe(false)
  })

  it('una ausencia nunca confirma, ni con origen de confirmación', () => {
    expect(registroTieneEntradaConfirmada({
      tipo_registro: 'ausencia',
      origen_cobertura: 'confirmacion_supervisor',
    })).toBe(false)
  })

  it('carga_supervisor es carga de datos, no confirmación de presencia', () => {
    expect(esConfirmacionHumana('carga_supervisor')).toBe(false)
    expect(registroTieneEntradaConfirmada({ origen_cobertura: 'carga_supervisor' })).toBe(false)
  })

  it('los tres orígenes de confirmación humana', () => {
    const esperados = [
      'confirmacion_admin',
      'confirmacion_supervisor',
      'confirmacion_supervisor_legacy',
    ]
    expect(ORIGENES_CONFIRMACION_HUMANA.size).toBe(esperados.length)
    esperados.forEach(o => {
      expect(ORIGENES_CONFIRMACION_HUMANA.has(o)).toBe(true)
      expect(esConfirmacionHumana(o)).toBe(true)
    })
  })

  it('el fichaje GPS no es confirmación humana', () => {
    expect(esConfirmacionHumana('fichaje_gps')).toBe(false)
    expect(esConfirmacionHumana(null)).toBe(false)
    expect(esConfirmacionHumana(undefined)).toBe(false)
  })
})
