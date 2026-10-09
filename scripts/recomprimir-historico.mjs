// Recompresión de fotografías históricas de SUPERVISIÓN, con respaldo y reversión.
// BORRADOR — NO EJECUTADO. Requiere la migración 20261009120000 aplicada y un
// lote APROBADO por Gerencia (storage_recompresion_aprobar).
//
// Uso (desde SRV02 o una PC de Administración, con service_role en el entorno):
//   node scripts/recomprimir-historico.mjs simular  [--min-kb 900] [--limite 2000] [--muestra 20 --carpeta <fuera del repo>]
//   node scripts/recomprimir-historico.mjs proponer [--min-kb 900] --limite 10 --piloto      (escribe el lote propuesto)
//   node scripts/recomprimir-historico.mjs ejecutar --lote <uuid> [--max 50]
//   node scripts/recomprimir-historico.mjs revertir --lote <uuid> [--ruta <ruta>]
//   node scripts/recomprimir-historico.mjs informe  --lote <uuid>
//
// `simular` e `informe` sólo leen. `proponer`, `ejecutar` y `revertir`
// escriben y además exigen CONFIRMO_RECOMPRESION=si en el entorno.
//
// Garantías:
//   * SÓLO el bucket supervision-fotos (no rondas, fichajes, IA ni legajo);
//   * se ejecuta EXACTAMENTE la lista aprobada; un archivo cuyo eTag cambió
//     desde la aprobación se omite;
//   * el original queda en el bucket privado `respaldo-recompresion` ANTES de
//     reemplazar, y se verifica volviéndolo a descargar (SHA-256);
//   * si la versión nueva no ahorra al menos 40% o no decodifica, se omite;
//   * el reemplazo es en la MISMA ruta y se verifica volviéndolo a descargar;
//   * todo queda en `storage_recompresion` (bytes, SHA-256, dimensiones);
//   * el respaldo NO se borra automáticamente.
// Depende de `sharp` (instalar SÓLO en la máquina que corre el script, no en la app).
import { createHash } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export const BUCKET = 'supervision-fotos'
export const RESPALDO = 'respaldo-recompresion'
export const PARAMETROS = { ladoMayor: 1600, calidad: 75, ahorroMinimo: 0.4 }
export const sha = b => createHash('sha256').update(b).digest('hex')

/** Lista exacta que se propone a Gerencia (lo que después se ejecuta). */
export function armarLote(candidatos, { piloto = false } = {}) {
  const rutas = candidatos.map(c => ({ ruta: c.name, bytes: Number(c.bytes), etag: c.etag ?? null }))
  const bytesAntes = rutas.reduce((a, r) => a + r.bytes, 0)
  return {
    bucket: BUCKET, parametros: PARAMETROS, rutas, candidatos: rutas.length, bytes_antes: bytesAntes,
    // Medido en la auditoría K: ~300 KB por foto a 1600 px / 75.
    bytes_despues_estimado: Math.round(rutas.length * 300 * 1024), es_piloto: piloto,
  }
}

/** ¿Se puede reemplazar este archivo? Devuelve el motivo para omitirlo o null. */
export function motivoParaOmitir({ etagAprobado, etagActual, bytesAntes, bytesNuevos, dimsNuevas }) {
  if (etagAprobado && etagActual && etagAprobado !== etagActual) return 'cambió desde la aprobación (eTag distinto)'
  if (!dimsNuevas || /^0x|x0$/.test(dimsNuevas)) return 'la versión nueva no decodifica'
  if (bytesNuevos > bytesAntes * (1 - PARAMETROS.ahorroMinimo)) return 'ahorro insuficiente'
  return null
}

const args = Object.fromEntries(process.argv.slice(3).reduce((a, v, i, arr) =>
  v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : a, []))
const accion = process.argv[2]

async function cliente() {
  const { createClient } = await import('@supabase/supabase-js')
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY')
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

function exigirConfirmacion() {
  if (process.env.CONFIRMO_RECOMPRESION !== 'si') {
    console.error('Esta acción escribe en producción: hace falta CONFIRMO_RECOMPRESION=si (autorización expresa).')
    process.exit(2)
  }
}

async function sharp() { return (await import('sharp')).default }

export async function recomprimir(buf) {
  const s = await sharp()
  const img = s(buf, { failOn: 'error' }).rotate() // aplica orientación EXIF
  const meta = await img.metadata()
  const out = await img.resize({ width: PARAMETROS.ladoMayor, height: PARAMETROS.ladoMayor, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: PARAMETROS.calidad, mozjpeg: true }).toBuffer({ resolveWithObject: true })
  // Que la versión nueva se pueda volver a leer.
  const control = await s(out.data).metadata()
  return { buf: out.data, dimsAntes: `${meta.width}x${meta.height}`, dimsDespues: `${control.width ?? 0}x${control.height ?? 0}` }
}

async function candidatos(db, minBytes, limite) {
  const { data, error } = await db.rpc('storage_recompresion_candidatos', { p_min_bytes: minBytes, p_limite: limite })
  if (error) throw new Error(error.message)
  return data ?? []
}

async function bajar(db, bucket, ruta) {
  const { data, error } = await db.storage.from(bucket).download(ruta)
  if (error || !data) return null
  return Buffer.from(await data.arrayBuffer())
}

async function simular() {
  const db = await cliente()
  const lista = await candidatos(db, Number(args['min-kb'] ?? 900) * 1024, Number(args.limite ?? 2000))
  const lote = armarLote(lista)
  const informe = { modo: 'SIMULACIÓN (no escribe nada)', candidatos: lote.candidatos, gb_antes: +(lote.bytes_antes / 1e9).toFixed(2),
    gb_despues_estimado: +(lote.bytes_despues_estimado / 1e9).toFixed(2), muestra: null }
  // Opcional: medir el ahorro real recomprimiendo una muestra EN ESTA PC (no se sube nada).
  if (args.muestra) {
    const n = Math.min(Number(args.muestra), lista.length)
    const pasos = Math.max(1, Math.floor(lista.length / n))
    const medidas = []
    for (let i = 0; i < lista.length && medidas.length < n; i += pasos) {
      const original = await bajar(db, BUCKET, lista[i].name)
      if (!original) continue
      const nuevo = await recomprimir(original)
      medidas.push({ antes: original.length, despues: nuevo.buf.length, dims: `${nuevo.dimsAntes}→${nuevo.dimsDespues}` })
      if (typeof args.carpeta === 'string') {
        mkdirSync(args.carpeta, { recursive: true })
        writeFileSync(join(args.carpeta, `${medidas.length}-original.jpg`), original)
        writeFileSync(join(args.carpeta, `${medidas.length}-nueva.jpg`), nuevo.buf)
      }
    }
    const antes = medidas.reduce((a, m) => a + m.antes, 0), despues = medidas.reduce((a, m) => a + m.despues, 0)
    informe.muestra = { fotos: medidas.length, ahorro: antes ? +(1 - despues / antes).toFixed(3) : null,
      gb_despues_proyectado: antes ? +((lote.bytes_antes * despues / antes) / 1e9).toFixed(2) : null, medidas }
  }
  console.log(JSON.stringify(informe, null, 2))
}

async function proponer() {
  exigirConfirmacion()
  const db = await cliente()
  const lista = await candidatos(db, Number(args['min-kb'] ?? 900) * 1024, Number(args.limite ?? 10))
  if (!lista.length) { console.log('No hay candidatos.'); return }
  const { data, error } = await db.from('storage_recompresion_lote').insert(armarLote(lista, { piloto: !!args.piloto })).select('id, candidatos, bytes_antes').single()
  if (error) throw new Error(error.message)
  console.log(`Lote ${data.id}${args.piloto ? ' (PILOTO)' : ''}: ${data.candidatos} fotos, ${(data.bytes_antes / 1e6).toFixed(1)} MB. Falta la aprobación de Gerencia.`)
}

async function ejecutar() {
  exigirConfirmacion()
  const r = await ejecutarLote(await cliente(), args.lote, { max: args.max ? Number(args.max) : undefined })
  console.log(JSON.stringify(r, null, 2))
}

/** Pasos 5–11 sobre la lista aprobada. Inyectable para probarlo sin producción. */
export async function ejecutarLote(db, loteId, { max, recomprimirFn = recomprimir } = {}) {
  const { data: lote } = await db.from('storage_recompresion_lote').select('*').eq('id', loteId).single()
  if (!lote || !['aprobado', 'ejecutando'].includes(lote.estado)) throw new Error('El lote no está aprobado por Gerencia')
  await db.from('storage_recompresion_lote').update({ estado: 'ejecutando' }).eq('id', lote.id)
  const { data: hechos } = await db.from('storage_recompresion').select('ruta, estado').eq('lote_id', lote.id)
  const yaHechos = new Set((hechos ?? []).filter(h => h.estado !== 'respaldado').map(h => h.ruta))
  const pendientes = lote.rutas.filter(r => !yaHechos.has(r.ruta)).slice(0, max ?? lote.rutas.length)
  const res = { reemplazados: 0, omitidos: 0, errores: 0 }
  const registrar = (fila, extra) => db.from('storage_recompresion').upsert({ ...fila, ...extra }, { onConflict: 'lote_id,bucket,ruta' })

  for (const item of pendientes) {
    const respaldo = `${BUCKET}/${item.ruta}`
    // eTag actual: si cambió desde la aprobación, no se toca.
    const carpeta = item.ruta.includes('/') ? item.ruta.slice(0, item.ruta.lastIndexOf('/')) : ''
    const nombre = item.ruta.slice(item.ruta.lastIndexOf('/') + 1)
    const { data: info } = await db.storage.from(BUCKET).list(carpeta, { search: nombre, limit: 5 })
    const etagActual = info?.find(f => f.name === nombre)?.metadata?.eTag ?? null
    const original = await bajar(db, BUCKET, item.ruta)
    if (!original) { res.errores++; console.error('no se pudo descargar', item.ruta); continue }
    const fila = { lote_id: lote.id, bucket: BUCKET, ruta: item.ruta, bytes_antes: original.length, sha256_antes: sha(original), etag_antes: etagActual, respaldo_ruta: respaldo }

    // 6-7) respaldo verificado (si ya existía, tiene que ser idéntico)
    const { error: eResp } = await db.storage.from(RESPALDO).upload(respaldo, original, { upsert: false, contentType: 'image/jpeg' })
    if (eResp && !/exists|duplicate/i.test(eResp.message)) { res.errores++; await registrar(fila, { estado: 'error', motivo: 'respaldo: ' + eResp.message }); continue }
    const copia = await bajar(db, RESPALDO, respaldo)
    if (!copia || sha(copia) !== fila.sha256_antes) { res.errores++; await registrar(fila, { estado: 'error', motivo: 'el respaldo no coincide con el original' }); continue }
    await registrar(fila, { estado: 'respaldado' })

    // 8-9) recomprimir y decidir
    let nuevo
    try { nuevo = await recomprimirFn(original) } catch (e) { res.omitidos++; await registrar(fila, { estado: 'omitido', motivo: 'no decodifica: ' + e.message }); continue }
    const motivo = motivoParaOmitir({ etagAprobado: item.etag, etagActual, bytesAntes: original.length, bytesNuevos: nuevo.buf.length, dimsNuevas: nuevo.dimsDespues })
    if (motivo) { res.omitidos++; await registrar(fila, { estado: 'omitido', motivo, dims_antes: nuevo.dimsAntes }); continue }

    // 10) reemplazo en la MISMA ruta, verificado
    const { error: eRepl } = await db.storage.from(BUCKET).upload(item.ruta, nuevo.buf, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' })
    if (eRepl) { res.errores++; await registrar(fila, { estado: 'error', motivo: 'reemplazo: ' + eRepl.message }); continue }
    const subida = await bajar(db, BUCKET, item.ruta)
    if (!subida || sha(subida) !== sha(nuevo.buf)) {
      // Lo subido no es lo esperado: se vuelve al original enseguida.
      await db.storage.from(BUCKET).upload(item.ruta, original, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' })
      const restaurado = await bajar(db, BUCKET, item.ruta)
      const motivoError = restaurado && sha(restaurado) === fila.sha256_antes
        ? 'la versión subida no coincide; se restauró el original'
        : 'ATENCIÓN: la versión subida no coincide y no se pudo verificar la restauración; el original está en el respaldo'
      res.errores++; await registrar(fila, { estado: 'error', motivo: motivoError }); continue
    }
    // 11) registro
    await registrar(fila, {
      estado: 'reemplazado', bytes_despues: nuevo.buf.length, sha256_despues: sha(nuevo.buf),
      dims_antes: nuevo.dimsAntes, dims_despues: nuevo.dimsDespues, reemplazado_at: new Date().toISOString(),
    })
    res.reemplazados++
  }
  const quedan = lote.rutas.length - yaHechos.size - pendientes.length
  if (quedan <= 0) await db.from('storage_recompresion_lote').update({ estado: 'ejecutado', ejecutado_at: new Date().toISOString() }).eq('id', lote.id)
  return { lote: lote.id, ...res, quedan: Math.max(0, quedan) }
}

async function revertir() {
  exigirConfirmacion()
  const r = await revertirLote(await cliente(), args.lote, typeof args.ruta === 'string' ? args.ruta : null)
  console.log(JSON.stringify(r, null, 2))
}

/** Paso 12: reversión por archivo o por lote, verificando el respaldo. */
export async function revertirLote(db, loteId, ruta = null) {
  let q = db.from('storage_recompresion').select('*').eq('lote_id', loteId).eq('estado', 'reemplazado')
  if (ruta) q = q.eq('ruta', ruta)
  const { data: filas } = await q
  const res = { revertidos: 0, errores: 0 }
  for (const f of filas ?? []) {
    const buf = await bajar(db, RESPALDO, f.respaldo_ruta)
    if (!buf) { res.errores++; console.error('sin respaldo', f.ruta); continue }
    if (sha(buf) !== f.sha256_antes) { res.errores++; console.error('respaldo alterado', f.ruta); continue }
    const { error } = await db.storage.from(f.bucket).upload(f.ruta, buf, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' })
    const vuelta = error ? null : await bajar(db, f.bucket, f.ruta)
    if (!vuelta || sha(vuelta) !== f.sha256_antes) { res.errores++; console.error('no se pudo verificar la reversión', f.ruta); continue }
    await db.from('storage_recompresion').update({ estado: 'revertido', revertido_at: new Date().toISOString() }).eq('id', f.id)
    res.revertidos++
  }
  if (!ruta && res.errores === 0) await db.from('storage_recompresion_lote').update({ estado: 'revertido' }).eq('id', loteId)
  return res
}

async function informe() {
  const db = await cliente()
  const { data: lote } = await db.from('storage_recompresion_lote').select('id, estado, candidatos, bytes_antes, es_piloto, aprobado_at').eq('id', args.lote).single()
  const { data: filas } = await db.from('storage_recompresion').select('estado, bytes_antes, bytes_despues, motivo').eq('lote_id', args.lote)
  const r = { lote, por_estado: {}, mb_antes: 0, mb_despues: 0, motivos: {} }
  for (const f of filas ?? []) {
    r.por_estado[f.estado] = (r.por_estado[f.estado] ?? 0) + 1
    if (f.estado === 'reemplazado') { r.mb_antes += f.bytes_antes / 1e6; r.mb_despues += f.bytes_despues / 1e6 }
    if (f.motivo) r.motivos[f.motivo] = (r.motivos[f.motivo] ?? 0) + 1
  }
  r.mb_antes = +r.mb_antes.toFixed(1); r.mb_despues = +r.mb_despues.toFixed(1)
  console.log(JSON.stringify(r, null, 2))
}

const acciones = { simular, proponer, ejecutar, revertir, informe }
if (process.argv[1]?.endsWith('recomprimir-historico.mjs')) {
  if (!acciones[accion]) { console.error('Acción: simular | proponer | ejecutar | revertir | informe'); process.exit(1) }
  acciones[accion]().catch(e => { console.error(e.message ?? e); process.exit(1) })
}
