/**
 * lib/facturacion/revision.ts
 *
 * Revisión ágil de prefacturas: una fila por comprobante (objetivo o grupo) con
 * las horas propuestas de Reportes, qué hay que mirar antes de aceptarlas y qué
 * puede aceptar "Aceptar todos". Sin acceso a datos: sólo decide con lo que recibe.
 */

import { periodoFacturacion } from './periodos'
import { tarifasParaObjetivo, type TarifaGuardada } from './prefacturacion'

const horasTexto = (m: number) => (m / 60).toFixed(2).replace(/\.?0+$/, '') || '0'

/** Advertencias de la propuesta de horas de un objetivo (no bloquean la aprobación individual). */
export function avisosHoras(separarDiurnaNocturna: boolean, r: any): string[] {
  const h = r?.horas, out: string[] = []
  if (!h) return out
  if (h.turnosFuturos > 0) out.push(`${h.turnosFuturos} turno(s) todavía no ocurrieron`)
  if (h.turnosSinRegistro > 0) out.push(`${h.turnosSinRegistro} turno(s) sin horas reconocidas`)
  if (h.revisar?.length) out.push(`${h.revisar.length} superposición(es) para revisión comercial`)
  if (separarDiurnaNocturna && !r.franjaDefinida) out.push('falta la franja nocturna del contrato')
  if (r.desvio?.hayDiferencia) out.push(`Reportes cambió después de aprobar: aprobado ${horasTexto(r.desvio.cubiertosAprobados)} h, hoy ${horasTexto(r.desvio.cubiertosActuales)} h`)
  return out
}

export type TratamientoDescubiertos = 'no_facturar' | 'facturar'

/**
 * Aprobación de horas de ESTE mes de facturación: el mismo período exacto que usa
 * el servidor (mes calendario o corte del contrato). Comparar sólo "YYYY-MM"
 * confundía la aprobación de octubre (hasta el 01/11 exclusivo) con noviembre.
 */
export function aprobacionDelMes<A extends { contrato_id: string; objetivo_id: string; periodo_desde: string; periodo_hasta_excl: string }>(
  aprobaciones: A[], contrato: { id: string; regla_periodo?: string | null; dia_corte?: number | string | null }, objetivoId: string, mes: string,
): A | null {
  let p: { desde: string; hastaExclusivo: string }
  try {
    p = periodoFacturacion(contrato.regla_periodo === 'corte' ? { tipo: 'corte', diaInicio: Number(contrato.dia_corte) } : { tipo: 'mes_calendario' }, mes)
  } catch { return null }
  return aprobaciones.find(a => a.contrato_id === contrato.id && a.objetivo_id === objetivoId
    && a.periodo_desde === p.desde && a.periodo_hasta_excl === p.hastaExclusivo) ?? null
}

/** Minutos que se proponen facturar: lo cubierto, más lo descubierto sólo si se decidió facturarlo. */
export function minutosPropuestos(r: any, trat?: TratamientoDescubiertos): number | null {
  const h = r?.horas
  if (!h) return null
  return trat === 'facturar' ? h.minutosCubiertos + h.minutosDescubiertos : h.minutosCubiertos
}

export type ObjetivoEnRevision = {
  objetivoId: string
  nombre: string
  propuesta: any | null // respuesta de api('horas', { accion: 'proponer' })
  error: string | null
  aprobada: { minutos_aprobados: number } | null
  tratamiento?: TratamientoDescubiertos // elegido en "Ver turnos"
}

export type FilaRevision = {
  modalidad: string
  separarDiurnaNocturna: boolean
  tarifas: TarifaGuardada[] // vigentes del contrato
  objetivos: ObjetivoEnRevision[]
  prefactura: { estado: string } | null
}

const BLOQUEADAS = ['aprobada_emitir', 'emitida']
export const sinHoras = (f: Pick<FilaRevision, 'modalidad'>) => f.modalidad === 'abono' || f.modalidad === 'presupuesto_anticipado'

/** Horas propuestas de la fila (suma de sus objetivos); null mientras falte calcular alguno. */
export function propuestaDeFila(f: FilaRevision): number | null {
  let total = 0
  for (const o of f.objetivos) {
    const m = minutosPropuestos(o.propuesta, o.tratamiento)
    if (m == null) return null
    total += m
  }
  return total
}

/** Objetivo con horas ya aprobadas iguales a la propuesta actual. */
export const objetivoAlDia = (o: ObjetivoEnRevision) => {
  const m = minutosPropuestos(o.propuesta, o.tratamiento)
  return o.aprobada != null && m != null && o.aprobada.minutos_aprobados === m
}

/**
 * Qué hay que mirar antes de aceptar. Cualquier motivo saca la fila de
 * "Aceptar todos": diferencias, falta de tarifa o inconsistencias se revisan a mano.
 */
export function motivosRevision(f: FilaRevision): string[] {
  const out: string[] = []
  const varios = f.objetivos.length > 1
  const de = (o: ObjetivoEnRevision, t: string) => (varios ? `${o.nombre}: ${t}` : t)
  if (f.prefactura && BLOQUEADAS.includes(f.prefactura.estado)) out.push(f.prefactura.estado === 'emitida' ? 'Ya emitida: no se cambia' : 'Prefactura aprobada: no se cambia')
  for (const o of f.objetivos) {
    if (o.error) out.push(de(o, `no se pudo calcular (${o.error})`))
    if (sinHoras(f)) continue
    for (const a of avisosHoras(f.separarDiurnaNocturna, o.propuesta)) out.push(de(o, a))
    const desc = o.propuesta?.horas?.minutosDescubiertos ?? 0
    if (desc > 0 && !o.tratamiento) out.push(de(o, `${horasTexto(desc)} h descubiertas: decidir en Ver turnos`))
    const m = minutosPropuestos(o.propuesta, o.tratamiento)
    if (o.aprobada && m != null && o.aprobada.minutos_aprobados !== m && !o.propuesta?.desvio?.hayDiferencia) {
      out.push(de(o, `aprobadas ${horasTexto(o.aprobada.minutos_aprobados)} h, hoy se proponen ${horasTexto(m)} h`))
    }
  }
  const conceptos = sinHoras(f) ? ['abono'] : f.separarDiurnaNocturna ? ['hora_diurna', 'hora_nocturna'] : ['hora']
  const sinTarifa = (f.objetivos.length ? f.objetivos.map(o => o.objetivoId) : [null])
    .filter(id => { const ts = tarifasParaObjetivo(f.tarifas, id); return conceptos.some(c => !ts.some(t => t.concepto === c)) })
  if (sinTarifa.length) out.push(varios ? `Sin tarifa: ${f.objetivos.filter(o => sinTarifa.includes(o.objetivoId)).map(o => o.nombre).join(', ')}` : 'Sin tarifa vigente')
  return out
}

/** Hay horas para aceptar en la fila (algún objetivo sin aprobar o con propuesta distinta). */
export const filaPendiente = (f: FilaRevision) => !sinHoras(f) && f.objetivos.some(o => !objetivoAlDia(o))

/** "Aceptar todos": sólo filas completas, pendientes y sin nada para revisar. */
export const elegibleParaAceptarTodos = (f: FilaRevision) => filaPendiente(f) && propuestaDeFila(f) != null && motivosRevision(f).length === 0

/** Objetivos de la fila que hay que aprobar (o reemplazar) al tocar Aceptar. */
export const objetivosParaAceptar = (f: FilaRevision) => f.objetivos.filter(o => o.propuesta && !objetivoAlDia(o))

// ── Exportación a Excel ────────────────────────────────────────────────────

const LETRA: Record<number, string> = { 1: 'A', 6: 'B', 201: 'FCE A' }
const ddmmaaaa = (d: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '')
const diaAnterior = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
const $ = (c: unknown) => (c == null ? null : Number(c) / 100)

/** Nombre visible del comprobante: el objetivo, el grupo o el contrato. */
export function nombreComprobante(p: { objetivo?: { nombre?: string | null } | null; agrupacion_clave?: string; grupo?: string | null; contrato?: { nombre?: string | null } | null }): string {
  if (p.objetivo?.nombre) return p.objetivo.nombre
  if (p.grupo) return p.grupo
  if (p.agrupacion_clave?.startsWith('grupo:')) return p.agrupacion_clave.split(':').slice(2).join(':')
  return p.contrato?.nombre ?? ''
}

/** Filas del Excel de prefacturas: un renglón por concepto con SU precio, y el total si hay más de uno. */
export function filasExcel(prefacturas: any[], estado: (p: any) => string): any[][] {
  const rows: any[][] = [['Cliente', 'CUIT', 'Factura', 'Objetivo o grupo', 'Período', 'Concepto', 'Cantidad (h)', 'Precio unitario', 'Neto', 'IVA', 'Total', 'Estado', 'Pendiente', 'Texto de la factura']]
  for (const f of prefacturas) {
    const base = [f.cliente?.razon_social ?? '', f.cliente?.cuit ?? '', LETRA[f.tipo_comprobante] ?? '', nombreComprobante(f),
      `${ddmmaaaa(f.periodo_desde)} – ${ddmmaaaa(diaAnterior(f.periodo_hasta_excl))}`]
    const pend = (f.requisitos ?? []).map((r: any) => r.detalle).join(' · ')
    const lineas = (f.lineas ?? []) as any[]
    if (!lineas.length) rows.push([...base, '', null, null, null, null, null, estado(f), pend, f.texto_factura ?? ''])
    lineas.forEach((l, i) => rows.push([...base, l.concepto, Number(l.cantidad), Number(l.precio), $(l.importes?.neto), $(l.importes?.iva), $(l.importes?.total),
      i === 0 ? estado(f) : '', i === 0 ? pend : '', i === 0 ? f.texto_factura ?? '' : '']))
    if (lineas.length > 1) rows.push([...base, 'TOTAL', null, null, $(f.neto_c), $(f.iva_c), $(f.total_c), '', '', ''])
  }
  return rows
}
