import { describe, it, expect } from 'vitest'
import { agruparPorBucket, firmarEnLote } from '@/lib/firmas-storage'
import type { ItemFirma, ResultadoFirma } from '@/lib/firmas-storage'

const item = (id: string, bucket: string, path: string): ItemFirma => ({ id, bucket, path })

/** Firmador de mentira: devuelve una URL por path y anota cómo lo llamaron. */
function firmadorFalso(opts: { falla?: string; sinPath?: boolean; rotos?: string[] } = {}) {
  const llamadas: Array<{ bucket: string; paths: string[] }> = []
  const firmar = async (bucket: string, paths: string[]): Promise<ResultadoFirma[]> => {
    llamadas.push({ bucket, paths })
    if (opts.falla === bucket) throw new Error('bucket caído')
    return paths.map(p => opts.rotos?.includes(p)
      ? { path: p, signedUrl: null, error: 'no existe' }
      : { path: opts.sinPath ? null : p, signedUrl: `https://firmado/${bucket}/${p}` })
  }
  return { firmar, llamadas }
}

describe('agrupar por bucket', () => {
  it('junta los paths de cada bucket', () => {
    const g = agruparPorBucket([
      item('a1', 'ronda-evidencias', 'r/1.jpg'),
      item('a2', 'ingreso-evidencias', 'i/1.jpg'),
      item('a3', 'ronda-evidencias', 'r/2.jpg'),
    ])
    expect(g.get('ronda-evidencias')).toEqual(['r/1.jpg', 'r/2.jpg'])
    expect(g.get('ingreso-evidencias')).toEqual(['i/1.jpg'])
  })

  it('no repite un path que aparece dos veces: es un viaje de más por la misma foto', () => {
    const g = agruparPorBucket([
      item('a1', 'ronda-evidencias', 'r/1.jpg'),
      item('a2', 'ronda-evidencias', 'r/1.jpg'),
    ])
    expect(g.get('ronda-evidencias')).toEqual(['r/1.jpg'])
  })

  it('ignora filas sin bucket o sin path', () => {
    const g = agruparPorBucket([
      { id: 'a1', bucket: '', path: 'r/1.jpg' },
      { id: 'a2', bucket: 'ronda-evidencias', path: '' },
    ] as ItemFirma[])
    expect(g.size).toBe(0)
  })
})

describe('firmar en lote', () => {
  it('una sola llamada por bucket, no una por foto', async () => {
    const { firmar, llamadas } = firmadorFalso()
    const items = Array.from({ length: 50 }, (_, i) => item(`a${i}`, 'ronda-evidencias', `r/${i}.jpg`))

    const urls = await firmarEnLote(items, firmar)

    expect(llamadas).toHaveLength(1)
    expect(llamadas[0].paths).toHaveLength(50)
    expect(Object.keys(urls)).toHaveLength(50)
  })

  it('devuelve la url de cada id', async () => {
    const { firmar } = firmadorFalso()
    const urls = await firmarEnLote([
      item('a1', 'ronda-evidencias', 'r/1.jpg'),
      item('a2', 'ingreso-evidencias', 'i/9.jpg'),
    ], firmar)

    expect(urls).toEqual({
      a1: 'https://firmado/ronda-evidencias/r/1.jpg',
      a2: 'https://firmado/ingreso-evidencias/i/9.jpg',
    })
  })

  it('dos análisis de la misma foto reciben los dos su url', async () => {
    const { firmar, llamadas } = firmadorFalso()
    const urls = await firmarEnLote([
      item('a1', 'ronda-evidencias', 'r/1.jpg'),
      item('a2', 'ronda-evidencias', 'r/1.jpg'),
    ], firmar)

    expect(llamadas[0].paths).toEqual(['r/1.jpg'])
    expect(urls.a1).toBe(urls.a2)
    expect(urls.a1).toBeTruthy()
  })

  it('empareja por posición cuando el firmador no devuelve el path', async () => {
    const { firmar } = firmadorFalso({ sinPath: true })
    const urls = await firmarEnLote([
      item('a1', 'b', 'p/1.jpg'),
      item('a2', 'b', 'p/2.jpg'),
    ], firmar)

    expect(urls.a1).toContain('p/1.jpg')
    expect(urls.a2).toContain('p/2.jpg')
  })

  it('una foto que falla no se lleva puestas a las demás', async () => {
    const { firmar } = firmadorFalso({ rotos: ['p/2.jpg'] })
    const urls = await firmarEnLote([
      item('a1', 'b', 'p/1.jpg'),
      item('a2', 'b', 'p/2.jpg'),
      item('a3', 'b', 'p/3.jpg'),
    ], firmar)

    expect(urls.a1).toBeTruthy()
    expect(urls.a2).toBeUndefined()
    expect(urls.a3).toBeTruthy()
  })

  it('un bucket caído no cancela el otro', async () => {
    const { firmar } = firmadorFalso({ falla: 'roto' })
    const urls = await firmarEnLote([
      item('a1', 'roto', 'x/1.jpg'),
      item('a2', 'sano', 'y/1.jpg'),
    ], firmar)

    expect(urls.a1).toBeUndefined()
    expect(urls.a2).toBeTruthy()
  })

  it('sin items no llama a Storage', async () => {
    const { firmar, llamadas } = firmadorFalso()
    expect(await firmarEnLote([], firmar)).toEqual({})
    expect(llamadas).toHaveLength(0)
  })

  it('los buckets se firman en paralelo, no en cadena', async () => {
    // El bug original era la espera encadenada: si los dos buckets se firmaran
    // uno después del otro, esto tardaría 2 × 40 ms en vez de ~40.
    const firmar = async (bucket: string, paths: string[]): Promise<ResultadoFirma[]> => {
      await new Promise(r => setTimeout(r, 40))
      return paths.map(p => ({ path: p, signedUrl: `https://firmado/${bucket}/${p}` }))
    }
    const t0 = Date.now()
    await firmarEnLote([item('a1', 'b1', 'p1'), item('a2', 'b2', 'p2')], firmar)
    expect(Date.now() - t0).toBeLessThan(75)
  })
})
