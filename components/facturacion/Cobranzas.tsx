'use client'
// Cuentas corrientes y conciliación. El extracto bancario se importa como
// movimientos; las propuestas se aceptan o rechazan a mano. Retenciones
// estimadas no cancelan; las aplicaciones se revierten con motivo.
import { useEffect, useRef, useState } from 'react'
import { abrirDocumento, api, leer, rpc, subirDocumento } from '@/lib/facturacion/datos'
import { numeroVisible } from '@/lib/facturacion/comprobantes'
import { conVencimiento, detalleVencimiento, estadoCobro, vencimientoDe, type CondicionesPago } from '@/lib/facturacion/estado-cobro'
import { cargarCondicionesPago } from '@/lib/facturacion/condiciones-pago'
import { textoParaCliente, totalIntereses, useIntereses } from '@/lib/facturacion/intereses-cobranzas'
import { S, centavosDe, fecha, pesos, useAccion } from './comun'
import { fechaArgentina } from '@/lib/periodo-argentina'
import FacturasCobros from './FacturasCobros'
import ClientesDeuda from './ClientesDeuda'
import InteresesMora from './InteresesMora'
import { AMBAR } from './InteresFactura'

/** Centavos → texto para los campos de importe (1234567 → "12345,67"), el formato que lee centavosDe. */
const importeTexto = (c: number) => (c / 100).toFixed(2).replace('.', ',')

export default function Cobranzas() {
  const [clientes, setClientes] = useState<any[]>([])
  const [cli, setCli] = useState('')
  const { ocupado, correr, Mensaje } = useAccion()
  useEffect(() => { correr(async () => setClientes(await leer('fact_clientes', q => q.order('razon_social'), 'id, razon_social, cuit'))) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Vistas de Cobranzas: la lista general de facturas es la principal; se irán sumando más.
  const [vista, setVista] = useState<'facturas' | 'cuenta' | 'intereses' | 'banco'>('facturas')

  return (
    <div>
      <div style={{ ...S.fila, marginBottom: 12 }}>
        {([['facturas', 'Facturas y cobros'], ['cuenta', 'Cuenta por cliente'], ['intereses', 'Intereses por mora'], ['banco', 'Conciliación bancaria']] as const).map(([k, t]) =>
          <button key={k} style={vista === k ? S.btn : S.btn2} onClick={() => setVista(k)}>{t}</button>)}
      </div>
      {vista === 'facturas' && <FacturasCobros alVerCliente={id => { setCli(id); setVista('cuenta') }} />}
      {vista === 'intereses' && <InteresesMora />}
      {vista === 'banco' && <Conciliacion clientes={clientes} />}
      {vista === 'cuenta' && <div style={S.card}>
        {!cli && <ClientesDeuda clientes={clientes} alElegir={setCli} />}
        {cli && <>
          <div style={S.fila}>
            <button style={S.btn2} onClick={() => setCli('')}>← Todos los clientes</button>
            <h3 style={{ ...S.h3, margin: 0 }}>Cuenta corriente</h3>
            <select style={S.input} value={cli} onChange={e => setCli(e.target.value)}>{clientes.map(c => <option key={c.id} value={c.id}>{c.razon_social}</option>)}</select>
            <Mensaje />
          </div>
          {!ocupado && <CuentaCliente clienteId={cli} nombreCliente={clientes.find(c => c.id === cli)?.razon_social ?? 'Cliente'} />}
        </>}
      </div>}
    </div>
  )
}

const BANCOS: Record<string, string> = { galicia: 'Banco Galicia', municipal_rosario: 'Banco Municipal de Rosario', otro: 'Otro banco' }
// Tres categorías, nunca imputación automática.
const CATEGORIA: Record<string, [string, string]> = {
  fuerte: ['Coincidencia inequívoca (revisar y aceptar)', '#16a34a'],
  media: ['Probable: requiere revisión', '#ca8a04'],
  debil: ['Sin identificar (sólo coincide el importe)', '#64748b'],
}

function Conciliacion({ clientes }: { clientes: any[] }) {
  const [movs, setMovs] = useState<any[]>([])
  const [props, setProps] = useState<any[]>([])
  const [cuentas, setCuentas] = useState<any[]>([])
  const [cuenta, setCuenta] = useState('')
  const [verNoCobranza, setVerNoCobranza] = useState(false)
  const [nueva, setNueva] = useState({ banco: 'galicia', numero: '', cbu: '' })
  const [rech, setRech] = useState<Record<string, string>>({})
  const { ocupado, correr, Mensaje } = useAccion()

  async function cargar() {
    const [m, cobros, p, cs] = await Promise.all([
      leer('fact_movimientos_bancarios', q => (cuenta ? q.eq('cuenta_id', cuenta) : q).gt('importe_c', 0).order('fecha', { ascending: false }).limit(500)),
      leer('fact_cobros', q => q.not('movimiento_id', 'is', null).is('anulado_at', null), 'movimiento_id'),
      leer('fact_propuestas', q => q.eq('estado', 'propuesta')),
      leer('fact_cuentas_bancarias', q => q.eq('activa', true).order('banco')),
    ])
    setCuentas(cs)
    const con = new Set(cobros.map(c => c.movimiento_id))
    setMovs(m.map(x => ({ ...x, conCobro: con.has(x.id) }))); setProps(p)
  }
  useEffect(() => { correr(cargar) }, [cuenta]) // eslint-disable-line react-hooks/exhaustive-deps
  const nombre = (id: string | null) => clientes.find(c => c.id === id)?.razon_social ?? '—'
  const pendientes = movs.filter(m => !m.conCobro && (verNoCobranza ? m.clasificacion === 'no_cobranza' : m.clasificacion !== 'no_cobranza'))
  const cuentaTxt = (id: string) => { const c = cuentas.find(x => x.id === id); return c ? `${BANCOS[c.banco] ?? c.banco} ${c.numero}` : '' }

  return (
    <div style={S.card}>
      <h3 style={S.h3}>Conciliación bancaria</h3>
      <div style={S.fila}>
        <select style={S.input} value={cuenta} onChange={e => setCuenta(e.target.value)} title="Cuenta">
          <option value="">Todas las cuentas (para importar, elegí una)</option>
          {cuentas.map(c => <option key={c.id} value={c.id}>{BANCOS[c.banco] ?? c.banco} · {c.numero}</option>)}
        </select>
        <input type="file" accept=".csv" disabled={ocupado || !cuenta} onChange={e => {
          const f = e.target.files?.[0]; if (!f) return
          const form = new FormData(); form.append('archivo', f); form.append('tipo', 'extracto'); form.append('cuenta_id', cuenta)
          correr(async () => { const r = await api('importar', form); await cargar(); if (r.duplicado) throw new Error('Ese extracto ya estaba importado') }, 'Extracto importado')
          e.target.value = ''
        }} />
        <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => { const r = await api('conciliacion', {}); await cargar(); return r }, 'Propuestas recalculadas')}>Proponer asociaciones</button>
        <label style={S.sub}><input type="checkbox" checked={verNoCobranza} onChange={e => setVerNoCobranza(e.target.checked)} /> ver los que no son cobranza</label>
        <Mensaje />
      </div>
      <div style={{ ...S.fila, marginTop: 6 }}>
        <span style={S.sub}>Nueva cuenta:</span>
        <select style={S.input} value={nueva.banco} onChange={e => setNueva({ ...nueva, banco: e.target.value })}>{Object.entries(BANCOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input style={{ ...S.input, width: 140 }} placeholder="Número de cuenta" value={nueva.numero} onChange={e => setNueva({ ...nueva, numero: e.target.value })} />
        <input style={{ ...S.input, width: 220 }} placeholder="CBU (opcional)" value={nueva.cbu} onChange={e => setNueva({ ...nueva, cbu: e.target.value })} />
        <button style={S.btn2} disabled={ocupado || !nueva.numero.trim()} onClick={() => correr(async () => { await rpc('fact_cuenta_bancaria_guardar', { p_datos: nueva }); setNueva({ banco: 'galicia', numero: '', cbu: '' }); await cargar() }, 'Cuenta agregada')}>Agregar cuenta</button>
      </div>
      <div style={S.sub}>Un ingreso no es una cobranza hasta aceptarlo. Rescates, transferencias propias y reversos quedan fuera. La igualdad de importe sola no confirma un pago.</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead><tr>{['Fecha', 'Cuenta', 'Importe', 'Concepto', 'Clasificación', 'Propuestas'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
        <tbody>{pendientes.map(m => (
          <tr key={m.id}>
            <td style={S.td}>{fecha(m.fecha)}</td><td style={S.td}>{cuentaTxt(m.cuenta_id)}</td><td style={S.num}>{pesos(m.importe_c)}</td>
            <td style={S.td}>{m.concepto}<div style={S.sub}>{m.cuit_contraparte ?? ''} {m.referencia ?? ''}</div></td>
            <td style={S.td}>{m.clasificacion}{m.clasificacion_motivo ? <div style={S.sub}>{m.clasificacion_motivo}</div> : null}
              <div><button style={{ ...S.btn2, padding: '2px 6px' }} onClick={() => {
                const destino = m.clasificacion === 'no_cobranza' ? 'cobranza_posible' : 'no_cobranza'
                const motivo = prompt(destino === 'no_cobranza' ? 'Motivo para marcar como NO cobranza (rescate, transferencia propia, reverso, impuesto…)' : 'Motivo para volver a tratarlo como posible cobranza'); if (!motivo) return
                correr(async () => { await rpc('fact_movimiento_clasificar', { p_id: m.id, p_clasificacion: destino, p_motivo: motivo }); await cargar() })
              }}>{m.clasificacion === 'no_cobranza' ? 'Sí es cobranza' : 'No es cobranza'}</button></div></td>
            <td style={S.td}>{props.filter(p => p.movimiento_id === m.id).map(p => (
              <div key={p.id} style={{ borderLeft: `3px solid ${CATEGORIA[p.fuerza]?.[1] ?? '#64748b'}`, paddingLeft: 8, marginBottom: 6 }}>
                <b>{CATEGORIA[p.fuerza]?.[0] ?? p.fuerza}</b> · {nombre(p.cliente_id)}
                {p.motivos.map((x: string, i: number) => <div key={i} style={S.sub}>✓ {x}</div>)}
                {p.advertencias.map((x: string, i: number) => <div key={i} style={{ color: '#fbbf24', fontSize: 12 }}>⚠ {x}</div>)}
                {p.aplicaciones.map((a: any, i: number) => <div key={i} style={S.sub}>{a.origen} {pesos(a.importe)} → comprobante {String(a.comprobanteId).slice(0, 8)} ({a.vinculo})</div>)}
                <div style={S.fila}>
                  {p.aplicaciones.length > 0 && <button style={S.btn} disabled={ocupado} onClick={() => correr(async () => { await rpc('fact_propuesta_aceptar', { p_id: p.id }); await cargar() }, 'Cobro registrado y aplicado')}>Aceptar</button>}
                  <input style={{ ...S.input, width: 160 }} placeholder="Motivo rechazo" value={rech[p.id] ?? ''} onChange={e => setRech({ ...rech, [p.id]: e.target.value })} />
                  <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => { await rpc('fact_propuesta_rechazar', { p_id: p.id, p_motivo: rech[p.id] ?? null }); await cargar() })}>Rechazar</button>
                </div>
              </div>
            ))}{!props.some(p => p.movimiento_id === m.id) && <span style={S.sub}>Movimiento sin identificar: registrar el cobro a mano en la cuenta corriente si corresponde</span>}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}

function CuentaCliente({ clienteId, nombreCliente }: { clienteId: string; nombreCliente: string }) {
  const [d, setD] = useState<{ saldos: any[]; cobros: any[]; rets: any[]; aps: any[]; si: any[]; cargos: any[]; cond: CondicionesPago | null }>({ saldos: [], cobros: [], rets: [], aps: [], si: [], cargos: [], cond: null })
  const primeraCarga = useRef(true)
  // Id del cobro generado en la pantalla: si el alta se reintenta, el servidor devuelve el mismo cobro.
  const idCobro = useRef(crypto.randomUUID())
  const [cobro, setCobro] = useState({ fecha: '', importe: '', medio: 'transferencia', referencia: '', es_anticipo: false, cheque_numero: '', cheque_banco: '', cheque_fecha_pago: '' })
  const [ret, setRet] = useState({ impuesto: 'ganancias', certificado: '', fecha: '', importe: '', orden_pago: '', estado: 'certificado_recibido' })
  const [ap, setAp] = useState({ origen: '', destino: '', importe: '' })
  const [si, setSi] = useState({ fecha: '', importe: '', detalle: '', documento_id: '' })
  // Cargo sin factura (remito): id generado en la pantalla para que el alta sea idempotente.
  const idCargo = useRef(crypto.randomUUID())
  const [cargo, setCargo] = useState({ fecha: '', periodo: '', descripcion: '', importe: '' })
  const { ocupado, correr, Mensaje } = useAccion()

  async function cargar() {
    const [saldosArca, cobros, rets, si2, cond, cargos] = await Promise.all([
      // Todas las facturas del cliente (pagas e impagas), por fecha de emisión y número.
      leer('fact_v_saldos', q => q.eq('cliente_id', clienteId).order('fecha_emision').order('punto_venta').order('numero')),
      leer('fact_cobros', q => q.eq('cliente_id', clienteId).order('fecha')),
      leer('fact_retenciones', q => q.eq('cliente_id', clienteId).order('fecha')),
      leer('fact_saldos_iniciales', q => q.eq('cliente_id', clienteId)),
      cargarCondicionesPago(),
      // Remitos y otros cargos sin factura, con su saldo (no son comprobantes fiscales).
      leer('fact_v_cargos', q => q.eq('cliente_id', clienteId).order('fecha')).catch(() => []),
    ])
    // Vencimiento según el contrato vigente del cliente (si cambia el plazo, cambia solo).
    const saldos = conVencimiento(saldosArca, cond)
    const ids = [...cobros.map(c => c.id), ...rets.map(r => r.id)]
    const aps = ids.length ? await leer('fact_aplicaciones', q => q.or(`cobro_id.in.(${cobros.map(c => c.id).join(',') || '00000000-0000-0000-0000-000000000000'}),retencion_id.in.(${rets.map(r => r.id).join(',') || '00000000-0000-0000-0000-000000000000'})`).order('created_at')) : []
    setD({ saldos, cobros, rets, aps, si: si2, cargos, cond })
    // Después de cargar un cobro, aplicar o revertir, los intereses se recalculan con los pagos nuevos.
    if (primeraCarga.current) primeraCarga.current = false; else setRecarga(x => x + 1)
  }
  useEffect(() => { correr(cargar) }, [clienteId]) // eslint-disable-line react-hooks/exhaustive-deps

  const aplicado = (campo: 'cobro_id' | 'retencion_id', id: string) => d.aps.filter(a => a[campo] === id && !a.revertida_at).reduce((s, a) => s + Number(a.importe_c), 0)
  // Lo que falta de una factura ya cobrada (hasta el 25 %) son retenciones que el cliente todavía no mandó: no es deuda.
  const esRestoRetenciones = (x: any) => estadoCobro(x, fechaArgentina()).estado === 'cobrada_retenciones'
  const deuda = d.saldos.filter(x => !esRestoRetenciones(x)).reduce((s, x) => s + Math.max(0, Number(x.saldo_c)), 0)
  const restoRetenciones = d.saldos.filter(esRestoRetenciones).reduce((s, x) => s + Math.max(0, Number(x.saldo_c)), 0)
  const deudaCargos = d.cargos.reduce((s, x) => s + Math.max(0, Number(x.saldo_c)), 0)
  const nv = (s: any) => numeroVisible({ tipo: s.tipo, puntoVenta: s.punto_venta, numero: Number(s.numero) })

  // Intereses por mora a hoy: informativos, para avisarle al cliente (no se registran ni se facturan solos).
  const hoy = fechaArgentina()
  const [recarga, setRecarga] = useState(0)
  const intereses = useIntereses(d.saldos, d.cond, hoy, recarga)
  const interesDe = (id: string) => intereses.porFactura?.get(id)
  const totalInteres = totalIntereses(d.saldos.map(s => s.comprobante_id), intereses.porFactura)
  const textoCliente = () => textoParaCliente(nombreCliente,
    d.saldos.flatMap(s => { const i = interesDe(s.comprobante_id); return i ? [{ numero: nv(s), i }] : [] }), hoy)

  // Factura tocada en la lista: precarga el cobro y el destino de la aplicación con su saldo.
  const [selFac, setSelFac] = useState<string | null>(null)
  const facSel = d.saldos.find(s => s.comprobante_id === selFac) ?? null
  const disponibleCobro = (c: any) => Number(c.importe_c) - aplicado('cobro_id', c.id)
  function elegirFactura(s: any) {
    if (Number(s.saldo_c) <= 0) return
    const saldo = importeTexto(Number(s.saldo_c))
    setSelFac(s.comprobante_id)
    setCobro(c => ({ ...c, fecha: c.fecha || fechaArgentina(), importe: saldo, referencia: `Pago ${nv(s)}` }))
    setAp(a => {
      const cob = d.cobros.find(c => `cobro:${c.id}` === a.origen)
      const imp = cob ? Math.min(disponibleCobro(cob), Number(s.saldo_c)) : Number(s.saldo_c)
      return { ...a, destino: `c:${s.comprobante_id}`, importe: importeTexto(imp) }
    })
  }
  function elegirCobro(c: any) {
    const disp = disponibleCobro(c)
    if (c.anulado_at || disp <= 0) return
    setAp(a => ({ ...a, origen: `cobro:${c.id}`, importe: importeTexto(facSel ? Math.min(disp, Number(facSel.saldo_c)) : disp) }))
  }
  async function aplicar(origen: string, destino: string, importe: number | null) {
    if (!origen || !destino || !importe || importe <= 0) throw new Error('Elegí el cobro (o la retención), la factura y el importe a aplicar')
    const [ot, oid] = origen.split(':'); const [dt, did] = destino.split(':')
    if (dt === 'g') {
      if (ot !== 'cobro') throw new Error('A un remito sólo se le aplican cobros (las retenciones van a facturas)')
      await rpc('fact_aplicar_cargo', { p_cobro_id: oid, p_cargo_id: did, p_importe_c: importe, p_evidencia: { manual: true } })
      return
    }
    await rpc('fact_aplicar', { p_origen_tipo: ot, p_origen_id: oid, p_comprobante_id: dt === 'c' ? did : null, p_saldo_inicial_id: dt === 's' ? did : null, p_importe_c: importe, p_evidencia: { manual: true } })
  }

  return (
    <div style={{ marginTop: 10 }}>
      <Mensaje />
      <div style={{ ...S.fila, ...S.sub }}>
        <span>Deuda en comprobantes: <b style={{ color: '#e2e8f0' }}>{pesos(deuda)}</b></span>
        {restoRetenciones > 0 && <span title="Facturas cobradas a las que les falta cargar los certificados de retención: no es deuda">· Retenciones a certificar (no es deuda): {pesos(restoRetenciones)}</span>}
        {d.cargos.length > 0 && <span>· Remitos sin factura: <b style={{ color: '#e2e8f0' }}>{pesos(deudaCargos)}</b> · Total: <b style={{ color: '#e2e8f0' }}>{pesos(deuda + deudaCargos)}</b></span>}
        <span>· Intereses por mora a hoy (informativo): {intereses.cargando ? '…' : <b style={{ color: AMBAR }}>{pesos(totalInteres)}</b>}</span>
        {!intereses.cargando && totalInteres > 0 && <button style={{ ...S.btn2, padding: '2px 8px' }} onClick={() => correr(async () => {
          const texto = textoCliente()
          try { await navigator.clipboard.writeText(texto) } catch { window.prompt('Copiá el detalle para el cliente:', texto); return }
        }, 'Detalle copiado: pegalo en el correo o el WhatsApp al cliente')}>Copiar detalle para el cliente</button>}
      </div>
      {intereses.error && <div style={S.err}>{intereses.error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16, marginTop: 8 }}>
        <div>
          <h4 style={S.sub}>COMPROBANTES</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
            {d.saldos.map(s => <tr key={s.comprobante_id} onClick={() => elegirFactura(s)} title={Number(s.saldo_c) > 0 ? 'Tocá para cargar un cobro de esta factura' : undefined}
              style={{ cursor: Number(s.saldo_c) > 0 ? 'pointer' : undefined, background: s.comprobante_id === selFac ? '#1e3a5f' : undefined }}><td style={S.td}>{nv(s)}</td><td style={S.td}>{fecha(s.fecha_emision)}<div style={S.sub} title={detalleVencimiento(s)}>vence {fecha(vencimientoDe(s))}</div></td>
              <td style={S.num}>{pesos(s.total_c)}{Number(s.nc_c) > 0 && <div style={S.sub}>NC {pesos(s.nc_c)}</div>}</td>
              <td style={S.num}>{Number(s.saldo_c) <= 0 ? <span style={{ color: '#4ade80' }}>{Number(s.nc_c) >= Number(s.total_c) ? 'anulada' : 'pagada'}</span> : esRestoRetenciones(s) ? <span style={{ color: '#a3e635' }} title="Falta cargar las retenciones">cobrada<div style={S.sub}>faltan ret. {pesos(s.saldo_c)}</div></span> : <b>{pesos(s.saldo_c)}</b>}
                {(() => {
                  const i = interesDe(s.comprobante_id)
                  return i && i.interes_c > 0 ? <div style={{ ...S.sub, color: i.noCobrar ? '#64748b' : AMBAR, textDecoration: i.noCobrar ? 'line-through' : undefined }}
                    title={i.noCobrar ? `No se cobra: ${i.noCobrar.motivo}` : `${i.dias_mora} días de mora${i.cerradaEl ? `, cerrados el ${fecha(i.cerradaEl)}` : ' a hoy'}`}>interés {pesos(i.interes_c)}</div> : null
                })()}</td></tr>)}
            {d.si.map(s => <tr key={s.id}><td style={S.td}>Saldo inicial</td><td style={S.td}>{fecha(s.fecha)}</td><td style={S.num}>{pesos(s.importe_c)}</td><td style={S.td}><a href="#" style={{ color: '#93c5fd' }} onClick={e => { e.preventDefault(); correr(() => abrirDocumento(s.documento_id)) }}>respaldo</a></td></tr>)}
          </tbody></table>

          <h4 style={{ ...S.sub, marginTop: 12 }}>REMITOS / CARGOS SIN FACTURA</h4>
          <div style={S.sub}>Lo que el cliente paga y no se factura. No es un comprobante fiscal: sólo cuenta para la deuda del cliente.</div>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}><tbody>
            {d.cargos.map(g => <tr key={g.id}><td style={S.td}>{g.descripcion}{g.periodo ? <div style={S.sub}>{g.periodo}</div> : null}</td><td style={S.td}>{fecha(g.fecha)}</td>
              <td style={S.num}>{pesos(g.importe_c)}</td>
              <td style={S.num}>{Number(g.saldo_c) <= 0 ? <span style={{ color: '#4ade80' }}>pagado</span> : <b>{pesos(g.saldo_c)}</b>}
                <div><button style={{ ...S.btnPeligro, padding: '1px 6px' }} disabled={ocupado} onClick={() => {
                  const m = prompt(`Anular el cargo "${g.descripcion}" por ${pesos(g.importe_c)}.
Se revierten los pagos aplicados (quedan disponibles). Queda en el historial.

Motivo:`)
                  if (m) correr(async () => { await rpc('fact_cargo_anular', { p_id: g.id, p_motivo: m }); await cargar() }, 'Cargo anulado')
                }}>Anular</button></div></td></tr>)}
          </tbody></table>
          <div style={S.fila}>
            <input style={S.input} type="date" value={cargo.fecha} onChange={e => setCargo({ ...cargo, fecha: e.target.value })} />
            <input style={{ ...S.input, width: 90 }} type="month" title="Mes del servicio" value={cargo.periodo} onChange={e => setCargo({ ...cargo, periodo: e.target.value })} />
            <input style={{ ...S.input, flex: 1 }} placeholder="Descripción (ej. Remito junio)" value={cargo.descripcion} onChange={e => setCargo({ ...cargo, descripcion: e.target.value })} />
            <input style={{ ...S.input, width: 130 }} placeholder="Importe" value={cargo.importe} onChange={e => setCargo({ ...cargo, importe: e.target.value })} />
            <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => {
              const importe = centavosDe(cargo.importe)
              if (!cargo.fecha || !importe || importe <= 0 || cargo.descripcion.trim().length < 3) throw new Error('Completá fecha, descripción e importe del remito')
              await rpc('fact_cargo_registrar', { p_id: idCargo.current, p_datos: { cliente_id: clienteId, fecha: cargo.fecha, periodo: cargo.periodo, descripcion: cargo.descripcion, importe_c: importe } })
              idCargo.current = crypto.randomUUID(); setCargo({ fecha: '', periodo: '', descripcion: '', importe: '' }); await cargar()
            }, 'Remito cargado')}>+ Remito</button>
          </div>

          <h4 style={{ ...S.sub, marginTop: 12 }}>APLICAR</h4>
          <div style={S.fila}>
            <select style={S.input} value={ap.origen} onChange={e => setAp({ ...ap, origen: e.target.value })}>
              <option value="">Origen…</option>
              {d.cobros.filter(c => !c.anulado_at).map(c => <option key={c.id} value={`cobro:${c.id}`}>Cobro {fecha(c.fecha)} · disp. {pesos(Number(c.importe_c) - aplicado('cobro_id', c.id))}</option>)}
              {d.rets.filter(r => r.estado === 'certificado_recibido').map(r => <option key={r.id} value={`retencion:${r.id}`}>Ret. {r.impuesto} {r.certificado} · disp. {pesos(Number(r.importe_c) - aplicado('retencion_id', r.id))}</option>)}
            </select>
            <select style={S.input} value={ap.destino} onChange={e => setAp({ ...ap, destino: e.target.value })}>
              <option value="">Destino…</option>
              {d.saldos.filter(s => Number(s.saldo_c) > 0).map(s => <option key={s.comprobante_id} value={`c:${s.comprobante_id}`}>{nv(s)} · saldo {pesos(s.saldo_c)}</option>)}
              {d.si.filter(s => s.estado === 'vigente').map(s => <option key={s.id} value={`s:${s.id}`}>Saldo inicial</option>)}
              {d.cargos.filter(g => Number(g.saldo_c) > 0).map(g => <option key={g.id} value={`g:${g.id}`}>{g.descripcion} · saldo {pesos(g.saldo_c)}</option>)}
            </select>
            <input style={{ ...S.input, width: 130 }} placeholder="Importe" value={ap.importe} onChange={e => setAp({ ...ap, importe: e.target.value })} />
            <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => {
              await aplicar(ap.origen, ap.destino, centavosDe(ap.importe))
              setAp({ origen: '', destino: '', importe: '' }); setSelFac(null); await cargar()
            }, 'Aplicado')}>Aplicar</button>
          </div>
          <h4 style={{ ...S.sub, marginTop: 12 }}>APLICACIONES</h4>
          {d.aps.map(a => <div key={a.id} style={{ ...S.fila, fontSize: 13, opacity: a.revertida_at ? 0.5 : 1 }}>
            {fecha(a.created_at)} · {a.cobro_id ? 'cobro' : 'retención'} {pesos(a.importe_c)}{a.cargo_id ? ` → ${d.cargos.find(g => g.id === a.cargo_id)?.descripcion ?? 'remito'}` : ''} · {a.vinculo}{a.revertida_at ? ` · revertida: ${a.revertida_motivo}` : ''}
            {!a.revertida_at && <button style={{ ...S.btnPeligro, padding: '2px 8px' }} onClick={() => { const m = prompt('Motivo de la reversión'); if (m) correr(async () => { await rpc('fact_aplicacion_revertir', { p_id: a.id, p_motivo: m }); await cargar() }, 'Revertida') }}>Revertir</button>}
          </div>)}
        </div>

        <div>
          <h4 style={S.sub}>COBROS / ANTICIPOS / CHEQUES</h4>
          {d.cobros.map(c => <div key={c.id} style={{ ...S.fila, fontSize: 13, opacity: c.anulado_at ? 0.5 : 1, cursor: disponibleCobro(c) > 0 && !c.anulado_at ? 'pointer' : undefined, background: ap.origen === `cobro:${c.id}` ? '#1e3a5f' : undefined }}
            onClick={() => elegirCobro(c)} title={disponibleCobro(c) > 0 && !c.anulado_at ? 'Tocá para aplicarlo a la factura elegida' : undefined}>
            {fecha(c.fecha)} · {c.medio} · {pesos(c.importe_c)} · aplicado {pesos(aplicado('cobro_id', c.id))}{c.es_anticipo ? ' · anticipo' : ''}{c.cheque_estado ? ` · cheque ${c.cheque_numero} ${c.cheque_estado}` : ''}{c.referencia ? ` · ${c.referencia}` : ''}{c.anulado_at ? ` · anulado: ${c.anulado_motivo ?? ''}` : ''}
            {!c.anulado_at && <button style={{ ...S.btnPeligro, padding: '2px 8px' }} disabled={ocupado} onClick={e => {
              e.stopPropagation()
              const m = prompt(`Anular el pago del ${fecha(c.fecha)} por ${pesos(c.importe_c)}.\nSe revierten sus aplicaciones y la factura vuelve a quedar con saldo. El registro queda en el historial.\n\nMotivo:`)
              if (m) correr(async () => { await rpc('fact_cobro_anular_completo', { p_id: c.id, p_motivo: m }); await cargar() }, 'Pago anulado')
            }}>Anular pago</button>}
            {c.cheque_estado && ({ en_cartera: ['depositado', 'endosado'], depositado: ['acreditado', 'rechazado'], rechazado: ['en_cartera', 'anulado'] } as Record<string, string[]>)[c.cheque_estado]?.map(x => (
              <button key={x} style={{ ...S.btn2, padding: '2px 6px' }} onClick={() => correr(async () => { await rpc('fact_cheque_estado', { p_cobro_id: c.id, p_estado: x, p_motivo: null }); await cargar() })}>{x}</button>
            ))}
          </div>)}
          <div style={S.fila}>
            <input style={S.input} type="date" value={cobro.fecha} onChange={e => setCobro({ ...cobro, fecha: e.target.value })} />
            <input style={{ ...S.input, width: 130 }} placeholder="Importe" value={cobro.importe} onChange={e => setCobro({ ...cobro, importe: e.target.value })} />
            <select style={S.input} value={cobro.medio} onChange={e => setCobro({ ...cobro, medio: e.target.value })}>{['transferencia', 'deposito', 'cheque', 'echeq', 'efectivo', 'otro'].map(x => <option key={x}>{x}</option>)}</select>
            {['cheque', 'echeq'].includes(cobro.medio) && <>
              <input style={{ ...S.input, width: 110 }} placeholder="N° cheque" value={cobro.cheque_numero} onChange={e => setCobro({ ...cobro, cheque_numero: e.target.value })} />
              <input style={{ ...S.input, width: 110 }} placeholder="Banco" value={cobro.cheque_banco} onChange={e => setCobro({ ...cobro, cheque_banco: e.target.value })} />
              <input style={S.input} type="date" title="Fecha de pago" value={cobro.cheque_fecha_pago} onChange={e => setCobro({ ...cobro, cheque_fecha_pago: e.target.value })} />
            </>}
            <input style={S.input} placeholder="Referencia" value={cobro.referencia} onChange={e => setCobro({ ...cobro, referencia: e.target.value })} />
            <label style={S.sub}><input type="checkbox" checked={cobro.es_anticipo} onChange={e => setCobro({ ...cobro, es_anticipo: e.target.checked })} /> anticipo</label>
            <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => {
              await rpc('fact_cobro_registrar', { p_datos: { ...cobro, id: idCobro.current, cliente_id: clienteId, importe_c: centavosDe(cobro.importe) } })
              idCobro.current = crypto.randomUUID(); setCobro(c => ({ ...c, importe: '', referencia: '', cheque_numero: '', cheque_banco: '', cheque_fecha_pago: '' })); await cargar()
            }, 'Cobro registrado (sin aplicar)')}>Registrar cobro</button>
            {facSel && <button style={S.btn} disabled={ocupado} onClick={() => correr(async () => {
              const importe = centavosDe(cobro.importe)
              if (!cobro.fecha || !importe || importe <= 0) throw new Error('Completá la fecha y el importe del cobro')
              const id = await rpc('fact_cobro_registrar', { p_datos: { ...cobro, id: idCobro.current, cliente_id: clienteId, importe_c: importe } })
              idCobro.current = crypto.randomUUID()
              // Se aplica hasta el saldo de la factura; si el cobro es mayor, el resto queda disponible.
              await aplicar(`cobro:${id}`, `c:${facSel.comprobante_id}`, Math.min(importe, Number(facSel.saldo_c)))
              setCobro(c => ({ ...c, importe: '', referencia: '', cheque_numero: '', cheque_banco: '', cheque_fecha_pago: '' })); setSelFac(null); setAp({ origen: '', destino: '', importe: '' }); await cargar()
            }, 'Cobro registrado y aplicado a la factura')}>Registrar y aplicar a {nv(facSel)}</button>}
          </div>
          {facSel ? <div style={S.sub}>Factura elegida: {nv(facSel)} · saldo {pesos(facSel.saldo_c)}. Si cobraste menos por retenciones, cargá el importe cobrado y después las retenciones.</div>
            : <div style={S.sub}>Tocá una factura de la lista para precargar el cobro con su saldo.</div>}

          <h4 style={{ ...S.sub, marginTop: 12 }}>RETENCIONES</h4>
          {d.rets.map(r => <div key={r.id} style={{ ...S.fila, fontSize: 13, opacity: r.estado === 'anulada' ? 0.5 : 1 }}>
            {fecha(r.fecha)} · {r.impuesto} · cert. {r.certificado ?? '—'} · OP {r.orden_pago ?? '—'} · {pesos(r.importe_c)} · <b>{r.estado === 'estimada' ? 'ESTIMADA (no cancela)' : r.estado === 'anulada' ? 'ANULADA' : r.estado}</b>
            {r.estado !== 'anulada' && <button style={{ ...S.btnPeligro, padding: '2px 8px' }} disabled={ocupado} onClick={() => {
              const m = prompt(`Anular la retención de ${r.impuesto} ${r.certificado ?? ''} por ${pesos(r.importe_c)} (por ejemplo, si se cargó dos veces).
Si estaba aplicada, la factura vuelve a tener ese saldo. Queda en el historial.

Motivo:`)
              if (m) correr(async () => { await rpc('fact_retencion_anular', { p_id: r.id, p_motivo: m }); await cargar() }, 'Retención anulada')
            }}>Anular</button>}
          </div>)}
          <div style={S.fila}>
            <select style={S.input} value={ret.impuesto} onChange={e => setRet({ ...ret, impuesto: e.target.value })}>{['ganancias', 'iva', 'iibb', 'suss', 'otro'].map(x => <option key={x}>{x}</option>)}</select>
            <input style={{ ...S.input, width: 100 }} placeholder="Certificado" value={ret.certificado} onChange={e => setRet({ ...ret, certificado: e.target.value })} />
            <input style={{ ...S.input, width: 90 }} placeholder="OP" value={ret.orden_pago} onChange={e => setRet({ ...ret, orden_pago: e.target.value })} />
            <input style={S.input} type="date" value={ret.fecha} onChange={e => setRet({ ...ret, fecha: e.target.value })} />
            <input style={{ ...S.input, width: 120 }} placeholder="Importe" value={ret.importe} onChange={e => setRet({ ...ret, importe: e.target.value })} />
            <select style={S.input} value={ret.estado} onChange={e => setRet({ ...ret, estado: e.target.value })}><option value="certificado_recibido">Certificado recibido</option><option value="estimada">Estimada</option></select>
            <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => {
              await rpc('fact_retencion_registrar', { p_datos: { ...ret, cliente_id: clienteId, importe_c: centavosDe(ret.importe) } }); await cargar()
            }, 'Retención registrada')}>Registrar</button>
          </div>

          <h4 style={{ ...S.sub, marginTop: 12 }}>SALDO INICIAL (sólo con respaldo)</h4>
          <div style={S.fila}>
            <input style={S.input} type="date" value={si.fecha} onChange={e => setSi({ ...si, fecha: e.target.value })} />
            <input style={{ ...S.input, width: 120 }} placeholder="Importe" value={si.importe} onChange={e => setSi({ ...si, importe: e.target.value })} />
            <input style={S.input} placeholder="De dónde sale" value={si.detalle} onChange={e => setSi({ ...si, detalle: e.target.value })} />
            <input type="file" onChange={e => { const f = e.target.files?.[0]; if (f) correr(async () => { const r = await subirDocumento(f, 'otro', { cliente_id: clienteId }); setSi(x => ({ ...x, documento_id: r.id })) }, 'Respaldo cargado') }} />
            <button style={S.btn2} disabled={ocupado || !si.documento_id} onClick={() => correr(async () => {
              await rpc('fact_saldo_inicial_registrar', { p_cliente_id: clienteId, p_fecha: si.fecha, p_importe_c: centavosDe(si.importe), p_detalle: si.detalle, p_documento_id: si.documento_id }); await cargar()
            }, 'Saldo inicial registrado')}>Registrar</button>
          </div>
          <div style={S.sub}>No se reconstruyen saldos a partir de un extracto de un solo mes.</div>
        </div>
      </div>
    </div>
  )
}
