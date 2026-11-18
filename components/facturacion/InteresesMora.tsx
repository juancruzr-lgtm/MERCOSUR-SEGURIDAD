'use client'
// Cobranzas → Intereses por mora (TIM). SÓLO CÁLCULO: no registra intereses ni pide notas de débito.
// Para cada factura pagada fuera de término o todavía vencida: el interés con la Tasa de Intereses Moratorios
// (TIM) del BCRA (CCyC art. 768 inc. c), con la misma cuenta que su calculadora oficial, por tramos de saldo:
// desde el día siguiente al vencimiento del contrato vigente (+ días de gracia) hasta cada pago
// (lib/facturacion/intereses-variables). Para cobrarlo: Comprobantes → NC/ND → nota de débito.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { api, leer } from '@/lib/facturacion/datos'
import { numeroVisible } from '@/lib/facturacion/comprobantes'
import { conVencimiento, detalleVencimiento, estadoCobro, vencimientoDe } from '@/lib/facturacion/estado-cobro'
import { cargarCondicionesPago, leerTodo } from '@/lib/facturacion/condiciones-pago'
import { interesConTim, type Movimiento, type PuntoSerie } from '@/lib/facturacion/intereses-variables'
import { CALCULADORA_TIM } from '@/lib/facturacion/serie-bcra'
import { fechaArgentina, sumarDias } from '@/lib/periodo-argentina'
import { S, fecha, pesos, useAccion } from './comun'

const CLAVE_GRACIA = 'cobranzas.intereses_tim.gracia'
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('es-AR', { maximumFractionDigits: 2 })} %`)
const ND = [2, 7, 202]

type Datos = { filas: any[]; movs: Map<string, Movimiento[]>; ultimoCobro: Map<string, string>; clientes: Map<string, string> }
type Tim = { serie: PuntoSerie[]; fuente: string; ultima: PuntoSerie | null; desde: string; hasta: string }

export default function InteresesMora() {
  const hoy = fechaArgentina()
  const [hasta, setHasta] = useState(hoy)
  const [gracia, setGracia] = useState('0')
  const [cargada, setCargada] = useState(false)
  // Los días de gracia se recuerdan en este navegador (no son datos de la empresa).
  useEffect(() => { try { setGracia(localStorage.getItem(CLAVE_GRACIA) ?? '0') } catch { /* sin almacenamiento */ } setCargada(true) }, [])
  useEffect(() => { if (cargada) try { localStorage.setItem(CLAVE_GRACIA, gracia) } catch { /* sin almacenamiento */ } }, [gracia, cargada])
  const [cli, setCli] = useState('')
  const [filtro, setFiltro] = useState<'todas' | 'pagadas' | 'impagas'>('todas')
  const [abierta, setAbierta] = useState<string | null>(null)
  const [datos, setDatos] = useState<Datos | null>(null)
  const [tim, setTim] = useState<Tim | null>(null)
  const { ocupado, correr, Mensaje } = useAccion()

  async function cargar() {
    const [saldos, cond, aps, cobros, rets, notas, cls] = await Promise.all([
      leer('fact_v_saldos', q => q.in('tipo', [1, 6, 201]).limit(5000)),
      cargarCondicionesPago(),
      leerTodo<any>('fact_aplicaciones', 'comprobante_id, cobro_id, retencion_id, importe_c', 'id', q => q.is('revertida_at', null).not('comprobante_id', 'is', null)),
      leerTodo<any>('fact_cobros', 'id, fecha', 'id'),
      leerTodo<any>('fact_retenciones', 'id, fecha', 'id'),
      leerTodo<any>('fact_comprobantes', 'asociado_id, tipo, fecha_emision, total_c', 'id', q => q.eq('ambiente', 'produccion').not('asociado_id', 'is', null).in('tipo', [2, 3, 7, 8, 202, 203])),
      leer('fact_clientes', q => q.order('razon_social'), 'id, razon_social'),
    ])
    // Movimientos del saldo de cada factura, como fact_movimientos_saldo: ND (+), NC (−), cobros y retenciones aplicados (−).
    const fechaCobro = new Map<string, string>(cobros.map((x: any) => [x.id, String(x.fecha).slice(0, 10)]))
    const fechaRet = new Map<string, string>(rets.map((x: any) => [x.id, String(x.fecha).slice(0, 10)]))
    const movs = new Map<string, Movimiento[]>()
    const ultimoCobro = new Map<string, string>()
    const agregar = (id: string, m: Movimiento) => movs.set(id, [...(movs.get(id) ?? []), m])
    for (const a of aps) {
      const f = (a.cobro_id && fechaCobro.get(a.cobro_id)) || (a.retencion_id && fechaRet.get(a.retencion_id))
      if (!f) continue
      agregar(a.comprobante_id, { fecha: f, importe_c: -Number(a.importe_c) })
      if (a.cobro_id && f > (ultimoCobro.get(a.comprobante_id) ?? '')) ultimoCobro.set(a.comprobante_id, f)
    }
    for (const n of notas) agregar(n.asociado_id, { fecha: String(n.fecha_emision).slice(0, 10), importe_c: ND.includes(Number(n.tipo)) ? Number(n.total_c) : -Number(n.total_c) })
    setDatos({ filas: conVencimiento(saldos, cond), movs, ultimoCobro, clientes: new Map(cls.map((c: any) => [c.id, c.razon_social])) })
  }
  useEffect(() => { correr(cargar) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // TIM del BCRA desde el día anterior al vencimiento más viejo hasta la fecha de cálculo.
  const desdeSerie = useMemo(() => {
    const vtos = (datos?.filas ?? []).map(f => vencimientoDe(f)).sort()
    return vtos.length ? sumarDias(vtos[0], -1) : null
  }, [datos])
  useEffect(() => {
    if (!desdeSerie || hasta < desdeSerie) return
    if (tim && tim.desde <= desdeSerie && tim.hasta >= hasta) return
    correr(async () => {
      const r = await api<any>(`tim?desde=${desdeSerie}&hasta=${hasta}`, undefined, 'GET')
      setTim({ serie: r.serie ?? [], fuente: r.fuente, ultima: r.ultima ?? null, desde: desdeSerie, hasta })
    })
  }, [desdeSerie, hasta]) // eslint-disable-line react-hooks/exhaustive-deps

  const diasGracia = Math.max(0, Math.trunc(Number(String(gracia).replace(',', '.')) || 0))

  const calculadas = useMemo(() => {
    if (!datos || !tim) return []
    return datos.filas.flatMap(f => {
      const est = estadoCobro(f, hasta)
      if (est.estado === 'anulada' || est.estado === 'por_vencer') return []
      const vto = vencimientoDe(f)
      const movs = datos.movs.get(f.comprobante_id) ?? []
      // Lo que queda impago sólo por retenciones no genera interés: se calcula hasta el último cobro.
      const ult = datos.ultimoCobro.get(f.comprobante_id)
      const corte = est.estado === 'cobrada_retenciones' && ult && ult < hasta ? ult : hasta
      const r = interesConTim({ total_c: Number(f.total_c), vencimiento: vto, graciaDias: diasGracia, movimientos: movs, hasta: corte, serie: tim.serie })
      if (r.interes_c <= 0) return []
      const pagadaEl = est.estado === 'pagada' ? movs.filter(m => m.importe_c < 0).map(m => m.fecha).sort().pop() ?? null : null
      const tnaMedia = r.dias_mora ? r.tramos.reduce((s, t) => s + t.tna_equivalente * t.dias, 0) / r.dias_mora : null
      return [{ ...f, est, vto, r, pagadaEl, tnaMedia, cliente: datos.clientes.get(f.cliente_id) ?? 'sin cliente',
        nv: numeroVisible({ tipo: Number(f.tipo), puntoVenta: Number(f.punto_venta), numero: Number(f.numero) }) }]
    })
  }, [datos, tim, hasta, diasGracia])

  const visibles = calculadas.filter(x => (!cli || x.cliente_id === cli) && (filtro === 'todas' || (filtro === 'pagadas') === (x.est.estado === 'pagada')))
  const total = visibles.reduce((s, x) => s + x.r.interes_c, 0)
  const clientesConInteres = Array.from(new Set(calculadas.map(x => x.cliente_id))).map(id => ({ id, nombre: datos?.clientes.get(id) ?? 'sin cliente' })).sort((a, b) => a.nombre.localeCompare(b.nombre))

  return (
    <div style={S.card}>
      <h3 style={S.h3}>Intereses por mora con la TIM del BCRA · sólo cálculo</h3>
      <div style={S.sub}>No registra intereses ni pide notas de débito: muestra cuánto da el interés de cada factura pagada fuera de término o todavía vencida. Para cobrarlo, Comprobantes → NC/ND → nota de débito con este importe (más IVA).</div>
      <div style={{ ...S.fila, marginTop: 8 }}>
        <label style={S.sub}>Calcular hasta <input type="date" style={S.input} value={hasta} onChange={e => e.target.value && setHasta(e.target.value)} /></label>
        <label style={S.sub}>Días de gracia <input style={{ ...S.input, width: 60 }} inputMode="numeric" value={gracia} onChange={e => setGracia(e.target.value)} /></label>
        <select style={S.input} value={cli} onChange={e => setCli(e.target.value)}>
          <option value="">Todos los clientes</option>
          {clientesConInteres.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        {(['todas', 'pagadas', 'impagas'] as const).map(k => <button key={k} style={filtro === k ? S.btn : S.btn2} onClick={() => setFiltro(k)}>
          {k === 'todas' ? 'Todas' : k === 'pagadas' ? 'Pagadas fuera de término' : 'Vencidas sin pagar'}</button>)}
        <Mensaje />
      </div>
      <div style={{ ...S.sub, marginTop: 6 }}>
        Tasa: {tim?.fuente ?? 'Tasa de Intereses Moratorios (TIM) del BCRA'}{tim?.ultima ? ` · último dato ${fecha(tim.ultima.fecha)}` : ''}.
        {' '}Misma cuenta que la <a href={CALCULADORA_TIM} target="_blank" rel="noopener noreferrer" style={{ color: '#93c5fd' }}>calculadora del BCRA</a>:
        {' '}interés = saldo × ((100 + TIM del día de cierre) / (100 + TIM del día anterior al inicio)) − saldo, con inicio el día siguiente al vencimiento
        {diasGracia ? ` + ${diasGracia} días de gracia` : ''} (el del contrato vigente) y cierre el día de cada pago; lo que falta sólo por retenciones no genera interés.
      </div>
      {ocupado && !tim && <div style={{ ...S.sub, marginTop: 8 }}>Calculando…</div>}
      {tim && <>
        <div style={{ marginTop: 10, fontSize: 15 }}><b>{pesos(total)}</b> <span style={S.sub}>de interés en {visibles.length} factura(s)</span></div>
        <div style={{ overflowX: 'auto', marginTop: 6 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>{['Factura', 'Cliente', 'Vence', 'Pagada el / saldo', 'Días de mora', 'Tasa equivalente (TNA)', 'Interés'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {visibles.map(x => <Fragment key={x.comprobante_id}>
                <tr onClick={() => setAbierta(abierta === x.comprobante_id ? null : x.comprobante_id)} style={{ cursor: 'pointer', background: abierta === x.comprobante_id ? '#111c35' : undefined }}>
                  <td style={S.td}>{x.nv}<div style={S.sub}>{fecha(x.fecha_emision)}</div></td>
                  <td style={S.td}>{x.cliente}</td>
                  <td style={S.td} title={detalleVencimiento(x)}>{fecha(x.vto)}{!x.vto_comercial && <div style={{ ...S.sub, color: '#fbbf24' }}>{detalleVencimiento(x)}</div>}</td>
                  <td style={S.td}>{x.pagadaEl ? `pagada el ${fecha(x.pagadaEl)}` : `saldo ${pesos(x.saldo_c)}`}</td>
                  <td style={S.num}>{x.r.dias_mora}</td>
                  <td style={S.num}>{pct(x.tnaMedia == null ? null : Math.round(x.tnaMedia * 100) / 100)}</td>
                  <td style={S.num}><b>{pesos(x.r.interes_c)}</b></td>
                </tr>
                {abierta === x.comprobante_id && <tr><td style={S.td} colSpan={7}>
                  <table style={{ borderCollapse: 'collapse' }}><tbody>
                    {x.r.tramos.map((t: any, i: number) => <tr key={i}>
                      <td style={S.td}>{fecha(t.desde)} a {fecha(t.hasta)}</td><td style={S.num}>{t.dias} días</td><td style={S.num}>sobre {pesos(t.saldo_c)}</td>
                      <td style={S.num}>coef. {t.coeficiente.toLocaleString('es-AR', { maximumFractionDigits: 8 })}</td><td style={S.num}>{pesos(t.interes_c)}</td>
                    </tr>)}
                    <tr><td style={S.td} colSpan={4}>Total del interés{x.r.sin_dato ? ' (hay días sin dato de la TIM: no se cuentan)' : ''}</td><td style={S.num}><b>{pesos(x.r.interes_c)}</b></td></tr>
                  </tbody></table>
                </td></tr>}
              </Fragment>)}
              {!visibles.length && <tr><td style={S.td} colSpan={7}><span style={S.sub}>Ninguna factura genera interés con estos datos.</span></td></tr>}
            </tbody>
          </table>
        </div>
      </>}
    </div>
  )
}
