'use client'
// Cobranzas → Facturas y cobros: todas las facturas en orden cronológico con su estado de cobro.
// Tocar una factura abre su detalle (datos, notas de crédito, cobros aplicados, historial, PDF) y permite
// registrar el pago ahí mismo. Sólo lee; registrar el pago usa las mismas funciones que la cuenta corriente.
// Intereses por mora: informativos, para avisarle al cliente (lib/facturacion/intereses-cobranzas); a la fecha si
// la factura sigue impaga, con los días cerrados el día del pago si ya se cobró. Se pueden marcar "no cobrar".
import { Fragment, useEffect, useMemo, useState } from 'react'
import { api, leer, rpc } from '@/lib/facturacion/datos'
import { numeroVisible } from '@/lib/facturacion/comprobantes'
import { ETIQUETA_ESTADO, conVencimiento, detalleVencimiento, estadoCobro, vencimientoDe, type CondicionesPago, type EstadoCobro } from '@/lib/facturacion/estado-cobro'
import { cargarCondicionesPago } from '@/lib/facturacion/condiciones-pago'
import { totalIntereses, useIntereses, type InteresFactura } from '@/lib/facturacion/intereses-cobranzas'
import { describirTasa } from '@/lib/facturacion/tasa-mora'
import { fechaArgentina } from '@/lib/periodo-argentina'
import { S, centavosDe, fecha, pesos, useAccion } from './comun'
import { AMBAR, CeldaInteres, DetalleInteres } from './InteresFactura'
import { CeldaReclamo, ReclamosFactura, ultimoReclamo, type Reclamo } from './ReclamosFactura'

const importeTexto = (c: number) => (c / 100).toFixed(2).replace('.', ',')
const FILTROS: Array<[string, string]> = [['todas', 'Todas'], ['impagas', 'Impagas'], ['vencidas', 'Vencidas'], ['pagadas', 'Pagadas']]
const ENTRA: Record<string, (e: EstadoCobro) => boolean> = {
  todas: () => true,
  impagas: e => ['vencida', 'por_vencer', 'parcial'].includes(e),
  vencidas: e => e === 'vencida' || e === 'parcial',
  pagadas: e => ['pagada', 'cobrada_retenciones', 'anulada'].includes(e),
}

export default function FacturasCobros({ alVerCliente }: { alVerCliente: (clienteId: string) => void }) {
  const [filas, setFilas] = useState<any[]>([])
  const [clientes, setClientes] = useState<any[]>([])
  const [aps, setAps] = useState<any[]>([])
  const [cobros, setCobros] = useState<any[]>([])
  const [cli, setCli] = useState('')
  const [filtro, setFiltro] = useState('todas')
  const [anio, setAnio] = useState(fechaArgentina().slice(0, 4))
  const [buscar, setBuscar] = useState('')
  const [recientes, setRecientes] = useState(false)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [cond, setCond] = useState<CondicionesPago | null>(null)
  const [recarga, setRecarga] = useState(0)
  const [reclamos, setReclamos] = useState<Reclamo[]>([])
  const [paraReclamar, setParaReclamar] = useState(false)
  const { ocupado, correr, Mensaje } = useAccion()
  const hoy = fechaArgentina()

  async function cargar() {
    // Reclamos: si la tabla todavía no existe (migración sin aplicar) la pantalla sigue andando sin ellos.
    leer('fact_reclamos', q => q.is('anulado_at', null).order('fecha', { ascending: false }).limit(5000)).then(setReclamos).catch(() => setReclamos([]))
    const [s, c, a, co, cnd] = await Promise.all([
      leer('fact_v_saldos', q => q.order('fecha_emision').order('punto_venta').order('numero').limit(5000)),
      leer('fact_clientes', q => q.order('razon_social'), 'id, razon_social, cuit'),
      leer('fact_aplicaciones', q => q.is('revertida_at', null).limit(10000), 'id, cobro_id, retencion_id, comprobante_id, importe_c, created_at'),
      leer('fact_cobros', q => q.is('anulado_at', null).limit(10000), 'id, fecha, medio, importe_c, referencia, cheque_numero, cheque_banco, cheque_estado'),
      cargarCondicionesPago(),
    ])
    // Vencimiento según el contrato vigente: si cambia el plazo, cambia solo.
    setFilas(conVencimiento(s, cnd)); setCond(cnd); setClientes(c); setAps(a); setCobros(co)
  }
  useEffect(() => { correr(cargar) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Intereses por mora informativos a hoy (tasa general o la del contrato).
  const intereses = useIntereses(filas, cond, hoy, recarga)
  const recargarTodo = () => { correr(cargar); setRecarga(x => x + 1) }

  const nombre = (id: string | null) => clientes.find(c => c.id === id)?.razon_social ?? 'sin cliente'
  const cobroPorId = useMemo(() => new Map(cobros.map(c => [c.id, c])), [cobros])
  const ultimoCobro = (compId: string) => {
    const fechas = aps.filter(a => a.comprobante_id === compId && a.cobro_id).map(a => cobroPorId.get(a.cobro_id)?.fecha).filter(Boolean) as string[]
    return fechas.sort().pop() ?? null
  }

  const enriquecidas = useMemo(() => filas.map(f => ({ ...f, ...estadoCobro(f, hoy), vto: vencimientoDe(f), nv: numeroVisible({ tipo: f.tipo, puntoVenta: f.punto_venta, numero: Number(f.numero) }) })), [filas, hoy])
  const anios = useMemo(() => Array.from(new Set(enriquecidas.map(f => String(f.fecha_emision).slice(0, 4)))).sort().reverse(), [enriquecidas])
  const impaga = (f: any) => ENTRA.impagas(f.estado)
  // Impagas cuyo último reclamo pide volver a reclamar hoy o antes.
  const tocaReclamar = (f: any) => { const r = ultimoReclamo(reclamos, f.comprobante_id); return impaga(f) && !!r?.proximo_contacto && r.proximo_contacto <= hoy }
  const nParaReclamar = useMemo(() => enriquecidas.filter(tocaReclamar).length, [enriquecidas, reclamos]) // eslint-disable-line react-hooks/exhaustive-deps
  const visibles = useMemo(() => {
    const v = enriquecidas.filter(f => (!anio || String(f.fecha_emision).startsWith(anio)) && (!cli || f.cliente_id === cli) && ENTRA[filtro](f.estado)
      && (!paraReclamar || tocaReclamar(f))
      && (!buscar || `${f.nv} ${nombre(f.cliente_id)}`.toLowerCase().includes(buscar.toLowerCase())))
    return recientes ? [...v].reverse() : v
  }, [enriquecidas, anio, cli, filtro, buscar, recientes, clientes, paraReclamar, reclamos]) // eslint-disable-line react-hooks/exhaustive-deps

  const base = enriquecidas.filter(f => (!anio || String(f.fecha_emision).startsWith(anio)) && (!cli || f.cliente_id === cli))
  const suma = (pred: (f: any) => boolean, campo = 'saldo_c') => base.filter(pred).reduce((a, f) => a + Number(f[campo]), 0)
  const kpi = {
    facturado: base.reduce((a, f) => a + Number(f.total_c) - Number(f.nc_c), 0),
    cobrado: base.reduce((a, f) => a + Number(f.aplicado_c), 0),
    vencido: suma(f => f.estado === 'vencida' || f.estado === 'parcial'),
    porVencer: suma(f => f.estado === 'por_vencer'),
    retenciones: suma(f => f.estado === 'cobrada_retenciones'),
    intereses: totalIntereses(base.map(f => f.comprobante_id), intereses.porFactura),
  }
  const tarjetas: Array<[string, string, string, string?]> = [
    ['Facturado', pesos(kpi.facturado), '#e2e8f0'], ['Cobrado', pesos(kpi.cobrado), '#4ade80'], ['Vencido sin cobrar', pesos(kpi.vencido), '#f87171'],
    ['Por vencer', pesos(kpi.porVencer), '#93c5fd'], ['Retenciones a certificar', pesos(kpi.retenciones), '#a3e635'],
    ['Intereses por mora (informativo)', intereses.cargando ? '…' : pesos(kpi.intereses), AMBAR,
      intereses.error ?? (intereses.general ? `Tasa general: ${describirTasa(intereses.general)}` : undefined)],
  ]

  return (
    <div style={S.card}>
      <div style={S.fila}>
        <h3 style={{ ...S.h3, margin: 0 }}>Facturas y cobros</h3>
        <select style={S.input} value={anio} onChange={e => setAnio(e.target.value)}><option value="">Todos los años</option>{anios.map(a => <option key={a}>{a}</option>)}</select>
        <select style={S.input} value={cli} onChange={e => setCli(e.target.value)}><option value="">Todos los clientes</option>{clientes.map(c => <option key={c.id} value={c.id}>{c.razon_social}</option>)}</select>
        {FILTROS.map(([k, t]) => <button key={k} style={filtro === k ? S.btn : S.btn2} onClick={() => setFiltro(k)}>{t}</button>)}
        <input style={S.input} placeholder="Buscar número o cliente" value={buscar} onChange={e => setBuscar(e.target.value)} />
        <label style={S.sub}><input type="checkbox" checked={recientes} onChange={e => setRecientes(e.target.checked)} /> más recientes primero</label>
        <label style={{ ...S.sub, color: nParaReclamar ? '#fbbf24' : undefined }}><input type="checkbox" checked={paraReclamar} onChange={e => setParaReclamar(e.target.checked)} /> para volver a reclamar hoy ({nParaReclamar})</label>
        <Mensaje />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, margin: '12px 0' }}>
        {tarjetas.map(([t, v, c, nota]) => (
          <div key={t} style={{ background: '#0a0e1a', border: '1px solid #1e293b', borderRadius: 8, padding: '8px 12px' }}>
            <div style={S.sub}>{t}</div><div style={{ fontSize: 18, fontWeight: 700, color: c }}>{v}</div>
            {nota && <div style={{ ...S.sub, fontSize: 11 }}>{nota}</div>}
          </div>))}
      </div>

      {/* Lista con su propia barra de desplazamiento: el encabezado queda fijo arriba. */}
      <div style={{ overflow: 'auto', maxHeight: '60vh', border: '1px solid #1e293b', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Fecha', 'Comprobante', 'Cliente', 'Total', 'Cobrado', 'Saldo', 'Vence', 'Estado', 'Pagada el', 'Interés por mora'].map(h =>
            <th key={h} style={{ ...S.th, position: 'sticky', top: 0, zIndex: 1, background: '#0f1629' }}>{h}</th>)}</tr></thead>
          <tbody>{visibles.map(f => {
            const et = ETIQUETA_ESTADO[f.estado as EstadoCobro], abiertaEsta = abierta === f.comprobante_id
            return (
              <Fragment key={f.comprobante_id}>
                <tr onClick={() => setAbierta(abiertaEsta ? null : f.comprobante_id)} style={{ cursor: 'pointer', background: abiertaEsta ? '#111c35' : undefined }}>
                  <td style={S.td}>{fecha(f.fecha_emision)}</td>
                  <td style={S.td}>{f.nv}</td>
                  <td style={S.td}>{nombre(f.cliente_id)}</td>
                  <td style={S.num}>{pesos(f.total_c)}{Number(f.nc_c) > 0 && <div style={S.sub}>NC {pesos(f.nc_c)}</div>}</td>
                  <td style={S.num}>{Number(f.aplicado_c) > 0 ? pesos(f.aplicado_c) : '—'}</td>
                  <td style={S.num}>{Number(f.saldo_c) > 0 ? <b>{pesos(f.saldo_c)}</b> : '—'}</td>
                  <td style={S.td}>{fecha(f.vto)}</td>
                  <td style={S.td}><span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, border: `1px solid ${et.color}`, color: et.color, fontSize: 12, whiteSpace: 'nowrap' }}>
                    {et.texto}{(f.estado === 'vencida' || f.estado === 'parcial') && f.diasVencida > 0 ? ` · ${f.diasVencida} d` : ''}</span>
                    <CeldaReclamo r={ultimoReclamo(reclamos, f.comprobante_id)} hoy={hoy} /></td>
                  <td style={S.td}>{fecha(ultimoCobro(f.comprobante_id))}</td>
                  <td style={S.num}><CeldaInteres i={intereses.porFactura?.get(f.comprobante_id)} cargando={intereses.cargando} /></td>
                </tr>
                {abiertaEsta && <tr><td colSpan={10} style={{ padding: 0 }}>
                  <DetalleFactura f={f} nombreCliente={nombre(f.cliente_id)} aps={aps.filter(a => a.comprobante_id === f.comprobante_id)} cobroPorId={cobroPorId}
                    reclamos={reclamos} otrasImpagas={enriquecidas.filter(o => o.cliente_id === f.cliente_id && o.comprobante_id !== f.comprobante_id && impaga(o))}
                    alCambiar={recargarTodo} alVerCliente={() => alVerCliente(f.cliente_id)}
                    interes={intereses.porFactura?.get(f.comprobante_id)} cargandoInteres={intereses.cargando} alCambiarInteres={() => setRecarga(x => x + 1)} />
                </td></tr>}
              </Fragment>
            )
          })}</tbody>
        </table>
        {!visibles.length && !ocupado && <div style={{ ...S.sub, marginTop: 8 }}>No hay facturas con esos filtros.</div>}
      </div>
      <div style={{ ...S.sub, marginTop: 8 }}>{visibles.length} facturas. Tocá una para ver el detalle y registrar el pago. «Faltan retenciones»: se cobró y lo que resta (hasta 25 %) suele ser IVA, Ganancias, IIBB o SUSS retenidos; se cierra cargando los certificados.</div>
      <div style={{ ...S.sub, marginTop: 4 }}>Interés por mora: informativo, para avisarle al cliente; no se registra ni se factura solo. Si la factura sigue impaga es lo acumulado a hoy; si ya se pagó, los días quedan cerrados el día del pago. Tachado: marcado «no cobrar».</div>
    </div>
  )
}

function DetalleFactura({ f, nombreCliente, aps, cobroPorId, reclamos, otrasImpagas, alCambiar, alVerCliente, interes, cargandoInteres, alCambiarInteres }: {
  f: any; nombreCliente: string; aps: any[]; cobroPorId: Map<string, any>; reclamos: Reclamo[]; otrasImpagas: any[]; alCambiar: () => void; alVerCliente: () => void
  interes: InteresFactura | undefined; cargandoInteres: boolean; alCambiarInteres: () => void
}) {
  const [comp, setComp] = useState<any>(null)
  const [notas, setNotas] = useState<any[]>([])
  const [hist, setHist] = useState<any[]>([])
  const [pago, setPago] = useState({ fecha: fechaArgentina(), importe: importeTexto(Math.max(0, Number(f.saldo_c))), medio: 'transferencia', referencia: `Pago ${f.nv}`, cheque_numero: '', cheque_banco: '', cheque_fecha_pago: '' })
  const { ocupado, correr, Mensaje } = useAccion()

  useEffect(() => {
    correr(async () => {
      const [c, n, h] = await Promise.all([
        leer('fact_comprobantes', q => q.eq('id', f.comprobante_id)),
        leer('fact_comprobantes', q => q.eq('asociado_id', f.comprobante_id).order('fecha_emision'), 'id, tipo, punto_venta, numero, fecha_emision, total_c, motivo'),
        leer('fact_historial', q => q.eq('entidad', 'comprobante').eq('entidad_id', f.comprobante_id).order('at', { ascending: false }).limit(30)),
      ])
      setComp(c[0] ?? null); setNotas(n); setHist(h)
    })
  }, [f.comprobante_id]) // eslint-disable-line react-hooks/exhaustive-deps

  const saldo = Number(f.saldo_c)
  // Pago cargado por error: se anula entero (revierte sus aplicaciones). Queda en el historial.
  function anularPago(c: any) {
    const m = prompt(`Anular el pago del ${fecha(c.fecha)} por ${pesos(c.importe_c)}${c.referencia ? ` (${c.referencia})` : ''}.\nLa factura vuelve a quedar con saldo. El registro queda en el historial.\n\nMotivo:`)
    if (!m) return
    correr(async () => { await rpc('fact_cobro_anular_completo', { p_id: c.id, p_motivo: m }); alCambiar() }, 'Pago anulado')
  }
  return (
    <div style={{ background: '#0a0e1a', border: '1px solid #1e3a5f', borderRadius: 8, padding: 12, margin: '4px 0 10px' }}>
      <div style={S.fila}>
        <b>{f.nv}</b><span style={S.sub}>{nombreCliente}</span>
        {comp?.cae && <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => { const r = await api(`comprobante-pdf?id=${f.comprobante_id}`, undefined, 'GET'); window.open(r.url, '_blank', 'noopener') })}>Ver PDF</button>}
        <button style={S.btn2} onClick={alVerCliente}>Cuenta del cliente</button>
        <Mensaje />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16, marginTop: 8, fontSize: 13 }}>
        <div>
          <h4 style={S.sub}>DATOS</h4>
          <div>Emitida {fecha(f.fecha_emision)} · vence {fecha(f.vto)} <span style={S.sub}>· {detalleVencimiento(f)}</span>
            {f.vto_pago && f.vto_pago !== f.vto && <span style={S.sub}> · la factura informó {fecha(f.vto_pago)}</span>}</div>
          {comp && <div>Neto {pesos(comp.neto_c)} · IVA {pesos(comp.iva_c)} · <b>Total {pesos(comp.total_c)}</b></div>}
          {comp?.servicio_desde && <div>Servicio {fecha(comp.servicio_desde)} al {fecha(comp.servicio_hasta)}</div>}
          {comp?.cae && <div style={S.sub}>CAE {comp.cae} · {comp.origen === 'emision_app' ? 'emitida por la app' : 'importada de ARCA'}</div>}
          {notas.length > 0 && <><h4 style={{ ...S.sub, marginTop: 8 }}>NOTAS DE CRÉDITO / DÉBITO</h4>
            {notas.map(n => <div key={n.id}>{numeroVisible({ tipo: n.tipo, puntoVenta: n.punto_venta, numero: Number(n.numero) })} · {fecha(n.fecha_emision)} · {pesos(n.total_c)}{n.motivo ? ` · ${n.motivo}` : ''}</div>)}</>}
          <h4 style={{ ...S.sub, marginTop: 8 }}>COBROS APLICADOS</h4>
          {aps.length ? aps.map(a => {
            const c = a.cobro_id ? cobroPorId.get(a.cobro_id) : null
            return <div key={a.id} style={{ ...S.fila, gap: 6 }}>{c ? `${fecha(c.fecha)} · ${c.medio}${c.cheque_numero ? ` n° ${c.cheque_numero}` : ''}${c.cheque_estado ? ` (${c.cheque_estado})` : ''}${c.referencia ? ` · ${c.referencia}` : ''}` : 'Retención'} · <b>{pesos(a.importe_c)}</b>
              {c && <button style={{ ...S.btnPeligro, padding: '2px 8px' }} disabled={ocupado} onClick={() => anularPago(c)}>Anular pago</button>}</div>
          }) : <div style={S.sub}>Sin cobros registrados.</div>}
          <ReclamosFactura f={f} reclamos={reclamos} otrasImpagas={otrasImpagas} alCambiar={alCambiar} />
          <DetalleInteres comprobanteId={f.comprobante_id} i={interes} cargando={cargandoInteres} alCambiar={alCambiarInteres} />
          {hist.length > 0 && <details style={{ marginTop: 8 }}><summary style={S.sub}>Historial ({hist.length})</summary>
            {hist.map(h => <div key={h.id} style={S.sub}>{new Date(h.at).toLocaleString('es-AR')} · {h.accion}{h.datos?.motivo ? ` · ${h.datos.motivo}` : ''}</div>)}</details>}
        </div>
        {saldo > 0 && f.cliente_id && <div>
          <h4 style={S.sub}>REGISTRAR PAGO (saldo {pesos(saldo)})</h4>
          <div style={S.fila}>
            <input style={S.input} type="date" value={pago.fecha} onChange={e => setPago({ ...pago, fecha: e.target.value })} />
            <input style={{ ...S.input, width: 130 }} placeholder="Importe cobrado" value={pago.importe} onChange={e => setPago({ ...pago, importe: e.target.value })} />
            <select style={S.input} value={pago.medio} onChange={e => setPago({ ...pago, medio: e.target.value })}>{['transferencia', 'deposito', 'cheque', 'echeq', 'efectivo', 'otro'].map(x => <option key={x}>{x}</option>)}</select>
          </div>
          {['cheque', 'echeq'].includes(pago.medio) && <div style={{ ...S.fila, marginTop: 6 }}>
            <input style={{ ...S.input, width: 110 }} placeholder="N° cheque" value={pago.cheque_numero} onChange={e => setPago({ ...pago, cheque_numero: e.target.value })} />
            <input style={{ ...S.input, width: 110 }} placeholder="Banco" value={pago.cheque_banco} onChange={e => setPago({ ...pago, cheque_banco: e.target.value })} />
            <input style={S.input} type="date" title="Fecha de pago del cheque" value={pago.cheque_fecha_pago} onChange={e => setPago({ ...pago, cheque_fecha_pago: e.target.value })} />
          </div>}
          <div style={{ ...S.fila, marginTop: 6 }}>
            <input style={{ ...S.input, flex: 1 }} placeholder="Referencia" value={pago.referencia} onChange={e => setPago({ ...pago, referencia: e.target.value })} />
            <button style={S.btn} disabled={ocupado} onClick={() => correr(async () => {
              const importe = centavosDe(pago.importe)
              if (!pago.fecha || !importe || importe <= 0) throw new Error('Completá la fecha y el importe cobrado')
              const id = await rpc('fact_cobro_registrar', { p_datos: { ...pago, cliente_id: f.cliente_id, importe_c: importe } })
              await rpc('fact_aplicar', { p_origen_tipo: 'cobro', p_origen_id: id, p_comprobante_id: f.comprobante_id, p_saldo_inicial_id: null, p_importe_c: Math.min(importe, saldo), p_evidencia: { manual: true, desde: 'facturas y cobros' } })
              alCambiar()
            }, 'Pago registrado y aplicado')}>Registrar pago</button>
          </div>
          <div style={{ ...S.sub, marginTop: 4 }}>Poné lo que entró al banco. Si cobraste menos por retenciones, la diferencia queda pendiente hasta cargar los certificados en la cuenta del cliente.</div>
        </div>}
      </div>
    </div>
  )
}
