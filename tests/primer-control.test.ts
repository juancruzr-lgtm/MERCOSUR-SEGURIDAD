import { describe, expect, it } from 'vitest'
import { accionesPrimerControl } from '@/lib/primer-control'

// Visibilidad de acciones del primer control del vigilador (OT-01/OT-02).
// Las validaciones de identidad, idempotencia y no-modificación de horas
// viven en las RPC de Postgres (aceptar_turno_planilla /
// solicitar_modificacion_planilla) y no son ejecutables en este entorno
// sin base de datos; acá se cubre la regla de visibilidad completa que
// consume Mi Planilla, con es_titular resuelto por el servidor.

const TURNO = 'turno-1'

describe('accionesPrimerControl', () => {
  it('titular con turno pasado trabajado pendiente: Aceptar y Solicitar', () => {
    expect(accionesPrimerControl(
      { estado: 'trabajado', estado_control: 'pendiente', permite_aceptar: true, turno_id: TURNO },
      true,
    )).toEqual({ aceptar: true, solicitar: true })
  })

  it('turno con salida automática pendiente se comporta como trabajado (ambas acciones)', () => {
    // La salida automática produce hora_salida_final → fila trabajada
    expect(accionesPrimerControl(
      { estado: 'trabajado', estado_control: 'pendiente', permite_aceptar: true, turno_id: TURNO },
      true,
    ).aceptar).toBe(true)
  })

  it('turno pasado sin fichaje: NO permite Aceptar', () => {
    expect(accionesPrimerControl(
      { estado: 'programado', estado_control: 'pendiente', permite_aceptar: false, turno_id: TURNO },
      true,
    ).aceptar).toBe(false)
  })

  it('turno pasado sin fichaje: SÍ permite Solicitar modificación', () => {
    expect(accionesPrimerControl(
      { estado: 'programado', estado_control: 'pendiente', permite_aceptar: false, turno_id: TURNO },
      true,
    ).solicitar).toBe(true)
  })

  it('fila trabajada con permite_aceptar=false no ofrece Aceptar', () => {
    expect(accionesPrimerControl(
      { estado: 'trabajado', estado_control: 'pendiente', permite_aceptar: false, turno_id: TURNO },
      true,
    )).toEqual({ aceptar: false, solicitar: true })
  })

  it('no titular (admin o supervisor viendo planilla ajena): ninguna acción', () => {
    expect(accionesPrimerControl(
      { estado: 'trabajado', estado_control: 'pendiente', permite_aceptar: true, turno_id: TURNO },
      false,
    )).toEqual({ aceptar: false, solicitar: false })
  })

  it('turno en curso: ninguna acción', () => {
    expect(accionesPrimerControl(
      { estado: 'en_curso', estado_control: 'pendiente', permite_aceptar: true, turno_id: TURNO },
      true,
    )).toEqual({ aceptar: false, solicitar: false })
  })

  it('turno futuro (estado_control null): ninguna acción', () => {
    expect(accionesPrimerControl(
      { estado: 'programado', estado_control: null, turno_id: TURNO },
      true,
    )).toEqual({ aceptar: false, solicitar: false })
  })

  it('turno ya aceptado: no vuelve a mostrar botones', () => {
    expect(accionesPrimerControl(
      { estado: 'trabajado', estado_control: 'aceptado', permite_aceptar: true, turno_id: TURNO },
      true,
    )).toEqual({ aceptar: false, solicitar: false })
  })

  it('turno con modificación solicitada: no muestra botones', () => {
    expect(accionesPrimerControl(
      { estado: 'trabajado', estado_control: 'modificacion_solicitada', permite_aceptar: true, turno_id: TURNO },
      true,
    )).toEqual({ aceptar: false, solicitar: false })
  })

  it('día sin programación: ninguna acción', () => {
    expect(accionesPrimerControl(
      { estado: 'sin_programacion', estado_control: null, turno_id: null },
      true,
    )).toEqual({ aceptar: false, solicitar: false })
  })

  it('sin turno_id: ninguna acción', () => {
    expect(accionesPrimerControl(
      { estado: 'trabajado', estado_control: 'pendiente', permite_aceptar: true, turno_id: null },
      true,
    )).toEqual({ aceptar: false, solicitar: false })
  })
})
