// Legajo Digital — carga de PROPUESTAS del archivo histórico (MEGA).
//
// Lee la clasificación local (documentos.json, generada fuera del repo) y
// arma una propuesta por archivo: persona sugerida por DNI y tipo sugerido.
// No sube archivos ni crea documentos: sólo propuestas para que
// Administración las revise en la bandeja.
//
// POR DEFECTO SIMULA: muestra cuántas propuestas cargaría (sin datos
// personales) y no escribe nada. Para cargar:
//   CONFIRMO_CARGA_PROPUESTAS=si node scripts/legajo-historico/cargar-propuestas.mjs \
//     --documentos=<ruta fuera del repo>/documentos.json --lote=mega-2026-10 --ejecutar
//
// Opcional: --excluir-dni=<archivo fuera del repo> con un DNI por línea. Esos
// DNI entran como "conflicto" y nunca se asocian automáticamente (además de
// los DNI repetidos en la app, que la base ya detecta).

import { readFileSync } from 'fs'
import {
  TIPOS_FUERA_DEL_LEGAJO, TIPO_CATALOGO, argumentos, clienteServicio, contar, exigirAutorizacion,
} from './comun.mjs'

const EXTENSIONES_LEGAJO = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp'])

export function armarPropuestas(documentos, { lote, excluirDni = new Set() }) {
  const propuestas = []
  const descartes = {}
  for (const d of documentos) {
    if (d.area !== 'legajo') { contar(descartes, 'fuera_del_area_legajo'); continue }
    if (d.duplicado_de) { contar(descartes, 'duplicado_exacto'); continue }
    // Al legajo sólo entran fotos o PDF (Word/Excel quedan en MEGA).
    if (!EXTENSIONES_LEGAJO.has(String(d.ext ?? '').toLowerCase())) { contar(descartes, 'formato_no_admitido'); continue }
    if (!d.sha256 || !/^[0-9a-f]{64}$/.test(d.sha256)) { contar(descartes, 'sin_hash'); continue }
    const tipos = (d.tipos ?? []).filter(t => !TIPOS_FUERA_DEL_LEGAJO.has(t))
    if ((d.tipos ?? []).length > 0 && tipos.length === 0) { contar(descartes, 'recibos_contratos_homologaciones'); continue }
    const codigos = [...new Set(tipos.map(t => TIPO_CATALOGO[t]).filter(Boolean))]
    const revisar = d.revisar ?? []
    const compilado = !!d.tipos_por_pagina || revisar.includes('compilado_varios_documentos') || codigos.length > 1
    const conflictos = []
    if (compilado) conflictos.push('PDF compilado con varios documentos: separar por páginas')
    if (revisar.includes('varias_personas')) conflictos.push('Aparecen varias personas en el archivo')
    if (revisar.includes('persona_distinta_a_carpeta')) conflictos.push('El DNI del documento no coincide con la carpeta')
    if (d.persona && excluirDni.has(d.persona)) conflictos.push('DNI excluido de las asociaciones automáticas')
    propuestas.push({
      lote,
      hash_origen: d.sha256,
      ruta_origen: d.ruta,
      bytes: d.bytes ?? null,
      paginas: d.paginas ?? null,
      tipo_sugerido: codigos.length === 1 ? codigos[0] : null,
      dni_sugerido: /^[0-9]{7,8}$/.test(d.persona ?? '') ? d.persona : null,
      confianza: d.confianza === 'contenido' ? 'alta' : d.confianza === 'solo_nombre' ? 'media' : 'baja',
      criterio: d.criterio ?? null,
      senales: {
        metodo: d.metodo ?? null, tipos: d.tipos ?? [], tipos_por_pagina: d.tipos_por_pagina ?? null,
        dnis_en_texto: d.dnis_en_texto ?? null, revisar, carpeta_persona: d.carpeta_persona ?? null,
      },
      conflicto: conflictos.length ? conflictos.join(' · ') : null,
    })
  }
  return { propuestas, descartes }
}

export function resumen(propuestas) {
  const r = { total: propuestas.length, por_tipo: {}, por_confianza: {}, con_conflicto: 0, sin_persona: 0, sin_tipo: 0 }
  for (const p of propuestas) {
    contar(r.por_tipo, p.tipo_sugerido ?? '(a definir)')
    contar(r.por_confianza, p.confianza)
    if (p.conflicto) r.con_conflicto++
    if (!p.dni_sugerido) r.sin_persona++
    if (!p.tipo_sugerido) r.sin_tipo++
  }
  return r
}

async function principal() {
  const a = argumentos()
  if (!a.documentos) { console.error('Falta --documentos=<ruta a documentos.json>'); process.exit(1) }
  const documentos = JSON.parse(readFileSync(a.documentos, 'utf8'))
  const excluirDni = new Set(a['excluir-dni']
    ? readFileSync(a['excluir-dni'], 'utf8').split(/\r?\n/).map(s => s.replace(/\D/g, '')).filter(Boolean) : [])
  const lote = typeof a.lote === 'string' ? a.lote : 'mega-' + new Date().toISOString().slice(0, 7)
  const { propuestas, descartes } = armarPropuestas(documentos, { lote, excluirDni })

  console.log(JSON.stringify({ lote, archivos_leidos: documentos.length, descartes, ...resumen(propuestas) }, null, 2))
  if (!exigirAutorizacion(a, 'CONFIRMO_CARGA_PROPUESTAS')) {
    console.log('\nSIMULACIÓN: no se escribió nada. Para cargar: --ejecutar y CONFIRMO_CARGA_PROPUESTAS=si.')
    return
  }
  const db = await clienteServicio()
  const res = {}
  for (const p of propuestas) {
    const { data, error } = await db.rpc('legajo_historico_cargar_propuesta', { p })
    if (error) { contar(res, 'error'); console.error(`error en una propuesta: ${error.message}`); continue }
    contar(res, data.resultado === 'ya_estaba' ? 'ya_estaba' : `${data.estado}${data.indexado ? '' : '_sin_indice'}`)
  }
  console.log('Resultado de la carga:', res)
}

if (process.argv[1]?.endsWith('cargar-propuestas.mjs')) {
  principal().catch(e => { console.error(e.message); process.exit(1) })
}
