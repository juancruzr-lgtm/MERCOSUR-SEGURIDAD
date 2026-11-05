// V2 (auditoría 05/11/2026): el CBU de `usuarios.cuenta_bancaria` no se lee desde
// el navegador. Después de la migración 20261207100100, `authenticated` no tiene
// SELECT sobre esa columna, y un select('*') o un .select() sin columnas sobre
// `usuarios` desde el cliente FALLA para todos (incluido el login). Estas pruebas
// frenan que vuelva a aparecer uno.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { COLUMNAS_USUARIO, sinCuentaBancaria, cargarCuentasBancarias } from '@/lib/usuarios-columnas'

const RAIZ = join(__dirname, '..')

function archivos(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) { if (!['node_modules', '.next'].includes(n)) archivos(p, out) }
    else if (/\.(ts|tsx)$/.test(n)) out.push(p)
  }
  return out
}

// Código que corre en el navegador (o con la sesión del usuario): todo menos app/api,
// que usa service_role y filtra el CBU en la respuesta.
const CLIENTE = [...archivos(join(RAIZ, 'app')), ...archivos(join(RAIZ, 'lib')), ...archivos(join(RAIZ, 'components'))]
  .filter(p => !p.replace(/\\/g, '/').includes('/app/api/'))

function cadenasUsuarios(src: string): string[] {
  const out: string[] = []
  let i = -1
  while ((i = src.indexOf("from('usuarios')", i + 1)) >= 0) {
    // La cadena del query builder hasta el primer corte de sentencia.
    const resto = src.slice(i, i + 800)
    const fin = resto.search(/\)\s*\r?\n\s*\r?\n|;\s*\r?\n|\n\s*(const|let|if|return|await)\b/)
    out.push(resto.slice(0, fin > 0 ? fin + 1 : 800))
  }
  return out
}

describe('usuarios sin CBU desde el navegador (V2)', () => {
  it('la lista de columnas no incluye cuenta_bancaria', () => {
    const cols = COLUMNAS_USUARIO.split(',').map(c => c.trim())
    expect(cols).not.toContain('cuenta_bancaria')
    expect(cols).toEqual(expect.arrayContaining(['id', 'auth_user_id', 'rol', 'puesto_organizacional', 'estado', 'acceso_admin_pleno', 'acceso_interfaz_admin', 'acceso_bloqueado']))
    expect(new Set(cols).size).toBe(cols.length)
  })

  it('la migración concede SELECT exactamente sobre esas columnas', () => {
    const sql = readFileSync(join(RAIZ, 'supabase/migrations/20261207100100_usuarios_revocar_cuenta_bancaria.sql'), 'utf8')
    const m = sql.match(/grant select \(([^)]+)\) on public\.usuarios to authenticated/i)
    expect(m).not.toBeNull()
    const enMigracion = m![1].split(',').map(c => c.trim()).sort()
    expect(enMigracion).toEqual(COLUMNAS_USUARIO.split(',').map(c => c.trim()).sort())
    expect(enMigracion).not.toContain('cuenta_bancaria')
  })

  it("ningún lector del cliente usa select('*'), .select() vacío ni pide cuenta_bancaria", () => {
    const malos: string[] = []
    for (const f of CLIENTE) {
      const src = readFileSync(f, 'utf8')
      for (const c of cadenasUsuarios(src)) {
        // Sólo el argumento del primer .select( de la cadena (no comentarios cercanos).
        const sel = c.match(/\.select\(([^)]*)\)/)
        if (sel && (sel[1].trim() === '' || /^['"`]\*['"`]$/.test(sel[1].trim()) || sel[1].includes('cuenta_bancaria'))) malos.push(`${f.replace(RAIZ, '')}: ${c.slice(0, 120).replace(/\s+/g, ' ')}`)
      }
    }
    expect(malos).toEqual([])
  })

  it('/api/usuarios devuelve la fila sin CBU a quien no tiene capacidad económica', () => {
    const src = readFileSync(join(RAIZ, 'app/api/usuarios/route.ts'), 'utf8')
    const respuestas = src.match(/NextResponse\.json\(\{ ok: true, usuario: [^}]+\}\)/g) ?? []
    expect(respuestas.length).toBe(2)
    for (const r of respuestas) expect(r).toContain('puedeEconomico ? data : sinCuentaBancaria(data)')
  })

  it('sinCuentaBancaria quita sólo esa columna', () => {
    expect(sinCuentaBancaria({ id: '1', nombre: 'A', cuenta_bancaria: '123' })).toEqual({ id: '1', nombre: 'A' })
    expect(sinCuentaBancaria(null)).toBeNull()
  })

  it('cargarCuentasBancarias: mapa id → cuenta; error de la RPC (42501) no inventa cuentas', async () => {
    const ok = await cargarCuentasBancarias({ rpc: async () => ({ data: { a: '0001', b: '', c: null }, error: null }) })
    expect(Array.from(ok.porId)).toEqual([['a', '0001']])
    expect(ok.error).toBeNull()
    const denegado = await cargarCuentasBancarias({ rpc: async () => ({ data: null, error: { code: '42501', message: 'Sólo Gerencia o Administración' } }) })
    expect(denegado.porId.size).toBe(0)
    expect(denegado.error).toMatch(/Gerencia/)
  })
})
