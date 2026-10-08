#!/usr/bin/env node
// Recompresión de fotografías históricas con respaldo y reversión.
// BORRADOR — NO EJECUTADO. Requiere la migración 20261009120000 aplicada y un
// lote APROBADO por Gerencia (storage_recompresion_aprobar).
//
// Uso (desde SRV02 o una PC de Administración, con service_role en el entorno):
//   node scripts/recomprimir-historico.mjs simular  --bucket supervision-fotos --min-kb 900 --limite 200
//   node scripts/recomprimir-historico.mjs ejecutar --lote <uuid> [--limite 200]
//   node scripts/recomprimir-historico.mjs revertir --lote <uuid> [--ruta <ruta>]
//
// Garantías:
//   * misma ruta → las filas de la base no cambian;
//   * el original queda en el bucket privado `respaldo-recompresion` ANTES de reemplazar;
//   * si la versión nueva no ahorra al menos 40% o no se puede decodificar, se omite;
//   * nunca toca `ia-referencias` ni archivos con `evidencias.contenido_sha256` cargado;
//   * todo queda en `storage_recompresion` (bytes, SHA-256 antes y después).
// Depende de `sharp` (instalar SÓLO en la máquina que corre el script, no en la app).
import { createHash } from 'crypto'
import { createClient } from '@supabase/supabase-js'

const BUCKETS_PERMITIDOS = new Set(['supervision-fotos', 'ronda-evidencias', 'ingreso-evidencias'])
const PARAMETROS = { ladoMayor: 1600, calidad: 75, ahorroMinimo: 0.4 }
const RESPALDO = 'respaldo-recompresion'

const args = Object.fromEntries(process.argv.slice(3).reduce((a, v, i, arr) => v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a, []))
const accion = process.argv[2]
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const sha = b => createHash('sha256').update(b).digest('hex')

async function sharp() { return (await import('sharp')).default }

async function recomprimir(buf) {
  const s = await sharp()
  const img = s(buf, { failOn: 'error' }).rotate() // aplica orientación EXIF
  const meta = await img.metadata()
  const out = await img.resize({ width: PARAMETROS.ladoMayor, height: PARAMETROS.ladoMayor, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: PARAMETROS.calidad, mozjpeg: true }).toBuffer({ resolveWithObject: true })
  return { buf: out.data, dimsAntes: `${meta.width}x${meta.height}`, dimsDespues: `${out.info.width}x${out.info.height}` }
}

async function candidatos(bucket, minBytes, limite) {
  // Archivos grandes del bucket, sin hash registrado en evidencias.
  const { data, error } = await db.rpc('storage_recompresion_candidatos', { p_bucket: bucket, p_min_bytes: minBytes, p_limite: limite })
  if (error) throw error
  return data // [{ name, bytes, etag }]
}

async function simular() {
  const bucket = args.bucket
  if (!BUCKETS_PERMITIDOS.has(bucket)) throw new Error('Bucket no permitido')
  const lista = await candidatos(bucket, Number(args['min-kb'] ?? 900) * 1024, Number(args.limite ?? 200))
  const bytesAntes = lista.reduce((a, x) => a + x.bytes, 0)
  const { data: lote, error } = await db.from('storage_recompresion_lote').insert({
    bucket, parametros: PARAMETROS, candidatos: lista.length, bytes_antes: bytesAntes,
    bytes_despues_estimado: Math.round(lista.length * 300 * 1024),
  }).select('id').single()
  if (error) throw error
  console.log(`Lote ${lote.id}: ${lista.length} fotos, ${(bytesAntes / 1e9).toFixed(2)} GB. Falta la aprobación de Gerencia.`)
}

async function ejecutar() {
  const { data: lote } = await db.from('storage_recompresion_lote').select('*').eq('id', args.lote).single()
  if (!lote || lote.estado !== 'aprobado') throw new Error('El lote no está aprobado por Gerencia')
  await db.from('storage_recompresion_lote').update({ estado: 'ejecutando' }).eq('id', lote.id)
  const lista = await candidatos(lote.bucket, 0, Number(args.limite ?? lote.candidatos))
  for (const obj of lista) {
    const { data: blob, error: e1 } = await db.storage.from(lote.bucket).download(obj.name)
    if (e1) { console.error('descarga', obj.name, e1.message); continue }
    const original = Buffer.from(await blob.arrayBuffer())
    const shaAntes = sha(original)
    // 1) respaldo (si ya existe con el mismo contenido, sigue)
    const { error: e2 } = await db.storage.from(RESPALDO).upload(`${lote.bucket}/${obj.name}`, original, { upsert: false, contentType: blob.type || 'image/jpeg' })
    if (e2 && !/exists/i.test(e2.message)) { console.error('respaldo', obj.name, e2.message); continue }
    const fila = { lote_id: lote.id, bucket: lote.bucket, ruta: obj.name, bytes_antes: original.length, sha256_antes: shaAntes, etag_antes: obj.etag, respaldo_ruta: `${lote.bucket}/${obj.name}` }
    let nuevo
    try { nuevo = await recomprimir(original) } catch (e) {
      await db.from('storage_recompresion').upsert({ ...fila, estado: 'omitido', motivo: 'no decodifica: ' + e.message }, { onConflict: 'lote_id,bucket,ruta' }); continue
    }
    if (nuevo.buf.length > original.length * (1 - PARAMETROS.ahorroMinimo)) {
      await db.from('storage_recompresion').upsert({ ...fila, estado: 'omitido', motivo: 'ahorro insuficiente', dims_antes: nuevo.dimsAntes }, { onConflict: 'lote_id,bucket,ruta' }); continue
    }
    // 2) reemplazo en la MISMA ruta
    const { error: e3 } = await db.storage.from(lote.bucket).upload(obj.name, nuevo.buf, { upsert: true, contentType: 'image/jpeg' })
    if (e3) { await db.from('storage_recompresion').upsert({ ...fila, estado: 'error', motivo: e3.message }, { onConflict: 'lote_id,bucket,ruta' }); continue }
    await db.from('storage_recompresion').upsert({
      ...fila, estado: 'reemplazado', bytes_despues: nuevo.buf.length, sha256_despues: sha(nuevo.buf),
      dims_antes: nuevo.dimsAntes, dims_despues: nuevo.dimsDespues, reemplazado_at: new Date().toISOString(),
    }, { onConflict: 'lote_id,bucket,ruta' })
  }
  await db.from('storage_recompresion_lote').update({ estado: 'ejecutado', ejecutado_at: new Date().toISOString() }).eq('id', lote.id)
}

async function revertir() {
  let q = db.from('storage_recompresion').select('*').eq('lote_id', args.lote).eq('estado', 'reemplazado')
  if (args.ruta) q = q.eq('ruta', args.ruta)
  const { data: filas } = await q
  for (const f of filas ?? []) {
    const { data: blob, error } = await db.storage.from(RESPALDO).download(f.respaldo_ruta)
    if (error) { console.error('sin respaldo', f.ruta); continue }
    const buf = Buffer.from(await blob.arrayBuffer())
    if (sha(buf) !== f.sha256_antes) { console.error('respaldo alterado', f.ruta); continue }
    await db.storage.from(f.bucket).upload(f.ruta, buf, { upsert: true, contentType: blob.type || 'image/jpeg' })
    await db.from('storage_recompresion').update({ estado: 'revertido', revertido_at: new Date().toISOString() }).eq('id', f.id)
  }
  if (!args.ruta) await db.from('storage_recompresion_lote').update({ estado: 'revertido' }).eq('id', args.lote)
}

const acciones = { simular, ejecutar, revertir }
if (!acciones[accion]) { console.error('Acción: simular | ejecutar | revertir'); process.exit(1) }
acciones[accion]().catch(e => { console.error(e); process.exit(1) })
