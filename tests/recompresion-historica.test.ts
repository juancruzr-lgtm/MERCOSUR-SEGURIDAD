import { createHash } from 'crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { BUCKET, PARAMETROS, RESPALDO, armarLote, ejecutarLote, motivoParaOmitir, revertirLote } from '@/scripts/recomprimir-historico.mjs'

// Storage y base en memoria: nada toca producción.
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
type Obj = { bytes: Buffer; etag: string }
let storage: Record<string, Record<string, Obj>>
let filas: any[]
let lote: any
let corromperSubida = false
const subidas: string[] = []

function fakeDb() {
  const tabla = (nombre: string) => {
    const filtros: [string, any][] = []
    let pendienteUpdate: any = null
    const q: any = {
      select: () => q, single: async () => ({ data: nombre === 'storage_recompresion_lote' ? lote : null, error: null }),
      eq: (c: string, v: any) => { filtros.push([c, v]); return q },
      update: (v: any) => { pendienteUpdate = v; return q },
      upsert: async (v: any) => {
        const i = filas.findIndex(f => f.lote_id === v.lote_id && f.ruta === v.ruta)
        if (i >= 0) {
          for (const k of ['bytes_antes', 'sha256_antes', 'respaldo_ruta']) if (filas[i][k] !== v[k]) throw new Error('antes inmutable')
          filas[i] = { ...filas[i], ...v }
        } else filas.push({ id: filas.length + 1, ...v })
        return { error: null }
      },
      then: (ok: any) => {
        if (pendienteUpdate) {
          if (nombre === 'storage_recompresion_lote') Object.assign(lote, pendienteUpdate)
          else filas.filter(f => filtros.every(([c, v]) => f[c] === v)).forEach(f => Object.assign(f, pendienteUpdate))
          return Promise.resolve({ error: null }).then(ok)
        }
        return Promise.resolve({ data: filas.filter(f => filtros.every(([c, v]) => f[c] === v)), error: null }).then(ok)
      },
    }
    return q
  }
  const bucket = (b: string) => ({
    download: async (r: string) => storage[b]?.[r] ? { data: new Blob([new Uint8Array(storage[b][r].bytes)]), error: null } : { data: null, error: { message: 'not found' } },
    upload: async (r: string, buf: Buffer, o: { upsert: boolean }) => {
      storage[b] ??= {}
      if (storage[b][r] && !o.upsert) return { error: { message: 'The resource already exists' } }
      subidas.push(`${b}/${r}`)
      const guardado = corromperSubida && b === BUCKET ? Buffer.concat([buf, Buffer.from('x')]) : buf
      storage[b][r] = { bytes: guardado, etag: sha(guardado).slice(0, 8) }
      return { error: null }
    },
    list: async (carpeta: string, o: { search: string }) => ({
      data: Object.entries(storage[b] ?? {}).filter(([k]) => k === (carpeta ? `${carpeta}/${o.search}` : o.search))
        .map(([k, v]) => ({ name: k.slice(k.lastIndexOf('/') + 1), metadata: { eTag: v.etag } })),
    }),
  })
  return { from: tabla, storage: { from: bucket } }
}

const ORIGINAL = Buffer.alloc(2_600_000, 7)
const NUEVA = Buffer.alloc(300_000, 9)
const recomprimirFn = async () => ({ buf: NUEVA, dimsAntes: '4000x3000', dimsDespues: '1600x1200' })

beforeEach(() => {
  storage = { [BUCKET]: { 's1/grande.jpg': { bytes: ORIGINAL, etag: 'a' } } }
  filas = []; subidas.length = 0; corromperSubida = false
  lote = { id: 'L1', estado: 'aprobado', rutas: [{ ruta: 's1/grande.jpg', bytes: ORIGINAL.length, etag: 'a' }] }
})

describe('Recompresión histórica (supervisión)', () => {
  it('perfil operativo de #280 y sólo el bucket de supervisión', () => {
    expect(PARAMETROS).toMatchObject({ ladoMayor: 1600, calidad: 75, ahorroMinimo: 0.4 })
    expect(armarLote([{ name: 'a.jpg', bytes: 1000, etag: 'x' }], { piloto: true })).toMatchObject({ bucket: 'supervision-fotos', es_piloto: true, candidatos: 1 })
  })
  it('motivos para no reemplazar', () => {
    expect(motivoParaOmitir({ etagAprobado: 'a', etagActual: 'b', bytesAntes: 10, bytesNuevos: 1, dimsNuevas: '1x1' })).toMatch(/eTag/)
    expect(motivoParaOmitir({ etagAprobado: 'a', etagActual: 'a', bytesAntes: 10, bytesNuevos: 7, dimsNuevas: '1x1' })).toMatch(/ahorro/)
    expect(motivoParaOmitir({ etagAprobado: 'a', etagActual: 'a', bytesAntes: 10, bytesNuevos: 5, dimsNuevas: '0x0' })).toMatch(/decodifica/)
    expect(motivoParaOmitir({ etagAprobado: 'a', etagActual: 'a', bytesAntes: 10, bytesNuevos: 5, dimsNuevas: '16x12' })).toBeNull()
  })
  it('sin aprobación de Gerencia no hace nada', async () => {
    lote.estado = 'propuesto'
    await expect(ejecutarLote(fakeDb(), 'L1', { recomprimirFn })).rejects.toThrow(/no está aprobado/)
    expect(subidas).toEqual([])
  })
  it('respalda ANTES de reemplazar, verifica, y reemplaza en la misma ruta', async () => {
    const r = await ejecutarLote(fakeDb(), 'L1', { recomprimirFn })
    expect(r).toMatchObject({ reemplazados: 1, omitidos: 0, errores: 0, quedan: 0 })
    expect(subidas).toEqual([`${RESPALDO}/${BUCKET}/s1/grande.jpg`, `${BUCKET}/s1/grande.jpg`])
    expect(sha(storage[RESPALDO][`${BUCKET}/s1/grande.jpg`].bytes)).toBe(sha(ORIGINAL))
    expect(storage[BUCKET]['s1/grande.jpg'].bytes.equals(NUEVA)).toBe(true)
    expect(filas[0]).toMatchObject({ estado: 'reemplazado', sha256_antes: sha(ORIGINAL), sha256_despues: sha(NUEVA), bytes_despues: NUEVA.length })
    expect(lote.estado).toBe('ejecutado')
  })
  it('si el archivo cambió desde la aprobación (eTag), no lo toca', async () => {
    storage[BUCKET]['s1/grande.jpg'].etag = 'otro'
    const r = await ejecutarLote(fakeDb(), 'L1', { recomprimirFn })
    expect(r.omitidos).toBe(1)
    expect(storage[BUCKET]['s1/grande.jpg'].bytes.equals(ORIGINAL)).toBe(true)
  })
  it('si ya había un respaldo DISTINTO, no reemplaza', async () => {
    storage[RESPALDO] = { [`${BUCKET}/s1/grande.jpg`]: { bytes: Buffer.from('otra cosa'), etag: 'z' } }
    const r = await ejecutarLote(fakeDb(), 'L1', { recomprimirFn })
    expect(r.errores).toBe(1)
    expect(storage[BUCKET]['s1/grande.jpg'].bytes.equals(ORIGINAL)).toBe(true)
  })
  it('si lo subido no coincide, restaura el original enseguida', async () => {
    corromperSubida = true
    const r = await ejecutarLote(fakeDb(), 'L1', { recomprimirFn })
    expect(r.errores).toBe(1)
    // En el fake la restauración también sale alterada: el script lo detecta y avisa.
    expect(filas[0].motivo).toMatch(/ATENCIÓN.*el original está en el respaldo/)
    expect(subidas.filter(s => s === `${BUCKET}/s1/grande.jpg`)).toHaveLength(2)
    expect(sha(storage[RESPALDO][`${BUCKET}/s1/grande.jpg`].bytes)).toBe(sha(ORIGINAL))
  })
  it('sin ahorro suficiente, no reemplaza', async () => {
    const r = await ejecutarLote(fakeDb(), 'L1', { recomprimirFn: async () => ({ buf: Buffer.alloc(2_000_000), dimsAntes: '1x1', dimsDespues: '1x1' }) })
    expect(r.omitidos).toBe(1)
    expect(storage[BUCKET]['s1/grande.jpg'].bytes.equals(ORIGINAL)).toBe(true)
  })
  it('reanudable: no repite lo ya reemplazado', async () => {
    await ejecutarLote(fakeDb(), 'L1', { recomprimirFn })
    subidas.length = 0
    lote.estado = 'ejecutando'
    const r = await ejecutarLote(fakeDb(), 'L1', { recomprimirFn })
    expect(r.reemplazados).toBe(0)
    expect(subidas).toEqual([])
  })
  it('revertir vuelve al original verificado (por lote)', async () => {
    await ejecutarLote(fakeDb(), 'L1', { recomprimirFn })
    const r = await revertirLote(fakeDb(), 'L1')
    expect(r).toEqual({ revertidos: 1, errores: 0 })
    expect(storage[BUCKET]['s1/grande.jpg'].bytes.equals(ORIGINAL)).toBe(true)
    expect(filas[0].estado).toBe('revertido')
    expect(lote.estado).toBe('revertido')
  })
  it('no revierte con un respaldo alterado', async () => {
    await ejecutarLote(fakeDb(), 'L1', { recomprimirFn })
    storage[RESPALDO][`${BUCKET}/s1/grande.jpg`].bytes = Buffer.from('alterado')
    const r = await revertirLote(fakeDb(), 'L1', 's1/grande.jpg')
    expect(r).toEqual({ revertidos: 0, errores: 1 })
    expect(storage[BUCKET]['s1/grande.jpg'].bytes.equals(NUEVA)).toBe(true)
  })
})
