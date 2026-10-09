import * as crypto from 'crypto'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Visor, leerRaices } from '../agente-documental/src/visor/Visor'

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex')
const PDF = Buffer.from('%PDF-1.4\n% prueba\n')
let dir = ''

/** Cliente de Supabase mínimo: cola en memoria y bucket en memoria. */
function falso(cola: { id: string; ruta_relativa: string; hash_esperado: string; extension: string }[]) {
  const bucket = new Map<string, Buffer>()
  const estados = new Map<string, { estado: string; error?: string; objeto?: string | null }>()
  const vencidas: { id: string; objeto: string }[] = []
  const cliente = {
    rpc: async (fn: string, a: any) => {
      if (fn === 'legajo_historico_vista_tomar') { const p = cola.shift(); if (p) estados.set(p.id, { estado: 'tomada' }); return { data: p ? [p] : [], error: null } }
      if (fn === 'legajo_historico_vista_lista') {
        const ok = a.p_objeto !== null && a.p_hash === hashes.get(a.p_id)
        estados.set(a.p_id, ok ? { estado: 'lista', objeto: a.p_objeto } : { estado: 'error', error: 'hash' })
        return { data: ok, error: null }
      }
      if (fn === 'legajo_historico_vista_error') { estados.set(a.p_id, { estado: 'error', error: a.p_error }); return { data: null, error: null } }
      if (fn === 'legajo_historico_vistas_a_borrar') return { data: vencidas.splice(0), error: null }
      if (fn === 'legajo_historico_vista_borrada') { estados.set(a.p_id, { estado: 'eliminada' }); return { data: null, error: null } }
      return { data: null, error: { message: 'rpc desconocida' } }
    },
    storage: { from: () => ({
      upload: async (o: string, b: Buffer) => { bucket.set(o, b); return { error: null } },
      remove: async (os_: string[]) => { os_.forEach(o => bucket.delete(o)); return { error: null } },
    }) },
  }
  const hashes = new Map<string, string>()
  return { cliente, bucket, estados, vencidas, hashes }
}

const log = { info: () => {}, warn: () => {}, error: () => {} }

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'visor-'))
  fs.mkdirSync(path.join(dir, 'x'))
  fs.writeFileSync(path.join(dir, 'x', 'ok.pdf'), PDF)
  fs.writeFileSync(path.join(dir, 'x', 'falso.pdf'), Buffer.from('no soy un pdf'))
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('Lector del archivo histórico', () => {
  it('lee, verifica el hash y sube la copia; el original no cambia', async () => {
    const f = falso([{ id: 'v1', ruta_relativa: 'EMPLEADOS/x/ok.pdf', hash_esperado: sha(PDF), extension: '.pdf' }])
    f.hashes.set('v1', sha(PDF))
    const antes = fs.statSync(path.join(dir, 'x', 'ok.pdf')).mtimeMs
    const v = new Visor(f.cliente as any, leerRaices(`EMPLEADOS/=${dir}`), 't', log)
    expect(await v.atenderUno()).toBe(true)
    expect(f.estados.get('v1')?.estado).toBe('lista')
    expect(f.bucket.get('v1.pdf')?.equals(PDF)).toBe(true)
    expect(fs.statSync(path.join(dir, 'x', 'ok.pdf')).mtimeMs).toBe(antes)
    expect(await v.atenderUno()).toBe(false)
  })
  it('hash distinto: no sube nada', async () => {
    const f = falso([{ id: 'v2', ruta_relativa: 'EMPLEADOS/x/ok.pdf', hash_esperado: sha(Buffer.from('otro')), extension: '.pdf' }])
    f.hashes.set('v2', sha(Buffer.from('otro')))
    await new Visor(f.cliente as any, leerRaices(`EMPLEADOS/=${dir}`), 't', log).atenderUno()
    expect(f.estados.get('v2')?.estado).toBe('error')
    expect(f.bucket.size).toBe(0)
  })
  it('contenido que no corresponde a la extensión: no sube', async () => {
    const b = Buffer.from('no soy un pdf')
    const f = falso([{ id: 'v3', ruta_relativa: 'EMPLEADOS/x/falso.pdf', hash_esperado: sha(b), extension: '.pdf' }])
    await new Visor(f.cliente as any, leerRaices(`EMPLEADOS/=${dir}`), 't', log).atenderUno()
    expect(f.estados.get('v3')?.error).toMatch(/extensión/)
    expect(f.bucket.size).toBe(0)
  })
  it('archivo inexistente, ruta fuera de la carpeta o tipo no permitido: error sin subir', async () => {
    const f = falso([
      { id: 'a', ruta_relativa: 'EMPLEADOS/x/no.pdf', hash_esperado: sha(PDF), extension: '.pdf' },
      { id: 'b', ruta_relativa: 'EMPLEADOS/../../etc/x.pdf', hash_esperado: sha(PDF), extension: '.pdf' },
      { id: 'c', ruta_relativa: 'EMPLEADOS/x/ok.pdf', hash_esperado: sha(PDF), extension: '.exe' },
    ])
    const v = new Visor(f.cliente as any, leerRaices(`EMPLEADOS/=${dir}`), 't', log)
    while (await v.atenderUno()) { /* atender todo */ }
    expect(['a', 'b', 'c'].map(i => f.estados.get(i)?.estado)).toEqual(['error', 'error', 'error'])
    expect(f.bucket.size).toBe(0)
  })
  it('borra las copias vencidas', async () => {
    const f = falso([])
    f.bucket.set('v9.pdf', PDF); f.vencidas.push({ id: 'v9', objeto: 'v9.pdf' })
    expect(await new Visor(f.cliente as any, [], 't', log).limpiar()).toBe(1)
    expect(f.bucket.size).toBe(0)
    expect(f.estados.get('v9')?.estado).toBe('eliminada')
  })
})
