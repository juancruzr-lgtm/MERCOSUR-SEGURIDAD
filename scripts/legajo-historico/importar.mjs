// Legajo Digital — importación SELECTIVA del archivo histórico.
//
// Toma las propuestas que Administración ACEPTÓ en la bandeja y, por cada una:
//   1. lee el archivo de MEGA (sólo lectura: no se modifica, mueve ni borra);
//   2. verifica que su SHA-256 sea el de la propuesta (el del índice del
//      agente): si cambió, no se importa;
//   3. si es una parte de un PDF compilado, extrae esas páginas (pdf-lib);
//   4. sube la copia a legajo-documentos y registra el documento con
//      documentacion_importar_historico (origen 'historico', trazabilidad).
//
// POR DEFECTO SIMULA (no sube ni escribe nada). Para ejecutar hace falta
// autorización expresa:
//   CONFIRMO_IMPORTACION=si node scripts/legajo-historico/importar.mjs \
//     --raiz="<carpeta mercosur mega>" --lote=mega-2026-10 --max=10 --ejecutar
//
// Opciones: --lote, --max (por defecto 10), --propuestas-json=<archivo> (sólo
// simulación, para probar sin base), --reporte=<archivo fuera del repo>.

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve, sep } from 'path'
import { randomUUID } from 'crypto'
import { EXT, MAX_BYTES, argumentos, clienteServicio, contar, exigirAutorizacion, mimeReal, sha256 } from './comun.mjs'

async function extraerPaginas(buf, desde, hasta) {
  let PDFDocument
  try { ({ PDFDocument } = await import('pdf-lib')) } catch {
    throw new Error('separar páginas requiere pdf-lib (npm i --no-save pdf-lib en la máquina que importa)')
  }
  const origen = await PDFDocument.load(buf, { ignoreEncryption: false })
  if (hasta > origen.getPageCount()) throw new Error(`el PDF tiene ${origen.getPageCount()} páginas`)
  const nuevo = await PDFDocument.create()
  const paginas = await nuevo.copyPages(origen, Array.from({ length: hasta - desde + 1 }, (_, i) => desde - 1 + i))
  paginas.forEach(p => nuevo.addPage(p))
  return Buffer.from(await nuevo.save())
}

/** Prepara UNA propuesta: lee, verifica y arma la copia. No escribe nada. */
export async function prepararImportacion(p, raiz) {
  const ruta = resolve(raiz, p.ruta_origen)
  if (!ruta.startsWith(resolve(raiz) + sep)) return { ok: false, motivo: 'ruta fuera de la carpeta raíz' }
  if (!existsSync(ruta)) return { ok: false, motivo: 'el archivo ya no está en MEGA' }
  const original = readFileSync(ruta)
  const hash = sha256(original)
  if (hash !== p.hash_origen) return { ok: false, motivo: 'el archivo cambió desde la clasificación (hash distinto)' }
  let copia = original
  if (p.pagina_desde) {
    if (mimeReal(original) !== 'application/pdf') return { ok: false, motivo: 'separar páginas sólo en PDF' }
    try { copia = await extraerPaginas(original, p.pagina_desde, p.pagina_hasta) } catch (e) { return { ok: false, motivo: e.message } }
  }
  const mime = mimeReal(copia)
  if (!mime) return { ok: false, motivo: 'formato no admitido en el legajo (sólo foto o PDF)' }
  if (copia.length > MAX_BYTES) return { ok: false, motivo: 'pesa más de 15 MB' }
  return { ok: true, hashLeido: hash, copia, archivo: { mime, bytes: copia.length, sha256: sha256(copia) } }
}

async function principal() {
  const a = argumentos()
  if (!a.raiz) { console.error('Falta --raiz=<carpeta de MEGA>'); process.exit(1) }
  const max = Math.max(1, Math.min(parseInt(a.max ?? '10', 10) || 10, 500))
  const ejecutar = exigirAutorizacion(a, 'CONFIRMO_IMPORTACION')
  if (ejecutar && a['propuestas-json']) { console.error('--propuestas-json es sólo para simular'); process.exit(1) }

  let propuestas
  let db = null
  if (a['propuestas-json']) {
    propuestas = JSON.parse(readFileSync(a['propuestas-json'], 'utf8'))
  } else {
    db = await clienteServicio()
    let q = db.from('legajo_historico_propuestas')
      .select('id, lote, hash_origen, ruta_origen, pagina_desde, pagina_hasta, empleado_id, tipo')
      .eq('estado', 'aceptada').order('revisado_at').limit(max)
    if (typeof a.lote === 'string') q = q.eq('lote', a.lote)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    propuestas = data ?? []
  }
  propuestas = propuestas.slice(0, max)

  const resultado = { modo: ejecutar ? 'EJECUCIÓN' : 'SIMULACIÓN', propuestas: propuestas.length, listas: 0, importadas: 0, motivos: {}, por_tipo: {} }
  const detalle = []
  for (const p of propuestas) {
    const prep = await prepararImportacion(p, a.raiz)
    if (!prep.ok) { contar(resultado.motivos, prep.motivo); detalle.push({ propuesta: p.id, ok: false, motivo: prep.motivo }); continue }
    resultado.listas++
    contar(resultado.por_tipo, p.tipo)
    if (!ejecutar) { detalle.push({ propuesta: p.id, ok: true, bytes: prep.archivo.bytes, mime: prep.archivo.mime }); continue }

    const documentoId = randomUUID()
    const destino = `${p.empleado_id}/${documentoId}/1.${EXT[prep.archivo.mime]}`
    const { error: errSubida } = await db.storage.from('legajo-documentos')
      .upload(destino, prep.copia, { contentType: prep.archivo.mime, upsert: false })
    if (errSubida) { contar(resultado.motivos, 'no se pudo subir'); detalle.push({ propuesta: p.id, ok: false, motivo: errSubida.message }); continue }
    const { error } = await db.rpc('documentacion_importar_historico', {
      p_propuesta_id: p.id, p_documento_id: documentoId, p_hash_leido: prep.hashLeido, p_archivos: [prep.archivo],
    })
    if (error) {
      // La copia subida queda en el bucket (no se borra nada sin autorización): se informa.
      contar(resultado.motivos, 'la base rechazó la importación')
      detalle.push({ propuesta: p.id, ok: false, motivo: error.message, copia_huerfana: destino })
      continue
    }
    resultado.importadas++
    detalle.push({ propuesta: p.id, ok: true, documento_id: documentoId })
  }

  console.log(JSON.stringify(resultado, null, 2))
  if (typeof a.reporte === 'string') writeFileSync(a.reporte, JSON.stringify({ ...resultado, detalle }, null, 2))
  if (!ejecutar) console.log('\nSIMULACIÓN: no se subió ni se escribió nada.')
}

if (process.argv[1]?.endsWith('importar.mjs')) {
  principal().catch(e => { console.error(e.message); process.exit(1) })
}

