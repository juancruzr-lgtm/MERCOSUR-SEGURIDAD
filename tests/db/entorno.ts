// Entorno aislado de base de datos para pruebas: PGlite (Postgres en WASM, en memoria)
// con el snapshot del esquema VIVO de producción (tests/db/schema) y un seed ficticio.
// No usa red ni Docker. Ver tests/db/README.md.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'

const DIR = fileURLToPath(new URL('.', import.meta.url))
export const RAIZ_REPO = join(DIR, '..', '..')

/** Perfiles ficticios del seed: `auth` es el sub del JWT, `id` es usuarios.id. */
export const P = {
  vigilador: { id: '10000000-0000-4000-8000-000000000001', auth: 'a0000000-0000-4000-8000-000000000001', email: 'vigilador.norte@ejemplo.test' },
  supervisor: { id: '10000000-0000-4000-8000-000000000002', auth: 'a0000000-0000-4000-8000-000000000002', email: 'supervisor.norte@ejemplo.test' },
  jefe: { id: '10000000-0000-4000-8000-000000000003', auth: 'a0000000-0000-4000-8000-000000000003', email: 'jefa.supervisores@ejemplo.test' },
  administracion: { id: '10000000-0000-4000-8000-000000000004', auth: 'a0000000-0000-4000-8000-000000000004', email: 'administracion@ejemplo.test' },
  gerencia: { id: '10000000-0000-4000-8000-000000000005', auth: 'a0000000-0000-4000-8000-000000000005', email: 'gerencia@ejemplo.test' },
  vigiladorSur: { id: '10000000-0000-4000-8000-000000000006', auth: 'a0000000-0000-4000-8000-000000000006', email: 'vigilador.sur@ejemplo.test' },
} as const
export type Perfil = (typeof P)[keyof typeof P]

export const ZONA = { norte: '20000000-0000-4000-8000-000000000001', sur: '20000000-0000-4000-8000-000000000002' } as const
export const OBJETIVO = { norte: '30000000-0000-4000-8000-000000000001', sur: '30000000-0000-4000-8000-000000000002', sur2: '30000000-0000-4000-8000-000000000003' } as const
export const TURNO = { vigNorte: '50000000-0000-4000-8000-000000000001', vigSur: '50000000-0000-4000-8000-000000000002', vigNorteManiana: '50000000-0000-4000-8000-000000000003' } as const
export const REGISTRO = { vigNorte: '60000000-0000-4000-8000-000000000001', vigSur: '60000000-0000-4000-8000-000000000002' } as const
export const SUPERVISION = { norte: '70000000-0000-4000-8000-000000000001', sur: '70000000-0000-4000-8000-000000000002' } as const

/** Lee un .sql y lo adapta a la versión de PGlite (el snapshot viene de Postgres 17). */
export function adaptarSql(sql: string, versionNum: number): string {
  // MAINTAIN existe desde Postgres 17; PGlite 0.2.x es Postgres 16.
  return versionNum < 170000 ? sql.replace(/\bmaintain, /g, '') : sql
}

export function archivosEsquema(): string[] {
  const dir = join(DIR, 'schema')
  return readdirSync(dir).filter(f => f.endsWith('.sql')).sort().map(f => join(dir, f))
}

export interface Entorno {
  db: PGlite
  version: number
  /** Ejecuta SQL (varias sentencias) como superusuario o con el rol vigente. */
  exec: (sql: string) => Promise<void>
  /** Consulta con parámetros; devuelve filas y filas afectadas. */
  q: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; afectadas: number }>
  /** Aplica un archivo SQL (p. ej. una migración nueva) con la misma adaptación del snapshot. */
  aplicarArchivo: (ruta: string) => Promise<void>
  /** Corre `fn` con role=authenticated y los claims del perfil (como PostgREST). */
  comoUsuario: <T>(perfil: Perfil | string, fn: () => Promise<T>) => Promise<T>
  /** Corre `fn` como anon (sin sesión). */
  comoAnon: <T>(fn: () => Promise<T>) => Promise<T>
  /** Corre `fn` dentro de una transacción que SIEMPRE se revierte (las pruebas no se ensucian entre sí). */
  enTransaccion: <T>(fn: () => Promise<T>) => Promise<T>
  /** Corre `fn` en un savepoint: devuelve el error (o null) sin abortar la transacción. */
  intentar: (fn: () => Promise<unknown>) => Promise<Error | null>
  cerrar: () => Promise<void>
}

export async function crearEntorno(opciones: { seed?: boolean } = {}): Promise<Entorno> {
  const db = new PGlite()
  await db.waitReady
  const version = Number((await db.query<{ v: string }>(`select current_setting('server_version_num') v`)).rows[0].v)
  const exec = async (sql: string) => { await db.exec(sql) }
  const aplicarArchivo = async (ruta: string) => exec(adaptarSql(readFileSync(ruta, 'utf8'), version))
  for (const f of archivosEsquema()) {
    try { await aplicarArchivo(f) } catch (e: any) { throw new Error(`cargando ${f}: ${e.message}`) }
  }
  if (opciones.seed !== false) await aplicarArchivo(join(DIR, 'seed.sql'))

  const q = async <T,>(sql: string, params: unknown[] = []) => {
    const r = await db.query<T>(sql, params)
    return { rows: r.rows, afectadas: r.affectedRows ?? 0 }
  }
  const conClaims = async <T,>(rol: 'authenticated' | 'anon', claims: Record<string, unknown>, fn: () => Promise<T>) => {
    await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)])
    await db.exec(`set role ${rol}`)
    try {
      return await fn()
    } finally {
      // Si la transacción quedó abortada esto falla; el rollback de enTransaccion lo limpia.
      try { await db.exec(`reset role; select set_config('request.jwt.claims', '', false);`) } catch { /* noop */ }
    }
  }
  const comoUsuario = <T,>(perfil: Perfil | string, fn: () => Promise<T>) => {
    const sub = typeof perfil === 'string' ? perfil : perfil.auth
    const email = typeof perfil === 'string' ? undefined : perfil.email
    return conClaims('authenticated', { sub, role: 'authenticated', email }, fn)
  }
  const comoAnon = <T,>(fn: () => Promise<T>) => conClaims('anon', { role: 'anon' }, fn)
  const enTransaccion = async <T,>(fn: () => Promise<T>) => {
    await db.exec('begin')
    try { return await fn() } finally { await db.exec('rollback') }
  }
  let n = 0
  const intentar = async (fn: () => Promise<unknown>) => {
    const sp = `sp_${++n}`
    await db.exec(`savepoint ${sp}`)
    try {
      await fn()
      await db.exec(`release savepoint ${sp}`)
      return null
    } catch (e: any) {
      await db.exec(`rollback to savepoint ${sp}`)
      return e instanceof Error ? e : new Error(String(e))
    }
  }
  return { db, version, exec, q, aplicarArchivo, comoUsuario, comoAnon, enTransaccion, intentar, cerrar: () => db.close() }
}
