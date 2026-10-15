import { describe, expect, it } from 'vitest'
import {
  armarPrompt, controlesPorInstruccion, destinoActivable, instruccionesPendientes, interpretarPropuestas,
  schemaPropuestas, type ContextoIA, type ControlPropuesto,
} from '../lib/protocolo-controles'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const ITEM = '44444444-4444-4444-8444-444444444444'

const ctx: ContextoIA = {
  version_id: 'v', objetivo_id: 'o', objetivo_nombre: 'RANDSTAD', titulo: 'FUNCIONES',
  instrucciones: [
    { id: A, orden: 1, texto: 'FUNCIONES Y PROCEDIMIENTOS', clasificacion: 'informativa', tiene_control: false },
    { id: B, orden: 2, texto: 'Registrar al personal externo en el libro', clasificacion: null, tiene_control: false },
    { id: C, orden: 3, texto: 'Cerrar ventanas al retirarse', clasificacion: 'frecuencia', tiene_control: true },
  ],
  checklist: [{ id: ITEM, texto: 'Libro de novedades al día' }],
  rondas: [{ id: 'r1', nombre: 'Recorrida', descripcion: null, intervalo_minutos: 120, puntos: [{ id: 'p1', nombre: 'Piso 7', descripcion: null }] }],
}

describe('instruccionesPendientes', () => {
  it('saca las validadas como informativas y las que ya tienen control', () => {
    expect(instruccionesPendientes(ctx).map(i => i.id)).toEqual([B])
  })
})

describe('armarPrompt', () => {
  it('incluye las instrucciones pendientes y lo existente con sus identificadores', () => {
    const p = armarPrompt(ctx, instruccionesPendientes(ctx))
    expect(p).toContain(`[${B}] Registrar al personal externo`)
    expect(p).not.toContain(`[${C}]`)
    expect(p).toContain(`[checklist_item ${ITEM}] Libro de novedades al día`)
    expect(p).toContain('[ronda_punto p1] Piso 7')
  })
  it('avisa cuando no hay checklist ni rondas', () => {
    const p = armarPrompt({ ...ctx, checklist: [], rondas: [] }, [])
    expect(p).toContain('no tiene checklist asignado')
    expect(p).toContain('no tiene rondas activas')
  })
})

describe('schemaPropuestas', () => {
  it('admite "ninguno" como destino', () => {
    const s = schemaPropuestas() as any
    expect(s.properties.propuestas.items.properties.destino.enum).toContain('ninguno')
  })
})

describe('interpretarPropuestas', () => {
  it('descarta instrucciones no enviadas y duplicadas', () => {
    const r = interpretarPropuestas({ propuestas: [
      { instruccion_id: B, clasificacion: 'obligacion', destino: 'checklist_supervision', texto_item: 'x' },
      { instruccion_id: B, clasificacion: 'obligacion', destino: 'checklist_supervision', texto_item: 'otra' },
      { instruccion_id: C, clasificacion: 'obligacion', destino: 'checklist_supervision', texto_item: 'y' },
    ] }, [B])
    expect(r).toHaveLength(1)
    expect(r[0].texto_item).toBe('x')
  })

  it('una informativa o destino "ninguno" no trae control', () => {
    const r = interpretarPropuestas({ propuestas: [
      { instruccion_id: A, clasificacion: 'informativa', destino: 'checklist_supervision', texto_item: 'Título' },
      { instruccion_id: B, clasificacion: 'obligacion', destino: 'ninguno', texto_item: 'algo' },
    ] }, [A, B])
    expect(r.map(p => [p.destino, p.texto_item])).toEqual([[null, null], [null, null]])
    expect(r[0].clasificacion).toBe('informativa')
  })

  it('valores fuera de catálogo quedan en null / normal', () => {
    const [p] = interpretarPropuestas({ propuestas: [
      { instruccion_id: B, clasificacion: 'urgente', destino: 'mail', texto_item: 'x', criticidad: 'maxima', foto_obligatoria: 'si' },
    ] }, [B])
    expect(p).toMatchObject({ clasificacion: null, destino: null, texto_item: null, criticidad: 'normal', foto_obligatoria: false })
  })

  it('acota textos y espacios, y sólo acepta referencias existentes con uuid', () => {
    const [p] = interpretarPropuestas({ propuestas: [{
      instruccion_id: B, clasificacion: 'obligacion', destino: 'checklist_supervision',
      texto_item: '  Libro   de\n novedades  ' + 'x'.repeat(600), quien: ' vigilador ',
      existente_tipo: 'checklist_item', existente_id: 'no-es-uuid',
    }] }, [B])
    expect(p.texto_item!.startsWith('Libro de novedades')).toBe(true)
    expect(p.texto_item!.length).toBe(500)
    expect(p.quien).toBe('vigilador')
    expect(p.existente_tipo).toBeNull()
    const [q] = interpretarPropuestas({ propuestas: [{
      instruccion_id: B, clasificacion: 'obligacion', destino: 'checklist_supervision', texto_item: 'x',
      existente_tipo: 'checklist_item', existente_id: ITEM,
    }] }, [B])
    expect(q).toMatchObject({ existente_tipo: 'checklist_item', existente_id: ITEM })
  })

  it('respuesta sin forma esperada → lista vacía', () => {
    expect(interpretarPropuestas(null, [B])).toEqual([])
    expect(interpretarPropuestas({ propuestas: 'x' }, [B])).toEqual([])
  })
})

describe('controlesPorInstruccion y destinoActivable', () => {
  const base = { instruccion_id: B, creado_at: '2026-10-15T10:00:00Z' } as ControlPropuesto
  it('el control en curso va primero, los rechazados después', () => {
    const m = controlesPorInstruccion([
      { ...base, id: '1', estado: 'rechazado', creado_at: '2026-10-15T12:00:00Z' },
      { ...base, id: '2', estado: 'propuesto' },
    ])
    expect(m.get(B)!.map(c => c.id)).toEqual(['2', '1'])
  })
  it('sólo el checklist de supervisión se activa', () => {
    expect(destinoActivable('checklist_supervision')).toBe(true)
    expect(destinoActivable('punto_ronda')).toBe(false)
  })
})
