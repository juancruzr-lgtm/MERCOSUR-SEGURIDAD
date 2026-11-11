/**
 * lib/facturacion/externas-arca.ts
 *
 * Facturas emitidas FUERA de la app (Comprobantes en línea / Factuweb) y su cruce con las
 * prefacturas, para marcarlas como emitidas. ARCA NO deja leerlas por el web service de
 * facturación (error 11002 para los puntos de venta que no son Web Service), así que la
 * fuente es el archivo de "Mis Comprobantes – Emitidos" importado en Comprobantes.
 * Sin acceso a datos: sólo arma con lo que recibe.
 */


/** Comprobante de producción ya importado del archivo de ARCA (fact_comprobantes). */
export type ComprobanteExterno = {
  id: string
  tipo: number
  puntoVenta: number
  numero: number
  fecha: string // AAAA-MM-DD
  docNro: string
  receptor: string | null
  netoC: number
  ivaC: number
  totalC: number
  cae: string | null
}

export type LineaPrefactura = { concepto?: string; cantidad?: string | number; precio?: string | number; importes?: { neto?: number; total?: number } }

export type PrefacturaAbierta = {
  id: string; version: number; estado: string; cuit_receptor: string | null; tipo_comprobante: number | null
  total_c: number | null; neto_c: number | null; iva_c: number | null; periodo_desde: string; periodo_hasta_excl: string
  cliente?: string | null; lineas?: LineaPrefactura[] | null
}

const dia = (iso: string, mas: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + mas * 86400000).toISOString().slice(0, 10)

/**
 * ¿La factura puede ser la de ese período? El archivo de ARCA no trae el período de servicio:
 * se usa la fecha de emisión, desde 7 días antes del fin del período hasta 45 días después.
 * Así una factura de octubre emitida a principios de octubre (que es de septiembre) no cierra la
 * prefactura de octubre, aunque el abono tenga el mismo total.
 */
export function fechaCompatible(fecha: string, p: Pick<PrefacturaAbierta, 'periodo_hasta_excl'>): boolean {
  return fecha >= dia(p.periodo_hasta_excl, -7) && fecha <= dia(p.periodo_hasta_excl, 45)
}

/** Horas que representa un importe, con el precio por hora de la prefactura (una sola línea de horas). */
export function horasFacturadas(p: PrefacturaAbierta, c: Pick<ComprobanteExterno, 'netoC' | 'totalC'>): { reales: number; prefactura: number } | null {
  const ls = (p.lineas ?? []).filter(l => Number(l.precio) > 0 && Number(l.cantidad) > 0)
  if (ls.length !== 1) return null
  const l = ls[0]
  const precioC = Number(l.precio) * 100
  const bruto = precioC * Number(l.cantidad)
  // Tarifa con IVA incluido (factura B): precio × horas da el total; si no, el neto.
  const sobreTotal = l.importes?.total != null && l.importes?.neto != null && Math.abs(bruto - l.importes.total) < Math.abs(bruto - l.importes.neto)
  const reales = (sobreTotal ? c.totalC : c.netoC) / precioC
  return { reales: Math.round(reales * 100) / 100, prefactura: Number(l.cantidad) }
}

/**
 * Conciliación AUTOMÁTICA (al importar el archivo de ARCA). Por cliente (CUIT) y tipo:
 *  1) exacta: mismo total, una sola candidata de cada lado → se vincula sin diferencia;
 *  2) inequívoca: después de lo exacto, la prefactura tiene UNA sola factura posible y esa factura es
 *     candidata sólo de ella → se vincula y la diferencia queda visible (pendiente);
 *  3) el resto es ambiguo (varias facturas o varias prefacturas) → queda para revisión, no se vincula.
 * Lo que no aparece en el archivo no se toca (el archivo puede estar incompleto).
 */
export type Clasificacion = {
  vincular: Array<{ prefactura: PrefacturaAbierta; comprobante: ComprobanteExterno; exacta: boolean }>
  ambiguas: Array<{ prefactura: PrefacturaAbierta; comprobantes: ComprobanteExterno[]; motivo: string }>
  sinFactura: PrefacturaAbierta[]
  sinPrefactura: ComprobanteExterno[]
}

const cuitDe = (p: PrefacturaAbierta) => String(p.cuit_receptor ?? '').replace(/\D/g, '')

export function clasificar(prefacturas: PrefacturaAbierta[], comprobantes: ComprobanteExterno[]): Clasificacion {
  const cand = (p: PrefacturaAbierta, usados: Set<string>) =>
    comprobantes.filter(c => !usados.has(c.id) && c.docNro === cuitDe(p) && c.tipo === p.tipo_comprobante && fechaCompatible(c.fecha, p))
  const out: Clasificacion = { vincular: [], ambiguas: [], sinFactura: [], sinPrefactura: [] }
  const usados = new Set<string>()
  const resueltas = new Set<string>()
  // 1) Exactas.
  const exactas = new Map(prefacturas.map(p => [p.id, p.total_c == null ? [] : cand(p, usados).filter(c => c.totalC === p.total_c)]))
  const usosEx = new Map<string, number>()
  Array.from(exactas.values()).forEach(cs => cs.forEach(c => usosEx.set(c.id, (usosEx.get(c.id) ?? 0) + 1)))
  for (const p of prefacturas) {
    const cs = exactas.get(p.id) ?? []
    if (cs.length === 1 && usosEx.get(cs[0].id) === 1) { out.vincular.push({ prefactura: p, comprobante: cs[0], exacta: true }); usados.add(cs[0].id); resueltas.add(p.id) }
  }
  // 2) Inequívocas (una sola candidata de cada lado), con diferencia.
  const resto = prefacturas.filter(p => !resueltas.has(p.id))
  const cands = new Map(resto.map(p => [p.id, cand(p, usados)]))
  const usos = new Map<string, number>()
  Array.from(cands.values()).forEach(cs => cs.forEach(c => usos.set(c.id, (usos.get(c.id) ?? 0) + 1)))
  const enAmbiguas = new Set<string>()
  for (const p of resto) {
    const cs = cands.get(p.id) ?? []
    if (cs.length === 1 && usos.get(cs[0].id) === 1) { out.vincular.push({ prefactura: p, comprobante: cs[0], exacta: false }); continue }
    if (cs.length) {
      out.ambiguas.push({ prefactura: p, comprobantes: cs, motivo: cs.length > 1 ? `${cs.length} facturas posibles del cliente en el período` : 'la misma factura sirve para varias prefacturas del cliente' })
      cs.forEach(c => enAmbiguas.add(c.id))
      continue
    }
    // Factura del mismo cliente y período pero de OTRO tipo: no se vincula sola.
    const otroTipo = comprobantes.filter(c => !usados.has(c.id) && c.docNro === cuitDe(p) && c.tipo !== p.tipo_comprobante && fechaCompatible(c.fecha, p))
    if (otroTipo.length) { out.ambiguas.push({ prefactura: p, comprobantes: otroTipo, motivo: `tipo de comprobante distinto (la prefactura es ${p.tipo_comprobante})` }); otroTipo.forEach(c => enAmbiguas.add(c.id)); continue }
    out.sinFactura.push(p)
  }
  for (const v of out.vincular) usados.add(v.comprobante.id)
  out.sinPrefactura = comprobantes.filter(c => !usados.has(c.id) && !enAmbiguas.has(c.id))
  return out
}

/** Período realmente facturado de una prefactura: el de la conciliación si lo informa, si no el propio. */
export function periodoEfectivo(p: { periodo_desde: string; periodo_hasta_excl: string; conciliacion?: any }): { desde: string; hastaExcl: string } {
  const pf = p.conciliacion?.periodo_facturado
  if (pf?.desde && pf?.hasta) return { desde: String(pf.desde), hastaExcl: dia(String(pf.hasta), 1) }
  return { desde: p.periodo_desde, hastaExcl: p.periodo_hasta_excl }
}

/** ¿Se superponen dos períodos [desde, hastaExcl)? */
export const superpone = (a: { desde: string; hastaExcl: string }, b: { desde: string; hastaExcl: string }) => a.desde < b.hastaExcl && b.desde < a.hastaExcl
