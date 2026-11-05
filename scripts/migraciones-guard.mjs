#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// GUARD DE MIGRACIONES — impide aplicar migraciones viejas sobre producción.
//
// Modo local (por defecto, no toca ninguna base):
//   node scripts/migraciones-guard.mjs
//   - nombres con formato inválido (p. ej. `20260725_x.sql`, sin hora, que
//     ordena mal frente a `20260725230000_x.sql`, u horas fuera de rango);
//   - versiones duplicadas (dos archivos con el mismo número);
//   - archivos `_rollback.sql` dentro de supabase/migrations (un `db reset`
//     los correría como migraciones);
//   - migraciones NUEVAS con número menor o igual al piso del mapa
//     (docs/migraciones/mapa-historial.json) o al de la rama base (--base).
//   Lo que ya está en el mapa (historia legada) sólo genera avisos; lo nuevo
//   genera errores y el proceso sale con código 1.
//
// Modo remoto (opcional, SÓLO LECTURA):
//   node scripts/migraciones-guard.mjs --remoto --db-url "$URL_SOLO_LECTURA"
//   node scripts/migraciones-guard.mjs --remoto --historial-remoto historial.json
//   Compara los archivos locales con supabase_migrations.schema_migrations y
//   ABORTA si un `supabase db push` intentaría aplicar migraciones pendientes
//   más viejas que la última registrada, o migraciones que el mapa marca como
//   ya aplicadas a mano. Con --db-url usa `psql` con
//   default_transaction_read_only=on y sólo ejecuta un SELECT. La URL nunca
//   se imprime.
//
// Flags: --dir <carpeta> --mapa <json> --base <git-ref> --json
// ═══════════════════════════════════════════════════════════════════════════

import { readFileSync, readdirSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { pathToFileURL } from 'url'

export const PATRON_CANONICO = /^(\d{14})_([a-z0-9_]+)\.sql$/
const PATRON_CLI = /^(\d+)_(.*)\.sql$/

const ESTADOS_YA_APLICADOS = new Set([
  'APLICADA_A_MANO_SIN_REGISTRO',
  'REGISTRADA_OTRA_VERSION',
  'REGISTRADA_MISMA_VERSION',
])

function fechaHoraValida(v) {
  const anio = +v.slice(0, 4), mes = +v.slice(4, 6), dia = +v.slice(6, 8)
  const hh = +v.slice(8, 10), mi = +v.slice(10, 12), ss = +v.slice(12, 14)
  if (mes < 1 || mes > 12 || dia < 1) return false
  const diasMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate()
  if (dia > diasMes) return false
  return hh <= 23 && mi <= 59 && ss <= 59
}

/** Describe un nombre de archivo de migración. */
export function parsearArchivo(nombre) {
  const cli = nombre.match(PATRON_CLI)
  const version = cli ? cli[1] : null
  let formato = 'OK'
  let detalle = null
  if (!nombre.endsWith('.sql')) { formato = 'NO_SQL'; detalle = 'no termina en .sql' }
  else if (!cli) { formato = 'SIN_VERSION'; detalle = 'no empieza con <número>_' }
  else if (version.length === 8) { formato = 'SIN_HORA'; detalle = `versión ${version} sin hora: ordena antes que cualquier ${version}HHMMSS y choca con otros archivos del mismo día` }
  else if (version.length !== 14) { formato = 'LARGO_INVALIDO'; detalle = `versión de ${version.length} dígitos (se esperan 14: AAAAMMDDHHMMSS)` }
  else if (!fechaHoraValida(version)) { formato = 'FECHA_HORA_INVALIDA'; detalle = `${version} no es una fecha/hora real` }
  else if (!PATRON_CANONICO.test(nombre)) { formato = 'NOMBRE_INVALIDO'; detalle = 'el nombre sólo admite minúsculas, dígitos y _' }
  return { archivo: nombre, version, formato, detalle, esRollback: /_rollback\.sql$/i.test(nombre) }
}

/** Mapa → { conocidos: Map archivo→fila, piso } */
export function prepararMapa(mapa) {
  const conocidos = new Map()
  for (const fila of mapa?.archivos ?? []) conocidos.set(fila.archivo, fila)
  let piso = mapa?.piso_version ?? null
  for (const f of conocidos.keys()) {
    const v = parsearArchivo(f).version
    if (v && v.length === 14 && (!piso || v > piso)) piso = v
  }
  return { conocidos, piso }
}

/**
 * Análisis local.
 * @param {string[]} archivos nombres dentro de supabase/migrations
 * @param {object} mapa contenido de mapa-historial.json
 * @param {{ archivosBase?: string[] }} opciones archivosBase = los de la rama base (--base)
 */
export function analizarLocal(archivos, mapa, opciones = {}) {
  const errores = []
  const avisos = []
  const { conocidos, piso: pisoMapa } = prepararMapa(mapa)
  const base = opciones.archivosBase ? new Set(opciones.archivosBase) : null
  let piso = pisoMapa
  if (base) for (const f of base) {
    const v = parsearArchivo(f).version
    if (v && v.length === 14 && (!piso || v > piso)) piso = v
  }
  const esLegado = f => conocidos.has(f) || (base ? base.has(f) : false)
  const sql = archivos.filter(f => !f.startsWith('.'))
  const porVersion = new Map()
  const nuevos = []

  for (const f of sql) {
    const p = parsearArchivo(f)
    const legado = esLegado(f)
    if (!legado) nuevos.push(f)
    const reportar = legado ? avisos : errores
    if (p.formato !== 'OK') reportar.push({ regla: 'formato', archivo: f, mensaje: `${f}: ${p.detalle}` })
    if (p.esRollback) reportar.push({ regla: 'rollback', archivo: f, mensaje: `${f}: un rollback no va en supabase/migrations (va en supabase/rollback/)` })
    if (p.version) {
      if (!porVersion.has(p.version)) porVersion.set(p.version, [])
      porVersion.get(p.version).push(f)
    }
    if (!legado && p.version && piso && p.version <= piso) {
      errores.push({ regla: 'version_vieja', archivo: f, mensaje: `${f}: migración nueva con versión ${p.version} <= ${piso} (última conocida). Renumerala con una fecha posterior.` })
    }
  }
  for (const [version, grupo] of porVersion) {
    if (grupo.length < 2) continue
    const todosLegados = grupo.every(esLegado)
    ;(todosLegados ? avisos : errores).push({ regla: 'duplicada', archivo: grupo.join(', '), mensaje: `versión ${version} repetida en ${grupo.length} archivos: ${grupo.join(', ')}` })
  }
  for (const f of conocidos.keys()) {
    if (!sql.includes(f)) avisos.push({ regla: 'mapa_sin_archivo', archivo: f, mensaje: `${f} figura en el mapa pero ya no está en supabase/migrations (¿se movió o renombró? actualizá el mapa)` })
  }
  return { errores, avisos, nuevos, piso }
}

/**
 * Análisis contra el historial remoto: qué haría `supabase db push`.
 * @param {string[]} archivos
 * @param {string[]} versionesRemotas
 * @param {object} mapa
 */
export function analizarRemoto(archivos, versionesRemotas, mapa) {
  const errores = []
  const avisos = []
  const { conocidos } = prepararMapa(mapa)
  const remotas = new Set(versionesRemotas.map(String))
  const maxRemota = [...remotas].sort().at(-1) ?? null
  const locales = new Map()
  for (const f of archivos) {
    const v = parsearArchivo(f).version
    if (!v) continue
    if (!locales.has(v)) locales.set(v, [])
    locales.get(v).push(f)
  }
  const pendientes = []
  for (const [v, grupo] of [...locales].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (remotas.has(v)) continue
    pendientes.push(v)
    const estados = grupo.map(f => conocidos.get(f)?.estado).filter(Boolean)
    if (estados.some(e => ESTADOS_YA_APLICADOS.has(e))) {
      errores.push({ regla: 'pendiente_ya_aplicada', archivo: grupo.join(', '), mensaje: `${grupo.join(', ')}: el mapa dice que ya está en la base (${estados.join('/')}) pero no figura en el historial; db push la volvería a ejecutar. Registrala con migration repair --status applied ${v}.` })
    } else if (maxRemota && v < maxRemota) {
      errores.push({ regla: 'pendiente_antigua', archivo: grupo.join(', '), mensaje: `${grupo.join(', ')}: pendiente con versión ${v} anterior a la última registrada (${maxRemota}); un push la aplicaría fuera de orden.` })
    }
  }
  const soloRemotas = [...remotas].filter(v => !locales.has(v)).sort()
  if (soloRemotas.length) avisos.push({ regla: 'solo_remota', archivo: null, mensaje: `${soloRemotas.length} versiones registradas sin archivo local (filas "MCP"): ${soloRemotas.join(' ')}. La CLI rechaza db push mientras existan.` })
  return { errores, avisos, pendientes, soloRemotas, maxRemota }
}

/** Lee un historial exportado: JSON ([{version}], ["v"], {versions:[...]}) o texto (una versión por línea, `version|name` o tabla de `migration list`). */
export function parsearHistorialRemoto(texto) {
  const t = texto.trim()
  if (!t) return []
  if (t.startsWith('[') || t.startsWith('{')) {
    const j = JSON.parse(t)
    const lista = Array.isArray(j) ? j : (j.versions ?? j.remoto ?? j.rows ?? [])
    return lista.map(x => (typeof x === 'object' && x !== null ? String(x.version) : String(x))).filter(v => /^\d+$/.test(v))
  }
  const out = []
  const lineas = t.split(/\r?\n/)
  // `supabase migration list` imprime una tabla  Local | Remote | Time:
  // sólo cuenta la columna Remote.
  const esTablaCli = lineas.some(l => /\bLocal\b/.test(l) && /\bRemote\b/.test(l))
  for (const linea of lineas) {
    if (esTablaCli) {
      const cols = linea.split('|').map(s => s.trim())
      if (cols.length >= 2 && /^\d{8,14}$/.test(cols[1])) out.push(cols[1])
      continue
    }
    const m = linea.match(/^\s*(\d{8,14})\s*(\||$)/)
    if (m) out.push(m[1])
  }
  return out
}

/** Consulta de sólo lectura con psql. Nunca imprime la URL. */
export function leerHistorialDesdeDb(dbUrl, spawn = spawnSync) {
  const r = spawn('psql', [dbUrl, '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c',
    'select version from supabase_migrations.schema_migrations order by version'], {
    encoding: 'utf8',
    env: { ...process.env, PGOPTIONS: '-c default_transaction_read_only=on' },
  })
  if (r.error) throw new Error('No se pudo ejecutar psql (¿está instalado?). Alternativa: exportá el historial y usá --historial-remoto <archivo>.')
  if (r.status !== 0) throw new Error('psql devolvió un error al leer el historial (la URL no se muestra): ' + String(r.stderr || '').replace(/postgres(ql)?:\/\/\S+/g, '<url>').trim())
  return parsearHistorialRemoto(r.stdout)
}

function archivosDeRef(ref, dir, cwd) {
  const r = spawnSync('git', ['ls-tree', '--name-only', ref, dir.replace(/\\/g, '/') + '/'], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ls-tree ${ref} falló: ${r.stderr}`)
  return r.stdout.split(/\r?\n/).filter(Boolean).map(p => p.split('/').pop())
}

function leerArgs(argv) {
  const a = { dir: 'supabase/migrations', mapa: 'docs/migraciones/mapa-historial.json', remoto: false, json: false }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    if (k === '--remoto') a.remoto = true
    else if (k === '--json') a.json = true
    else if (['--dir', '--mapa', '--base', '--db-url', '--historial-remoto'].includes(k)) a[k.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i]
    else if (k === '--help' || k === '-h') a.ayuda = true
    else throw new Error(`flag desconocido: ${k}`)
  }
  return a
}

export function main(argv = process.argv.slice(2), cwd = process.cwd(), log = console.log) {
  const a = leerArgs(argv)
  if (a.ayuda) { log('uso: node scripts/migraciones-guard.mjs [--dir d] [--mapa m.json] [--base origin/main] [--remoto (--db-url URL | --historial-remoto archivo)] [--json]'); return 0 }
  const dir = resolve(cwd, a.dir)
  const archivos = readdirSync(dir).filter(f => !f.startsWith('.')).sort()
  const rutaMapa = resolve(cwd, a.mapa)
  const mapa = existsSync(rutaMapa) ? JSON.parse(readFileSync(rutaMapa, 'utf8')) : null
  const errores = []
  const avisos = []
  if (!mapa) errores.push({ regla: 'mapa', archivo: null, mensaje: `no se encontró el mapa ${a.mapa}` })
  const archivosBase = a.base ? archivosDeRef(a.base, a.dir, cwd) : undefined
  const local = analizarLocal(archivos, mapa, { archivosBase })
  errores.push(...local.errores); avisos.push(...local.avisos)
  let remoto = null
  if (a.remoto) {
    const url = a.dbUrl || process.env.MIGRACIONES_GUARD_DB_URL
    let versiones
    if (a.historialRemoto) versiones = parsearHistorialRemoto(readFileSync(resolve(cwd, a.historialRemoto), 'utf8'))
    else if (url) versiones = leerHistorialDesdeDb(url)
    else throw new Error('--remoto necesita --db-url (o MIGRACIONES_GUARD_DB_URL) o --historial-remoto <archivo>')
    remoto = analizarRemoto(archivos.filter(f => f.endsWith('.sql')), versiones, mapa)
    errores.push(...remoto.errores); avisos.push(...remoto.avisos)
  }
  if (a.json) {
    log(JSON.stringify({ ok: errores.length === 0, errores, avisos, nuevos: local.nuevos, piso: local.piso, pendientes: remoto?.pendientes ?? null }, null, 2))
  } else {
    log(`Migraciones: ${archivos.length} archivos · piso ${local.piso} · nuevas (fuera del mapa): ${local.nuevos.length ? local.nuevos.join(', ') : 'ninguna'}`)
    if (remoto) log(`Historial remoto: última ${remoto.maxRemota} · pendientes según la CLI: ${remoto.pendientes.length}`)
    log(`Avisos (historia legada, no bloquean): ${avisos.length}`)
    for (const e of avisos) log(`  aviso [${e.regla}] ${e.mensaje}`)
    if (errores.length) {
      log(`ERRORES: ${errores.length}`)
      for (const e of errores) log(`  ERROR [${e.regla}] ${e.mensaje}`)
      if (remoto) log('NO ejecutes `supabase db push`. Ver docs/migraciones/PROCEDIMIENTO-NORMALIZACION.md')
    } else log('OK: sin errores.')
  }
  return errores.length ? 1 : 0
}

const directo = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (directo) {
  try { process.exitCode = main() } catch (e) { console.error('migraciones-guard:', e.message); process.exitCode = 2 }
}
