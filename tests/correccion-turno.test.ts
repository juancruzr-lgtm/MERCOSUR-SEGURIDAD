import { describe, expect, it } from 'vitest'
import { mensajeErrorCorreccion, normalizarEvidencia, opcionesCorreccion, resumenEvidencia } from '@/lib/correccion-turno'
import { decidir } from '@/lib/escalamiento-descubierto'
import { turnoTieneObligacionDeCobertura } from '@/lib/turnos'

// La regla (qué se puede anular según la evidencia) vive en
// corregir_turno_programacion y está probada en tests/sql. Acá: lo que la
// grilla ofrece con cada clase y que un turno anulado no alerte más.

const ev = (over: Record<string, unknown> = {}) => normalizarEvidencia({
  clase: 'iniciado_sin_fichaje', iniciado: true, horario_finalizado: true, puede_anular: true, puede_modificar: true,
  horas: 0, ronda_ejecuciones: 0, evidencias: 0, periodo_liquidacion: null,
  alertas_emitidas: { push: 8, whatsapp: 6 }, ronda_alertas_pendientes: 0, ...over,
})

describe('opcionesCorreccion — según la evidencia, no según "figura iniciado"', () => {
  it('turno futuro: anular y corregir horario', () => {
    expect(opcionesCorreccion(ev({ clase: 'futuro', iniciado: false }))).toMatchObject({ anular: true, cambiarHorario: true, solicitar: false })
  })
  it('iniciado sin fichaje (caso Lotuf 29/10): se puede anular', () => {
    const o = opcionesCorreccion(ev())
    expect(o.anular).toBe(true)
    expect(o.explicacion).toBeNull()
  })
  it('con fichaje: solo solicitud, conserva registros', () => {
    const o = opcionesCorreccion(ev({ clase: 'con_entrada', puede_anular: false, puede_modificar: false }))
    expect(o).toMatchObject({ anular: false, cambiarHorario: false, solicitar: true })
    expect(o.explicacion).toMatch(/se conservan/)
  })
  it('con horas cargadas: solicitud', () => {
    expect(opcionesCorreccion(ev({ clase: 'con_horas', horas: 8, puede_anular: false, puede_modificar: false })).solicitar).toBe(true)
  })
  it('período liquidado: ni anular ni solicitar, rectificación', () => {
    const o = opcionesCorreccion(ev({ clase: 'periodo_cerrado', periodo_liquidacion: 'liquidada', puede_anular: false }))
    expect(o).toMatchObject({ anular: false, cambiarHorario: false, solicitar: false })
    expect(o.explicacion).toMatch(/rectificación/)
  })
  it('informa las alertas ya emitidas (no se deshacen)', () => {
    expect(resumenEvidencia(ev()!).join(' ')).toMatch(/8 push · 6 WhatsApp/)
  })
  it('clase desconocida: no ofrece nada', () => {
    expect(normalizarEvidencia({ clase: 'x' })).toBeNull()
    expect(opcionesCorreccion(null).anular).toBe(false)
  })
  it('traduce los códigos del servidor', () => {
    expect(mensajeErrorCorreccion('CONCURRENCIA: x')).toMatch(/modificado por otra persona/)
    expect(mensajeErrorCorreccion('PERIODO_CERRADO: el mes 10/2026 ya esta liquidada.')).toBe('el mes 10/2026 ya esta liquidada.')
  })
})

describe('después de anular no hay alertas nuevas (prueba 10)', () => {
  const turno = { id: 't', guardia_id: 'edu', objetivo_id: 'o', puesto_id: 'p', fecha: '2026-10-29', hora_inicio: '15:00', hora_fin: '23:00' }
  it('el turno anulado no tiene obligación (push 30/15, sin fichaje, rondas al vigilador)', () => {
    expect(turnoTieneObligacionDeCobertura({ ...turno, estado: 'programado' })).toBe(true)
    expect(turnoTieneObligacionDeCobertura({ ...turno, estado: 'anulado' })).toBe(false)
  })
  it('WhatsApp de puesto descubierto: no escala un turno anulado', () => {
    const ctx = { objetivo: { estado: 'activo' }, tieneEntrada: false, minutosDesdeInicio: 16 }
    expect(decidir({ ...turno, estado: 'programado' }, ctx).escala).toBe(true)
    expect(decidir({ ...turno, estado: 'anulado' }, ctx)).toEqual({ escala: false, motivo: 'turno_anulado' })
  })
  it('anular el turno erróneo no oculta otra obligación válida del mismo puesto', () => {
    const ctx = { objetivo: { estado: 'activo' }, tieneEntrada: false, minutosDesdeInicio: 16 }
    const otroTurnoDelPuesto = { ...turno, id: 't2', guardia_id: 'g2', estado: 'programado' }
    expect(decidir(otroTurnoDelPuesto, ctx).escala).toBe(true)
  })
})
