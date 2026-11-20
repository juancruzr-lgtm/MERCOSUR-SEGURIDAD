// ═══════════════════════════════════════════════════════════════════════════
// LÍNEA BASE DE TYPESCRIPT — falla sólo por errores NUEVOS.
//
// El build de Next ignora los errores de tipos (next.config.js) y main arrastra
// errores históricos. Este script compara la salida de `tsc --noEmit` con
// tsc-baseline.json (conteo por archivo y código de error):
//   - si algún archivo tiene MÁS errores de un código que en la línea base → sale 1;
//   - si tiene menos o igual → OK (los históricos no bloquean);
//   - si bajó, avisa para que se actualice la línea base (así no se puede volver a subir).
//
//   node scripts/tsc-baseline.mjs                 compara (corre tsc)
//   node scripts/tsc-baseline.mjs --actualizar    reescribe tsc-baseline.json con el estado actual
//   node scripts/tsc-baseline.mjs --desde out.txt usa una salida de tsc ya generada
//   node scripts/tsc-baseline.mjs --json          resultado en JSON
// ═══════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const RAIZ = fileURLToPath(new URL('..', import.meta.url))
export const ARCHIVO_BASE = 'tsc-baseline.json'
const LINEA = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/

/** Salida de tsc → { 'ruta/archivo.ts': { TS2339: 3, ... } } */
export function contar(salida) {
  const conteo = {}
  const detalle = []
  for (const l of salida.split(/\r?\n/)) {
    const m = l.match(LINEA)
    if (!m) continue
    const archivo = m[1].replace(/\\/g, '/').replace(/^\.\//, '')
    const codigo = m[4]
    conteo[archivo] ??= {}
    conteo[archivo][codigo] = (conteo[archivo][codigo] ?? 0) + 1
    detalle.push({ archivo, linea: +m[2], columna: +m[3], codigo, mensaje: m[5] })
  }
  return { conteo, detalle }
}

export const total = conteo => Object.values(conteo).reduce((s, c) => s + Object.values(c).reduce((a, b) => a + b, 0), 0)

/** Compara el conteo actual con la línea base. */
export function comparar(actual, base) {
  const nuevos = []
  const resueltos = []
  for (const [archivo, codigos] of Object.entries(actual)) {
    for (const [codigo, n] of Object.entries(codigos)) {
      const antes = base[archivo]?.[codigo] ?? 0
      if (n > antes) nuevos.push({ archivo, codigo, antes, ahora: n })
    }
  }
  for (const [archivo, codigos] of Object.entries(base)) {
    for (const [codigo, antes] of Object.entries(codigos)) {
      const n = actual[archivo]?.[codigo] ?? 0
      if (n < antes) resueltos.push({ archivo, codigo, antes, ahora: n })
    }
  }
  return { nuevos, resueltos }
}

function ordenar(conteo) {
  const out = {}
  for (const a of Object.keys(conteo).sort()) {
    out[a] = {}
    for (const c of Object.keys(conteo[a]).sort()) out[a][c] = conteo[a][c]
  }
  return out
}

function correrTsc(cwd) {
  const bin = join(cwd, 'node_modules', 'typescript', 'bin', 'tsc')
  const r = spawnSync(process.execPath, [bin, '--noEmit', '--pretty', 'false', '-p', 'tsconfig.json'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.error) throw r.error
  return (r.stdout || '') + (r.stderr || '')
}

export function main(argv = process.argv.slice(2), cwd = RAIZ, log = console.log) {
  const actualizar = argv.includes('--actualizar')
  const json = argv.includes('--json')
  const i = argv.indexOf('--desde')
  const salida = i >= 0 ? readFileSync(resolve(cwd, argv[i + 1]), 'utf8') : correrTsc(cwd)
  const { conteo, detalle } = contar(salida)
  if (!detalle.length && /error TS/.test(salida)) throw new Error('No se pudo interpretar la salida de tsc (¿--pretty?).')
  const rutaBase = join(cwd, ARCHIVO_BASE)

  if (actualizar) {
    writeFileSync(rutaBase, JSON.stringify({
      descripcion: 'Errores de TypeScript tolerados (históricos) por archivo y código. Lo genera `node scripts/tsc-baseline.mjs --actualizar`; CI falla si aparecen errores nuevos.',
      total: total(conteo),
      archivos: ordenar(conteo),
    }, null, 2) + '\n')
    log(`Línea base actualizada: ${total(conteo)} errores en ${Object.keys(conteo).length} archivos.`)
    return 0
  }

  if (!existsSync(rutaBase)) throw new Error(`Falta ${ARCHIVO_BASE}: generalo con --actualizar.`)
  const base = JSON.parse(readFileSync(rutaBase, 'utf8')).archivos ?? {}
  const { nuevos, resueltos } = comparar(conteo, base)
  if (json) {
    log(JSON.stringify({ ok: nuevos.length === 0, total: total(conteo), base: total(base), nuevos, resueltos }, null, 2))
    return nuevos.length ? 1 : 0
  }
  log(`TypeScript: ${total(conteo)} errores (línea base ${total(base)}).`)
  if (resueltos.length) {
    log(`Bajaron ${resueltos.length} grupos de errores; corré \`node scripts/tsc-baseline.mjs --actualizar\` y commiteá tsc-baseline.json para fijar la mejora:`)
    for (const r of resueltos) log(`  ${r.archivo} ${r.codigo}: ${r.antes} → ${r.ahora}`)
  }
  if (nuevos.length) {
    log(`ERROR: ${nuevos.length} grupos con errores NUEVOS respecto de la línea base:`)
    for (const n of nuevos) {
      log(`  ${n.archivo} ${n.codigo}: ${n.antes} → ${n.ahora}`)
      for (const d of detalle.filter(d => d.archivo === n.archivo && d.codigo === n.codigo)) log(`    ${d.archivo}(${d.linea},${d.columna}): ${d.codigo} ${d.mensaje}`)
    }
    return 1
  }
  log('OK: sin errores nuevos.')
  return 0
}

const directo = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (directo) {
  try { process.exitCode = main() } catch (e) { console.error('tsc-baseline:', e.message); process.exitCode = 2 }
}
