import { describe, expect, it } from 'vitest'
import { sugerirVinculacion } from '@/lib/vinculacion-puestos'
import type { PuestoActivo } from '@/lib/puestos'

// Sugerencia de vinculación de servicios legacy con puestos reales
// (Bloque E, commit 2). La vinculación efectiva y su auditoría viven en la
// RPC vincular_servicio_puesto (Postgres) y no son ejecutables acá.

const p = (id: string, nombre: string): PuestoActivo =>
  ({ id, objetivo_id: 'obj-1', nombre, orden: null })

describe('sugerirVinculacion', () => {
  it('servicio ya vinculado: estado vinculado, sin sugerencias', () => {
    expect(sugerirVinculacion({ puesto_id: 'p1', nombre_puesto: 'x' }, [p('p1', 'Principal')]))
      .toEqual({ estado: 'vinculado', puestoSugerido: null, candidatos: [] })
  })

  it('objetivo sin puestos activos', () => {
    expect(sugerirVinculacion({ puesto_id: null, nombre_puesto: 'Portería' }, []).estado)
      .toBe('sin_puestos')
  })

  it('nombre legacy con coincidencia exacta única (normalizada)', () => {
    const r = sugerirVinculacion(
      { puesto_id: null, nombre_puesto: '  portería  PRINCIPAL ' },
      [p('p1', 'Portería Principal'), p('p2', 'Acceso Sur')],
    )
    expect(r.estado).toBe('sugerencia_unica')
    expect(r.puestoSugerido?.id).toBe('p1')
  })

  it('caso NACION SERVICIOS: nombre legacy sin match no sugiere el único puesto', () => {
    // "DIURNO A" contra "Principal": debe quedar pendiente, nunca sugerirse
    // Principal automáticamente ni crearse posiciones. Los candidatos listan
    // las posiciones activas SOLO para que el administrador elija a mano.
    const r = sugerirVinculacion({ puesto_id: null, nombre_puesto: 'DIURNO A' }, [p('p1', 'Principal')])
    expect(r.estado).toBe('sin_coincidencia')
    expect(r.puestoSugerido).toBeNull()
    expect(r.candidatos.map(c => c.id)).toEqual(['p1'])
  })

  it('sin coincidencia con varias posiciones: candidatos para elección manual, sin sugerencia', () => {
    const r = sugerirVinculacion(
      { puesto_id: null, nombre_puesto: 'DIURNO B' },
      [p('p1', 'Principal'), p('p2', 'Vigilador 1'), p('p3', 'Vigilador 2')],
    )
    expect(r.estado).toBe('sin_coincidencia')
    expect(r.puestoSugerido).toBeNull()
    expect(r.candidatos).toHaveLength(3)
  })

  it('sin nombre legacy y un solo puesto activo: sugerencia única (regla única del proyecto)', () => {
    const r = sugerirVinculacion({ puesto_id: null, nombre_puesto: null }, [p('p1', 'Principal')])
    expect(r.estado).toBe('sugerencia_unica')
    expect(r.puestoSugerido?.id).toBe('p1')
  })

  it('sin nombre legacy y varios puestos: el administrador elige', () => {
    const r = sugerirVinculacion({ puesto_id: null, nombre_puesto: '' }, [p('p1', 'A'), p('p2', 'B')])
    expect(r.estado).toBe('ambiguo')
    expect(r.candidatos).toHaveLength(2)
  })

  it('varias coincidencias exactas: ambiguo, todas listadas, nada automático', () => {
    // Homónimos posibles entre puestos (mismo nombre normalizado)
    const r = sugerirVinculacion(
      { puesto_id: null, nombre_puesto: 'garita' },
      [p('p1', 'Garita'), p('p2', 'GARITA '), p('p3', 'Otra')],
    )
    expect(r.estado).toBe('ambiguo')
    expect(r.candidatos.map(c => c.id)).toEqual(['p1', 'p2'])
    expect(r.puestoSugerido).toBeNull()
  })
})
