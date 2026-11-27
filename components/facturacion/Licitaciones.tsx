'use client'
// Clientes y contratos → Licitaciones y órdenes de compra: cada una con sus horas adjudicadas y cuánto lleva
// usado según los turnos de sus objetivos (hechas hasta hoy y programadas), lo ya facturado, el saldo y a qué
// ritmo se agota. Al tocar una se ve el detalle por mes y objetivo y se editan los objetivos ligados.
import { useEffect, useMemo, useState } from 'react'
import { leer, rpc } from '@/lib/facturacion/datos'
import { numeroVisible } from '@/lib/facturacion/comprobantes'
import { diasEntre } from '@/lib/facturacion/estado-cobro'
import { S, fecha, pesos, useAccion } from './comun'

const TIPO: Record<string, string> = { licitacion: 'Licitación', orden_compra: 'Orden de compra', presupuesto: 'Presupuesto' }
const h = (n: unknown) => Number(n ?? 0).toLocaleString('es-AR', { maximumFractionDigits: 1 })
const sumarDias = (iso: string, d: number) => { const x = new Date(`${iso}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }

export function estadoLicitacion(l: any) {
  const adj = Number(l.horas ?? 0), previas = Number(l.horas_previas ?? 0), hechas = Number(l.hechas) + previas, ritmo = Number(l.ultimos30) / 30
  const saldo = adj ? adj - hechas : null
  const pct = adj ? hechas / adj : null
  const agota = saldo != null && saldo > 0 && ritmo > 0 ? sumarDias(l.hoy, Math.ceil(saldo / ritmo)) : null
  const venceEn = l.vigencia_hasta ? diasEntre(l.hoy, l.vigencia_hasta) : null
  const alertas: string[] = []
  if (pct != null && pct >= 1) alertas.push('horas agotadas')
  else if (pct != null && pct >= 0.8) alertas.push(`${Math.round(pct * 100)} % usado`)
  if (venceEn != null && venceEn < 0) alertas.push('vencida')
  else if (venceEn != null && venceEn <= 30) alertas.push(`vence en ${venceEn} días`)
  if (agota && l.vigencia_hasta && agota < l.vigencia_hasta) alertas.push(`al ritmo actual se agota el ${fecha(agota)}`)
  if (adj && hechas + Number(l.futuras) > adj) alertas.push('lo programado supera las horas')
  return { adj, previas, hechas, saldo, pct, agota, venceEn, alertas, vigente: l.estado === 'vigente' && (venceEn == null || venceEn >= 0) }
}

export default function Licitaciones() {
  const [lista, setLista] = useState<any[]>([])
  const [objetivos, setObjetivos] = useState<any[]>([])
  const [abierta, setAbierta] = useState<string | null>(null)
  const [verTodas, setVerTodas] = useState(false)
  const [buscar, setBuscar] = useState('')
  const { ocupado, correr, Mensaje } = useAccion()

  async function cargar() {
    const [l, o] = await Promise.all([rpc<any[]>('fact_licitaciones_resumen', {}), leer('objetivos', q => q.order('nombre'), 'id, nombre, cliente, estado, es_prueba')])
    setLista(l ?? []); setObjetivos(o.filter((x: any) => !x.es_prueba))
  }
  useEffect(() => { correr(cargar) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filas = useMemo(() => lista.map(l => ({ ...l, ...estadoLicitacion(l) }))
    .filter(l => (verTodas || l.vigente) && (!buscar || `${l.cliente} ${l.numero} ${l.objetivos.map((o: any) => o.nombre).join(' ')}`.toLowerCase().includes(buscar.toLowerCase())))
    .sort((a, b) => (b.alertas.length - a.alertas.length) || String(a.cliente).localeCompare(String(b.cliente))), [lista, verTodas, buscar])

  return (
    <div style={S.card}>
      <div style={S.fila}>
        <h3 style={{ ...S.h3, margin: 0 }}>Licitaciones y órdenes de compra</h3>
        <input style={S.input} placeholder="Buscar cliente, número u objetivo" value={buscar} onChange={e => setBuscar(e.target.value)} />
        <label style={S.sub}><input type="checkbox" checked={verTodas} onChange={e => setVerTodas(e.target.checked)} /> Ver también vencidas y cerradas</label>
        <Mensaje />
      </div>
      <div style={{ ...S.sub, marginTop: 4 }}>
        Horas hechas = horas ya brindadas antes del sistema (si se cargaron) + turnos de los objetivos ligados, dentro de la vigencia, hasta hoy (no cuentan anulados, reemplazados, descubiertos ni ausentes). Facturadas = lo emitido contra la licitación desde la app.
        Para cargar una nueva: abrí el cliente más abajo y usá «+ Orden de compra» (tipo licitación).
      </div>
      <div style={{ overflow: 'auto', maxHeight: '60vh', marginTop: 8, border: '1px solid #1e293b', borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Cliente', 'Licitación', 'Vigencia', 'Adjudicadas', 'Hechas', 'Uso', 'Saldo', 'Programadas', 'Facturadas', 'Avisos'].map(t =>
            <th key={t} style={{ ...S.th, position: 'sticky', top: 0, background: '#0f1629' }}>{t}</th>)}</tr></thead>
          <tbody>{filas.map(l => {
            const pct = l.pct ?? 0, color = pct >= 1 ? '#ef4444' : pct >= 0.8 ? '#f59e0b' : '#22c55e'
            return [
              <tr key={l.id} onClick={() => setAbierta(abierta === l.id ? null : l.id)} style={{ cursor: 'pointer', background: abierta === l.id ? '#1e3a5f' : undefined }}>
                <td style={S.td}><b>{l.cliente}</b><div style={S.sub}>{l.objetivos.length ? `${l.objetivos.length} objetivo${l.objetivos.length > 1 ? 's' : ''}` : 'sin objetivos ligados'}</div></td>
                <td style={S.td}>{TIPO[l.tipo] ?? l.tipo} {l.numero || '—'}</td>
                <td style={S.td}>{fecha(l.vigencia_desde)} a {fecha(l.vigencia_hasta)}</td>
                <td style={S.num}>{l.adj ? h(l.adj) : '—'}</td>
                <td style={S.num}>{h(l.hechas)}{l.previas > 0 && <div style={S.sub}>incl. {h(l.previas)} previas</div>}</td>
                <td style={{ ...S.td, minWidth: 110 }}>{l.pct != null ? <>
                  <div style={{ height: 8, background: '#1e293b', borderRadius: 4, overflow: 'hidden' }}><div style={{ width: `${Math.min(100, pct * 100)}%`, height: '100%', background: color }} /></div>
                  <div style={S.sub}>{Math.round(pct * 100)} %</div></> : <span style={S.sub}>sin cupo de horas</span>}</td>
                <td style={{ ...S.num, color: l.saldo != null && l.saldo < 0 ? '#f87171' : undefined }}><b>{l.saldo != null ? h(l.saldo) : '—'}</b></td>
                <td style={S.num}>{h(l.futuras)}</td>
                <td style={S.num}>{h(l.facturadas)}</td>
                <td style={{ ...S.td, color: '#fbbf24', fontSize: 12 }}>{l.alertas.join(' · ')}</td>
              </tr>,
              abierta === l.id && <tr key={`${l.id}-d`}><td colSpan={10} style={{ padding: 0 }}>
                <Detalle l={l} objetivos={objetivos} alCambiar={() => correr(cargar)} />
              </td></tr>,
            ]
          })}
            {!filas.length && !ocupado && <tr><td style={S.td} colSpan={10}>No hay licitaciones u órdenes de compra {verTodas ? '' : 'vigentes '}cargadas.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Detalle({ l, objetivos, alCambiar }: { l: any; objetivos: any[]; alCambiar: () => void }) {
  const [d, setD] = useState<{ turnos: any[]; facturado: any[] } | null>(null)
  const [editar, setEditar] = useState(false)
  const [sel, setSel] = useState<string[]>(l.objetivos.map((o: any) => o.id))
  const [form, setForm] = useState({ horas: l.horas ?? '', vigencia_desde: l.vigencia_desde ?? '', vigencia_hasta: l.vigencia_hasta ?? '',
    previas: l.horas_previas ? String(l.horas_previas) : '', previas_hasta: l.horas_previas_hasta ?? '', previas_nota: l.horas_previas_nota ?? '' })
  const [filtro, setFiltro] = useState('')
  const { ocupado, correr, Mensaje } = useAccion()
  // Presupuesto en pesos: facturas descontadas de la OC (desde la app o cargadas acá) y facturas del cliente para descontar.
  const [consumos, setConsumos] = useState<any[]>([])
  const [facturasCliente, setFacturasCliente] = useState<any[]>([])
  const [aDescontar, setADescontar] = useState('')
  async function cargarPresupuesto() {
    const [c, k] = await Promise.all([
      leer('fact_oc_consumos', q => q.eq('oc_id', l.id).order('created_at'), 'id, total_c, neto_c, anulado_at, anulado_motivo, comprobante_id, prefactura_id, created_at'),
      leer('fact_comprobantes', q => q.eq('cliente_id', l.cliente_id).eq('ambiente', 'produccion').not('tipo', 'in', '(3,8,13,53,203,208,213)').order('fecha_emision', { ascending: false }).limit(60),
        'id, tipo, punto_venta, numero, fecha_emision, total_c, prefactura_id'),
    ])
    setConsumos(c); setFacturasCliente(k)
  }
  useEffect(() => { correr(async () => { setD(await rpc('fact_licitacion_detalle', { p_oc_id: l.id })); await cargarPresupuesto() }) }, [l.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const nvk = (k: any) => numeroVisible({ tipo: k.tipo, puntoVenta: k.punto_venta, numero: Number(k.numero) })
  const vigentes = consumos.filter(c => !c.anulado_at)
  const usadoPres = vigentes.reduce((a, c) => a + Number(l.monto_total_c != null ? c.total_c : c.neto_c), 0)
  const montoPres = Number(l.monto_total_c ?? l.monto_neto_c ?? 0)
  const yaDescontada = (k: any) => vigentes.some(c => c.comprobante_id === k.id || (k.prefactura_id && c.prefactura_id === k.prefactura_id))

  const meses = useMemo(() => Array.from(new Set([...(d?.turnos ?? []).map(t => t.mes), ...(d?.facturado ?? []).map(f => f.mes)])).sort(), [d])
  const objs = useMemo(() => Array.from(new Map((d?.turnos ?? []).map(t => [t.objetivo_id, t.objetivo])).entries()), [d])
  const celda = (mes: string, id: string) => (d?.turnos ?? []).find(t => t.mes === mes && t.objetivo_id === id)
  const deMes = (mes: string) => (d?.turnos ?? []).filter(t => t.mes === mes)
  const candidatos = objetivos.filter(o => sel.includes(o.id) || (o.estado === 'activo' && (!filtro || `${o.nombre} ${o.cliente ?? ''}`.toLowerCase().includes(filtro.toLowerCase()))))

  function guardar() {
    correr(async () => {
      await rpc('fact_oc_guardar', { p_id: l.id, p_version: l.version, p_objetivos: sel, p_datos: {
        numero: l.numero ?? '', fecha: l.fecha ?? '', vigencia_desde: form.vigencia_desde, vigencia_hasta: form.vigencia_hasta,
        monto_neto_c: l.monto_neto_c ?? '', monto_total_c: l.monto_total_c ?? '', horas: String(form.horas ?? '').replace(',', '.'),
        aceptado_at: l.aceptado_at ?? '', condiciones: l.condiciones ?? '', documento_id: l.documento_id ?? '' } })
      const previas = Number(String(form.previas || '0').replace(',', '.'))
      if (previas !== Number(l.horas_previas ?? 0) || (form.previas_hasta || null) !== (l.horas_previas_hasta ?? null) || (form.previas_nota || '') !== (l.horas_previas_nota ?? ''))
        await rpc('fact_oc_horas_previas', { p_id: l.id, p_horas: previas, p_hasta: form.previas_hasta || null, p_nota: form.previas_nota })
      setEditar(false); alCambiar()
    }, 'Licitación actualizada')
  }

  return (
    <div style={{ background: '#0a0e1a', border: '1px solid #1e3a5f', borderRadius: 8, padding: 12, margin: '4px 0 10px' }}>
      <div style={S.fila}>
        <b>{TIPO[l.tipo] ?? l.tipo} {l.numero}</b><span style={S.sub}>{l.cliente}</span>
        {(l.monto_total_c ?? l.monto_neto_c) != null && <span style={S.sub}>Monto {pesos(l.monto_total_c ?? l.monto_neto_c)} {l.monto_total_c != null ? 'c/IVA' : 'neto'} · facturado {pesos(l.monto_total_c != null ? l.consumido_total_c : l.consumido_neto_c)}</span>}
        <button style={S.btn2} onClick={() => setEditar(!editar)}>{editar ? 'Cancelar' : 'Editar horas, vigencia y objetivos'}</button>
        <Mensaje />
      </div>
      {l.previas > 0 && <div style={{ marginTop: 6, fontSize: 13 }}><span style={S.sub}>Antes del sistema:</span> {h(l.previas)} h hasta el {fecha(l.horas_previas_hasta)}{l.horas_previas_nota ? ` · ${l.horas_previas_nota}` : ''}</div>}
      <div style={{ marginTop: 6, fontSize: 13 }}><span style={S.sub}>Objetivos ligados:</span> {l.objetivos.length ? l.objetivos.map((o: any) => o.nombre).join(', ') : <span style={S.err}>ninguno: no descuenta horas</span>}</div>

      {editar && <div style={{ marginTop: 8, padding: 8, border: '1px solid #1e293b', borderRadius: 6 }}>
        <div style={S.fila}>
          <label style={S.sub}>Horas adjudicadas <input style={{ ...S.input, width: 110 }} value={form.horas} onChange={e => setForm({ ...form, horas: e.target.value })} /></label>
          <label style={S.sub}>Desde <input style={S.input} type="date" value={form.vigencia_desde} onChange={e => setForm({ ...form, vigencia_desde: e.target.value })} /></label>
          <label style={S.sub}>Hasta <input style={S.input} type="date" value={form.vigencia_hasta} onChange={e => setForm({ ...form, vigencia_hasta: e.target.value })} /></label>
        </div>
        <div style={{ ...S.fila, marginTop: 6 }}>
          <label style={S.sub}>Horas ya brindadas antes del sistema <input style={{ ...S.input, width: 110 }} value={form.previas} onChange={e => setForm({ ...form, previas: e.target.value })} /></label>
          <label style={S.sub}>hasta el día (inclusive) <input style={S.input} type="date" value={form.previas_hasta} onChange={e => setForm({ ...form, previas_hasta: e.target.value })} /></label>
          <input style={{ ...S.input, minWidth: 220 }} placeholder="De dónde sale (planilla, facturas…)" value={form.previas_nota} onChange={e => setForm({ ...form, previas_nota: e.target.value })} />
        </div>
        <div style={S.sub}>Los turnos se cuentan desde el día siguiente a esa fecha, para no contar dos veces lo mismo.</div>
        <div style={{ ...S.fila, marginTop: 6 }}><span style={S.sub}>Objetivos ({sel.length} elegidos)</span>
          <input style={S.input} placeholder="Filtrar objetivos" value={filtro} onChange={e => setFiltro(e.target.value)} /></div>
        <div style={{ maxHeight: 220, overflow: 'auto', marginTop: 4, columns: 2, fontSize: 13 }}>
          {candidatos.map(o => <label key={o.id} style={{ display: 'block' }}>
            <input type="checkbox" checked={sel.includes(o.id)} onChange={e => setSel(e.target.checked ? [...sel, o.id] : sel.filter(x => x !== o.id))} /> {o.nombre} <span style={S.sub}>{o.cliente ?? ''}</span></label>)}
        </div>
        <button style={{ ...S.btn, marginTop: 6 }} disabled={ocupado} onClick={guardar}>Guardar</button>
      </div>}

      {montoPres > 0 && <div style={{ marginTop: 10 }}>
        <h4 style={S.sub}>PRESUPUESTO {l.monto_total_c != null ? '(CON IVA)' : '(NETO)'}: {pesos(montoPres)} · usado {pesos(usadoPres)} · <span style={{ color: montoPres - usadoPres < 0 ? '#f87171' : '#4ade80' }}>queda {pesos(montoPres - usadoPres)}</span></h4>
        {l.condiciones && <div style={{ ...S.sub, whiteSpace: 'pre-wrap' }}>{l.condiciones}</div>}
        {consumos.map(c => { const k = facturasCliente.find(x => x.id === c.comprobante_id || (c.prefactura_id && x.prefactura_id === c.prefactura_id))
          return <div key={c.id} style={{ ...S.fila, fontSize: 13, opacity: c.anulado_at ? 0.5 : 1 }}>
            {k ? `${nvk(k)} · ${fecha(k.fecha_emision)}` : 'Factura de la app'} · <b>{pesos(l.monto_total_c != null ? c.total_c : c.neto_c)}</b>
            {c.anulado_at ? <span style={S.sub}> · anulado: {c.anulado_motivo ?? ''}</span>
              : c.comprobante_id && <button style={{ ...S.btnPeligro, padding: '1px 6px' }} disabled={ocupado} onClick={() => {
                const m = prompt('Quitar esta factura del presupuesto de la OC (queda en el historial). Motivo:')
                if (m) correr(async () => { await rpc('fact_oc_consumo_anular', { p_id: c.id, p_motivo: m }); await cargarPresupuesto(); alCambiar() }, 'Quitada del presupuesto')
              }}>Quitar</button>}
          </div> })}
        <div style={{ ...S.fila, marginTop: 4 }}>
          <select style={{ ...S.input, minWidth: 260 }} value={aDescontar} onChange={e => setADescontar(e.target.value)}>
            <option value="">Descontar una factura del cliente…</option>
            {facturasCliente.filter(k => !yaDescontada(k)).map(k => <option key={k.id} value={k.id}>{nvk(k)} · {fecha(k.fecha_emision)} · {pesos(k.total_c)}</option>)}
          </select>
          <button style={S.btn2} disabled={ocupado || !aDescontar} onClick={() => correr(async () => {
            await rpc('fact_oc_consumo_comprobante', { p_oc_id: l.id, p_comprobante_id: aDescontar }); setADescontar(''); await cargarPresupuesto(); alCambiar()
          }, 'Factura descontada del presupuesto')}>Descontar</button>
        </div>
        <div style={S.sub}>Sirve para facturas hechas por fuera de la app o para clientes que dan un presupuesto en pesos (por ejemplo, INTA).</div>
      </div>}

      <h4 style={{ ...S.sub, marginTop: 10 }}>HORAS POR MES Y OBJETIVO</h4>
      {d && meses.length ? <div style={{ overflow: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={S.th}>Mes</th>{objs.map(([id, n]) => <th key={id} style={S.th}>{n}</th>)}<th style={S.th}>Total turnos</th><th style={S.th}>Facturadas</th><th style={S.th}>Acumulado</th></tr></thead>
        <tbody>{l.previas > 0 && <tr><td style={S.td}>Antes del sistema</td>{objs.map(([id]) => <td key={id} style={S.num}>—</td>)}<td style={S.num}><b>{h(l.previas)}</b></td><td style={S.num}>—</td><td style={S.num}>{h(l.previas)}{l.adj ? <div style={S.sub}>{Math.round(l.previas / l.adj * 100)} %</div> : null}</td></tr>}
          {meses.map((m, i) => {
          const tot = deMes(m).reduce((a, t) => a + Number(t.hechas ?? 0) + Number(t.futuras ?? 0), 0)
          const acum = l.previas + meses.slice(0, i + 1).flatMap(deMes).reduce((a, t) => a + Number(t.hechas ?? 0) + Number(t.futuras ?? 0), 0)
          const fac = (d.facturado ?? []).find(f => f.mes === m)
          return <tr key={m}><td style={S.td}>{m.slice(5)}/{m.slice(0, 4)}</td>
            {objs.map(([id]) => { const c = celda(m, id); return <td key={id} style={S.num}>{c ? <>{h(Number(c.hechas ?? 0))}{Number(c.futuras ?? 0) > 0 && <div style={S.sub}>+{h(c.futuras)} prog.</div>}</> : '—'}</td> })}
            <td style={S.num}><b>{h(tot)}</b></td><td style={S.num}>{fac ? h(fac.horas) : '—'}</td>
            <td style={{ ...S.num, color: l.adj && acum > l.adj ? '#f87171' : undefined }}>{h(acum)}{l.adj ? <div style={S.sub}>{Math.round(acum / l.adj * 100)} %</div> : null}</td></tr>
        })}</tbody>
      </table></div> : <div style={S.sub}>{d ? 'Sin turnos en la vigencia para los objetivos ligados.' : 'Cargando…'}</div>}
    </div>
  )
}
