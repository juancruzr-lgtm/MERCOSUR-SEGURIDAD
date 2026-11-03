/**
 * lib/facturacion/conciliacion.ts
 *
 * Propone (nunca aplica) asociaciones entre un ingreso bancario y la deuda de
 * clientes. Principios:
 *  - Ingreso bancario ≠ cobranza: rescates de inversiones, transferencias
 *    entre cuentas propias y reversos no cancelan nada.
 *  - La igualdad de importe sola no confirma un pago: sin identidad del
 *    cliente la propuesta es débil.
 *  - Se explica cada peso: transferencia + retenciones certificadas = saldo.
 *  - Se distingue lo que el documento CITA de lo que se INFIERE (p. ej.
 *    certificados que remiten a una orden de pago y no a la factura).
 *  - Un movimiento ya aplicado no se vuelve a proponer.
 */

import { limpiarCuit } from './comprobantes'

export type MovimientoBancario = {
  id: string
  fecha: string // YYYY-MM-DD
  importe: number // centavos; > 0 crédito
  concepto: string
  referencia?: string | null
  cuitContraparte?: string | null
  nombreContraparte?: string | null
  aplicado?: number // centavos ya aplicados
}

export type ClienteIdentidad = { id: string; cuit: string | null; razonSocial: string; alias: string[] }

export type ComprobanteAbierto = {
  id: string
  clienteId: string
  numeroVisible: string
  numero: number
  fecha: string
  total: number
  saldo: number
}

export type RetencionDisponible = {
  id: string
  clienteId: string
  impuesto: string
  certificado: string
  importe: number // disponible, centavos
  fecha: string
  ordenPago?: string | null
  comprobanteCitadoId?: string | null
}

export type Clasificacion =
  | { tipo: 'cobranza_posible' }
  | { tipo: 'no_cobranza'; motivo: string }
  | { tipo: 'debito' }

const PATRONES_NO_COBRANZA: Array<[RegExp, string]> = [
  [/rescate|fci|fondo com[uú]n|plazo fijo|inversi[oó]n|cauci[oó]n/i, 'Rescate o movimiento de inversión'],
  [/entre cuentas|cuenta propia|ctas? propias|transf\.? propia|misma titularidad/i, 'Transferencia entre cuentas propias'],
  [/revers|contrasiento|anulaci[oó]n|devoluci[oó]n de d[eé]bito|contracargo/i, 'Reverso o anulación bancaria'],
  [/inter[eé]s(es)? (ganado|acreditado)|acreditaci[oó]n de intereses/i, 'Intereses bancarios'],
]

export function clasificarMovimiento(mov: MovimientoBancario, cuitPropio: string): Clasificacion {
  if (mov.importe <= 0) return { tipo: 'debito' }
  if (mov.cuitContraparte && limpiarCuit(mov.cuitContraparte) === limpiarCuit(cuitPropio)) {
    return { tipo: 'no_cobranza', motivo: 'Transferencia entre cuentas propias' }
  }
  const texto = `${mov.concepto ?? ''} ${mov.referencia ?? ''}`
  for (const [re, motivo] of PATRONES_NO_COBRANZA) if (re.test(texto)) return { tipo: 'no_cobranza', motivo }
  return { tipo: 'cobranza_posible' }
}

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export type Identificacion = { cliente: ClienteIdentidad; via: 'cuit' | 'alias' } | null

export function identificarCliente(mov: MovimientoBancario, clientes: ClienteIdentidad[]): Identificacion[] {
  const cuit = limpiarCuit(mov.cuitContraparte)
  if (cuit) {
    const porCuit = clientes.filter(c => limpiarCuit(c.cuit) === cuit)
    if (porCuit.length) return porCuit.map(c => ({ cliente: c, via: 'cuit' as const }))
  }
  const texto = ` ${normalizar(`${mov.nombreContraparte ?? ''} ${mov.concepto ?? ''} ${mov.referencia ?? ''}`)} `
  return clientes
    .filter(c => [c.razonSocial, ...c.alias].some(a => {
      const n = normalizar(a)
      return n.length >= 4 && texto.includes(` ${n} `)
    }))
    .map(c => ({ cliente: c, via: 'alias' as const }))
}

export type Fuerza = 'fuerte' | 'media' | 'debil'

export type AplicacionPropuesta = {
  comprobanteId: string
  origen: 'cobro' | 'retencion'
  origenId: string
  importe: number
  vinculo: 'citado' | 'inferido'
}

export type Propuesta = {
  movimientoId: string
  clienteId: string | null
  fuerza: Fuerza
  aplicaciones: AplicacionPropuesta[]
  motivos: string[]
  advertencias: string[]
}

const MAX_COMBINACION = 4

function combinaciones<T>(items: T[], k: number): T[][] {
  const out: T[][] = []
  const rec = (inicio: number, acc: T[]) => {
    if (acc.length === k) { out.push(acc.slice()); return }
    for (let i = inicio; i < items.length; i++) { acc.push(items[i]); rec(i + 1, acc); acc.pop() }
  }
  rec(0, [])
  return out
}

function citaNumero(mov: MovimientoBancario, c: ComprobanteAbierto): boolean {
  const texto = `${mov.concepto ?? ''} ${mov.referencia ?? ''}`
  return new RegExp(`(^|\\D)0*${c.numero}(\\D|$)`).test(texto)
}

/** Grupos de retenciones que podrían acompañar a este cobro: por orden de pago, o todas las cercanas. */
function gruposRetenciones(mov: MovimientoBancario, rets: RetencionDisponible[]): RetencionDisponible[][] {
  const cercanas = rets.filter(r => r.importe > 0 && Math.abs(Date.parse(r.fecha) - Date.parse(mov.fecha)) <= 15 * 86400000)
  const porOp = new Map<string, RetencionDisponible[]>()
  for (const r of cercanas) if (r.ordenPago) porOp.set(r.ordenPago, [...(porOp.get(r.ordenPago) ?? []), r])
  const grupos = Array.from(porOp.values())
  if (cercanas.length && !grupos.some(g => g.length === cercanas.length)) grupos.push(cercanas)
  return grupos
}

export function proponerAsociaciones(input: {
  movimiento: MovimientoBancario
  cuitPropio: string
  clientes: ClienteIdentidad[]
  comprobantes: ComprobanteAbierto[]
  retenciones: RetencionDisponible[]
}): { clasificacion: Clasificacion; propuestas: Propuesta[] } {
  const { movimiento: mov } = input
  const clasificacion = clasificarMovimiento(mov, input.cuitPropio)
  if (clasificacion.tipo !== 'cobranza_posible') return { clasificacion, propuestas: [] }
  const disponible = mov.importe - (mov.aplicado ?? 0)
  if (disponible <= 0) return { clasificacion, propuestas: [] }

  const identificados = identificarCliente(mov, input.clientes)
  const propuestas: Propuesta[] = []

  if (!identificados.length) {
    // Sin identidad: sólo se informa la coincidencia de importe, como débil.
    for (const c of input.comprobantes) {
      if (c.saldo === disponible && c.fecha <= mov.fecha) {
        propuestas.push({
          movimientoId: mov.id, clienteId: c.clienteId, fuerza: 'debil',
          aplicaciones: [{ comprobanteId: c.id, origen: 'cobro', origenId: mov.id, importe: disponible, vinculo: 'inferido' }],
          motivos: [`El importe coincide con el saldo de ${c.numeroVisible}.`],
          advertencias: ['No se identificó al cliente (CUIT o alias): la igualdad de importe sola no confirma el pago.'],
        })
      }
    }
    return { clasificacion, propuestas }
  }

  for (const ident of identificados) {
    const cli = ident.cliente
    const abiertos = input.comprobantes
      .filter(c => c.clienteId === cli.id && c.saldo > 0 && c.fecha <= mov.fecha)
      .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.numero - b.numero)
    const rets = input.retenciones.filter(r => r.clienteId === cli.id)
    const motivoId = ident.via === 'cuit' ? `CUIT del ordenante coincide con ${cli.razonSocial}.` : `El texto del movimiento menciona un alias de ${cli.razonSocial}.`
    const encontradas: Propuesta[] = []

    // 1) Un comprobante: cobro solo, o cobro + grupo de retenciones certificadas.
    for (const c of abiertos) {
      if (c.saldo === disponible) {
        encontradas.push({
          movimientoId: mov.id, clienteId: cli.id, fuerza: 'fuerte',
          aplicaciones: [{ comprobanteId: c.id, origen: 'cobro', origenId: mov.id, importe: disponible, vinculo: citaNumero(mov, c) ? 'citado' : 'inferido' }],
          motivos: [motivoId, `El ingreso iguala el saldo de ${c.numeroVisible}.`, ...(citaNumero(mov, c) ? [`La referencia cita el número ${c.numero}.`] : [])],
          advertencias: [],
        })
      }
      for (const grupo of gruposRetenciones(mov, rets)) {
        const sumaRet = grupo.reduce((a, r) => a + r.importe, 0)
        if (disponible + sumaRet !== c.saldo) continue
        const citanTodas = grupo.every(r => r.comprobanteCitadoId === c.id)
        const ops = Array.from(new Set(grupo.map(r => r.ordenPago).filter(Boolean)))
        encontradas.push({
          movimientoId: mov.id, clienteId: cli.id, fuerza: 'fuerte',
          aplicaciones: [
            ...grupo.map(r => ({ comprobanteId: c.id, origen: 'retencion' as const, origenId: r.id, importe: r.importe, vinculo: (r.comprobanteCitadoId === c.id ? 'citado' : 'inferido') as 'citado' | 'inferido' })),
            { comprobanteId: c.id, origen: 'cobro', origenId: mov.id, importe: disponible, vinculo: citaNumero(mov, c) ? 'citado' : 'inferido' },
          ],
          motivos: [
            motivoId,
            `Ingreso + retenciones certificadas (${grupo.map(r => `${r.impuesto} ${r.certificado}`).join(', ')}) = saldo exacto de ${c.numeroVisible}.`,
            ...(ops.length === 1 && grupo.length > 1 ? [`Todos los certificados remiten a la orden de pago ${ops[0]}.`] : []),
          ],
          advertencias: citanTodas ? [] : ['Los certificados no citan la factura: el vínculo con el comprobante es inferido por importe, cliente y orden de pago.'],
        })
      }
    }

    // 2) Varios comprobantes pagados juntos (sin retenciones).
    if (!encontradas.length) {
      const candidatos = abiertos.slice(0, 12)
      for (let k = 2; k <= Math.min(MAX_COMBINACION, candidatos.length) && !encontradas.length; k++) {
        for (const combo of combinaciones(candidatos, k)) {
          if (combo.reduce((a, c) => a + c.saldo, 0) !== disponible) continue
          encontradas.push({
            movimientoId: mov.id, clienteId: cli.id, fuerza: 'media',
            aplicaciones: combo.map(c => ({ comprobanteId: c.id, origen: 'cobro' as const, origenId: mov.id, importe: c.saldo, vinculo: (citaNumero(mov, c) ? 'citado' : 'inferido') as 'citado' | 'inferido' })),
            motivos: [motivoId, `El ingreso iguala la suma de ${combo.map(c => c.numeroVisible).join(' + ')}.`],
            advertencias: ['Pago de varios comprobantes: confirmar con la orden de pago o el detalle del cliente.'],
          })
        }
      }
    }

    if (!encontradas.length) {
      propuestas.push({
        movimientoId: mov.id, clienteId: cli.id, fuerza: 'debil', aplicaciones: [],
        motivos: [motivoId],
        advertencias: ['El importe no explica ningún saldo: queda como cobro pendiente de aplicar (posible pago parcial o anticipo).'],
      })
      continue
    }

    // Ambigüedad: más de una explicación exacta → ninguna es fuerte.
    if (encontradas.length > 1) {
      for (const p of encontradas) {
        p.fuerza = 'media'
        p.advertencias.push(`Hay ${encontradas.length} combinaciones que explican el mismo importe: elegir con el respaldo del cliente.`)
      }
    }
    for (const p of encontradas) {
      if (ident.via === 'alias' && p.fuerza === 'fuerte') {
        p.fuerza = 'media'
        p.advertencias.push('Cliente identificado por alias, no por CUIT.')
      }
      // Control de saldo previo: comprobantes más viejos impagos que no entran en la propuesta.
      const usados = new Set(p.aplicaciones.map(a => a.comprobanteId))
      const primeraFecha = abiertos.filter(c => usados.has(c.id)).map(c => c.fecha).sort()[0]
      const previos = abiertos.filter(c => !usados.has(c.id) && primeraFecha && c.fecha < primeraFecha)
      if (previos.length) p.advertencias.push(`El cliente tiene ${previos.length} comprobante(s) anterior(es) impago(s): confirmar que este pago no corresponde a ellos.`)
      propuestas.push(p)
    }
  }
  return { clasificacion, propuestas }
}
