/**
 * lib/facturacion/externas-arca.ts
 *
 * Facturas emitidas FUERA de la app (Comprobantes en línea / Factuweb) y su cruce con las
 * prefacturas, para marcarlas como emitidas. ARCA NO deja leerlas por el web service de
 * facturación (error 11002 para los puntos de venta que no son Web Service), así que la
 * fuente es el archivo de "Mis Comprobantes – Emitidos" importado en Comprobantes.
 * Sin acceso a datos: sólo arma con lo que recibe.
 */

import { formatoPesos } from './dinero'

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

export type Emparejamiento = {
  coincidencias: Array<{ prefactura: PrefacturaAbierta; comprobante: ComprobanteExterno }>
  diferencias: Array<{ prefactura: PrefacturaAbierta; comprobante: ComprobanteExterno; motivo: string }>
  ambiguas: Array<{ prefactura: PrefacturaAbierta; comprobantes: ComprobanteExterno[] }>
  sinFactura: PrefacturaAbierta[]
  sinPrefactura: ComprobanteExterno[]
}

const cuitDe = (p: PrefacturaAbierta) => String(p.cuit_receptor ?? '').replace(/\D/g, '')

/** Cruce conservador: sólo lo exacto (CUIT, tipo, total y fecha compatible, una candidata por lado) se marca. */
export function emparejar(prefacturas: PrefacturaAbierta[], comprobantes: ComprobanteExterno[]): Emparejamiento {
  const candidatas = new Map<string, ComprobanteExterno[]>()
  const usos = new Map<string, number>()
  for (const p of prefacturas) {
    const cs = comprobantes.filter(c => c.docNro === cuitDe(p) && c.tipo === p.tipo_comprobante && c.totalC === p.total_c && fechaCompatible(c.fecha, p))
    candidatas.set(p.id, cs)
    for (const c of cs) usos.set(c.id, (usos.get(c.id) ?? 0) + 1)
  }
  const out: Emparejamiento = { coincidencias: [], diferencias: [], ambiguas: [], sinFactura: [], sinPrefactura: [] }
  const usados = new Set<string>()
  const resueltas = new Set<string>()
  // 1) Lo exacto primero, para todas: un cliente con varias facturas (Laromet) no se mezcla.
  for (const p of prefacturas) {
    const cs = candidatas.get(p.id) ?? []
    if (cs.length === 1 && usos.get(cs[0].id) === 1) { out.coincidencias.push({ prefactura: p, comprobante: cs[0] }); usados.add(cs[0].id); resueltas.add(p.id) }
    else if (cs.length) { out.ambiguas.push({ prefactura: p, comprobantes: cs }); cs.forEach(c => usados.add(c.id)); resueltas.add(p.id) }
  }
  // 2) Sin coincidencia exacta: la factura del mismo cliente y período con el total más parecido.
  for (const p of prefacturas) {
    if (resueltas.has(p.id)) continue
    const parecidas = comprobantes.filter(c => c.docNro === cuitDe(p) && fechaCompatible(c.fecha, p) && !usados.has(c.id))
      .sort((a, b) => Math.abs(a.totalC - (p.total_c ?? 0)) - Math.abs(b.totalC - (p.total_c ?? 0)))
    if (!parecidas.length) { out.sinFactura.push(p); continue }
    const c = parecidas[0]
    const h = horasFacturadas(p, c)
    const motivos = [
      c.tipo !== p.tipo_comprobante && `tipo ${c.tipo} (la prefactura dice ${p.tipo_comprobante})`,
      c.totalC !== p.total_c && `total ${formatoPesos(c.totalC)} (la prefactura dice ${formatoPesos(p.total_c ?? 0)})`,
      h && c.totalC !== p.total_c && `≈ ${h.reales} h facturadas (la prefactura tiene ${h.prefactura} h)`,
    ].filter(Boolean)
    out.diferencias.push({ prefactura: p, comprobante: c, motivo: motivos.join('; ') || 'revisar' })
    usados.add(c.id)
  }
  out.sinPrefactura = comprobantes.filter(c => !usados.has(c.id))
  return out
}
