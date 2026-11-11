/**
 * lib/facturacion/externas-arca.ts
 *
 * Facturas emitidas FUERA de la app (Comprobantes en línea, Factuweb: puntos de venta
 * distintos del Web Service de la app) leídas de ARCA con FECompUltimoAutorizado +
 * FECompConsultar (SÓLO LECTURA: no pide CAE), y su emparejamiento con las prefacturas
 * abiertas para marcarlas como emitidas. Sin acceso a datos: sólo arma con lo que recibe.
 */

export type ComprobanteArca = {
  tipo: number
  puntoVenta: number
  numero: number
  fecha: string // AAAA-MM-DD
  docTipo: number | null
  docNro: string
  netoC: number
  ivaC: number
  totalC: number
  cae: string
  caeVto: string
  servicioDesde: string | null
  servicioHasta: string | null
  vtoPago: string | null
}

const iso = (v: unknown): string | null => {
  const s = String(v ?? '').replace(/\D/g, '')
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null
}
const centavos = (v: unknown) => Math.round(Number(v ?? 0) * 100)

/** Datos de un FECompConsultarResult (el `crudo` de interpretarConsulta). */
export function comprobanteDeConsulta(crudo: any, base: { tipo: number; puntoVenta: number; numero: number }): ComprobanteArca | null {
  const g = crudo?.ResultGet
  if (!g?.CodAutorizacion) return null
  return {
    tipo: Number(g.CbteTipo ?? base.tipo), puntoVenta: Number(g.PtoVta ?? base.puntoVenta), numero: Number(g.CbteDesde ?? base.numero),
    fecha: iso(g.CbteFch) ?? '', docTipo: g.DocTipo != null ? Number(g.DocTipo) : null, docNro: String(g.DocNro ?? '').replace(/\D/g, ''),
    netoC: centavos(g.ImpNeto), ivaC: centavos(g.ImpIVA), totalC: centavos(g.ImpTotal),
    cae: String(g.CodAutorizacion), caeVto: iso(g.FchVto) ?? '',
    servicioDesde: iso(g.FchServDesde), servicioHasta: iso(g.FchServHasta), vtoPago: iso(g.FchVtoPago),
  }
}

export type PuertoConsulta = {
  ultimo(): Promise<{ ok: true; numero: number } | { ok: false; error: string }>
  consultar(numero: number): Promise<{ encontrado: true; comprobante: ComprobanteArca } | { encontrado: false } | { error: string }>
}

/**
 * Recorre un punto de venta y tipo desde el último autorizado hacia atrás hasta encontrar
 * uno emitido antes de `desde` (o hasta `maximo` números). Los números no encontrados (602)
 * se saltean. Errores de ARCA: se corta y se informa (nunca se inventa nada).
 */
export async function recorrerPuntoVenta(p: PuertoConsulta, o: { desde: string; maximo?: number; paralelo?: number }) {
  const u = await p.ultimo()
  if (u.ok === false) return { ultimo: null as number | null, comprobantes: [] as ComprobanteArca[], error: u.error as string | null, completo: false }
  const maximo = o.maximo ?? 150
  const paralelo = Math.max(1, o.paralelo ?? 4)
  const comprobantes: ComprobanteArca[] = []
  let n = u.numero
  let tope = Math.max(1, u.numero - maximo + 1)
  while (n >= tope) {
    const lote = Array.from({ length: Math.min(paralelo, n - tope + 1) }, (_, i) => n - i)
    const res = await Promise.all(lote.map(x => p.consultar(x)))
    let cortar = false
    for (const r of res) {
      if ('error' in r) return { ultimo: u.numero, comprobantes, error: r.error, completo: false }
      if (r.encontrado) {
        if (r.comprobante.fecha && r.comprobante.fecha < o.desde) cortar = true
        else comprobantes.push(r.comprobante)
      }
    }
    if (cortar) return { ultimo: u.numero, comprobantes, error: null, completo: true }
    n -= lote.length
  }
  return { ultimo: u.numero, comprobantes, error: null, completo: tope === 1 }
}

export type PrefacturaAbierta = {
  id: string; version: number; estado: string; cuit_receptor: string | null; tipo_comprobante: number | null
  total_c: number | null; neto_c: number | null; iva_c: number | null; periodo_desde: string; periodo_hasta_excl: string
  cliente?: string | null; nombre?: string | null
}

const solapa = (c: ComprobanteArca, p: PrefacturaAbierta) => {
  if (c.servicioDesde && c.servicioHasta) return c.servicioDesde < p.periodo_hasta_excl && c.servicioHasta >= p.periodo_desde
  return c.fecha >= p.periodo_desde // sin período de servicio: emitida desde el inicio del período
}

export type Emparejamiento = {
  /** Mismo CUIT, tipo y total exacto, período compatible, y una sola candidata de cada lado. */
  coincidencias: Array<{ prefactura: PrefacturaAbierta; comprobante: ComprobanteArca }>
  /** Mismo CUIT y período pero distinto tipo o total: se revisan a mano (no se marcan solas). */
  diferencias: Array<{ prefactura: PrefacturaAbierta; comprobante: ComprobanteArca; motivo: string }>
  /** Varias candidatas para la misma prefactura o el mismo comprobante: no se elige solo. */
  ambiguas: Array<{ prefactura: PrefacturaAbierta; comprobantes: ComprobanteArca[] }>
  sinFactura: PrefacturaAbierta[]
  sinPrefactura: ComprobanteArca[]
}

const claveC = (c: ComprobanteArca) => `${c.tipo}-${c.puntoVenta}-${c.numero}`

/** Empareja conservador: sólo lo exacto se marca; el resto se informa. */
export function emparejar(prefacturas: PrefacturaAbierta[], comprobantes: ComprobanteArca[]): Emparejamiento {
  const candidatas = new Map<string, ComprobanteArca[]>()
  const usosC = new Map<string, number>()
  for (const p of prefacturas) {
    const cs = comprobantes.filter(c => c.docNro === String(p.cuit_receptor ?? '').replace(/\D/g, '') && c.tipo === p.tipo_comprobante && c.totalC === p.total_c && solapa(c, p))
    candidatas.set(p.id, cs)
    for (const c of cs) usosC.set(claveC(c), (usosC.get(claveC(c)) ?? 0) + 1)
  }
  const out: Emparejamiento = { coincidencias: [], diferencias: [], ambiguas: [], sinFactura: [], sinPrefactura: [] }
  const usados = new Set<string>()
  for (const p of prefacturas) {
    const cs = candidatas.get(p.id) ?? []
    if (cs.length === 1 && usosC.get(claveC(cs[0])) === 1) { out.coincidencias.push({ prefactura: p, comprobante: cs[0] }); usados.add(claveC(cs[0])); continue }
    if (cs.length > 1 || (cs.length === 1 && (usosC.get(claveC(cs[0])) ?? 0) > 1)) { out.ambiguas.push({ prefactura: p, comprobantes: cs }); cs.forEach(c => usados.add(claveC(c))); continue }
    // Sin coincidencia exacta: ¿hay una factura del mismo cliente y período con otro tipo o total?
    const cuit = String(p.cuit_receptor ?? '').replace(/\D/g, '')
    const parecida = comprobantes.find(c => c.docNro === cuit && solapa(c, p) && !usados.has(claveC(c)))
    if (parecida) {
      const motivos = [
        parecida.tipo !== p.tipo_comprobante && `tipo ${parecida.tipo} (la prefactura dice ${p.tipo_comprobante})`,
        parecida.totalC !== p.total_c && `total ${(parecida.totalC / 100).toFixed(2)} (la prefactura dice ${((p.total_c ?? 0) / 100).toFixed(2)})`,
      ].filter(Boolean)
      out.diferencias.push({ prefactura: p, comprobante: parecida, motivo: motivos.join('; ') || 'período distinto' })
      usados.add(claveC(parecida))
      continue
    }
    out.sinFactura.push(p)
  }
  out.sinPrefactura = comprobantes.filter(c => !usados.has(claveC(c)))
  return out
}
