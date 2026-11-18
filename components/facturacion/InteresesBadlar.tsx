'use client'
// Cobranzas → Intereses por mora (BADLAR). SÓLO CÁLCULO: no registra intereses ni pide notas de débito.
// Para cada factura pagada fuera de término o todavía vencida: el interés día por día con la tasa BADLAR de
// bancos privados del BCRA (× factor + puntos), desde el día siguiente al vencimiento (+ días de gracia) hasta
// cada cobro (lib/facturacion/intereses-variables: mismas reglas que fact_interes_calcular, con tasa diaria).
// El vencimiento sale del contrato vigente. Para cobrarlo: Comprobantes → NC/ND → nota de débito.
import { Fragment, useEffect, useMemo, useState } from 'react'
import { api, leer } from '@/lib/facturacion/datos'
import { numeroVisible } from '@/lib/facturacion/comprobantes'
import { conVencimiento, detalleVencimiento, estadoCobro, vencimientoDe } from '@/lib/facturacion/estado-cobro'
import { cargarCondicionesPago, leerTodo } from '@/lib/facturacion/condiciones-pago'
import { corregirTasa, interesConTasaVariable, type Movimiento, type PuntoSerie } from '@/lib/facturacion/intereses-variables'
import { fechaArgentina, sumarDias } from '@/lib/periodo-argentina'
import { S, fecha, pesos, useAccion } from './comun'

const CLAVE_AJUSTES = 'cobranzas.intereses_badlar'
type Ajustes = { factor: string; puntos: string; gracia: string }
const AJUSTES_INICIALES: Ajustes = { factor: '1', puntos: '0', gracia: '0' }
const numero = (s: string, def: number) => { const n = Number(String(s).trim().replace(',', '.')); return String(s).trim() !== '' && Number.isFinite(n) ? n : def }
const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toLocaleString('es-AR', { maximumFractionDigits: 4 })} %`)
const ND = [2, 7, 202]

type Datos = { filas: any[]; movs: Map<string, Movimiento[]>; ultimoCobro: Map<string, string>; clientes: Map<string, string> }
type Badlar = { serie: PuntoSerie[]; fuente: string; ultima: PuntoSerie | null; desde: string; hasta: string }

export default function InteresesBadlar() {
  const hoy = fechaArgentina()
  const [hasta, setHasta] = useState(hoy)
  const [ajustes, setAjustes] = useState<Ajustes>(AJUSTES_INICIALES)
  const [cargados, setCargados] = useState(false)
  // Ajustes de la corrección: se recuerdan en este navegador (no son datos de la empresa).
  useEffect(() => {
    try { setAjustes({ ...AJUSTES_INICIALES, ...JSON.parse(localStorage.getItem(CLAVE_AJUSTES) ?? '{}') }) } catch { /* sin almacenamiento */ }
    setCargados(true)
  }, [])
  useEffect(() => { if (cargados) try { localStorage.setItem(CLAVE_AJUSTES, JSON.stringify(ajustes)) } catch { /* sin almacenamiento */ } }, [ajustes, cargados])
  const [cli, setCli] = useState('')
  const [filtro, setFiltro] = useState<'todas' | 'pagadas' | 'impagas'>('todas')
  const [abierta, setAbierta] = useState<string | null>(null)
  const [datos, setDatos] = useState<Datos | null>(null)
  const [badlar, setBadlar] = useState<Badlar | null>(null)
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

  // BADLAR del BCRA desde un poco antes del vencimiento más viejo hasta la fecha de cálculo.
  const desdeSerie = useMemo(() => {
    const vtos = (datos?.filas ?? []).map(f => vencimientoDe(f)).sort()
    return vtos.length ? sumarDias(vtos[0], -15) : null
  }, [datos])
  useEffect(() => {
    if (!desdeSerie || hasta < desdeSerie) return
    if (badlar && badlar.desde <= desdeSerie && badlar.hasta >= hasta) return
    correr(async () => {
      const r = await api<any>(`badlar?desde=${desdeSerie}&hasta=${hasta}`, undefined, 'GET')
      setBadlar({ serie: r.serie ?? [], fuente: r.fuente, ultima: r.ultima ?? null, desde: desdeSerie, hasta })
    })
  }, [desdeSerie, hasta]) // eslint-disable-line react-hooks/exhaustive-deps

  const correccion = { factor: numero(ajustes.factor, 1), puntos: numero(ajustes.puntos, 0) }
  const gracia = Math.max(0, Math.trunc(numero(ajustes.gracia, 0)))

  const calculadas = useMemo(() => {
    if (!datos || !badlar) return []
    return datos.filas.flatMap(f => {
      const est = estadoCobro(f, hasta)
      if (est.estado === 'anulada' || est.estado === 'por_vencer') return []
      const vto = vencimientoDe(f)
      const movs = datos.movs.get(f.comprobante_id) ?? []
      // Lo que queda impago sólo por retenciones no genera interés: se calcula hasta el día anterior al último cobro.
      const ult = datos.ultimoCobro.get(f.comprobante_id)
      const corte = est.estado === 'cobrada_retenciones' && ult ? sumarDias(ult, -1) : hasta
      const r = interesConTasaVariable({ total_c: Number(f.total_c), vencimiento: vto, graciaDias: gracia, movimientos: movs, hasta: corte < hasta ? corte : hasta, serie: badlar.serie, correccion })
      if (r.interes_c <= 0) return []
      const pagadaEl = est.estado === 'pagada' ? movs.filter(m => m.importe_c < 0).map(m => m.fecha).sort().pop() ?? null : null
      const tasaMedia = r.dias_mora ? r.tramos.reduce((s, t) => s + t.tasa_promedio * t.dias, 0) / r.dias_mora : null
      return [{ ...f, est, vto, r, pagadaEl, tasaMedia, cliente: datos.clientes.get(f.cliente_id) ?? 'sin cliente',
        nv: numeroVisible({ tipo: Number(f.tipo), puntoVenta: Number(f.punto_venta), numero: Number(f.numero) }) }]
    })
  }, [datos, badlar, hasta, ajustes]) // eslint-disable-line react-hooks/exhaustive-deps

  const visibles = calculadas.filter(x => (!cli || x.cliente_id === cli) && (filtro === 'todas' || (filtro === 'pagadas') === (x.est.estado === 'pagada')))
  const total = visibles.reduce((s, x) => s + x.r.interes_c, 0)
  const clientesConInteres = Array.from(new Set(calculadas.map(x => x.cliente_id))).map(id => ({ id, nombre: datos?.clientes.get(id) ?? 'sin cliente' })).sort((a, b) => a.nombre.localeCompare(b.nombre))
  const campo = (k: keyof Ajustes, ancho = 70) => <input style={{ ...S.input, width: ancho }} inputMode="decimal" value={ajustes[k]} onChange={e => setAjustes({ ...ajustes, [k]: e.target.value })} />

  return (
    <div style={S.card}>
      <h3 style={S.h3}>Intereses por mora con BADLAR · sólo cálculo</h3>
      <div style={S.sub}>No registra intereses ni pide notas de débito: muestra cuánto da el interés de cada factura pagada fuera de término o todavía vencida. Para cobrarlo, Comprobantes → NC/ND → nota de débito con este importe (más IVA).</div>
      <div style={{ ...S.fila, marginTop: 8 }}>
        <label style={S.sub}>Calcular hasta <input type="date" style={S.input} value={hasta} onChange={e => e.target.value && setHasta(e.target.value)} /></label>
        <label style={S.sub}>BADLAR × {campo('factor')}</label>
        <label style={S.sub}>+ puntos {campo('puntos')}</label>
        <label style={S.sub}>Días de gracia {campo('gracia', 60)}</label>
        <select style={S.input} value={cli} onChange={e => setCli(e.target.value)}>
          <option value="">Todos los clientes</option>
          {clientesConInteres.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        {(['todas', 'pagadas', 'impagas'] as const).map(k => <button key={k} style={filtro === k ? S.btn : S.btn2} onClick={() => setFiltro(k)}>
          {k === 'todas' ? 'Todas' : k === 'pagadas' ? 'Pagadas fuera de término' : 'Vencidas sin pagar'}</button>)}
        <Mensaje />
      </div>
      <div style={{ ...S.sub, marginTop: 6 }}>
        Tasa: {badlar?.fuente ?? 'BADLAR de bancos privados (BCRA)'}{badlar?.ultima ? ` · último dato ${fecha(badlar.ultima.fecha)}: ${pct(badlar.ultima.valor)} → corregida ${pct(corregirTasa(badlar.ultima.valor, correccion))}` : ''}.
        {' '}Cada día se usa la del último día hábil publicado, × {correccion.factor} + {correccion.puntos} puntos. Interés simple: saldo × tasa / 36.500 por día,
        {' '}desde el día siguiente al vencimiento{gracia ? ` + ${gracia} días de gracia` : ''} (el del contrato vigente); el día del cobro no cuenta; lo que falta sólo por retenciones no genera interés.
      </div>
      {ocupado && !badlar && <div style={{ ...S.sub, marginTop: 8 }}>Calculando…</div>}
      {badlar && <>
        <div style={{ marginTop: 10, fontSize: 15 }}><b>{pesos(total)}</b> <span style={S.sub}>de interés en {visibles.length} factura(s)</span></div>
        <div style={{ overflowX: 'auto', marginTop: 6 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead><tr>{['Factura', 'Cliente', 'Vence', 'Pagada el / saldo', 'Días de mora', 'Tasa media', 'Interés'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {visibles.map(x => <Fragment key={x.comprobante_id}>
                <tr onClick={() => setAbierta(abierta === x.comprobante_id ? null : x.comprobante_id)} style={{ cursor: 'pointer', background: abierta === x.comprobante_id ? '#111c35' : undefined }}>
                  <td style={S.td}>{x.nv}<div style={S.sub}>{fecha(x.fecha_emision)}</div></td>
                  <td style={S.td}>{x.cliente}</td>
                  <td style={S.td} title={detalleVencimiento(x)}>{fecha(x.vto)}{!x.vto_comercial && <div style={{ ...S.sub, color: '#fbbf24' }}>{detalleVencimiento(x)}</div>}</td>
                  <td style={S.td}>{x.pagadaEl ? `pagada el ${fecha(x.pagadaEl)}` : `saldo ${pesos(x.saldo_c)}`}</td>
                  <td style={S.num}>{x.r.dias_mora}</td>
                  <td style={S.num}>{pct(x.tasaMedia == null ? null : Math.round(x.tasaMedia * 100) / 100)}</td>
                  <td style={S.num}><b>{pesos(x.r.interes_c)}</b></td>
                </tr>
                {abierta === x.comprobante_id && <tr><td style={S.td} colSpan={7}>
                  <table style={{ borderCollapse: 'collapse' }}><tbody>
                    {x.r.tramos.map((t: any, i: number) => <tr key={i}>
                      <td style={S.td}>{fecha(t.desde)} a {fecha(t.hasta)}</td><td style={S.num}>{t.dias} días</td><td style={S.num}>sobre {pesos(t.saldo_c)}</td>
                      <td style={S.num}>tasa media {pct(Math.round(t.tasa_promedio * 100) / 100)}</td><td style={S.num}>{pesos(t.interes_c)}</td>
                    </tr>)}
                    <tr><td style={S.td} colSpan={4}>Total del interés{x.r.dias_sin_tasa ? ` (${x.r.dias_sin_tasa} días sin tasa publicada no se cuentan)` : ''}</td><td style={S.num}><b>{pesos(x.r.interes_c)}</b></td></tr>
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
