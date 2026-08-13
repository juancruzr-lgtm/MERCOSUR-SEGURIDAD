import { describe, expect, it } from 'vitest'
import {
  TOPE_LOTE,
  agregarASeleccion,
  alternarSeleccion,
  planificarLoteGrilla,
  resumenOmitidos,
} from '@/lib/seleccion-grilla'

// Selección múltiple en la grilla. Las reglas de qué se puede anular NO viven
// acá: las decide accionesCelda, la misma que habilita el menú de una celda
// suelta. Estos tests verifican que el lote la respete, no que la reemplace.

const HOY = '2026-08-13'
const AHORA = '10:00'

const turno = (over: Partial<{ id: string; fecha: string; hora_inicio: string; estado: string; guardia_id: string | null }> = {}) => ({
  id: 't1', fecha: '2026-08-20', hora_inicio: '08:00', estado: 'programado', guardia_id: 'g1', ...over,
})

const plan = (turnos: any[], ids: string[], over: any = {}) => planificarLoteGrilla({
  turnos, seleccion: new Set(ids), accion: 'anular',
  fechaActual: HOY, horaActual: AHORA, puedeEscribir: true, motivo: 'el cliente cancela', ...over,
})

describe('alternarSeleccion', () => {
  it('marca y desmarca', () => {
    const a = alternarSeleccion(new Set(), 't1')
    expect([...a]).toEqual(['t1'])
    expect([...alternarSeleccion(a, 't1')]).toEqual([])
  })

  it('no muta el set original', () => {
    const original = new Set(['t1'])
    alternarSeleccion(original, 't2')
    expect([...original]).toEqual(['t1'])
  })
})

describe('agregarASeleccion — el arrastre suma, nunca quita', () => {
  it('agrega varios de una', () => {
    expect([...agregarASeleccion(new Set(['a']), ['b', 'c'])].sort()).toEqual(['a', 'b', 'c'])
  })

  it('volver sobre lo ya pintado no lo borra', () => {
    expect([...agregarASeleccion(new Set(['a']), ['a'])]).toEqual(['a'])
  })
})

describe('planificarLoteGrilla', () => {
  it('un turno futuro programado se puede anular', () => {
    const p = plan([turno()], ['t1'])
    expect(p.aplicables).toEqual(['t1'])
    expect(p.omitidos).toHaveLength(0)
    expect(p.bloqueo).toBeNull()
    expect(p.resumen).toBe('Anular 1 turno')
  })

  it('un turno ya iniciado queda afuera, no rompe el lote', () => {
    const p = plan([turno({ id: 't1' }), turno({ id: 't2', fecha: '2026-08-01' })], ['t1', 't2'])
    expect(p.aplicables).toEqual(['t1'])
    expect(p.omitidos.map(o => o.motivo)).toEqual(['ya_iniciado'])
  })

  it('un turno ya anulado no se vuelve a anular', () => {
    const p = plan([turno({ estado: 'anulado' })], ['t1'])
    expect(p.aplicables).toHaveLength(0)
    expect(p.omitidos[0].motivo).toBe('ya_anulado')
    expect(p.bloqueo).toBe('Ninguno de los turnos marcados se puede procesar.')
  })

  it('reemplazado se distingue de ya iniciado', () => {
    const p = plan([turno({ estado: 'reemplazado' })], ['t1'])
    expect(p.omitidos[0].motivo).toBe('reemplazado')
  })

  it('sin permiso de escritura no se aplica nada', () => {
    const p = plan([turno()], ['t1'], { puedeEscribir: false })
    expect(p.aplicables).toHaveLength(0)
    expect(p.omitidos[0].motivo).toBe('sin_permiso')
  })

  it('anular exige motivo, igual que en una celda suelta', () => {
    expect(plan([turno()], ['t1'], { motivo: '' }).bloqueo).toBe('Escribí el motivo de la anulación.')
    expect(plan([turno()], ['t1'], { motivo: 'ab' }).bloqueo).toBeTruthy()
  })

  it('reactivar NO exige motivo: deshacer no destruye nada', () => {
    const p = plan([turno({ estado: 'anulado' })], ['t1'], { accion: 'reactivar', motivo: '' })
    expect(p.aplicables).toEqual(['t1'])
    expect(p.bloqueo).toBeNull()
    expect(p.resumen).toBe('Reactivar 1 turno')
  })

  it('un turno vigente no se puede reactivar', () => {
    const p = plan([turno()], ['t1'], { accion: 'reactivar', motivo: '' })
    expect(p.omitidos[0].motivo).toBe('vigente')
  })

  it('respeta el tope de la operacion', () => {
    const muchos = Array.from({ length: TOPE_LOTE + 1 }, (_, i) => turno({ id: `t${i}` }))
    const p = plan(muchos, muchos.map(t => t.id))
    expect(p.bloqueo).toContain(String(TOPE_LOTE))
  })

  it('un id marcado que ya no esta en la grilla se ignora en silencio', () => {
    const p = plan([turno()], ['t1', 'fantasma'])
    expect(p.aplicables).toEqual(['t1'])
    expect(p.omitidos).toHaveLength(0)
  })

  it('los omitidos salen ordenados por fecha', () => {
    const p = plan([
      turno({ id: 'b', fecha: '2026-08-05', estado: 'anulado' }),
      turno({ id: 'a', fecha: '2026-08-02', estado: 'anulado' }),
    ], ['b', 'a'])
    expect(p.omitidos.map(o => o.fecha)).toEqual(['2026-08-02', '2026-08-05'])
  })
})

describe('resumenOmitidos', () => {
  it('sin omitidos no dice nada', () => expect(resumenOmitidos([])).toBeNull())

  it('agrupa por motivo', () => {
    const texto = resumenOmitidos([
      { id: 'a', fecha: '2026-08-01', motivo: 'ya_iniciado' },
      { id: 'b', fecha: '2026-08-02', motivo: 'ya_iniciado' },
      { id: 'c', fecha: '2026-08-03', motivo: 'ya_anulado' },
    ])
    expect(texto).toContain('3 turnos')
    expect(texto).toContain('2 ya empezó o es pasado')
    expect(texto).toContain('1 ya estaba anulado')
  })
})
