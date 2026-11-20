// Regenera tests/db/schema/{10,20,30}-*.sql desde el esquema VIVO (sólo lectura).
//
//   MIGRACIONES_GUARD_DB_URL=<url de sólo lectura> node scripts/db-snapshot/generar.mjs
//   node scripts/db-snapshot/generar.mjs --db-url <url>
//
// Corre las tres consultas de scripts/db-snapshot/consultas.sql con psql, con
// default_transaction_read_only=on y cada bloque entre `begin transaction read only`
// y `rollback`. Sólo lee el catálogo: no copia filas. La URL nunca se imprime.
//
// Sin psql/URL se puede hacer lo mismo a mano (o con el MCP de Supabase,
// execute_sql): pegar cada bloque de consultas.sql y guardar la única columna
// `ddl` que devuelve en el archivo indicado en el encabezado del bloque.
// Después: `node scripts/db-snapshot/generar.mjs --revisar` y `npx vitest run tests/db`.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const RAIZ = fileURLToPath(new URL('../..', import.meta.url))
const SCHEMA = join(RAIZ, 'tests', 'db', 'schema')
const DESTINOS = ['10-tablas.sql', '20-funciones.sql', '30-politicas-grants-triggers.sql']

/** Patrones que NO deben aparecer en el snapshot (repo público). */
export const SENSIBLES = [
  [/https?:\/\/[^\s'"]+/i, 'URL'],
  [/\beyJ[A-Za-z0-9_-]{10,}/, 'JWT'],
  [/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/, 'clave de API'],
  [/\b[0-9]{22}\b/, 'CBU'],
  [/\binsert\s+into\b/i, 'INSERT (datos)'],
  [/\bcopy\s+\w+.*\bfrom\b/i, 'COPY (datos)'],
]

export function revisar(texto) {
  return SENSIBLES.filter(([re]) => re.test(texto)).map(([, nombre]) => nombre)
}

function bloques() {
  const sql = readFileSync(join(RAIZ, 'scripts', 'db-snapshot', 'consultas.sql'), 'utf8')
  const partes = sql.split(/^-- ── \d\) .*$/m).slice(1)
  if (partes.length !== 3) throw new Error(`consultas.sql: se esperaban 3 bloques y hay ${partes.length}`)
  return partes.map(p => p.trim())
}

function main(argv) {
  if (argv.includes('--revisar')) {
    let mal = 0
    for (const f of DESTINOS) {
      const hallazgos = revisar(readFileSync(join(SCHEMA, f), 'utf8'))
      if (hallazgos.length) { mal++; console.error(`${f}: posible dato sensible (${hallazgos.join(', ')})`) }
    }
    console.log(mal ? 'REVISAR antes de commitear.' : 'OK: el snapshot no tiene URLs, tokens, CBU ni filas de datos.')
    return mal ? 1 : 0
  }
  const i = argv.indexOf('--db-url')
  const url = i >= 0 ? argv[i + 1] : process.env.MIGRACIONES_GUARD_DB_URL
  if (!url) { console.error('Falta --db-url (o MIGRACIONES_GUARD_DB_URL). Alternativa sin psql: ver el encabezado de este archivo.'); return 2 }
  bloques().forEach((consulta, n) => {
    const r = spawnSync('psql', [url, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', consulta], {
      encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' },
    })
    if (r.error) throw new Error('No se pudo ejecutar psql (¿está instalado?).')
    if (r.status !== 0) throw new Error('psql devolvió un error (la URL no se muestra): ' + String(r.stderr || '').replace(/postgres(ql)?:\/\/\S+/g, '<url>').trim())
    const ddl = r.stdout.replace(/\s+$/, '') + '\n'
    const hallazgos = revisar(ddl)
    if (hallazgos.length) throw new Error(`${DESTINOS[n]}: posible dato sensible (${hallazgos.join(', ')}); no se escribió.`)
    writeFileSync(join(SCHEMA, DESTINOS[n]), ddl)
    console.log(`escrito tests/db/schema/${DESTINOS[n]}`)
  })
  return 0
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2))
