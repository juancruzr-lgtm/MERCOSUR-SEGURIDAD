import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// Raíz del repo: argumento, o tres carpetas arriba de este archivo.
const R = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const db = new PGlite()
await db.exec(readFileSync(new URL('../protocolos/prelude.sql', import.meta.url), 'utf8'))
await db.exec(readFileSync(new URL('./prelude.sql', import.meta.url), 'utf8'))
await db.exec(readFileSync(`${R}/supabase/migrations/20261022120000_protocolos_objetivo.sql`, 'utf8'))
await db.exec(readFileSync(`${R}/supabase/migrations/20261022130000_protocolos_carga_inicial.sql`, 'utf8'))
await db.exec(readFileSync(`${R}/supabase/migrations/20261023120000_protocolo_controles_propuestos.sql`, 'utf8'))
const res = await db.exec(readFileSync(`${R}/supabase/verificacion/protocolo_controles_post_migracion.sql`, 'utf8'))
const filas = res.at(-1).rows
for (const r of filas) console.log(r.ok ? 'OK ' : 'FALLA', r.control, '|', r.obtenido)
process.exit(filas.every(r => r.ok) ? 0 : 1)
