import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

// Corrección B (JC 19/10): a la app le alcanza con INSERT y SELECT sobre
// supervisor_route_points. Esto prueba que ningún código necesita más.

const RAIZ = join(__dirname, '..')
const MIGRACION = readFileSync(join(RAIZ, 'supabase', 'migrations', '20261102120000_gps_sin_privilegios_peligrosos.sql'), 'utf8')

function archivos(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n.startsWith('.')) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) archivos(p, out)
    else if (/\.(ts|tsx|js|mjs)$/.test(n)) out.push(p)
  }
  return out
}

describe('GPS de supervisores: la app sólo inserta y lee', () => {
  const codigo = ['app', 'components', 'lib', 'scripts'].flatMap(d => {
    try { return archivos(join(RAIZ, d)) } catch { return [] }
  })
  const usos = codigo
    .map(f => ({ f, t: readFileSync(f, 'utf8') }))
    .filter(x => x.t.includes('supervisor_route_points'))

  it('el único acceso directo desde el código es el insert de lib/supervisor-gps.ts', () => {
    const conFrom = usos.filter(x => /from\(\s*['"]supervisor_route_points['"]\s*\)/.test(x.t)).map(x => x.f.replace(RAIZ, '').replace(/\\/g, '/'))
    expect(conFrom).toEqual(['/lib/supervisor-gps.ts'])
    const gps = usos.find(x => x.f.endsWith('supervisor-gps.ts'))!.t
    expect(gps).toMatch(/from\('supervisor_route_points'\)\.insert\(row\)/)
  })
  it('nadie actualiza, borra, hace upsert ni trunca puntos GPS', () => {
    for (const { t } of usos) {
      expect(t).not.toMatch(/supervisor_route_points['"]\s*\)\s*\.(update|delete|upsert)\(/)
      expect(t.toLowerCase()).not.toMatch(/truncate[^;]*supervisor_route_points/)
    }
  })
})

describe('la migración quita sólo lo peligroso', () => {
  const sentencia = MIGRACION.slice(MIGRACION.indexOf('begin;'), MIGRACION.indexOf('commit;'))
  it('revoca TRUNCATE, UPDATE, DELETE, REFERENCES y TRIGGER a authenticated y anon', () => {
    expect(sentencia.replace(/\s+/g, ' ')).toContain('revoke truncate, update, delete, references, trigger on public.supervisor_route_points from authenticated, anon;')
  })
  it('no toca INSERT, SELECT, políticas ni service_role', () => {
    expect(sentencia).not.toMatch(/\binsert\b|\bselect\b|policy|service_role|\bgrant\b/i)
  })
})
