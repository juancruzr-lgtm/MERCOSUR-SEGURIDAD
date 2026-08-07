import { describe, expect, it } from 'vitest'
import { accionesCelda, celdaTieneAcciones, turnosEnConflicto } from '@/lib/asignacion-mensual'
import type { TurnoGrilla } from '@/lib/asignacion-mensual'

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

// Un turno anulado ya no obliga a nadie: no puede chocar con su reemplazo.
describe('turnosEnConflicto — los turnos anulados no generan conflicto', () => {
  const base = (over: Partial<TurnoGrilla>): TurnoGrilla => ({
    id: 'x', puesto_id: 'p1', puesto_nombre: 'Principal',
    fecha: '2026-08-10', hora_inicio: '10:00', hora_fin: '18:00',
    guardia_id: 'g1', guardia_nombre: 'Romero', estado: 'programado',
    ...over,
  })

  it('dos turnos vigentes superpuestos: ambos en conflicto', () => {
    const c = turnosEnConflicto([base({ id: 'a' }), base({ id: 'b' })])
    expect(c.has('a')).toBe(true)
    expect(c.has('b')).toBe(true)
  })

  it('el anulado y su reemplazo no chocan', () => {
    const c = turnosEnConflicto([base({ id: 'viejo', estado: 'anulado' }), base({ id: 'nuevo' })])
    expect(c.size).toBe(0)
  })

  it('tampoco cuentan cancelado ni reemplazado', () => {
    expect(turnosEnConflicto([base({ id: 'a', estado: 'cancelado' }), base({ id: 'b' })]).size).toBe(0)
    expect(turnosEnConflicto([base({ id: 'a', estado: 'reemplazado' }), base({ id: 'b' })]).size).toBe(0)
  })

  it('turnos de distinto vigilador no chocan aunque se superpongan', () => {
    expect(turnosEnConflicto([base({ id: 'a' }), base({ id: 'b', guardia_id: 'g2' })]).size).toBe(0)
  })
})

describe('accionesCelda — anular es reversible', () => {
  it('turno anulado futuro: solo se ofrece reactivar', () => {
    const a = accionesCelda(turno({ estado: 'anulado', guardia_id: 'g1' }), HOY, AHORA, true)
    expect(a.reactivar).toBe(true)
    expect(a.anular).toBe(false)
    expect(a.asignar).toBe(false)
    expect(a.cambiarVigilador).toBe(false)
    expect(a.cambiarHorario).toBe(false)
  })

  it('turno cancelado futuro: también se puede reactivar', () => {
    expect(accionesCelda(turno({ estado: 'cancelado' }), HOY, AHORA, true).reactivar).toBe(true)
  })

  it('un turno vigente nunca ofrece reactivar', () => {
    expect(accionesCelda(turno(), HOY, AHORA, true).reactivar).toBe(false)
  })

  it('anulado pero ya pasado: no se reactiva desde la grilla', () => {
    expect(accionesCelda(turno({ estado: 'anulado', fecha: '2026-08-01' }), HOY, AHORA, true).reactivar).toBe(false)
  })

  it('reemplazado no se reactiva: hay otro turno cubriendo', () => {
    expect(accionesCelda(turno({ estado: 'reemplazado' }), HOY, AHORA, true).reactivar).toBe(false)
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

  it('turno reemplazado: ninguna acción (lo sustituye otro turno)', () => {
    expect(celdaTieneAcciones(accionesCelda(turno({ estado: 'reemplazado' }), HOY, AHORA, true))).toBe(false)
  })

  it('sin permiso de escritura: ninguna acción aunque el turno sea futuro', () => {
    expect(celdaTieneAcciones(accionesCelda(turno({ guardia_id: 'g1' }), HOY, AHORA, false))).toBe(false)
  })
})
