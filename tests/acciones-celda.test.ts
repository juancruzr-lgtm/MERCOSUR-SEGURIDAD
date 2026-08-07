import { describe, expect, it } from 'vitest'
import { accionesCelda, celdaTieneAcciones } from '@/lib/asignacion-mensual'

// Acciones disponibles al hacer clic en una celda de la grilla mensual.
// La ejecución real (cambiar vigilador/horario, anular) vive en
// /api/turnos/editar, que revalida permisos y ventana temporal en servidor.

const HOY = '2026-08-04'
const AHORA = '10:00'

const turno = (over: Partial<{ guardia_id: string | null; estado: string; fecha: string; hora_inicio: string }> = {}) => ({
  guardia_id: null as string | null,
  estado: 'programado',
  fecha: '2026-08-10',
  hora_inicio: '22:00',
  ...over,
})

describe('accionesCelda — turno futuro sin vigilador', () => {
  const a = accionesCelda(turno(), HOY, AHORA, true)

  it('ofrece asignar', () => expect(a.asignar).toBe(true))
  it('no ofrece cambiar ni quitar vigilador', () => {
    expect(a.cambiarVigilador).toBe(false)
    expect(a.quitarVigilador).toBe(false)
  })
  it('permite cambiar horario y anular', () => {
    expect(a.cambiarHorario).toBe(true)
    expect(a.anular).toBe(true)
  })
})

describe('accionesCelda — turno futuro con vigilador', () => {
  const a = accionesCelda(turno({ guardia_id: 'g1' }), HOY, AHORA, true)

  it('no vuelve a ofrecer asignar', () => expect(a.asignar).toBe(false))
  it('ofrece cambiar y quitar vigilador', () => {
    expect(a.cambiarVigilador).toBe(true)
    expect(a.quitarVigilador).toBe(true)
  })
  it('permite cambiar horario y anular', () => {
    expect(a.cambiarHorario).toBe(true)
    expect(a.anular).toBe(true)
  })
})

describe('accionesCelda — publicar no congela el turno', () => {
  it('un turno publicado futuro conserva todas las acciones', () => {
    // publicado no participa de la regla: el turno sigue siendo futuro.
    const a = accionesCelda(turno({ guardia_id: 'g1' }), HOY, AHORA, true)
    expect(a.anular).toBe(true)
    expect(a.cambiarHorario).toBe(true)
    expect(a.cambiarVigilador).toBe(true)
  })
})

describe('accionesCelda — turnos que no se tocan desde la grilla', () => {
  it('turno pasado: ninguna acción', () => {
    expect(celdaTieneAcciones(accionesCelda(turno({ fecha: '2026-08-01' }), HOY, AHORA, true))).toBe(false)
  })

  it('turno de hoy que ya empezó: ninguna acción', () => {
    expect(celdaTieneAcciones(accionesCelda(turno({ fecha: HOY, hora_inicio: '08:00' }), HOY, AHORA, true))).toBe(false)
  })

  it('turno de hoy que todavía no empezó: sí hay acciones', () => {
    expect(celdaTieneAcciones(accionesCelda(turno({ fecha: HOY, hora_inicio: '22:00' }), HOY, AHORA, true))).toBe(true)
  })

  it('turno anulado: ninguna acción', () => {
    expect(celdaTieneAcciones(accionesCelda(turno({ estado: 'anulado' }), HOY, AHORA, true))).toBe(false)
  })

  it('turno cancelado: ninguna acción', () => {
    expect(celdaTieneAcciones(accionesCelda(turno({ estado: 'cancelado' }), HOY, AHORA, true))).toBe(false)
  })

  it('turno reemplazado: ninguna acción', () => {
    expect(celdaTieneAcciones(accionesCelda(turno({ estado: 'reemplazado' }), HOY, AHORA, true))).toBe(false)
  })

  it('sin permiso de escritura: ninguna acción aunque el turno sea futuro', () => {
    expect(celdaTieneAcciones(accionesCelda(turno({ guardia_id: 'g1' }), HOY, AHORA, false))).toBe(false)
  })
})
