/**
 * lib/facturacion/importadores.ts
 *
 * Lectura (sin escribir nada) de:
 *  - CSV "Mis Comprobantes – Emitidos" de ARCA.
 *  - Extracto bancario en CSV.
 *
 * Los archivos son DATOS: no se interpreta ningún texto como instrucción.
 * Las columnas se reconocen por el encabezado (ARCA cambió el formato más de
 * una vez); lo que no se reconoce se informa como error de fila, no se
 * inventa. Las filas repetidas (copias del mismo ZIP, líneas duplicadas) se
 * colapsan por clave: el servidor las cuenta y no las multiplica.
 */

import { aCentavos } from './dinero'
import { cuitValido, limpiarCuit, TIPOS_COMPROBANTE } from './comprobantes'
import { clasificarMovimiento } from './conciliacion'

export function parseCsv(texto: string): string[][] {
  const limpio = texto.replace(/^﻿/, '')
  const primera = limpio.split(/\r?\n/, 1)[0] ?? ''
  const sep = (primera.match(/;/g)?.length ?? 0) >= (primera.match(/,/g)?.length ?? 0) ? ';' : ','
  const filas: string[][] = []
  let fila: string[] = [], campo = '', comillas = false
  for (let i = 0; i < limpio.length; i++) {
    const ch = limpio[i]
    if (comillas) {
      if (ch === '"' && limpio[i + 1] === '"') { campo += '"'; i++ }
      else if (ch === '"') comillas = false
      else campo += ch
    } else if (ch === '"') comillas = true
    else if (ch === sep) { fila.push(campo); campo = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && limpio[i + 1] === '\n') i++
      fila.push(campo); campo = ''
      if (fila.some(c => c.trim() !== '')) filas.push(fila)
      fila = []
    } else campo += ch
  }
  fila.push(campo)
  if (fila.some(c => c.trim() !== '')) filas.push(fila)
  return filas
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

function indice(encabezado: string[], ...patrones: RegExp[]): number {
  const h = encabezado.map(norm)
  for (const p of patrones) {
    const i = h.findIndex(x => p.test(x))
    if (i >= 0) return i
  }
  return -1
}

/** '04/09/2026', '2026-09-04', '20260904' → '2026-09-04'. */
export function fechaIso(v: string): string | null {
  const s = String(v ?? '').trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  return null
}

export type FilaArca = {
  clave: string
  tipo: number
  punto_venta: number
  numero: number
  fecha: string
  doc_tipo_receptor: number | null
  doc_nro_receptor: string
  receptor_nombre: string
  moneda: string
  neto_c: number
  no_gravado_c: number
  exento_c: number
  iva_c: number
  total_c: number
  cae: string | null
}

export type LecturaArca = { filas: FilaArca[]; errores: Array<{ fila: number; motivo: string }>; repetidas: number }

/** El CSV de "Mis Comprobantes" trae "$" para pesos; WSFE y la base usan el código "PES". */
function monedaArca(v: string | undefined): string {
  const m = String(v ?? '').trim().toUpperCase()
  return !m || m === '$' || m === 'ARS' || m === 'PES' ? 'PES' : m === 'U$S' || m === 'USD' || m === 'US$' ? 'DOL' : m
}

export function leerCsvArcaEmitidos(texto: string): LecturaArca {
  const filas = parseCsv(texto)
  const errores: LecturaArca['errores'] = []
  if (!filas.length) return { filas: [], errores: [{ fila: 0, motivo: 'Archivo vacío' }], repetidas: 0 }
  const h = filas[0]
  const col = {
    fecha: indice(h, /^fecha( de emision)?$/, /fecha/),
    tipo: indice(h, /^tipo( de comprobante)?$/, /tipo de comprobante/),
    pv: indice(h, /punto de venta/),
    desde: indice(h, /numero desde/, /^numero$/, /nro desde/),
    hasta: indice(h, /numero hasta/, /nro hasta/),
    cae: indice(h, /cod autorizacion/, /cae/),
    docTipo: indice(h, /tipo doc receptor/),
    docNro: indice(h, /nro doc receptor/, /numero doc receptor/),
    nombre: indice(h, /denominacion receptor/),
    moneda: indice(h, /^moneda$/),
    neto: indice(h, /^imp neto gravado( total)?$/, /neto gravado/),
    noGrav: indice(h, /no gravado/),
    exento: indice(h, /exent/),
    iva: indice(h, /^iva$/, /^total iva$/),
    total: indice(h, /^imp total$/, /importe total/),
  }
  const faltan = Object.entries({ fecha: col.fecha, tipo: col.tipo, pv: col.pv, desde: col.desde, total: col.total }).filter(([, i]) => i < 0).map(([k]) => k)
  if (faltan.length) return { filas: [], errores: [{ fila: 1, motivo: `No se reconocen columnas: ${faltan.join(', ')}` }], repetidas: 0 }

  const vistos = new Map<string, FilaArca>()
  let repetidas = 0
  const num = (v: string | undefined) => (v == null || v.trim() === '' ? 0 : aCentavos(v))
  for (let i = 1; i < filas.length; i++) {
    const f = filas[i]
    try {
      const tipo = Number(String(f[col.tipo]).match(/^\s*(\d+)/)?.[1])
      if (!TIPOS_COMPROBANTE[tipo]) throw new Error(`Tipo de comprobante no contemplado: "${f[col.tipo]}"`)
      const desde = Number(f[col.desde]), hasta = col.hasta >= 0 && f[col.hasta] ? Number(f[col.hasta]) : desde
      if (!Number.isInteger(desde) || desde < 1) throw new Error('Número inválido')
      if (hasta !== desde) throw new Error(`Rango ${desde}-${hasta}: se carga comprobante por comprobante`)
      const fecha = fechaIso(f[col.fecha])
      if (!fecha) throw new Error(`Fecha inválida: "${f[col.fecha]}"`)
      const pv = Number(f[col.pv])
      const fila: FilaArca = {
        clave: `${tipo}-${pv}-${desde}`, tipo, punto_venta: pv, numero: desde, fecha,
        doc_tipo_receptor: col.docTipo >= 0 ? Number(String(f[col.docTipo]).match(/\d+/)?.[0]) || null : null,
        doc_nro_receptor: col.docNro >= 0 ? limpiarCuit(f[col.docNro]) : '',
        receptor_nombre: col.nombre >= 0 ? String(f[col.nombre] ?? '').trim() : '',
        moneda: monedaArca(col.moneda >= 0 ? f[col.moneda] : ''),
        neto_c: Math.abs(num(f[col.neto])), no_gravado_c: Math.abs(num(f[col.noGrav])), exento_c: Math.abs(num(f[col.exento])),
        iva_c: Math.abs(num(f[col.iva])), total_c: Math.abs(num(f[col.total])),
        cae: col.cae >= 0 ? String(f[col.cae] ?? '').trim() || null : null,
      }
      const previo = vistos.get(fila.clave)
      if (previo) {
        repetidas++
        if (previo.total_c !== fila.total_c) errores.push({ fila: i + 1, motivo: `${fila.clave} aparece dos veces con importes distintos` })
        continue
      }
      vistos.set(fila.clave, fila)
    } catch (e: any) {
      errores.push({ fila: i + 1, motivo: e?.message ?? String(e) })
    }
  }
  return { filas: Array.from(vistos.values()), errores, repetidas }
}

/**
 * Número de cuenta que declara el archivo (nombre "EXTRACTO_511522209-D…" o
 * una línea "Cuenta …"). null si no declara ninguno: no se inventa.
 */
export function cuentaEnExtracto(texto: string): string | null {
  const m = /EXTRACTO_(\d{6,})/i.exec(texto) ?? /cuenta[^\d\n]{0,25}(\d[\d\-/ ]{5,})/i.exec(texto)
  return m ? m[1].replace(/\D/g, '') : null
}

export type FilaExtracto = {
  fecha: string
  importe_c: number
  concepto: string
  referencia: string | null
  cuit_contraparte: string | null
  nombre_contraparte: string | null
  hash: string
  clasificacion: 'cobranza_posible' | 'no_cobranza' | 'debito'
  clasificacion_motivo: string | null
}

/**
 * Extracto bancario CSV. Reconoce Fecha, Concepto/Descripción, Débito/Crédito
 * o Importe, Referencia y (si hay) CUIT/Ordenante. Dos líneas idénticas el
 * mismo día se distinguen por su orden de aparición, así reimportar el mismo
 * archivo no duplica y dos pagos iguales reales no se pierden.
 */
export function leerExtracto(texto: string, cuitPropio: string): { filas: FilaExtracto[]; errores: Array<{ fila: number; motivo: string }>; saldoVerificado: number } {
  const filas = parseCsv(texto)
  const errores: Array<{ fila: number; motivo: string }> = []
  const iH = filas.findIndex(f => f.some(c => /fecha/i.test(c)))
  if (iH < 0) return { filas: [], errores: [{ fila: 0, motivo: 'No se encontró la fila de encabezado (Fecha…)' }], saldoVerificado: 0 }
  const h = filas[iH]
  const col = {
    fecha: indice(h, /^fecha( operacion| movimiento)?$/, /fecha/),
    // Galicia trae "Descripción" (texto) además de "Grupo de Conceptos" y "Concepto" (códigos): manda la descripción.
    concepto: indice(h, /^descripcion$/, /^concepto$/, /descripcion/, /detalle/, /concepto/),
    grupo: indice(h, /^grupo de conceptos?$/),
    debito: indice(h, /debito/, /^debe$/),
    credito: indice(h, /credito/, /^haber$/),
    importe: indice(h, /^importe$/, /^monto$/),
    saldo: indice(h, /^saldo$/),
    referencia: indice(h, /referencia/, /comprobante/, /nro operacion/),
    cuit: indice(h, /cuit/, /cuil/),
    nombre: indice(h, /ordenante/, /originante/, /contraparte/, /nombre/),
    // Galicia: ordenante en "Leyenda Adicional1" y su CUIT en "Leyenda Adicional2".
    leyendas: h.map((x, i) => (/leyenda adicional/.test(norm(x)) ? i : -1)).filter(i => i >= 0),
  }
  if (col.fecha < 0 || col.concepto < 0 || (col.importe < 0 && col.credito < 0)) {
    return { filas: [], errores: [{ fila: iH + 1, motivo: 'Faltan columnas de fecha, concepto o importe/crédito' }], saldoVerificado: 0 }
  }
  const ocurrencias = new Map<string, number>()
  const out: FilaExtracto[] = []
  // Control de lectura: si el banco informa el saldo de cada línea, saldo anterior + movimiento = saldo.
  let saldoPrevio: number | null = null
  let saldoVerificado = 0
  for (let i = iH + 1; i < filas.length; i++) {
    const f = filas[i]
    const fecha = fechaIso(f[col.fecha] ?? '')
    if (!fecha) { if ((f[col.fecha] ?? '').trim()) errores.push({ fila: i + 1, motivo: `Fecha inválida: "${f[col.fecha]}"` }); continue }
    let importe: number
    try {
      if (col.importe >= 0 && (f[col.importe] ?? '').trim()) importe = aCentavos(f[col.importe])
      else {
        const cr = (f[col.credito] ?? '').trim() ? aCentavos(f[col.credito]) : 0
        const db = col.debito >= 0 && (f[col.debito] ?? '').trim() ? aCentavos(f[col.debito]) : 0
        importe = Math.abs(cr) - Math.abs(db)
      }
    } catch { errores.push({ fila: i + 1, motivo: 'Importe ilegible' }); continue }
    if (col.saldo >= 0 && (f[col.saldo] ?? '').trim()) {
      let saldo: number | null = null
      try { saldo = aCentavos(String(f[col.saldo]).trim().replace(/^\+/, '')) } catch { errores.push({ fila: i + 1, motivo: 'Saldo ilegible' }) }
      if (saldo != null) {
        if (saldoPrevio != null) {
          if (saldoPrevio + importe === saldo) saldoVerificado++
          else errores.push({ fila: i + 1, motivo: `El saldo no cierra: ${saldoPrevio} + ${importe} ≠ ${saldo}. Revisar el archivo antes de importar.` })
        }
        saldoPrevio = saldo
      }
    }
    if (importe === 0) continue
    const concepto = String(f[col.concepto] ?? '').trim()
    const grupo = col.grupo >= 0 ? String(f[col.grupo] ?? '').trim() : ''
    const leyendas = col.leyendas.map(j => String(f[j] ?? '').trim()).filter(Boolean)
    const referencia = col.referencia >= 0 ? String(f[col.referencia] ?? '').trim() || null : null
    const cuitCol = col.cuit >= 0 ? limpiarCuit(f[col.cuit]) : ''
    const cuitTexto = concepto.match(/\b(\d{2}-?\d{8}-?\d)\b/)?.[1]
    const cuitLeyenda = leyendas.map(x => limpiarCuit(x)).find(x => x.length === 11 && cuitValido(x))
    const cuit = (cuitCol.length === 11 ? cuitCol : limpiarCuit(cuitTexto) || cuitLeyenda) || null
    const base = `${fecha}|${importe}|${norm(concepto)}|${referencia ?? ''}`
    const n = (ocurrencias.get(base) ?? 0) + 1
    ocurrencias.set(base, n)
    // El grupo y las leyendas también clasifican (Inversiones, Impuestos, rechazos de débito).
    const mov = { id: '', fecha, importe, concepto: [concepto, grupo, ...leyendas].filter(Boolean).join(' · '), referencia, cuitContraparte: cuit }
    const c = clasificarMovimiento(mov, cuitPropio)
    const nombreLeyenda = cuitLeyenda && leyendas[0] && !/\d{6,}/.test(leyendas[0]) ? leyendas[0] : ''
    out.push({
      fecha, importe_c: importe, concepto, referencia, cuit_contraparte: cuit,
      nombre_contraparte: (col.nombre >= 0 ? String(f[col.nombre] ?? '').trim() : '') || nombreLeyenda || null,
      hash: `${base}|${n}`,
      clasificacion: c.tipo === 'no_cobranza' ? 'no_cobranza' : c.tipo === 'debito' ? 'debito' : 'cobranza_posible',
      clasificacion_motivo: c.tipo === 'no_cobranza' ? c.motivo : null,
    })
  }
  return { filas: out, errores, saldoVerificado }
}
