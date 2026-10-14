import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// Raíz del repo: argumento, o tres carpetas arriba de este archivo.
const R = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const db = new PGlite()
await db.exec(readFileSync(new URL('./prelude.sql', import.meta.url), 'utf8'))
await db.exec(readFileSync(`${R}/supabase/migrations/20261022120000_protocolos_objetivo.sql`, 'utf8'))
await db.exec(readFileSync(`${R}/supabase/migrations/20261022130000_protocolos_carga_inicial.sql`, 'utf8'))
const res = await db.exec(readFileSync(`${R}/supabase/verificacion/protocolos_post_migracion.sql`, 'utf8'))
for (const r of res.at(-1).rows) console.log(r.ok ? 'OK ' : 'FALLA', r.control, '|', r.obtenido)
// rollback limpia todo
await db.exec(readFileSync(`${R}/supabase/rollback/20261022120000_protocolos_objetivo_rollback.sql`, 'utf8'))
const quedan = (await db.query(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'protocolo%'`)).rows[0].n
const tablas = (await db.query(`select count(*)::int n from pg_class where relname like 'protocolo\_%' and relkind='r'`)).rows[0].n
console.log(quedan === 0 && tablas === 0 ? 'OK ' : 'FALLA', 'Rollback deja 0 funciones y 0 tablas', quedan, tablas)
// y se puede volver a aplicar
await db.exec(readFileSync(`${R}/supabase/migrations/20261022120000_protocolos_objetivo.sql`, 'utf8'))
await db.exec(readFileSync(`${R}/supabase/migrations/20261022130000_protocolos_carga_inicial.sql`, 'utf8'))
console.log('OK  Reaplicar después del rollback')
