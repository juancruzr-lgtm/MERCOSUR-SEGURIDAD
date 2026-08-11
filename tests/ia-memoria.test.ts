import { describe, expect, it } from 'vitest'
import {
  LIMITES_MEMORIA_DEFECTO,
  hayBaseDeComparacion,
  seleccionarEjemplos,
  type CandidatoEjemplo,
} from '../lib/ia/memoria'

const cand = (over: Partial<CandidatoEjemplo> = {}): CandidatoEjemplo => ({
  analisis_id: 'a1',
  clase: 'positivo',
  bucket: 'evidencias',
  storage_path: 'p/1.jpg',
  content_type: 'image/jpeg',
  contenido_sha256: 'sha1',
  revisado_at: '2026-08-10T10:00:00Z',
  ...over,
})

describe('seleccionarEjemplos', () => {
  it('respeta los topes de positivos y negativos por separado', () => {
    const candidatos = [
      ...Array.from({ length: 8 }, (_, i) =>
        cand({ analisis_id: `p${i}`, contenido_sha256: `shap${i}`, storage_path: `p/${i}.jpg` })),
      ...Array.from({ length: 5 }, (_, i) =>
        cand({ analisis_id: `n${i}`, clase: 'negativo', contenido_sha256: `shan${i}`, storage_path: `n/${i}.jpg` })),
    ]
    const r = seleccionarEjemplos(candidatos, { maxPositivos: 3, maxNegativos: 1, minimoParaHistorial: 1 })
    expect(r.positivos).toHaveLength(3)
    expect(r.negativos).toHaveLength(1)
  })

  it('informa cuántos había disponibles, no sólo cuántos se envían', () => {
    const candidatos = Array.from({ length: 6 }, (_, i) =>
      cand({ analisis_id: `p${i}`, contenido_sha256: `sha${i}`, storage_path: `p/${i}.jpg` }))
    const r = seleccionarEjemplos(candidatos, { maxPositivos: 2, maxNegativos: 0, minimoParaHistorial: 1 })
    expect(r.positivos).toHaveLength(2)
    expect(r.positivosDisponibles).toBe(6)
  })

  it('prefiere los más recientes: un punto cambia con el tiempo', () => {
    const candidatos = [
      cand({ analisis_id: 'viejo', contenido_sha256: 'v', revisado_at: '2026-01-01T00:00:00Z' }),
      cand({ analisis_id: 'nuevo', contenido_sha256: 'n', revisado_at: '2026-08-01T00:00:00Z' }),
    ]
    const r = seleccionarEjemplos(candidatos, { maxPositivos: 1, maxNegativos: 0, minimoParaHistorial: 1 })
    expect(r.positivos[0].analisis_id).toBe('nuevo')
  })

  it('es determinista ante empate de fecha: mismo input, misma selección', () => {
    const mismaFecha = '2026-08-10T10:00:00Z'
    const candidatos = [
      cand({ analisis_id: 'zzz', contenido_sha256: 'z', revisado_at: mismaFecha }),
      cand({ analisis_id: 'aaa', contenido_sha256: 'a', revisado_at: mismaFecha }),
    ]
    const limites = { maxPositivos: 1, maxNegativos: 0, minimoParaHistorial: 1 }
    const uno = seleccionarEjemplos(candidatos, limites)
    const dos = seleccionarEjemplos([...candidatos].reverse(), limites)
    expect(uno.positivos[0].analisis_id).toBe('aaa')
    expect(dos.positivos[0].analisis_id).toBe('aaa')
  })

  it('no manda dos veces la misma imagen aunque tenga dos análisis', () => {
    // Un reintento o una versión nueva de configuración genera otra fila de
    // análisis sobre el MISMO archivo. Pagar dos veces por la misma foto en el
    // mismo pedido es puro desperdicio de cuota.
    const candidatos = [
      cand({ analisis_id: 'a1', contenido_sha256: 'igual' }),
      cand({ analisis_id: 'a2', contenido_sha256: 'igual' }),
    ]
    const r = seleccionarEjemplos(candidatos, LIMITES_MEMORIA_DEFECTO)
    expect(r.positivos).toHaveLength(1)
  })

  it('excluye una foto ya promovida a referencia formal', () => {
    const candidatos = [
      cand({ analisis_id: 'promovida', contenido_sha256: 'ref' }),
      cand({ analisis_id: 'otra', contenido_sha256: 'distinta', storage_path: 'p/2.jpg' }),
    ]
    const r = seleccionarEjemplos(candidatos, LIMITES_MEMORIA_DEFECTO, { sha256: ['ref'] })
    expect(r.positivos.map(p => p.analisis_id)).toEqual(['otra'])
  })

  it('nunca usa la foto que se está analizando como su propio ejemplo', () => {
    const candidatos = [cand({ analisis_id: 'la-misma', contenido_sha256: 'yo' })]
    const r = seleccionarEjemplos(candidatos, LIMITES_MEMORIA_DEFECTO, { analisisId: 'la-misma' })
    expect(r.positivos).toHaveLength(0)
  })

  it('descarta candidatos sin archivo en vez de romper el pedido', () => {
    const candidatos = [
      cand({ analisis_id: 'roto', bucket: '', storage_path: '' }),
      cand({ analisis_id: 'sano', contenido_sha256: 'ok', storage_path: 'p/9.jpg' }),
    ]
    const r = seleccionarEjemplos(candidatos, LIMITES_MEMORIA_DEFECTO)
    expect(r.positivos.map(p => p.analisis_id)).toEqual(['sano'])
  })

  it('con tope en cero no envía nada de esa clase', () => {
    const candidatos = [cand({ clase: 'negativo', contenido_sha256: 'n1' })]
    const r = seleccionarEjemplos(candidatos, { maxPositivos: 3, maxNegativos: 0, minimoParaHistorial: 1 })
    expect(r.negativos).toHaveLength(0)
    expect(r.negativosDisponibles).toBe(1)
  })

  it('separa positivos de negativos: un rechazado nunca entra como aceptado', () => {
    const candidatos = [
      cand({ analisis_id: 'bueno', contenido_sha256: 'b' }),
      cand({ analisis_id: 'malo', clase: 'negativo', contenido_sha256: 'm' }),
    ]
    const r = seleccionarEjemplos(candidatos, LIMITES_MEMORIA_DEFECTO)
    expect(r.positivos.map(p => p.analisis_id)).toEqual(['bueno'])
    expect(r.negativos.map(p => p.analisis_id)).toEqual(['malo'])
  })
})

describe('hayBaseDeComparacion', () => {
  it('alcanza con la referencia formal', () => {
    expect(hayBaseDeComparacion(1, 0)).toBe(true)
  })

  it('alcanza con el historial humano aunque no haya referencia cargada', () => {
    expect(hayBaseDeComparacion(0, 2)).toBe(true)
  })

  it('sin referencia ni historial no hay con qué comparar', () => {
    expect(hayBaseDeComparacion(0, 0)).toBe(false)
  })

  it('respeta el mínimo configurado', () => {
    const limites = { maxPositivos: 3, maxNegativos: 1, minimoParaHistorial: 3 }
    expect(hayBaseDeComparacion(0, 2, limites)).toBe(false)
    expect(hayBaseDeComparacion(0, 3, limites)).toBe(true)
  })
})
