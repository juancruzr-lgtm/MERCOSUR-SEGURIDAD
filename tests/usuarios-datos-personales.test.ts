// F-06: DNI, teléfono y CUIL se leen por la RPC con permiso
// `usuarios_datos_personales()`, no por `usuarios.dni` / `usuarios.telefono` /
// `usuarios.cuil` desde el navegador. Las rutas con service_role recortan esos
// campos según lo que la sesión puede ver. Estas pruebas frenan regresiones.
import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { COLUMNAS_USUARIO, cargarDatosPersonales, conDatosPersonales, conDatosPersonalesPropios } from '@/lib/usuarios-columnas'

vi.mock('@/app/api/_lib/cliente-usuario', () => ({ clienteDelUsuario: () => null }))
import {
  camposVisibles, recortarDatosPersonales, recortarListaDatosPersonales, recortarParaLaSesion, visiblesDeLaSesion,
} from '@/app/api/_lib/datos-personales-respuesta'

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

const PERSONAL = /\b(dni|cuil|telefono)\b/
const corto = (f: string) => f.replace(/.*\/(app|lib|components)\//, '$1/')

describe('DNI/teléfono/CUIL por RPC con permiso (F-06)', () => {
  it('la lista de columnas del cliente no incluye dni, telefono ni cuil', () => {
    const cols = COLUMNAS_USUARIO.split(',').map(c => c.trim())
    for (const c of ['dni', 'telefono', 'cuil', 'cuenta_bancaria']) expect(cols).not.toContain(c)
    expect(cols.every(c => /^[a-z_]+$/.test(c))).toBe(true)
  })

  it('ningún lector del cliente pide dni/telefono/cuil a usuarios (select directo, *, ni embed)', () => {
    const malos: string[] = []
    for (const f of CLIENTE) {
      const src = readFileSync(f, 'utf8')
      let i = -1
      while ((i = src.indexOf("from('usuarios')", i + 1)) >= 0) {
        // Toda la cadena hasta el fin de la sentencia: también un .update(...).select(...).
        // Corta en la próxima consulta (otra tabla) o en el fin de la sentencia.
        const cadena = src.slice(i + 1, i + 900).split(/\.from\(|\.rpc\(|\n\s*\n|;\s*\n/)[0]
        for (const sel of Array.from(cadena.matchAll(/\.select\(([^)]*)\)/g))) {
          const arg = sel[1].trim()
          if (PERSONAL.test(arg) || arg === '' || /^['"`]\*['"`]$/.test(arg)) malos.push(`${corto(f)}: ${sel[0]}`)
        }
      }
      // Embeds: usuarios(...), alias:usuarios!fk(...) dentro de un select de otra tabla.
      for (const m of Array.from(src.matchAll(/[:'"`,\s(]usuarios(?:![\w]+)?\s*\(([^)]*)\)/g))) {
        if (PERSONAL.test(m[1]) || m[1].trim() === '*') malos.push(`${corto(f)}: ${m[0].trim()}`)
      }
    }
    expect(malos).toEqual([])
  })

  it('las rutas que devuelven filas de usuarios al navegador recortan los datos personales', () => {
    const rutas = [
      'app/api/usuarios/route.ts', 'app/api/create-user/route.ts', 'app/api/reset-user-password/route.ts',
      'app/api/update-user-email/route.ts', 'app/api/sync-auth-emails/route.ts', 'app/api/sync-employee-auth/route.ts',
      'app/api/admin/repair-auth-users/route.ts',
    ]
    for (const r of rutas) expect(readFileSync(join(RAIZ, r), 'utf8'), r).toMatch(/recortarParaLaSesion\(getBearerToken\(req\)/)
    const legajo = readFileSync(join(RAIZ, 'app/api/legajo/[id]/route.ts'), 'utf8')
    expect(legajo).toMatch(/cuil: visibles\?\.has\('cuil'\)/)
    expect(legajo).toMatch(/dni: gestionaLegajos\(solicitante\) && visibles\?\.has\('dni'\)/)
    // El CBU sigue con su regla (no se amplía).
    expect(legajo).toMatch(/cuenta_bancaria: \(tieneCapacidad\(solicitante, 'ver_finanzas'\) \|\| solicitante\.id === empleadoId\)/)
  })
})

describe('cliente: cargarDatosPersonales / conDatosPersonales', () => {
  it('mapa id → campos presentes; una clave ausente queda ausente (sin permiso ≠ vacío)', async () => {
    const llamadas: any[] = []
    const r = await cargarDatosPersonales({
      rpc: async (fn, args) => {
        llamadas.push([fn, args])
        return { data: { a: { dni: '30111222', telefono: '3415550000', cuil: '20301112223' }, b: { dni: '', telefono: null }, c: 5 }, error: null }
      },
    }, ['a', 'a', 'b', null, ''])
    expect(llamadas).toEqual([['usuarios_datos_personales', { p_ids: ['a', 'b'] }]])
    expect(r.error).toBeNull()
    expect(r.porId.get('a')).toEqual({ dni: '30111222', telefono: '3415550000', cuil: '20301112223' })
    expect(r.porId.get('b')).toEqual({ dni: null, telefono: null })
    expect('cuil' in r.porId.get('b')!).toBe(false)
    expect(r.porId.has('c')).toBe(false)
  })

  it('ids nulo = todas las visibles; lista vacía no consulta', async () => {
    const llamadas: any[] = []
    const cli = { rpc: async (_fn: string, args?: Record<string, unknown>) => { llamadas.push(args); return { data: {}, error: null } } }
    await cargarDatosPersonales(cli)
    expect(await cargarDatosPersonales(cli, [])).toEqual({ porId: new Map(), error: null })
    expect(llamadas).toEqual([{ p_ids: null }])
  })

  it('error de la RPC o cliente sin rpc → mapa vacío con error', async () => {
    const e = await cargarDatosPersonales({ rpc: async () => ({ data: null, error: { code: '42501', message: 'sin permiso' } }) }, ['a'])
    expect(e.porId.size).toBe(0)
    expect(e.error).toBe('sin permiso')
    expect((await cargarDatosPersonales({}, ['a'])).error).toMatch(/RPC/)
  })

  it('conDatosPersonales completa sólo lo que vino y no borra lo que ya estaba', () => {
    const porId = new Map([['a', { dni: '1', telefono: '2' }]])
    const filas = [{ id: 'a', nombre: 'A', cuil: '9' }, { id: 'b', nombre: 'B', dni: '7' }]
    expect(conDatosPersonales(filas, porId)).toEqual([{ id: 'a', nombre: 'A', dni: '1', telefono: '2', cuil: '9' }, { id: 'b', nombre: 'B', dni: '7' }])
    expect(conDatosPersonales(filas, new Map())).toBe(filas)
  })

  it('conDatosPersonalesPropios: agrega los propios; si la RPC falla, sin las claves (no se sabe)', async () => {
    const ok = await conDatosPersonalesPropios({ rpc: async () => ({ data: { u1: { dni: '30111222', telefono: null, cuil: null } }, error: null }) }, { id: 'u1', nombre: 'X' })
    expect(ok).toEqual({ id: 'u1', nombre: 'X', dni: '30111222', telefono: null, cuil: null })
    const roto = await conDatosPersonalesPropios({ rpc: async () => { throw new Error('sin red') } }, { id: 'u1', nombre: 'X' })
    expect(roto).toEqual({ id: 'u1', nombre: 'X' })
    expect('telefono' in (roto as object)).toBe(false)
    expect(await conDatosPersonalesPropios({ rpc: async () => ({ data: {}, error: null }) }, null)).toBeNull()
  })
})

describe('servidor: recorte de respuestas según la sesión (rutas con service_role)', () => {
  const fila = (id: string) => ({ id, nombre: 'N', dni: '30111222', telefono: '341', cuil: '20301112223', cuenta_bancaria: '0001' })

  it('Administración: la base devuelve las tres claves → la fila sale completa', async () => {
    const v = await camposVisibles({ rpc: async () => ({ data: { a: { dni: '1', telefono: '2', cuil: '3' } }, error: null }) }, ['a'])
    expect(recortarDatosPersonales(fila('a'), v)).toEqual(fila('a'))
  })

  it('jefe de supervisores / dirección operativa: sin cuil → se quita sólo el CUIL; el CBU no se toca acá', async () => {
    const v = await camposVisibles({ rpc: async () => ({ data: { a: { dni: '1', telefono: '2' } }, error: null }) }, ['a'])
    const { cuil: _c, ...esperado } = fila('a')
    expect(recortarDatosPersonales(fila('a'), v)).toEqual(esperado)
  })

  it('supervisor: persona fuera de sus zonas (ausente en la respuesta) → sin dni, teléfono ni CUIL', async () => {
    const v = await camposVisibles({ rpc: async () => ({ data: { a: { dni: '1', telefono: '2' } }, error: null }) }, ['a', 'b'])
    expect(recortarListaDatosPersonales([fila('b')], v)).toEqual([{ id: 'b', nombre: 'N', cuenta_bancaria: '0001' }])
  })

  it('error o excepción de la base → se quitan los tres campos (nunca de más)', async () => {
    const conError = await camposVisibles({ rpc: async () => ({ data: null, error: { message: 'x' } }) }, ['a'])
    const conExcepcion = await camposVisibles({ rpc: async () => { throw new Error('red') } }, ['a'])
    for (const v of [conError, conExcepcion]) expect(recortarDatosPersonales(fila('a'), v)).toEqual({ id: 'a', nombre: 'N', cuenta_bancaria: '0001' })
  })

  it('pide sólo los ids de las filas; sin token no consulta y recorta todo', async () => {
    const llamadas: any[] = []
    await camposVisibles({ rpc: async (fn, args) => { llamadas.push([fn, args]); return { data: {}, error: null } } }, ['a', 'a', null])
    expect(llamadas).toEqual([['usuarios_datos_personales', { p_ids: ['a'] }]])
    expect((await visiblesDeLaSesion(null, ['a'])).size).toBe(0)
    expect(await recortarParaLaSesion(null, [fila('a')])).toEqual([{ id: 'a', nombre: 'N', cuenta_bancaria: '0001' }])
    expect(recortarDatosPersonales(null, new Map())).toBeNull()
  })
})
