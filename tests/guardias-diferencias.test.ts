import { describe, expect, it } from 'vitest'
import { diferenciasReglaCalendario, totalDiferencias, type FilaCalendario, type ReglaSemanal } from '@/lib/guardias-supervisor'

const HOY = '2026-10-08'

// Regla tipo "José Luis de día, L-V y Dom" después de la edición de octubre.
const regla: ReglaSemanal = {
  id: 'regla-1', supervisor_id: 'jl', zona_id: 'z1', zona_nombre: 'Rosario',
  dias_semana: [1, 2, 3, 4, 5, 7], hora_inicio: '07:00:00', hora_fin: '19:00:00', activo: true,
}

const fila = (over: Partial<FilaCalendario>): FilaCalendario => ({
  id: over.id ?? Math.random().toString(36).slice(2),
  supervisor_id: 'jl', zona: 'Rosario', fecha: '2026-10-09',
  hora_inicio: '07:00:00', hora_fin: '19:00:00',
  regla_id: 'regla-1', estado: 'activo', tipo_evento: 'normal',
  supervisor_original_id: null, ...over,
})

describe('diferenciasReglaCalendario', () => {
  it('calendario fiel a la regla → sin diferencias', () => {
    const d = diferenciasReglaCalendario(regla, [fila({ fecha: '2026-10-09' })], HOY)
    expect(totalDiferencias(d)).toBe(0)
    expect(d.conflictos).toEqual([])
  })

  it('el caso de octubre: horario viejo (nocturno) → actualizar al de la regla', () => {
    const vieja = fila({ fecha: '2026-10-09', hora_inicio: '19:00:00', hora_fin: '07:00:00' })
    const d = diferenciasReglaCalendario(regla, [vieja], HOY)
    expect(d.actualizar).toHaveLength(1)
    expect(d.actualizar[0]).toMatchObject({ horaInicio: '07:00', horaFin: '19:00' })
  })

  it('día que la regla ya no incluye (sábado) → desactivar', () => {
    const sabado = fila({ fecha: '2026-10-10' }) // sábado, dow 6, fuera de la regla
    const d = diferenciasReglaCalendario(regla, [sabado], HOY)
    expect(d.desactivar).toHaveLength(1)
  })

  it('fecha vigente sin fila, dentro del horizonte generado → crear', () => {
    // Hay fila el lunes 12 (horizonte) pero falta el viernes 09.
    const d = diferenciasReglaCalendario(regla, [fila({ fecha: '2026-10-12' })], HOY)
    expect(d.crear.map(c => c.fecha)).toContain('2026-10-09')
    // y nunca propone más allá del horizonte ya generado
    expect(d.crear.every(c => c.fecha <= '2026-10-12')).toBe(true)
  })

  it('fila inactiva en día vigente → reactivar (no crear duplicada)', () => {
    const inactiva = fila({ fecha: '2026-10-09', estado: 'inactivo' })
    const d = diferenciasReglaCalendario(regla, [inactiva, fila({ fecha: '2026-10-12' })], HOY)
    expect(d.reactivar).toHaveLength(1)
    expect(d.crear.map(c => c.fecha)).not.toContain('2026-10-09')
  })

  it('PROTECCIONES: franco, reasignada a mano e intervenidas van a conflictos y no se tocan', () => {
    const franco = fila({ id: 'f1', fecha: '2026-10-09', tipo_evento: 'franco', hora_inicio: '19:00:00', hora_fin: '07:00:00' })
    const reasignada = fila({ id: 'f2', fecha: '2026-10-12', supervisor_id: 'otro' })
    const intervenida = fila({ id: 'f3', fecha: '2026-10-13', hora_inicio: '19:00:00', hora_fin: '07:00:00' })
    const d = diferenciasReglaCalendario(regla, [franco, reasignada, intervenida], HOY, new Set(['f3']))
    expect(d.conflictos).toHaveLength(3)
    expect(d.actualizar).toEqual([])
    expect(d.desactivar).toEqual([])
  })

  it('el pasado y lo de hoy no entran nunca', () => {
    const ayer = fila({ fecha: '2026-10-07', hora_inicio: '19:00:00', hora_fin: '07:00:00' })
    const hoyMismo = fila({ fecha: '2026-10-08', hora_inicio: '19:00:00', hora_fin: '07:00:00' })
    const d = diferenciasReglaCalendario(regla, [ayer, hoyMismo], HOY)
    expect(totalDiferencias(d)).toBe(0)
  })

  it('regla inactiva → no propone nada', () => {
    const d = diferenciasReglaCalendario({ ...regla, activo: false }, [fila({ hora_inicio: '19:00:00' })], HOY)
    expect(totalDiferencias(d)).toBe(0)
  })
})
