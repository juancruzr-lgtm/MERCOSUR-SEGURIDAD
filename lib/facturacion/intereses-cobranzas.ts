// Intereses por mora INFORMATIVOS en Cobranzas (Facturas y cobros, Cuenta por cliente, Intereses por mora), sólo
// para avisarle al cliente. Reúne lo necesario para calcularlos en pantalla — la tasa general, la de cada contrato,
// los movimientos del saldo de cada factura y la marca "no cobrar" — y pide al BCRA las series que hagan falta.
// Sólo lee: no registra intereses ni pide notas de débito. Si algo no se puede leer, las pantallas siguen sin
// intereses (y lo dicen).
import { useEffect, useMemo, useState } from 'react'
import { sumarDias } from '@/lib/periodo-argentina'
import { api, leer } from './datos'
import { leerTodo } from './condiciones-pago'
import { formatoPesos } from './dinero'
import { contratoDeFactura, estadoCobro, vencimientoDe, type CondicionesPago, type FacturaParaVencer, type SaldoFactura } from './estado-cobro'
import { interesConTasa, type Movimiento, type PuntoSerie, type ResultadoInteres, type SeriesBcra } from './intereses-variables'
import { SERIES_BCRA, type SerieBcra } from './serie-bcra'
import { describirTasa, tasaDelContrato, tasaGeneral, type ContratoMora, type TasaMora } from './tasa-mora'

const FACTURAS = [1, 6, 201]
const NOTAS = [2, 3, 7, 8, 202, 203]
const ND = [2, 7, 202]
const FECHA = /^\d{4}-\d{2}-\d{2}$/
/** Días que se piden antes del primer día de mora: la BADLAR sólo se publica en días hábiles. */
const MARGEN_SERIE = 10
const dia = (x: unknown) => String(x ?? '').slice(0, 10)
const dma = (x: string) => x.split('-').reverse().join('/')

export type NoCobrar = { motivo: string; at: string | null }
export interface DatosIntereses {
  general: TasaMora
  contratos: Map<string, ContratoMora>
  /** comprobante → movimientos de su saldo, como fact_v_saldos: ND (+), NC, cobros y retenciones aplicados (−). */
  movs: Map<string, Movimiento[]>
  /** comprobante → fecha del último cobro aplicado (no cuenta retenciones). */
  ultimoCobro: Map<string, string>
  noCobrar: Map<string, NoCobrar>
}
export type FilaInteres = FacturaParaVencer & SaldoFactura & { tipo?: number | string | null }
export interface InteresFactura extends ResultadoInteres {
  tasa: TasaMora
  /** true: la tasa es la del contrato; false: la general. */
  propia: boolean
  graciaDias: number
  vencimiento: string
  /** Día en que quedaron cerrados los días: el del pago si ya se pagó (o el último cobro si sólo faltan retenciones); null si sigue corriendo. */
  cerradaEl: string | null
  noCobrar: NoCobrar | null
}

export async function cargarDatosIntereses(): Promise<DatosIntereses> {
  const [cfg, contratos, aps, cobros, rets, notas, seg] = await Promise.all([
    leer<{ valor: unknown }>('fact_config', q => q.eq('clave', 'intereses'), 'valor'),
    leerTodo<ContratoMora>('fact_contratos', 'id, mora_tasa_tipo, mora_tasa_factor, mora_tasa, mora_tasa_periodo, mora_gracia_dias', 'id'),
    leerTodo<any>('fact_aplicaciones', 'comprobante_id, cobro_id, retencion_id, importe_c', 'id', q => q.is('revertida_at', null).not('comprobante_id', 'is', null)),
    leerTodo<any>('fact_cobros', 'id, fecha', 'id'),
    leerTodo<any>('fact_retenciones', 'id, fecha', 'id'),
    leerTodo<any>('fact_comprobantes', 'asociado_id, tipo, fecha_emision, total_c', 'id', q => q.eq('ambiente', 'produccion').not('asociado_id', 'is', null).in('tipo', NOTAS)),
    leerTodo<any>('fact_comprobante_seguimiento', 'comprobante_id, interes_no_cobrar_motivo, interes_no_cobrar_at', 'comprobante_id', q => q.eq('interes_no_cobrar', true)),
  ])
  const fechaCobro = new Map<string, string>(cobros.map(x => [x.id, dia(x.fecha)]))
  const fechaRet = new Map<string, string>(rets.map(x => [x.id, dia(x.fecha)]))
  const movs = new Map<string, Movimiento[]>()
  const ultimoCobro = new Map<string, string>()
  const agregar = (id: string, m: Movimiento) => {
    if (!FECHA.test(m.fecha)) return
    const l = movs.get(id)
    if (l) l.push(m); else movs.set(id, [m])
  }
  for (const a of aps) {
    const f = (a.cobro_id && fechaCobro.get(a.cobro_id)) || (a.retencion_id && fechaRet.get(a.retencion_id))
    if (!f) continue
    agregar(a.comprobante_id, { fecha: f, importe_c: -Number(a.importe_c) })
    if (a.cobro_id && f > (ultimoCobro.get(a.comprobante_id) ?? '')) ultimoCobro.set(a.comprobante_id, f)
  }
  for (const n of notas) agregar(n.asociado_id, { fecha: dia(n.fecha_emision), importe_c: ND.includes(Number(n.tipo)) ? Number(n.total_c) : -Number(n.total_c) })
  return {
    general: tasaGeneral(cfg[0]?.valor),
    contratos: new Map(contratos.map(k => [k.id, k])),
    movs,
    ultimoCobro,
    noCobrar: new Map(seg.map(s => [s.comprobante_id, { motivo: String(s.interes_no_cobrar_motivo ?? ''), at: s.interes_no_cobrar_at ?? null }])),
  }
}

/** Sólo facturas (no notas sueltas) vencidas, con pagos parciales o pagadas: las anuladas y las por vencer no tienen mora. */
function enMora(f: FilaInteres, hasta: string) {
  if (!FACTURAS.includes(Number(f.tipo))) return null
  const est = estadoCobro(f, hasta).estado
  return est === 'anulada' || est === 'por_vencer' ? null : est
}
function tasaDeFactura(f: FilaInteres, cond: CondicionesPago | null, d: DatosIntereses) {
  const k = cond ? contratoDeFactura(f, cond) : null
  return tasaDelContrato(k ? d.contratos.get(k.id) : null, d.general)
}

/** Interés informativo de cada factura a la fecha `hasta` (las que no tienen mora no aparecen). */
export function calcularIntereses(filas: FilaInteres[], cond: CondicionesPago | null, d: DatosIntereses, series: SeriesBcra, hasta: string): Map<string, InteresFactura> {
  const out = new Map<string, InteresFactura>()
  for (const f of filas) {
    const est = enMora(f, hasta)
    if (!est) continue
    const { tasa, propia, graciaDias } = tasaDeFactura(f, cond, d)
    const vencimiento = vencimientoDe(f)
    const movs = d.movs.get(f.comprobante_id) ?? []
    let cerradaEl: string | null = null
    if (est === 'pagada') {
      const u = movs.filter(m => m.importe_c < 0).map(m => m.fecha).sort().pop() ?? null
      cerradaEl = u && u <= hasta ? u : null
    } else if (est === 'cobrada_retenciones') {
      // Lo que falta sólo por retenciones no genera interés: los días se cierran el día del último cobro.
      const u = d.ultimoCobro.get(f.comprobante_id) ?? null
      cerradaEl = u && u < hasta ? u : null
    }
    const r = interesConTasa({ total_c: Number(f.total_c), vencimiento, graciaDias, movimientos: movs, hasta: est === 'cobrada_retenciones' && cerradaEl ? cerradaEl : hasta, tasa, series })
    out.set(f.comprobante_id, { ...r, tasa, propia, graciaDias, vencimiento, cerradaEl, noCobrar: d.noCobrar.get(f.comprobante_id) ?? null })
  }
  return out
}

/** Qué series del BCRA hacen falta y desde qué día (el primer día de mora de las facturas que las usan). */
export function seriesNecesarias(filas: FilaInteres[], cond: CondicionesPago | null, d: DatosIntereses, hasta: string): Partial<Record<SerieBcra, string>> {
  const out: Partial<Record<SerieBcra, string>> = {}
  for (const f of filas) {
    if (!enMora(f, hasta)) continue
    const { tasa, graciaDias } = tasaDeFactura(f, cond, d)
    if (tasa.tipo !== 'badlar' && tasa.tipo !== 'tim') continue
    const inicio = sumarDias(vencimientoDe(f), graciaDias + 1)
    if (inicio > hasta) continue
    const ya = out[tasa.tipo]
    if (!ya || inicio < ya) out[tasa.tipo] = inicio
  }
  return out
}

/** Lo que se le avisaría al cliente: la suma sin las facturas marcadas "no cobrar". */
export function totalIntereses(ids: Iterable<string>, porFactura: Map<string, InteresFactura> | null): number {
  let total = 0
  if (porFactura) for (const id of Array.from(ids)) {
    const i = porFactura.get(id)
    if (i && !i.noCobrar) total += i.interes_c
  }
  return total
}

/** Texto para mandarle al cliente (copiar y pegar en un correo o WhatsApp). */
export function textoParaCliente(cliente: string, items: Array<{ numero: string; i: InteresFactura }>, hasta: string): string {
  const cobrables = items.filter(x => x.i.interes_c > 0 && !x.i.noCobrar)
  const lineas = cobrables.map(({ numero, i }) =>
    `• ${numero}: venció el ${dma(i.vencimiento)}; ${i.dias_mora} días de mora${i.cerradaEl ? ` hasta el pago del ${dma(i.cerradaEl)}` : ` al ${dma(hasta)}`}: ${formatoPesos(i.interes_c)} (${describirTasa(i.tasa)})`)
  const total = cobrables.reduce((s, x) => s + x.i.interes_c, 0)
  return [
    `${cliente} — intereses por mora al ${dma(hasta)}`,
    ...lineas,
    `Total: ${formatoPesos(total)}`,
    'Calculados sobre el saldo impago de cada factura desde el día siguiente a su vencimiento hasta el día del pago; las que siguen impagas suman hasta hoy.',
  ].join('\n')
}

type SerieCargada = { puntos: PuntoSerie[]; desde: string; hasta: string; ultima: PuntoSerie | null; fuente: string }

/**
 * Intereses informativos de las filas de fact_v_saldos (con su vencimiento comercial) a la fecha `hasta`.
 * `recarga`: cambiarlo vuelve a leer tasas, pagos y marcas (p. ej. después de marcar "no cobrar").
 * porFactura es null mientras carga.
 */
export function useIntereses(filas: FilaInteres[], cond: CondicionesPago | null, hasta: string, recarga = 0) {
  const [datos, setDatos] = useState<DatosIntereses | null>(null)
  const [series, setSeries] = useState<Partial<Record<SerieBcra, SerieCargada>>>({})
  const [errores, setErrores] = useState<Partial<Record<'datos' | SerieBcra, string>>>({})

  useEffect(() => {
    let vivo = true
    cargarDatosIntereses().then(
      d => { if (vivo) { setDatos(d); setErrores(e => ({ ...e, datos: undefined })) } },
      e => { if (vivo) setErrores(x => ({ ...x, datos: `No se pudieron leer los datos de los intereses: ${e?.message ?? e}` })) },
    )
    return () => { vivo = false }
  }, [recarga])

  const necesarias = useMemo(() => (datos ? seriesNecesarias(filas, cond, datos, hasta) : {}), [filas, cond, datos, hasta])
  const tipos = Object.keys(necesarias).sort() as SerieBcra[]
  const desdeDe = (s: SerieBcra) => sumarDias(necesarias[s] as string, -MARGEN_SERIE)
  const cubre = (s: SerieBcra) => { const x = series[s]; return !!x && x.desde <= desdeDe(s) && x.hasta >= hasta }
  const pedido = tipos.map(s => `${s}:${desdeDe(s)}`).join('|')

  useEffect(() => {
    let vivo = true
    for (const s of tipos) {
      if (cubre(s)) continue
      const desde = desdeDe(s)
      api<any>(`serie-bcra?serie=${s}&desde=${desde}&hasta=${hasta}`, undefined, 'GET').then(
        r => {
          if (!vivo) return
          setSeries(p => ({ ...p, [s]: { puntos: r.serie ?? [], desde, hasta, ultima: r.ultima ?? null, fuente: r.fuente ?? SERIES_BCRA[s].descripcion } }))
          setErrores(e => ({ ...e, [s]: undefined }))
        },
        e => { if (vivo) setErrores(x => ({ ...x, [s]: e?.message ?? `No se pudo consultar la ${SERIES_BCRA[s].nombre} al BCRA` })) },
      )
    }
    return () => { vivo = false }
  }, [pedido, hasta]) // eslint-disable-line react-hooks/exhaustive-deps

  const cargando = !errores.datos && (!datos || tipos.some(s => !errores[s] && !cubre(s)))
  const porFactura = useMemo(() => {
    if (!datos || cargando) return null
    return calcularIntereses(filas, cond, datos, { badlar: series.badlar?.puntos, tim: series.tim?.puntos }, hasta)
  }, [filas, cond, datos, series, hasta, cargando])
  const error = Object.values(errores).filter(Boolean).join(' · ') || null
  return { porFactura, general: datos?.general ?? null, series, cargando, error }
}
