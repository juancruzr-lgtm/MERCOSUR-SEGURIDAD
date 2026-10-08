import { createHash } from 'crypto'
import { existsSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { nombreDescarga, rutaOriginal, urlOriginal } from '@/lib/estatuto-original'
import { GET } from '@/app/api/estatuto/original/route'

// Gerencia 08/10/2026: el vigilador no puede obtener el Word original del
// Estatuto, ni por el botón ni por un enlace directo ni por la API.

const RAIZ = join(__dirname, '..')
const HASH = '5feb70d22a7b5fffe100eb56304654678c73328117ecc4de25b8c5db4c46228c'

// ── Simulación de Supabase con la identidad de quien llama ──────────────────
type Rol = 'anonimo' | 'vigilador' | 'administracion' | 'gerencia' | 'supervisor'
let rol: Rol = 'vigilador'
let versionExiste = true

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      getUser: async () => rol === 'anonimo'
        ? { data: { user: null }, error: { message: 'invalid' } }
        : { data: { user: { id: `auth-${rol}` } }, error: null },
    },
    rpc: async (fn: string) => ({
      data: fn === 'puede_gestionar_personal_actual' ? rol === 'administracion'
        : fn === 'puede_acceder_gerencia_actual' ? rol === 'gerencia' : false,
      error: null,
    }),
    from: () => {
      const q: any = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: versionExiste ? { identificador: '1', archivo_sha256: HASH } : null, error: null }),
      }
      return q
    },
  }),
}))

// La ruta lee las variables al atender cada pedido, no al importarse.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:9'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'


const pedir = (version: string, conToken = true) => GET(new NextRequest(
  `http://localhost${urlOriginal(version)}`,
  { headers: conToken ? { Authorization: 'Bearer token-de-prueba' } : {} },
))

beforeEach(() => { rol = 'vigilador'; versionExiste = true })

describe('el Word original no está en ninguna dirección pública', () => {
  it('no hay ningún .doc/.docx ni archivo del Estatuto debajo de /public', () => {
    const buscar = (dir: string): string[] => readdirSync(dir).flatMap(n => {
      const p = join(dir, n)
      return statSync(p).isDirectory() ? buscar(p) : (/\.docx?$|estatuto/i.test(n) ? [p] : [])
    })
    expect(buscar(join(RAIZ, 'public'))).toEqual([])
  })

  it('el original vive en privado/ y es el registrado', () => {
    expect(existsSync(join(RAIZ, 'public/documentos/estatuto/v1/estatuto-interno.doc'))).toBe(false)
    expect(rutaOriginal('1')).toBe('privado/estatuto/v1/estatuto-interno.doc')
  })

  it('la ruta sólo acepta números de versión: nada de ../ ni texto arbitrario', () => {
    for (const malo of ['', '0', '../1', '1/../../.env', '1.doc', 'v1', '%2e%2e', '99999']) {
      expect(rutaOriginal(malo)).toBeNull()
    }
    expect(nombreDescarga('1')).toBe('Estatuto Interno Mercosur Seguridad SRL 2026.doc')
  })
})

describe('GET /api/estatuto/original', () => {
  it('sin sesión: 401', async () => {
    expect((await pedir('1', false)).status).toBe(401)
  })

  it('token inválido: 401', async () => {
    rol = 'anonimo'
    expect((await pedir('1')).status).toBe(401)
  })

  it('vigilador con sesión válida y el enlace directo: 403, sin el archivo', async () => {
    rol = 'vigilador'
    const r = await pedir('1')
    expect(r.status).toBe(403)
    expect(r.headers.get('content-type')).toMatch(/json/)
  })

  it('supervisor: 403 (documentación laboral, no operativa)', async () => {
    rol = 'supervisor'
    expect((await pedir('1')).status).toBe(403)
  })

  it('Administración: 200 con el original exacto, como descarga y sin caché', async () => {
    rol = 'administracion'
    const r = await pedir('1')
    expect(r.status).toBe(200)
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="Estatuto Interno Mercosur Seguridad SRL 2026.doc"')
    expect(r.headers.get('cache-control')).toMatch(/no-store/)
    const bytes = Buffer.from(await r.arrayBuffer())
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(HASH)
  })

  it('Gerencia: 200', async () => {
    rol = 'gerencia'
    expect((await pedir('1')).status).toBe(200)
  })

  it('versión inválida: 400 antes de mirar nada', async () => {
    rol = 'gerencia'
    expect((await pedir('../1')).status).toBe(400)
  })

  it('versión inexistente: 404', async () => {
    rol = 'gerencia'; versionExiste = false
    expect((await pedir('2')).status).toBe(404)
  })
})
