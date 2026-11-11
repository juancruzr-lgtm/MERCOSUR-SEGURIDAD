'use client'
// Conciliación con ARCA de las facturas emitidas FUERA de la app (Comprobantes en línea): corre sola
// después de cada importación de "Mis Comprobantes" y se puede volver a correr acá. Lo exacto o
// inequívoco se vincula solo (con la diferencia visible); lo ambiguo queda pendiente y se concilia a
// mano eligiendo la factura, con motivo. Las diferencias pendientes se pueden dar por explicadas.
import { useEffect, useState } from 'react'
import { api, leer, rpc } from '@/lib/facturacion/datos'
import { numeroVisible } from '@/lib/facturacion/comprobantes'
import { S, fecha, pesos } from './comun'

const nro = (c: any) => numeroVisible({ tipo: Number(c.tipo), puntoVenta: Number(c.punto_venta), numero: Number(c.numero) })

export default function FacturasExternas({ resultado, alCambiar }: { resultado: any; alCambiar: (r?: any) => void }) {
  const [ocupado, setOcupado] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [elegida, setElegida] = useState<Record<string, string>>({})
  const [pendientes, setPendientes] = useState<any[]>([])

  async function cargarPendientes() {
    const ps = await leer('fact_prefacturas', q => q.eq('estado', 'emitida').not('conciliacion', 'is', null).order('periodo_mes', { ascending: false }).limit(200),
      'id, periodo_mes, conciliacion, cliente:fact_clientes(razon_social)')
    setPendientes(ps.filter((p: any) => p.conciliacion?.estado_diferencia === 'pendiente'))
  }
  useEffect(() => { cargarPendientes().catch(() => {}) }, [resultado])

  async function conciliar() {
    setOcupado(true); setMsg(null)
    try { alCambiar(await api('conciliar', {})) } catch (e: any) { setMsg(e?.message ?? String(e)) } finally { setOcupado(false) }
  }
  async function manual(a: any) {
    const comprobante_id = elegida[a.prefactura_id] ?? (a.candidatas.length === 1 ? a.candidatas[0].id : '')
    if (!comprobante_id) { setMsg('Elegí la factura'); return }
    const motivo = prompt('Motivo de la conciliación manual (queda en el historial):')
    if (!motivo?.trim()) return
    setOcupado(true); setMsg(null)
    try { await api('conciliar', { prefactura_id: a.prefactura_id, version: a.version, comprobante_id, motivo }); alCambiar(await api('conciliar', {})) }
    catch (e: any) { setMsg(e?.message ?? String(e)) } finally { setOcupado(false) }
  }
  async function explicar(p: any) {
    const motivo = prompt('¿Por qué es correcta la diferencia? (queda en el historial)')
    if (!motivo?.trim()) return
    setOcupado(true); setMsg(null)
    try { await rpc('fact_conciliacion_diferencia', { p_prefactura_id: p.id, p_estado: 'explicada', p_motivo: motivo, p_periodo_facturado: null }); await cargarPendientes(); alCambiar() }
    catch (e: any) { setMsg(e?.message ?? String(e)) } finally { setOcupado(false) }
  }

  const r = resultado
  return (
    <div style={S.card}>
      <h3 style={S.h3}>Conciliación con ARCA (facturas emitidas fuera de la app)</h3>
      <div style={S.sub}>Corre sola al confirmar una importación de "Mis Comprobantes". Lo exacto o inequívoco (CUIT, tipo, período y total) se vincula solo, sin tocar horas ni importes; lo ambiguo queda pendiente. Lo que no está en el archivo no se marca.</div>
      <div style={{ ...S.fila, marginTop: 8 }}>
        <button style={S.btn} disabled={ocupado} onClick={conciliar}>Conciliar ahora</button>
        {msg && <span style={S.err}>{msg}</span>}
        {r?.error && <span style={S.err}>{r.error}</span>}
      </div>
      {r && !r.error && <div style={{ fontSize: 13, marginTop: 8 }}>
        <b>Última conciliación:</b> {r.conciliadas?.length ?? 0} vinculada(s){r.conciliadas?.length ? ` (${r.conciliadas.filter((x: any) => x.exacta).length} exactas)` : ''} · {r.ambiguas?.length ?? 0} pendiente(s) de revisión · {r.sin_factura ?? 0} prefactura(s) sin factura en el archivo · {r.sin_prefactura ?? 0} factura(s) sin prefactura abierta
        {(r.errores ?? []).map((e: string, i: number) => <div key={i} style={S.err}>{e}</div>)}
        {r.conciliadas?.length > 0 && <div style={{ ...S.sub, marginTop: 4 }}>{r.conciliadas.map((x: any) => `${x.cliente} ${x.mes} → ${x.factura}${x.estado_diferencia === 'pendiente' ? ' (con diferencia)' : ''}`).join(' · ')}</div>}
      </div>}
      {r?.ambiguas?.length > 0 && <>
        <h4 style={{ margin: '12px 0 4px' }}>Pendientes de revisión (no se vinculan solos)</h4>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}><tbody>
          {r.ambiguas.map((a: any) => <tr key={a.prefactura_id}>
            <td style={S.td}>{a.cliente} · {a.mes}</td><td style={S.td}>{a.motivo}</td>
            <td style={S.td}><select style={S.input} value={elegida[a.prefactura_id] ?? ''} onChange={e => setElegida({ ...elegida, [a.prefactura_id]: e.target.value })}>
              <option value="">Elegir factura…</option>
              {a.candidatas.map((c: any) => <option key={c.id} value={c.id}>{c.factura} · {fecha(c.fecha)} · {pesos(c.total_c)}</option>)}
            </select></td>
            <td style={S.td}><button style={S.btn2} disabled={ocupado} onClick={() => manual(a)}>Conciliar con esta</button></td>
          </tr>)}
        </tbody></table>
      </>}
      {pendientes.length > 0 && <>
        <h4 style={{ margin: '12px 0 4px' }}>Diferencias pendientes (factura emitida distinta de lo calculado)</h4>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}><tbody>
          {pendientes.map((p: any) => <tr key={p.id}>
            <td style={S.td}>{p.cliente?.razon_social} · {p.periodo_mes}</td><td style={S.td}>{nro(p.conciliacion)}</td>
            <td style={S.num}>{pesos(p.conciliacion.total_c)}</td>
            <td style={S.td}>{p.conciliacion.total_app_c != null ? `la app calculó ${pesos(p.conciliacion.total_app_c)}` : 'la app no tiene total'}
              {p.conciliacion.horas_facturadas != null && p.conciliacion.horas_app != null ? ` · ${p.conciliacion.horas_facturadas} h facturadas / ${p.conciliacion.horas_app} h calculadas` : ''}</td>
            <td style={S.td}><button style={S.btn2} disabled={ocupado} onClick={() => explicar(p)}>Marcar explicada</button></td>
          </tr>)}
        </tbody></table>
      </>}
    </div>
  )
}
