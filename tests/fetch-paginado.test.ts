import { describe, expect, it } from 'vitest'
import { fetchPaginado, fetchPaginadoResult, FILAS_POR_PAGINA } from '@/lib/fetch-paginado'

// PostgREST corta en 1000 filas sin devolver error: la consulta simplemente
// recibe menos datos y nadie se entera. Un `.limit(5000)` no evita nada, porque
// el tope del servidor manda sobre el del cliente.
//
// Caso medido en producción el 14/08/2026: 1.253 supervisiones. Las tres
// consultas afectadas traían 1.000 y perdían 253 en silencio.

/** Tabla falsa de N filas que respeta `range` como lo hace PostgREST. */
const tablaDe = (filas: number, tope = FILAS_POR_PAGINA) => {
  const datos = Array.from({ length: filas }, (_, i) => ({ id: i + 1 }))
  const llamadas: Array<[number, number]> = []
  const consulta = async (desde: number, hasta: number) => {
    llamadas.push([desde, hasta])
    // El servidor nunca devuelve más de `tope`, aunque le pidan un rango mayor.
    const fin = Math.min(hasta, desde + tope - 1)
    return { data: datos.slice(desde, fin + 1), error: null }
  }
  return { consulta, llamadas }
}

describe('fetchPaginado — el caso real de supervisiones', () => {
  it('con 1.253 filas devuelve las 1.253, no 1.000', async () => {
    const { consulta, llamadas } = tablaDe(1253)
    const todas = await fetchPaginado(consulta)
    expect(todas).toHaveLength(1253)
    expect(llamadas).toEqual([[0, 999], [1000, 1999]])
  })

  it('no repite ni saltea: los ids salen completos y en orden', async () => {
    const { consulta } = tablaDe(1253)
    const todas = await fetchPaginado<{ id: number }>(consulta)
    expect(todas[0].id).toBe(1)
    expect(todas[1252].id).toBe(1253)
    expect(new Set(todas.map(f => f.id)).size).toBe(1253)
  })

  it('el top-500 por orden no cambia al paginar (obs/quality lo usa)', async () => {
    const { consulta } = tablaDe(1253)
    const todas = await fetchPaginado<{ id: number }>(consulta)
    // Mismo slice que hace la ruta: como el orden se respeta, las 500 primeras
    // son las mismas que traía la consulta truncada.
    expect(todas.slice(0, 500).map(f => f.id)).toEqual(
      Array.from({ length: 500 }, (_, i) => i + 1),
    )
  })
})

describe('fetchPaginado — bordes', () => {
  it('tabla vacía: una sola llamada, sin filas', async () => {
    const { consulta, llamadas } = tablaDe(0)
    expect(await fetchPaginado(consulta)).toHaveLength(0)
    expect(llamadas).toHaveLength(1)
  })

  it('menos de una página: no pide una segunda', async () => {
    const { consulta, llamadas } = tablaDe(37)
    expect(await fetchPaginado(consulta)).toHaveLength(37)
    expect(llamadas).toHaveLength(1)
  })

  it('múltiplo exacto: pide una página de más para saber que terminó', async () => {
    const { consulta, llamadas } = tablaDe(2000)
    expect(await fetchPaginado(consulta)).toHaveLength(2000)
    expect(llamadas).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })

  it('varias páginas completas', async () => {
    const { consulta } = tablaDe(4321)
    expect(await fetchPaginado(consulta)).toHaveLength(4321)
  })
})

describe('fetchPaginado vs fetchPaginadoResult — manejo de error', () => {
  const queFalla = async () => ({ data: null, error: new Error('boom') })

  it('fetchPaginado lanza', async () => {
    await expect(fetchPaginado(queFalla)).rejects.toThrow('boom')
  })

  it('fetchPaginadoResult devuelve { data, error } y no lanza', async () => {
    // Es lo que permite usarlo dentro de un Promise.all sin que un fallo deje
    // la pantalla cargando para siempre.
    const r = await fetchPaginadoResult(queFalla)
    expect(r.data).toEqual([])
    expect(r.error).toBeInstanceOf(Error)
  })

  it('fetchPaginadoResult en el camino feliz devuelve todo con error null', async () => {
    const { consulta } = tablaDe(1253)
    const r = await fetchPaginadoResult(consulta)
    expect(r.data).toHaveLength(1253)
    expect(r.error).toBeNull()
  })
})
