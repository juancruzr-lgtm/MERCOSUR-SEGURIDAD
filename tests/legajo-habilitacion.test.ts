import { describe, expect, it } from 'vitest'
import { controlaHabilitacion } from '@/lib/legajo-habilitacion'

describe('Control de habilitación del Legajo Digital', () => {
  it('sólo Gerencia lo ve (Administración, Supervisión y jefes no)', () => {
    expect(controlaHabilitacion({ puesto_organizacional: 'gerencia' })).toBe(true)
    for (const p of ['administracion', 'supervisor', 'jefe_supervisores', 'direccion_operativa', 'vigilador', null]) {
      expect(controlaHabilitacion({ puesto_organizacional: p })).toBe(false)
    }
    expect(controlaHabilitacion(null)).toBe(false)
  })
})
