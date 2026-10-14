/**
 * La carga inicial de protocolos conserva el texto ORIGINAL de Aldo Monzón:
 * cada texto es un substring exacto de chat-original.txt, sin retornos de
 * carro, con el hash del manifiesto, y nada queda publicado.
 */
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const raiz = join(__dirname, '..')
const dir = join(raiz, 'docs', 'protocolos', 'aldo-monzon-2026-10')
const chatBytes = readFileSync(join(dir, 'chat-original.txt'))
const chat = chatBytes.toString('utf8')
const sql = readFileSync(join(raiz, 'supabase', 'migrations', '20261022130000_protocolos_carga_inicial.sql'), 'utf8')
const manifiesto = JSON.parse(readFileSync(join(dir, 'manifiesto-carga.json'), 'utf8'))
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')

// Textos entre $txt$ … $txt$ (o $txt1$, si alguno contuviera la etiqueta).
const textos = Array.from(sql.matchAll(/\$(txt\d*)\$([\s\S]*?)\$\1\$/g), m => m[2])

describe('fuente original', () => {
  it('es el archivo recibido, byte a byte', () => {
    expect(sha(chatBytes)).toBe('334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687')
    expect(manifiesto.fuente_sha256).toBe(sha(chatBytes))
  })
})

describe('carga inicial', () => {
  it('trae 22 textos para 21 objetivos (Rapsodia con dos)', () => {
    expect(textos).toHaveLength(22)
    expect(manifiesto.versiones).toHaveLength(22)
    expect(new Set(manifiesto.versiones.map((v: any) => v.objetivo_id)).size).toBe(21)
    expect(manifiesto.versiones.filter((v: any) => v.objetivo === 'RAPSODIA').map((v: any) => v.numero)).toEqual([1, 2])
  })

  it('cada texto es un substring EXACTO del chat (nada corregido ni completado)', () => {
    for (const t of textos) expect(chat.includes(t)).toBe(true)
  })

  it('sin retornos de carro: el hash coincide con la fuente al aplicarse', () => {
    expect(sql.includes('\r')).toBe(false)
    for (const t of textos) expect(t.includes('\r')).toBe(false)
  })

  it('los hashes del manifiesto son los de los textos cargados, en orden', () => {
    expect(textos.map(t => sha(t))).toEqual(manifiesto.versiones.map((v: any) => v.texto_sha256))
  })

  it('no publica nada ni aprueba nada', () => {
    expect(sql).not.toMatch(/'vigente'/)
    expect(sql).not.toMatch(/aprobado_(por|at)/)
    expect(sql).not.toMatch(/protocolo_publicar/)
  })

  it('las 7 coincidencias probables quedan pendientes de validación', () => {
    const probables = manifiesto.versiones.filter((v: any) => v.asociacion === 'pendiente_validacion').map((v: any) => v.objetivo)
    expect(probables.sort()).toEqual(['ACA', 'ANTENA', 'CLUB', 'NACION SANTA FE', 'Obrador Baigorria', 'PLAZA DE LA COOPERACIÓN', 'PLAZA DE LAS CIENCIAS'].sort())
  })

  it('las diferencias de la auditoría se cargan pendientes y sin resolución', () => {
    const inserts = sql.match(/insert into public\.protocolo_diferencias/g) ?? []
    expect(inserts.length).toBe(manifiesto.diferencias)
    expect(sql).not.toMatch(/'resuelta'/)
  })

  it('no reproduce los mensajes que no son protocolos', () => {
    expect(sql).not.toMatch(/licitación de 3000 hs/)
    expect(sql).not.toMatch(/personal de guardia adicional/)
  })
})
