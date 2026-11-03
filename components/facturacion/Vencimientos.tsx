'use client'
// Vencimientos comerciales y mora de las facturas con saldo.
// El vencimiento sale del contrato (plazo + evento) y de las fechas reales de
// cada factura; sin condición cargada queda "pendiente de definir". Los
// intereses se simulan, se proponen, se revisan con justificación y se
// aprueban; recién ahí se SOLICITA la nota de débito (que sigue su circuito).
import { useEffect, useState } from 'react'
import { leer, rpc } from '@/lib/facturacion/datos'
import { numeroVisible } from '@/lib/facturacion/comprobantes'
import { Etiqueta, S, centavosDe, fecha, pesos, useAccion } from './comun'

const ESTADO_MORA: Record<string, [string, string]> = {
  sin_vencimiento: ['Condición o fecha pendiente', '#b45309'], no_vencida: ['No vencida', '#334155'], proxima: ['Vence en ≤ 7 días', '#2563eb'],
  vencida_sin_clausula: ['Vencida · sin cláusula de interés', '#7f1d1d'], interes_potencial: ['Vencida · interés potencial', '#b91c1c'],
  interes_revisado: ['Interés revisado', '#7c3aed'], interes_aprobado: ['Interés aprobado', '#15803d'], nd_solicitada: ['Nota de débito solicitada', '#15803d'],
}

const hoyAr = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }).format(new Date())

export default function Vencimientos() {
  const [hoy, setHoy] = useState(hoyAr())
  const [filas, setFilas] = useState<any[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')
  const { ocupado, correr, Mensaje } = useAccion()
  const cargar = async () => setFilas(await rpc('fact_vencimientos', { p_hoy: hoy, p_cliente_id: null, p_objetivo_id: null }))
  useEffect(() => { correr(cargar) }, [hoy]) // eslint-disable-line react-hooks/exhaustive-deps
  const visibles = filas.filter(f => !filtro || f.estado_mora === filtro)
  const actual = filas.find(f => f.comprobante_id === sel)

  return (
    <div>
      <div style={{ ...S.card, ...S.fila }}>
        <span>Situación al</span><input style={S.input} type="date" value={hoy} onChange={e => setHoy(e.target.value)} />
        <select style={S.input} value={filtro} onChange={e => setFiltro(e.target.value)}>
          <option value="">Todas</option>{Object.entries(ESTADO_MORA).map(([k, [t]]) => <option key={k} value={k}>{t}</option>)}
        </select>
        <span style={S.sub}>Saldos según cobros y retenciones cargados: pendientes de conciliación hasta incorporar los extractos.</span>
        <Mensaje />
      </div>
      <div style={{ ...S.card, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{['Comprobante', 'Cliente', 'Emisión', 'Total', 'Saldo', 'Vencimiento', 'Días de mora', 'Interés estimado', 'Estado'].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>{visibles.map(f => {
            const [t, c] = ESTADO_MORA[f.estado_mora] ?? [f.estado_mora, '#334155']
            return (
              <tr key={f.comprobante_id} onClick={() => setSel(f.comprobante_id === sel ? null : f.comprobante_id)} style={{ cursor: 'pointer', background: f.comprobante_id === sel ? '#111c35' : undefined }}>
                <td style={S.td}>{numeroVisible({ tipo: f.tipo, puntoVenta: f.punto_venta, numero: f.numero })}</td>
                <td style={S.td}>{f.receptor ?? '—'}</td><td style={S.td}>{fecha(f.fecha_emision)}</td>
                <td style={S.num}>{pesos(f.total_c)}</td><td style={S.num}>{pesos(f.saldo_c)}</td>
                <td style={S.td}>{f.vencimiento?.vencimiento ? fecha(f.vencimiento.vencimiento) : <span style={{ color: '#fbbf24', fontSize: 12 }}>{f.vencimiento?.motivo}</span>}</td>
                <td style={S.num}>{f.dias_mora || '—'}</td><td style={S.num}>{f.interes_estimado_c ? pesos(f.interes_estimado_c) : '—'}</td>
                <td style={S.td}><Etiqueta texto={t} color={c} /></td>
              </tr>
            )
          })}
          {!visibles.length && <tr><td style={S.td} colSpan={9}><span style={S.sub}>Sin facturas con saldo.</span></td></tr>}</tbody>
        </table>
      </div>
      {actual && <DetalleMora key={actual.comprobante_id + hoy} f={actual} hoy={hoy} alCambiar={() => correr(cargar)} />}
    </div>
  )
}

function DetalleMora({ f, hoy, alCambiar }: { f: any; hoy: string; alCambiar: () => void }) {
  const [seg, setSeg] = useState({ presentada_el: '', recibida_el: '', conformidad_el: '', vencimiento_manual: '', vencimiento_manual_motivo: '' })
  const [sim, setSim] = useState<any>(null)
  const [int, setInt] = useState<any>(null)
  const [just, setJust] = useState('')
  const [iva, setIva] = useState('')
  const { ocupado, correr, Mensaje } = useAccion()
  useEffect(() => {
    correr(async () => {
      const [s] = await leer('fact_comprobante_seguimiento', q => q.eq('comprobante_id', f.comprobante_id))
      if (s) setSeg({ presentada_el: s.presentada_el ?? '', recibida_el: s.recibida_el ?? '', conformidad_el: s.conformidad_el ?? '', vencimiento_manual: s.vencimiento_manual ?? '', vencimiento_manual_motivo: s.vencimiento_manual_motivo ?? '' })
      if (f.interes_id) setInt((await leer('fact_intereses', q => q.eq('id', f.interes_id)))[0] ?? null)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={S.card}>
      <h3 style={S.h3}>{numeroVisible({ tipo: f.tipo, puntoVenta: f.punto_venta, numero: f.numero })} · {f.receptor} · saldo {pesos(f.saldo_c)}</h3>
      <Mensaje />
      <h4 style={S.sub}>FECHAS REALES (inician el plazo según el contrato)</h4>
      <div style={S.fila}>
        <label style={S.sub}>Presentada <input style={S.input} type="date" value={seg.presentada_el} onChange={e => setSeg({ ...seg, presentada_el: e.target.value })} /></label>
        <label style={S.sub}>Recibida <input style={S.input} type="date" value={seg.recibida_el} onChange={e => setSeg({ ...seg, recibida_el: e.target.value })} /></label>
        <label style={S.sub}>Conformidad <input style={S.input} type="date" value={seg.conformidad_el} onChange={e => setSeg({ ...seg, conformidad_el: e.target.value })} /></label>
        <label style={S.sub}>Vencimiento acordado <input style={S.input} type="date" value={seg.vencimiento_manual} onChange={e => setSeg({ ...seg, vencimiento_manual: e.target.value })} /></label>
        {seg.vencimiento_manual && <input style={S.input} placeholder="Motivo del vencimiento acordado" value={seg.vencimiento_manual_motivo} onChange={e => setSeg({ ...seg, vencimiento_manual_motivo: e.target.value })} />}
        <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => { await rpc('fact_seguimiento_registrar', { p_comprobante_id: f.comprobante_id, p_datos: seg }); alCambiar() }, 'Fechas guardadas')}>Guardar fechas</button>
      </div>
      <div style={S.sub}>Vencimiento: {f.vencimiento?.vencimiento ? `${fecha(f.vencimiento.vencimiento)} (${f.vencimiento.estado === 'manual' ? 'acordado' : `${f.vencimiento.dias ?? ''} días ${f.vencimiento.evento ?? ''}`})` : f.vencimiento?.motivo}. No es el vencimiento del CAE.</div>

      <h4 style={{ ...S.sub, marginTop: 12 }}>INTERESES POR MORA</h4>
      {!int && <div style={S.fila}>
        <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => setSim(await rpc('fact_interes_simular', { p_comprobante_id: f.comprobante_id, p_hasta: hoy })))}>Calcular al {fecha(hoy)}</button>
        {sim?.estado === 'calculado' && sim.importe_c > 0 && <button style={S.btn} disabled={ocupado} onClick={() => correr(async () => { await rpc('fact_interes_proponer', { p_comprobante_id: f.comprobante_id, p_hasta: hoy }); alCambiar() }, 'Interés propuesto: falta revisarlo')}>Proponer</button>}
      </div>}
      {sim && sim.estado !== 'calculado' && <div style={S.aviso}>{sim.motivo ?? sim.estado}</div>}
      {(int?.calculo ?? sim)?.tramos && <table style={{ borderCollapse: 'collapse', marginTop: 6 }}><tbody>
        {((int?.calculo ?? sim).tramos as any[]).map((t, i) => <tr key={i}><td style={S.td}>{fecha(t.desde)} a {fecha(t.hasta)}</td><td style={S.num}>{t.dias} días</td><td style={S.num}>sobre {pesos(t.saldo_c)}</td><td style={S.num}>{pesos(t.interes_c)}</td></tr>)}
        <tr><td style={S.td} colSpan={3}>Tasa {(int?.calculo ?? sim).tasa} % {(int?.calculo ?? sim).periodo} · {(int?.calculo ?? sim).metodo} · {(int?.calculo ?? sim).condiciones ?? ''}</td><td style={S.num}><b>{pesos((int?.calculo ?? sim).importe_c)}</b></td></tr>
      </tbody></table>}
      {int && <div style={{ ...S.fila, marginTop: 6 }}>
        <span style={S.sub}>Estado: {int.estado}{int.justificacion ? ` · ${int.justificacion}` : ''}</span>
        {int.estado === 'potencial' && <>
          <input style={{ ...S.input, flex: 1 }} placeholder="Justificación (cláusula, intimación, acuerdo)" value={just} onChange={e => setJust(e.target.value)} />
          <button style={S.btn2} disabled={ocupado} onClick={() => correr(async () => { await rpc('fact_interes_revisar', { p_id: int.id, p_justificacion: just }); alCambiar() }, 'Revisado')}>Marcar revisado</button>
        </>}
        {int.estado === 'revisado' && <button style={S.btn} disabled={ocupado} onClick={() => correr(async () => { await rpc('fact_interes_aprobar', { p_id: int.id }); alCambiar() }, 'Interés aprobado (se recalculó y coincide)')}>Aprobar interés</button>}
        {int.estado === 'aprobado' && <>
          <input style={{ ...S.input, width: 140 }} placeholder="IVA de la ND ($)" value={iva} onChange={e => setIva(e.target.value)} />
          <button style={S.btn2} disabled={ocupado || iva === ''} onClick={() => correr(async () => {
            await rpc('fact_interes_solicitar_nd', { p_id: int.id, p_iva_c: centavosDe(iva) ?? 0, p_motivo: null }); alCambiar()
          }, 'Nota de débito solicitada: queda pendiente de aprobación en Comprobantes')}>Solicitar nota de débito</button>
        </>}
        {['potencial', 'revisado', 'aprobado'].includes(int.estado) && <button style={S.btnPeligro} disabled={ocupado} onClick={() => {
          const m = prompt('Motivo de la anulación'); if (!m) return
          correr(async () => { await rpc('fact_interes_anular', { p_id: int.id, p_motivo: m }); alCambiar() }, 'Anulado')
        }}>Anular</button>}
      </div>}
      <div style={S.sub}>Ningún interés se aplica ni se factura solo. El IVA de la nota de débito lo define Administración.</div>
    </div>
  )
}
