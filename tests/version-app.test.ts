// Control de versión al arrancar: una copia vieja se recarga ANTES de consultar la base.
import { describe, it, expect } from 'vitest'
import { recargarSiHayVersionNueva, versionDesactualizada, versionPublicada } from '@/lib/version-app'

const almacen = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, m } }

describe('versionDesactualizada', () => {
  it('sólo con las dos versiones conocidas y distintas', () => {
    expect(versionDesactualizada('0.1.0+aaa', '0.1.0+bbb')).toBe(true)
    expect(versionDesactualizada('0.1.0+aaa', '0.1.0+aaa')).toBe(false)
    expect(versionDesactualizada('0.1.0+aaa', null)).toBe(false)
    expect(versionDesactualizada('dev', '0.1.0+bbb')).toBe(false)
  })
})

describe('recargarSiHayVersionNueva', () => {
  it('copia vieja: actualiza el service worker y recarga, una sola vez por versión publicada', async () => {
    const a = almacen(); let recargas = 0; let actualizaciones = 0
    const dep = { local: 'v1', publicada: async () => 'v2', almacen: a, actualizarWorker: async () => { actualizaciones++ }, recargar: () => { recargas++ } }
    expect(await recargarSiHayVersionNueva(dep)).toBe(true)
    expect(await recargarSiHayVersionNueva(dep)).toBe(false) // si sigue vieja tras recargar: no entra en bucle
    expect([recargas, actualizaciones]).toEqual([1, 1])
  })
  it('versión al día, desconocida o sin red: sigue el arranque', async () => {
    let recargas = 0
    const base = { local: 'v1', almacen: almacen(), actualizarWorker: async () => {}, recargar: () => { recargas++ } }
    expect(await recargarSiHayVersionNueva({ ...base, publicada: async () => 'v1' })).toBe(false)
    expect(await recargarSiHayVersionNueva({ ...base, publicada: async () => null })).toBe(false)
    expect(recargas).toBe(0)
  })
  it('si actualizar el service worker falla, igual recarga (la red trae la versión nueva)', async () => {
    let recargas = 0
    expect(await recargarSiHayVersionNueva({ local: 'v1', publicada: async () => 'v2', almacen: almacen(), actualizarWorker: async () => { throw new Error('x') }, recargar: () => { recargas++ } })).toBe(true)
    expect(recargas).toBe(1)
  })
})

describe('versionPublicada', () => {
  const resp = (ok: boolean, body: unknown) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch
  it('lee la versión y tolera fallas', async () => {
    expect(await versionPublicada(resp(true, { version: 'v9' }))).toBe('v9')
    expect(await versionPublicada(resp(false, { version: 'v9' }))).toBeNull()
    expect(await versionPublicada(resp(true, { version: 3 }))).toBeNull()
    expect(await versionPublicada((async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch)).toBeNull()
  })
  it('sin respuesta: corta por tiempo y sigue', async () => {
    const colgado = ((_u: string, init?: RequestInit) => new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('abort'))))) as unknown as typeof fetch
    expect(await versionPublicada(colgado, 50)).toBeNull()
  })
})
