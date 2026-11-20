// F-06 (paso previo a la fase B): DNI y CUIL se leen por la RPC con permiso
// `usuarios_datos_identidad()`, no por `usuarios.dni` / `usuarios.cuil` desde el
// navegador. Estas pruebas frenan que vuelva a aparecer una lectura directa.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { COLUMNAS_USUARIO, cargarDatosIdentidad, conIdentidad, conIdentidadPropia } from '@/lib/usuarios-columnas'

const RAIZ = join(__dirname, '..')

function archivos(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) { if (!['node_modules', '.next'].includes(n)) archivos(p, out) }
    else if (/\.(ts|tsx)$/.test(n)) out.push(p)
  }
  return out
}

// Código que corre con la sesión del usuario: todo menos app/api (service_role) y
// lib/afip/corroborar.ts (sólo lo usan rutas de app/api con el cliente admin).
const CLIENTE = [...archivos(join(RAIZ, 'app')), ...archivos(join(RAIZ, 'lib')), ...archivos(join(RAIZ, 'components'))]
  .map(p => p.replace(/\\/g, '/'))
  .filter(p => !p.includes('/app/api/') && !p.endsWith('/lib/afip/corroborar.ts'))

const pideIdentidad = (cols: string) => /\b(dni|cuil)\b|^\s*['"`]?\*['"`]?\s*$/.test(cols)

describe('DNI/CUIL por RPC con permiso (F-06)', () => {
  it('la lista de columnas del cliente no incluye dni ni cuil', () => {
    const cols = COLUMNAS_USUARIO.split(',').map(c => c.trim())
    expect(cols).not.toContain('dni')
    expect(cols).not.toContain('cuil')
  })

  it('ningún lector del cliente pide dni/cuil a usuarios (select directo ni embed)', () => {
    const malos: string[] = []
    for (const f of CLIENTE) {
      const src = readFileSync(f, 'utf8')
      let i = -1
      while ((i = src.indexOf("from('usuarios')", i + 1)) >= 0) {
        const sel = src.slice(i, i + 600).match(/\.select\(([^)]*)\)/)
        if (sel && pideIdentidad(sel[1])) malos.push(`${f.replace(/.*\/(app|lib|components)\//, '$1/')}: ${sel[0]}`)
      }
      const emb = /usuarios(?:![\w]+)?\s*\(([^)]*)\)/g
      let m: RegExpExecArray | null
      while ((m = emb.exec(src))) {
        // Sólo embeds dentro de una cadena de select (evita comentarios y llamadas).
        const antes = src.slice(Math.max(0, m.index - 1), m.index)
        if (/[\w]/.test(antes)) continue
        if (/\b(dni|cuil)\b/.test(m[1]) && /['"`,:\s]/.test(antes)) malos.push(`${f.replace(/.*\/(app|lib|components)\//, '$1/')}: ${m[0]}`)
      }
    }
    expect(malos).toEqual([])
  })

  it('la RPC existe en las migraciones con el permiso esperado', () => {
    const sql = readFileSync(join(RAIZ, 'supabase/migrations/20261220164000_usuarios_identidad_rpc.sql'), 'utf8')
    expect(sql).toMatch(/function public\.usuarios_datos_identidad\(p_ids uuid\[\] default null\)/)
    expect(sql).toMatch(/legajo_puede_gestionar\(\)/)
  })

  it('cargarDatosIdentidad: mapa id → {dni, cuil}; pide sólo los ids pedidos, sin duplicados', async () => {
    const llamadas: any[] = []
    const r = await cargarDatosIdentidad({
      rpc: async (fn, args) => { llamadas.push([fn, args]); return { data: { a: { dni: '30111222', cuil: '20301112223' }, b: { dni: '', cuil: null }, c: 5 }, error: null } },
    }, ['a', 'a', 'b', null, ''])
    expect(llamadas).toEqual([['usuarios_datos_identidad', { p_ids: ['a', 'b'] }]])
    expect(r.error).toBeNull()
    expect(Array.from(r.porId)).toEqual([['a', { dni: '30111222', cuil: '20301112223' }], ['b', { dni: null, cuil: null }]])
  })

  it('cargarDatosIdentidad: ids nulo = todas las personas que la sesión puede ver; lista vacía no consulta', async () => {
    const llamadas: any[] = []
    const cli = { rpc: async (fn: string, args?: Record<string, unknown>) => { llamadas.push(args); return { data: {}, error: null } } }
    await cargarDatosIdentidad(cli)
    const vacia = await cargarDatosIdentidad(cli, [])
    expect(llamadas).toEqual([{ p_ids: null }])
    expect(vacia).toEqual({ porId: new Map(), error: null })
  })

  it('cargarDatosIdentidad: error de la RPC o cliente sin rpc → mapa vacío con error', async () => {
    const e = await cargarDatosIdentidad({ rpc: async () => ({ data: null, error: { code: '42501', message: 'sin permiso' } }) }, ['a'])
    expect(e.porId.size).toBe(0)
    expect(e.error).toBe('sin permiso')
    expect((await cargarDatosIdentidad({}, ['a'])).error).toMatch(/RPC/)
  })

  it('conIdentidad completa sólo las filas del mapa y no borra lo que ya estaba', () => {
    const porId = new Map([['a', { dni: '1', cuil: '2' }]])
    const filas = [{ id: 'a', nombre: 'A' }, { id: 'b', nombre: 'B', dni: '9' }]
    expect(conIdentidad(filas, porId)).toEqual([{ id: 'a', nombre: 'A', dni: '1', cuil: '2' }, { id: 'b', nombre: 'B', dni: '9' }])
    expect(conIdentidad(filas, new Map())).toBe(filas)
  })

  it('conIdentidadPropia: agrega el DNI propio; si la RPC falla, el perfil sigue igual', async () => {
    const ok = await conIdentidadPropia({ rpc: async () => ({ data: { u1: { dni: '30111222', cuil: null } }, error: null }) }, { id: 'u1', nombre: 'X' })
    expect(ok).toEqual({ id: 'u1', nombre: 'X', dni: '30111222', cuil: null })
    const roto = await conIdentidadPropia({ rpc: async () => { throw new Error('sin red') } }, { id: 'u1', nombre: 'X' })
    expect(roto).toEqual({ id: 'u1', nombre: 'X' })
    expect(await conIdentidadPropia({ rpc: async () => ({ data: {}, error: null }) }, null)).toBeNull()
  })
})
