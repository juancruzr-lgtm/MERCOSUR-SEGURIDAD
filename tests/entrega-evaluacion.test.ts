import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: () => ({}), from: () => ({}) } }))

import { estadoDeEntrega } from '@/lib/entrega-evaluacion'
import type { FilaPublicada } from '@/lib/mi-desempeno'

const fila = (id: string, estado = 'publicada'): FilaPublicada => ({
  empleado_id: id, periodo: '2026-08',
  cumplimiento_ponderado: 90, indice: 7, nota_final: 7, concepto: 'Bueno',
  datos_insuficientes: false, cobertura: 100, alcance: 'integral',
  estado_desempeno: 'correcto', dimensiones: [], faltas: [], explicacion: null,
  balance: null, contexto: {}, estado,
})

const lectura = (id: string) => ({
  evaluacion_id: 'e-' + id, empleado_id: id, periodo: '2026-08',
  visto_at: '2026-09-02T10:00:00Z',
})

const observacion = (id: string, estado: any = 'abierta') => ({
  id: 'o-' + id, evaluacion_id: 'e-' + id, empleado_id: id, periodo: '2026-08',
  texto: 'No estoy de acuerdo con las rondas', estado,
  respuesta: null, respondido_at: null, creado_at: '2026-09-02T11:00:00Z',
})

describe('solo dos estados: publicado y visto', () => {
  const e = estadoDeEntrega(
    [fila('a'), fila('b'), fila('c')],
    [lectura('a')],
    [],
  )

  it('las publicadas son el universo', () => {
    expect(e.publicadas).toBe(3)
  })

  it('vistas y no vistas suman las publicadas', () => {
    expect(e.vistas).toBe(1)
    expect(e.noVistas).toBe(2)
    expect(e.vistas + e.noVistas).toBe(e.publicadas)
  })

  it('las no vistas salen por diferencia, no por filas ausentes', () => {
    // Sin ninguna lectura, "no vistas" tiene que ser TODAS, no cero.
    const v = estadoDeEntrega([fila('a'), fila('b')], [], [])
    expect(v.noVistas).toBe(2)
    expect(v.vistas).toBe(0)
  })

  it('se puede abrir el listado nominal de cada grupo', () => {
    expect(e.idsVistas).toEqual(['a'])
    expect(e.idsNoVistas).toEqual(['b', 'c'])
  })
})

describe('lo que no esta publicado no cuenta como entregado', () => {
  it('una fila en calculada o revisada queda fuera del universo', () => {
    const e = estadoDeEntrega(
      [fila('a'), fila('b', 'revisada'), fila('c', 'calculada')], [], [],
    )
    expect(e.publicadas).toBe(1)
    expect(e.noVistas).toBe(1)
  })
})

describe('las observaciones se cuentan aparte del visto', () => {
  it('solo las abiertas', () => {
    const e = estadoDeEntrega(
      [fila('a'), fila('b')],
      [lectura('a')],
      [observacion('a'), observacion('b', 'cerrada')],
    )
    expect(e.observacionesAbiertas).toBe(1)
    expect(e.idsConObservacion).toEqual(['a'])
  })

  it('observar no implica haber sido contado como visto ni al reves', () => {
    // Son dos hechos distintos: acceder y objetar.
    const e = estadoDeEntrega([fila('a')], [], [observacion('a')])
    expect(e.vistas).toBe(0)
    expect(e.noVistas).toBe(1)
    expect(e.observacionesAbiertas).toBe(1)
  })

  it('dos observaciones de la misma persona no la cuentan dos veces', () => {
    const e = estadoDeEntrega(
      [fila('a')], [], [observacion('a'), { ...observacion('a'), id: 'o-2' }],
    )
    expect(e.idsConObservacion).toEqual(['a'])
  })
})

describe('sin nadie no rompe', () => {
  it('todo en cero', () => {
    const e = estadoDeEntrega([], [], [])
    expect(e.publicadas).toBe(0)
    expect(e.vistas).toBe(0)
    expect(e.noVistas).toBe(0)
    expect(e.idsNoVistas).toEqual([])
  })
})
