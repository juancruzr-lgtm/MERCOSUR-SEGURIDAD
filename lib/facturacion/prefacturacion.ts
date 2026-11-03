/**
 * lib/facturacion/prefacturacion.ts
 *
 * Una prefactura = cliente + período de prestación + agrupación (todo el
 * cliente, o un objetivo cuando el cliente pide una factura por objetivo,
 * como Laromet). Se arma con HORAS APROBADAS de la app, nunca con la planilla.
 *
 * Capas separadas (no se mezclan en un mismo número):
 *   horas registradas → horas aprobadas → ajustes comerciales (con motivo y
 *   responsable) → importe contractual → comprobante fiscal → cobranza.
 */

import { desglosarIva, importePorMinutos, porcentajeCentavos, sumarImportes, type Importes, type TratamientoIva } from './dinero'

// ── Estados de preparación (separados de entrega/portal/cobranza) ──────────
export type EstadoPreparacion =
  | 'en_preparacion'
  | 'esperando_requisitos'
  | 'lista_revision'
  | 'aprobada_emitir'
  | 'emitida'
  | 'descartada'

export const TRANSICIONES_PREPARACION: Record<EstadoPreparacion, EstadoPreparacion[]> = {
  en_preparacion: ['esperando_requisitos', 'lista_revision', 'descartada'],
  esperando_requisitos: ['en_preparacion', 'lista_revision', 'descartada'],
  lista_revision: ['en_preparacion', 'esperando_requisitos', 'aprobada_emitir', 'descartada'],
  // Sólo la autorización de ARCA (CAE) pasa a 'emitida'; un cambio material vuelve a revisión.
  aprobada_emitir: ['lista_revision', 'emitida'],
  emitida: [],
  descartada: ['en_preparacion'],
}

export function puedeTransicionar(de: EstadoPreparacion, a: EstadoPreparacion): boolean {
  return TRANSICIONES_PREPARACION[de]?.includes(a) ?? false
}

export type EstadoEntrega = 'pendiente' | 'enviada' | 'no_requiere'
export type EstadoPortal = 'no_requiere' | 'pendiente' | 'presentada' | 'observada' | 'aceptada'

// ── Modalidades y requisitos ───────────────────────────────────────────────
export type Modalidad = 'por_hora' | 'abono' | 'presupuesto_anticipado' | 'orden_compra'

export type TipoRequisito =
  | 'oc_mensual'          // Conexión Alto Delta: sin OC del mes queda pendiente
  | 'oc_vigente'          // ACA, SRT, Depósito Fiscal: OC/licitación vigente con saldo
  | 'conformidad'         // Municipalidad, C&E: planilla conformada
  | 'presupuesto_aceptado'// INTA
  | 'tarifa_definida'
  | 'iva_definido'
  | 'cuit_receptor'
  | 'franja_nocturna'     // Nación Servicios: clasificación contractual diurna/nocturna
  | 'horas_aprobadas'
  | 'definicion_comercial'// p. ej. adicionales de PNC pendientes con el contador

export type Requisito = { tipo: TipoRequisito; detalle: string }

export type TarifaVigente = {
  id: string
  concepto: 'hora' | 'hora_diurna' | 'hora_nocturna' | 'abono'
  precio: string // decimal tal cual el contrato
  tratamientoIva: TratamientoIva
  alicuotaIva: string
}

export type HorasAprobadas = {
  /** Minutos aprobados para facturación, con su origen verificable. */
  minutosTotales: number
  minutosDiurnos?: number
  minutosNocturnos?: number
  /** Programado y cubierto por puesto (horas FACTURABLES, no liquidables). */
  minutosProgramados: number
  minutosCubiertos: number
  /** Descubierto que Administración decidió NO facturar (informativo). */
  minutosDescubiertosNoFacturados: number
  fuentes: string[] // ids de fact_horas_aprobaciones (fotos con detalle por turno)
}

export type AjusteComercial = {
  id: string
  descripcion: string
  importeNeto: number // centavos, con signo
  motivo: string
  responsableId: string
  aprobado: boolean
}

export type OrdenCompraEstado = {
  id: string
  numero: string
  vigenciaDesde: string | null
  vigenciaHasta: string | null
  montoNeto: number | null // centavos; null = sin tope informado
  // Las OC de los clientes se expresan casi siempre CON IVA (ACA 0006-26 =
  // 8.760 h × $14.641; Depósito Fiscal = 12 × $14.235.000 de factura B).
  // Si se informa el monto total, el saldo se controla contra el total facturado.
  montoTotal?: number | null
  horas: number | null
  consumidoNeto: number
  consumidoTotal?: number
  consumidoHoras: number
}

export type EntradaPrefactura = {
  modalidad: Modalidad
  cuitReceptor: string | null
  periodo: { desde: string; hastaExclusivo: string }
  horas: HorasAprobadas | null
  tarifas: TarifaVigente[]
  ajustes: AjusteComercial[]
  separarDiurnaNocturna: boolean
  requiere: TipoRequisito[] // del contrato
  cumplidos: TipoRequisito[] // documentos ya asociados
  oc: OrdenCompraEstado | null
  /** Neto ya facturado por anticipo para este período (INTA). */
  anticipoNeto: number
  pendientesComerciales: string[]
}

export type LineaCalculada = {
  concepto: string
  cantidad: string
  precio: string
  tarifaId: string | null
  importes: Importes
}

export type ResultadoPrefactura = {
  lineas: LineaCalculada[]
  importes: Importes | null
  requisitos: Requisito[]
  avisos: string[]
}

const horasDeMinutos = (m: number) => (m / 60).toFixed(2).replace(/\.?0+$/, '') || '0'

function tarifa(tarifas: TarifaVigente[], concepto: TarifaVigente['concepto']) {
  return tarifas.find(t => t.concepto === concepto) ?? null
}

export function calcularPrefactura(e: EntradaPrefactura): ResultadoPrefactura {
  const requisitos: Requisito[] = []
  const avisos: string[] = []
  const lineas: LineaCalculada[] = []
  let calculable = true

  if (!e.cuitReceptor) requisitos.push({ tipo: 'cuit_receptor', detalle: 'El cliente no tiene CUIT cargado.' })

  const agregarLinea = (concepto: string, minutos: number | null, t: TarifaVigente | null) => {
    if (!t) { calculable = false; requisitos.push({ tipo: 'tarifa_definida', detalle: `No hay tarifa vigente para ${concepto}.` }); return }
    const cantidad = minutos === null ? '1' : horasDeMinutos(minutos)
    const bruto = importePorMinutos(minutos === null ? 60 : minutos, t.precio)
    const r = desglosarIva(bruto, t.tratamientoIva, t.alicuotaIva)
    if ('motivo' in r) { calculable = false; requisitos.push({ tipo: 'iva_definido', detalle: `${concepto}: ${r.motivo}` }); return }
    lineas.push({ concepto, cantidad, precio: t.precio, tarifaId: t.id, importes: r.importes })
  }

  if (e.modalidad === 'abono') {
    agregarLinea('Abono mensual', null, tarifa(e.tarifas, 'abono'))
  } else {
    const h = e.horas
    if (!h || h.minutosTotales <= 0) {
      calculable = false
      requisitos.push({ tipo: 'horas_aprobadas', detalle: 'No hay horas aprobadas para facturar en el período.' })
    } else {
      // Lo descubierto ya tuvo su decisión al aprobar las horas: se informa, no bloquea.
      if (h.minutosDescubiertosNoFacturados > 0) {
        avisos.push(`${horasDeMinutos(h.minutosDescubiertosNoFacturados)} h programadas quedaron descubiertas y no se facturan.`)
      }
      if (e.separarDiurnaNocturna) {
        if (h.minutosDiurnos == null || h.minutosNocturnos == null) {
          calculable = false
          requisitos.push({ tipo: 'franja_nocturna', detalle: 'El contrato separa horas diurnas y nocturnas, pero no tiene franja nocturna definida.' })
        } else {
          if (h.minutosDiurnos > 0) agregarLinea('Horas diurnas', h.minutosDiurnos, tarifa(e.tarifas, 'hora_diurna'))
          if (h.minutosNocturnos > 0) agregarLinea('Horas nocturnas', h.minutosNocturnos, tarifa(e.tarifas, 'hora_nocturna'))
        }
      } else {
        agregarLinea('Horas de vigilancia', h.minutosTotales, tarifa(e.tarifas, 'hora'))
      }
    }
  }

  // Ajustes comerciales: sólo los aprobados entran al importe; con el IVA de la primera línea.
  for (const a of e.ajustes) {
    if (!a.aprobado) { avisos.push(`Ajuste "${a.descripcion}" sin aprobar: no se incluye.`); continue }
    const base = e.tarifas.find(t => t.tratamientoIva !== 'sin_definir')
    const iva = base && base.tratamientoIva !== 'exento' ? porcentajeCentavos(a.importeNeto, base.alicuotaIva) : 0
    lineas.push({ concepto: `Ajuste: ${a.descripcion}`, cantidad: '1', precio: String(a.importeNeto / 100), tarifaId: null, importes: { neto: a.importeNeto, iva, total: a.importeNeto + iva } })
  }

  // Anticipo (INTA): lo ya facturado por adelantado no se vuelve a facturar.
  if (e.anticipoNeto > 0) {
    const sub = sumarImportes(lineas.map(l => l.importes))
    const descuento = Math.min(e.anticipoNeto, sub.neto)
    const ivaDesc = sub.neto > 0 ? Math.round(sub.iva * descuento / sub.neto) : 0
    lineas.push({ concepto: 'Cubierto por factura anticipada', cantidad: '1', precio: String(-descuento / 100), tarifaId: null, importes: { neto: -descuento, iva: -ivaDesc, total: -(descuento + ivaDesc) } })
    if (sub.neto <= e.anticipoNeto) avisos.push('El período queda totalmente cubierto por el anticipo: no corresponde nueva factura salvo diferencia aprobada.')
  }

  for (const req of e.requiere) {
    if (e.cumplidos.includes(req)) continue
    const detalle: Record<string, string> = {
      oc_mensual: 'Falta la orden de compra del período.',
      oc_vigente: 'Falta una orden de compra vigente que cubra el período.',
      conformidad: 'Falta la conformidad de la planilla del período.',
      presupuesto_aceptado: 'Falta el presupuesto aceptado.',
    }
    requisitos.push({ tipo: req, detalle: detalle[req] ?? `Requisito pendiente: ${req}` })
  }
  for (const p of e.pendientesComerciales) requisitos.push({ tipo: 'definicion_comercial', detalle: p })

  const importes = calculable ? sumarImportes(lineas.map(l => l.importes)) : null

  if (e.oc && importes) {
    const v = validarConsumoOc(e.oc, e.periodo, importes, e.horas ? e.horas.minutosTotales / 60 : 0)
    if ('motivo' in v) requisitos.push({ tipo: e.requiere.includes('oc_mensual') ? 'oc_mensual' : 'oc_vigente', detalle: v.motivo })
    else if (v.agotandose) avisos.push(`La OC ${e.oc.numero} no alcanza para otro período igual a éste: pedir una nueva orden.`)
  }

  return { lineas, importes, requisitos, avisos }
}

/**
 * Una OC compartida por varios objetivos se guarda UNA vez; cada prefactura
 * registra su consumo. Se controla vigencia y saldo sin multiplicar el monto.
 */
export function validarConsumoOc(
  oc: OrdenCompraEstado,
  periodo: { desde: string; hastaExclusivo: string },
  nuevo: { neto: number; total: number },
  horasNuevas: number,
): { ok: true; saldo: number | null; base: 'neto' | 'total' | null; agotandose: boolean } | { ok: false; motivo: string } {
  if (oc.vigenciaHasta && oc.vigenciaHasta < periodo.desde) return { ok: false, motivo: `La OC ${oc.numero} venció el ${oc.vigenciaHasta}.` }
  if (oc.vigenciaDesde && oc.vigenciaDesde >= periodo.hastaExclusivo) return { ok: false, motivo: `La OC ${oc.numero} recién rige desde ${oc.vigenciaDesde}.` }
  const base: 'neto' | 'total' | null = oc.montoTotal != null ? 'total' : oc.montoNeto != null ? 'neto' : null
  let saldo: number | null = null
  let agotandose = false
  if (base) {
    const monto = base === 'total' ? oc.montoTotal! : oc.montoNeto!
    const consumido = base === 'total' ? (oc.consumidoTotal ?? 0) : oc.consumidoNeto
    const importe = base === 'total' ? nuevo.total : nuevo.neto
    const disponible = monto - consumido
    if (importe > disponible) return { ok: false, motivo: `La OC ${oc.numero} no tiene saldo suficiente (saldo ${base === 'total' ? 'con IVA' : 'neto'} ${disponible}, se necesitan ${importe}).` }
    saldo = disponible - importe
    agotandose = importe > 0 && saldo < importe
  }
  if (oc.horas != null && oc.consumidoHoras + horasNuevas > oc.horas + 1e-9) {
    return { ok: false, motivo: `La OC ${oc.numero} cubre ${oc.horas} h y ya se consumieron ${oc.consumidoHoras} h.` }
  }
  if (oc.horas != null && horasNuevas > 0 && oc.horas - oc.consumidoHoras - horasNuevas < horasNuevas - 1e-9) agotandose = true
  return { ok: true, saldo, base, agotandose }
}

/** Estado sugerido según requisitos. Nunca sugiere 'aprobada_emitir' ni 'emitida'. */
export function estadoSugerido(r: ResultadoPrefactura): EstadoPreparacion {
  if (!r.importes) return r.requisitos.length ? 'esperando_requisitos' : 'en_preparacion'
  return r.requisitos.length ? 'esperando_requisitos' : 'lista_revision'
}

/**
 * Huella de los datos MATERIALES de una prefactura. Si cambia después de
 * aprobada, la aprobación cae y vuelve a revisión.
 */
export function huellaMaterial(p: {
  cuitReceptor: string | null
  tipoComprobante: number | null
  periodo: { desde: string; hastaExclusivo: string }
  lineas: Array<{ concepto: string; cantidad: string; precio: string; importes: Importes }>
  importes: Importes | null
  texto: string
  vencimiento: string | null
}): string {
  const norm = JSON.stringify([
    p.cuitReceptor ?? '', p.tipoComprobante ?? 0, p.periodo.desde, p.periodo.hastaExclusivo,
    p.lineas.map(l => [l.concepto, l.cantidad, l.precio, l.importes.neto, l.importes.iva, l.importes.total]),
    p.importes ? [p.importes.neto, p.importes.iva, p.importes.total] : null,
    (p.texto ?? '').trim().replace(/\s+/g, ' '), p.vencimiento ?? '',
  ])
  // FNV-1a 32 bits ×2 (no criptográfico: sólo detecta cambios).
  let h1 = 0x811c9dc5, h2 = 0x01000193
  for (let i = 0; i < norm.length; i++) {
    const c = norm.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

/** Texto precargado de la factura (editable por Administración). */
export function textoPrecargado(p: {
  objetivos: string[]
  periodo: { desde: string; hastaExclusivo: string }
  lineas: Array<{ concepto: string; cantidad: string }>
  oc?: string | null
}): string {
  const [ay, am, ad] = p.periodo.desde.split('-')
  const hasta = new Date(Date.parse(`${p.periodo.hastaExclusivo}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
  const [by, bm, bd] = hasta.split('-')
  const detalle = p.lineas.filter(l => !l.concepto.startsWith('Ajuste') && !l.concepto.startsWith('Cubierto')).map(l => `${l.concepto}: ${l.cantidad}`).join(' · ')
  return [
    `Servicio de seguridad y vigilancia${p.objetivos.length ? ` en ${p.objetivos.join(', ')}` : ''}.`,
    `Período: ${ad}/${am}/${ay} al ${bd}/${bm}/${by}.`,
    detalle,
    p.oc ? `OC N° ${p.oc}.` : '',
  ].filter(Boolean).join('\n')
}

/** Clave de unicidad de prestación: impide dos prefacturas vivas para lo mismo. */
export function clavePrestacion(p: { clienteId: string; agrupacion: string; desde: string; hastaExclusivo: string }): string {
  return `${p.clienteId}|${p.agrupacion}|${p.desde}|${p.hastaExclusivo}`
}
