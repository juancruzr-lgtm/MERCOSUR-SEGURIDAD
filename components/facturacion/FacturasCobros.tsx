'use client'
// Cobranzas → Facturas y cobros: todas las facturas en orden cronológico con su estado de cobro.
// Tocar una factura abre su detalle (datos, notas de crédito, cobros aplicados, historial, PDF) y permite
// registrar el pago ahí mismo. Sólo lee; registrar el pago usa las mismas funciones que la cuenta corriente.
// Intereses por mora: informativos, para avisarle al cliente (lib/facturacion/intereses-cobranzas); a la fecha si
// la factura sigue impaga, con los días cerrados el día del pago si ya se cobró. Se pueden marcar "no cobrar".
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { api, leer, rpc } from '@/lib/facturacion/datos'
import { numeroVisible } from '@/lib/facturacion/comprobantes'
import { ETIQUETA_ESTADO, conVencimiento, detalleVencimiento, estadoCobro, vencimientoDe, type CondicionesPago, type EstadoCobro } from '@/lib/facturacion/estado-cobro'
import { cargarCondicionesPago, leerTodo } from '@/lib/facturacion/condiciones-pago'
import { totalIntereses, useIntereses, type InteresFactura } from '@/lib/facturacion/intereses-cobranzas'
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
      leerTodo('fact_v_saldos', '*', 'comprobante_id'),
      leer('fact_clientes', q => q.order('razon_social'), 'id, razon_social, cuit'),
      leerTodo('fact_aplicaciones', 'id, cobro_id, retencion_id, comprobante_id, importe_c, created_at', 'id', q => q.is('revertida_at', null)),
      leerTodo('fact_cobros', 'id, cliente_id, fecha, medio, importe_c, referencia, cheque_numero, cheque_banco, cheque_estado', 'id', q => q.is('anulado_at', null)),
      cargarCondicionesPago(),
    ])
    // Vencimiento según el contrato vigente: si cambia el plazo, cambia solo.
    s.sort((a: any, b: any) => String(a.fecha_emision).localeCompare(String(b.fecha_emision)) || Number(a.punto_venta) - Number(b.punto_venta) || Number(a.numero) - Number(b.numero))
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
  // Cobros que entraron y todavía no están asignados a una factura (neto de retenciones). Para compararlos con
  // facturas (que son por el total) se llevan a valor de factura con el % que ese cliente suele cobrar en neto.
  const sinAsignar = useMemo(() => {
    const aplicadoCobro = new Map<string, number>()
    for (const a of aps) if (a.cobro_id) aplicadoCobro.set(a.cobro_id, (aplicadoCobro.get(a.cobro_id) ?? 0) + Number(a.importe_c))
    const netoPorCliente = new Map<string, number>()
    for (const c of cobros) {
      if (!c.cliente_id || (cli && c.cliente_id !== cli) || ['rechazado', 'anulado', 'endosado'].includes(c.cheque_estado)) continue
      const resto = Number(c.importe_c) - (aplicadoCobro.get(c.id) ?? 0)
      if (resto > 0) netoPorCliente.set(c.cliente_id, (netoPorCliente.get(c.cliente_id) ?? 0) + resto)
    }
    // % neto/total del cliente: lo cobrado en efectivo sobre el total de sus facturas ya cobradas.
    const cobradoPorFactura = new Map<string, number>()
    for (const a of aps) if (a.cobro_id && a.comprobante_id) cobradoPorFactura.set(a.comprobante_id, (cobradoPorFactura.get(a.comprobante_id) ?? 0) + Number(a.importe_c))
    const ratio = (clienteId: string) => {
      let neto = 0, total = 0
      for (const f of enriquecidas) if (f.cliente_id === clienteId && ['pagada', 'cobrada_retenciones'].includes(f.estado) && cobradoPorFactura.get(f.comprobante_id)) {
        neto += cobradoPorFactura.get(f.comprobante_id)!; total += Number(f.total_c) - Number(f.nc_c)
      }
      const r = total > 0 ? neto / total : 0.85
      return Math.min(1, Math.max(0.6, r))
    }
    let neto = 0, equivalente = 0
    netoPorCliente.forEach((n, clienteId) => { neto += n; equivalente += n / ratio(clienteId) })
    return { neto, equivalente: Math.round(equivalente) }
  }, [aps, cobros, enriquecidas, cli])
  const vencidoNeto = Math.max(0, kpi.vencido - sinAsignar.equivalente)
  // Cobros ya cargados con plata sin asignar (para usarlos desde el detalle de una factura).
  const disponibleDeCobro = useMemo(() => {
    const ap = new Map<string, number>()
    for (const a of aps) if (a.cobro_id) ap.set(a.cobro_id, (ap.get(a.cobro_id) ?? 0) + Number(a.importe_c))
    return new Map(cobros.filter(c => !['rechazado', 'anulado', 'endosado'].includes(c.cheque_estado))
      .map(c => [c.id, Number(c.importe_c) - (ap.get(c.id) ?? 0)] as [string, number]).filter(([, d]) => d > 0))
  }, [aps, cobros])
  const tarjetas: Array<[string, string, string, string?]> = [
    ['Facturado', pesos(kpi.facturado), '#e2e8f0'], ['Cobrado', pesos(kpi.cobrado), '#4ade80'], ['Vencido sin cobrar', pesos(kpi.vencido), '#f87171', sinAsignar.neto > 0 ? `neto de cobros sin asignar: ${pesos(vencidoNeto)}` : undefined],
    ['Por vencer', pesos(kpi.porVencer), '#93c5fd'], ['Retenciones a certificar', pesos(kpi.retenciones), '#a3e635'],
    ['Cobros sin asignar', pesos(sinAsignar.neto), '#fbbf24', sinAsignar.neto > 0
      ? `lo que entró al banco · + retenciones presuntas ${pesos(sinAsignar.equivalente - sinAsignar.neto)} (estimadas con el % de cada cliente) = ${pesos(sinAsignar.equivalente)} de facturas`
      : 'todo lo cobrado está asignado'],
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
                    cobrosLibres={cobros.filter(c => c.cliente_id === f.cliente_id && disponibleDeCobro.has(c.id)).map(c => ({ ...c, disponible_c: disponibleDeCobro.get(c.id)! }))}
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

function DetalleFactura({ f, nombreCliente, aps, cobroPorId, cobrosLibres, reclamos, otrasImpagas, alCambiar, alVerCliente, interes, cargandoInteres, alCambiarInteres }: {
  f: any; nombreCliente: string; aps: any[]; cobroPorId: Map<string, any>; cobrosLibres: any[]; reclamos: Reclamo[]; otrasImpagas: any[]; alCambiar: () => void; alVerCliente: () => void
  interes: InteresFactura | undefined; cargandoInteres: boolean; alCambiarInteres: () => void
}) {
  const [comp, setComp] = useState<any>(null)
  const [notas, setNotas] = useState<any[]>([])
  const [hist, setHist] = useState<any[]>([])
  const [retsFactura, setRetsFactura] = useState<any[]>([])
  // Id del cobro generado en la pantalla: si el alta se reintenta, el servidor devuelve el mismo cobro.
  const idPago = useRef(crypto.randomUUID())
  const [pago, setPago] = useState({ fecha: fechaArgentina(), importe: '', medio: 'transferencia', referencia: `Pago ${f.nv}`, cheque_numero: '', cheque_banco: '', cheque_fecha_pago: '' })
  // Retenciones de este pago: una línea por impuesto (con o sin número de certificado) o un total sin detalle.
  const [modo, setModo] = useState<'nuevo' | 'existente' | 'retenciones'>(Number(f.aplicado_c) > 0 ? 'retenciones' : cobrosLibres.length ? 'existente' : 'nuevo')
  const [cobroUsado, setCobroUsado] = useState('')
  const [rets, setRets] = useState<Array<{ impuesto: string; certificado: string; importe: string }>>([])
  const { ocupado, correr, Mensaje } = useAccion()

  useEffect(() => {
    correr(async () => {
      const [c, n, h] = await Promise.all([
        leer('fact_comprobantes', q => q.eq('id', f.comprobante_id)),
        leer('fact_comprobantes', q => q.eq('asociado_id', f.comprobante_id).order('fecha_emision'), 'id, tipo, punto_venta, numero, fecha_emision, total_c, motivo'),
        leer('fact_historial', q => q.eq('entidad', 'comprobante').eq('entidad_id', f.comprobante_id).order('at', { ascending: false }).limit(30)),
      ])
      setComp(c[0] ?? null); setNotas(n); setHist(h)
      leer('fact_retenciones', q => q.eq('comprobante_citado_id', f.comprobante_id)).then(setRetsFactura).catch(() => setRetsFactura([]))
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
          <h4 style={{ ...S.sub, marginTop: 8 }}>COBROS Y RETENCIONES APLICADOS</h4>
          {aps.length ? aps.map(a => {
            const c = a.cobro_id ? cobroPorId.get(a.cobro_id) : null
            return <div key={a.id} style={{ ...S.fila, gap: 6 }}>{c ? `${fecha(c.fecha)} · ${c.medio}${c.cheque_numero ? ` n° ${c.cheque_numero}` : ''}${c.cheque_estado ? ` (${c.cheque_estado})` : ''}${c.referencia ? ` · ${c.referencia}` : ''}` : (() => { const r = retsFactura.find(x => x.id === a.retencion_id); return r ? `Retención ${r.impuesto}${r.certificado ? ` cert. ${r.certificado}` : ''}` : 'Retención' })()} · <b>{pesos(a.importe_c)}</b>
              {c && <button style={{ ...S.btnPeligro, padding: '2px 8px' }} disabled={ocupado} onClick={() => anularPago(c)}>Anular pago</button>}</div>
          }) : <div style={S.sub}>Sin cobros registrados.</div>}
          {retsFactura.filter(r => r.estado === 'estimada').map(r => <div key={r.id} style={S.sub}>Retención estimada {r.impuesto} · {pesos(r.importe_c)} (sin certificado: no cancela, se carga con número cuando llegue)</div>)}
          <ReclamosFactura f={f} reclamos={reclamos} otrasImpagas={otrasImpagas} alCambiar={alCambiar} />
          <DetalleInteres comprobanteId={f.comprobante_id} i={interes} cargando={cargandoInteres} alCambiar={alCambiarInteres} />
          {hist.length > 0 && <details style={{ marginTop: 8 }}><summary style={S.sub}>Historial ({hist.length})</summary>
            {hist.map(h => <div key={h.id} style={S.sub}>{new Date(h.at).toLocaleString('es-AR')} · {h.accion}{h.datos?.motivo ? ` · ${h.datos.motivo}` : ''}</div>)}</details>}
        </div>
        {saldo > 0 && f.cliente_id && (() => {
          const usado = cobrosLibres.find(c => c.id === cobroUsado)
          const pedido = centavosDe(pago.importe) || 0
          const neto = modo === 'retenciones' ? 0 : modo === 'existente' ? (usado ? Math.min(Number(usado.disponible_c), pedido || Number(usado.disponible_c)) : 0) : pedido
          const retTotal = rets.reduce((a, r) => a + (centavosDe(r.importe) || 0), 0)
          const conCert = rets.filter(r => r.certificado.trim()).reduce((a, r) => a + (centavosDe(r.importe) || 0), 0)
          const queda = saldo - neto - retTotal
          return <div>
            <h4 style={S.sub}>REGISTRAR PAGO DE ESTA FACTURA (saldo {pesos(saldo)})</h4>
            <div style={S.fila}>
              <label style={S.sub}><input type="radio" checked={modo === 'retenciones'} onChange={() => setModo('retenciones')} /> Sólo retenciones (el pago ya está cargado)</label>
              <label style={S.sub}><input type="radio" checked={modo === 'nuevo'} onChange={() => setModo('nuevo')} /> Pago nuevo</label>
              <label style={S.sub}><input type="radio" checked={modo === 'existente'} disabled={!cobrosLibres.length} onChange={() => setModo('existente')} /> Usar un cobro ya cargado sin asignar ({cobrosLibres.length})</label>
            </div>
            {modo === 'retenciones' ? null : modo === 'existente' ? <div style={{ ...S.fila, marginTop: 6 }}>
              <select style={{ ...S.input, flex: 1 }} value={cobroUsado} onChange={e => {
                setCobroUsado(e.target.value)
                const c = cobrosLibres.find(x => x.id === e.target.value)
                if (c) setPago(p => ({ ...p, importe: importeTexto(Math.min(Number(c.disponible_c), saldo)) }))
              }}>
                <option value="">Elegí el cobro…</option>
                {cobrosLibres.map(c => <option key={c.id} value={c.id}>{fecha(c.fecha)} · {c.medio}{c.cheque_numero ? ` n° ${c.cheque_numero}` : ''} · disponible {pesos(c.disponible_c)}{c.referencia ? ` · ${c.referencia}` : ''}</option>)}
              </select>
              <input style={{ ...S.input, width: 130 }} placeholder="Importe a usar" value={pago.importe} onChange={e => setPago({ ...pago, importe: e.target.value })} />
            </div> : <>
              <div style={{ ...S.fila, marginTop: 6 }}>
                <input style={S.input} type="date" value={pago.fecha} onChange={e => setPago({ ...pago, fecha: e.target.value })} />
                <input style={{ ...S.input, width: 140 }} placeholder="Lo que entró al banco" value={pago.importe} onChange={e => setPago({ ...pago, importe: e.target.value })} />
                <select style={S.input} value={pago.medio} onChange={e => setPago({ ...pago, medio: e.target.value })}>{['transferencia', 'deposito', 'cheque', 'echeq', 'efectivo', 'otro'].map(x => <option key={x}>{x}</option>)}</select>
              </div>
              {['cheque', 'echeq'].includes(pago.medio) && <div style={{ ...S.fila, marginTop: 6 }}>
                <input style={{ ...S.input, width: 110 }} placeholder="N° cheque" value={pago.cheque_numero} onChange={e => setPago({ ...pago, cheque_numero: e.target.value })} />
                <input style={{ ...S.input, width: 110 }} placeholder="Banco" value={pago.cheque_banco} onChange={e => setPago({ ...pago, cheque_banco: e.target.value })} />
                <input style={S.input} type="date" title="Fecha de pago del cheque" value={pago.cheque_fecha_pago} onChange={e => setPago({ ...pago, cheque_fecha_pago: e.target.value })} />
              </div>}
              <input style={{ ...S.input, width: '100%', marginTop: 6 }} placeholder="Referencia (n° de liquidación, orden de pago…)" value={pago.referencia} onChange={e => setPago({ ...pago, referencia: e.target.value })} />
            </>}

            <h4 style={{ ...S.sub, marginTop: 10 }}>RETENCIONES DE ESTE PAGO</h4>
            {rets.map((r, k) => <div key={k} style={{ ...S.fila, marginTop: 4 }}>
              <select style={S.input} value={r.impuesto} onChange={e => setRets(rets.map((x, n) => n === k ? { ...x, impuesto: e.target.value } : x))}>
                {[['iva', 'IVA'], ['ganancias', 'Ganancias'], ['iibb', 'Ingresos Brutos'], ['suss', 'SUSS / SIJP'], ['otro', 'DReI / otro / total sin detalle']].map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
              <input style={{ ...S.input, width: 160 }} placeholder="N° certificado (opcional)" value={r.certificado} onChange={e => setRets(rets.map((x, n) => n === k ? { ...x, certificado: e.target.value } : x))} />
              <input style={{ ...S.input, width: 120 }} placeholder="Importe" value={r.importe} onChange={e => setRets(rets.map((x, n) => n === k ? { ...x, importe: e.target.value } : x))} />
              <button style={{ ...S.btnPeligro, padding: '2px 8px' }} onClick={() => setRets(rets.filter((_, n) => n !== k))}>×</button>
            </div>)}
            <div style={{ ...S.fila, marginTop: 4 }}>
              <button style={{ ...S.btn2, padding: '2px 10px' }} onClick={() => setRets([...rets, { impuesto: rets.length ? 'ganancias' : 'iva', certificado: '', importe: '' }])}>+ Retención</button>
              <button style={{ ...S.btn2, padding: '2px 10px' }} disabled={neto <= 0} title="Carga la diferencia entre el saldo y lo cobrado como un total de retenciones, sin detalle"
                onClick={() => setRets([{ impuesto: 'otro', certificado: '', importe: importeTexto(Math.max(0, saldo - neto)) }])}>Total de retenciones = saldo − cobrado</button>
            </div>

            <div style={{ marginTop: 8, padding: 8, border: '1px solid #1e293b', borderRadius: 6 }}>
              <div>Cobrado (banco) <b>{pesos(neto)}</b> + retenciones <b>{pesos(retTotal)}</b> = <b>{pesos(neto + retTotal)}</b> de {pesos(saldo)}</div>
              <div style={{ color: queda < 0 ? '#f87171' : queda === 0 ? '#4ade80' : '#fbbf24' }}>
                {queda < 0 ? `Se pasa por ${pesos(-queda)}: revisá los importes` : queda === 0 ? 'La factura queda saldada' : `Queda pendiente ${pesos(queda)}`}
              </div>
              {retTotal > conCert && <div style={S.sub}>Las retenciones sin número quedan como estimadas: la factura figura cobrada, faltan retenciones, y no cuenta como deuda.</div>}
            </div>
            <div style={{ ...S.fila, marginTop: 6 }}>
              <button style={S.btn} disabled={ocupado || queda < 0 || (neto <= 0 && retTotal <= 0)} onClick={() => correr(async () => {
                if (neto > 0) {
                  if (modo === 'nuevo' && !pago.fecha) throw new Error('Completá la fecha')
                  let cobroId = usado?.id
                  if (modo === 'nuevo') cobroId = await rpc('fact_cobro_registrar', { p_datos: { ...pago, id: idPago.current, cliente_id: f.cliente_id, importe_c: neto } })
                  await rpc('fact_aplicar', { p_origen_tipo: 'cobro', p_origen_id: cobroId, p_comprobante_id: f.comprobante_id, p_saldo_inicial_id: null, p_importe_c: neto, p_evidencia: { manual: true, desde: 'facturas y cobros' } })
                }
                for (const r of rets) {
                  const imp = centavosDe(r.importe); if (!imp || imp <= 0) continue
                  const cert = r.certificado.trim()
                  const retId = await rpc('fact_retencion_registrar', { p_datos: {
                    cliente_id: f.cliente_id, impuesto: r.impuesto, certificado: cert, fecha: modo === 'existente' && usado ? usado.fecha : (pago.fecha || fechaArgentina()), importe_c: imp,
                    orden_pago: pago.referencia, comprobante_citado_id: f.comprobante_id, estado: cert ? 'certificado_recibido' : 'estimada',
                    notas: cert ? null : 'Cargada sin número de certificado desde el detalle de la factura' } })
                  if (cert) await rpc('fact_aplicar', { p_origen_tipo: 'retencion', p_origen_id: retId, p_comprobante_id: f.comprobante_id, p_saldo_inicial_id: null, p_importe_c: imp, p_evidencia: { certificado: cert, desde: 'facturas y cobros' } })
                }
                idPago.current = crypto.randomUUID(); setPago(p => ({ ...p, importe: '', referencia: '' })); setRets([]); setCobroUsado('')
                alCambiar()
              }, neto > 0 ? 'Pago y retenciones registrados' : 'Retenciones registradas')}>{neto > 0 ? 'Registrar' : 'Registrar sólo retenciones'}</button>
            </div>
            <div style={{ ...S.sub, marginTop: 4 }}>Cobrado = lo que entró al banco (neto). Las retenciones van abajo, cada una con su certificado si lo tenés. Si el pago ya está aplicado, dejá el cobro vacío y cargá sólo las retenciones.</div>
          </div>
        })()}
      </div>
    </div>
  )
}
