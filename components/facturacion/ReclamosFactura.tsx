'use client'
// Cobranzas → Facturas y cobros: reclamos de pago de una factura (historial + alta).
// Un reclamo puede abarcar varias facturas impagas del mismo cliente. No cambia el saldo: es seguimiento.
// No se borra: se anula con motivo y queda en el historial (fact_reclamo_* en el servidor, con auth.uid()).
import { useState } from 'react'
import { rpc } from '@/lib/facturacion/datos'
import { fechaArgentina } from '@/lib/periodo-argentina'
import { S, centavosDe, fecha, pesos, useAccion } from './comun'

export const MEDIOS_RECLAMO: Record<string, string> = {
  mail: 'Mail', telefono: 'Teléfono', whatsapp: 'WhatsApp', nota: 'Nota', carta_documento: 'Carta documento',
  portal: 'Portal del cliente', visita: 'Visita', otro: 'Otro',
}

export interface Reclamo {
  id: string; cliente_id: string; comprobante_ids: string[]; fecha: string; medio: string; contacto: string | null
  detalle: string; respuesta: string | null; promesa_fecha: string | null; promesa_importe_c: number | null
  proximo_contacto: string | null; created_at: string
}

/** Último reclamo (por fecha) de una factura. */
export function ultimoReclamo(reclamos: Reclamo[], compId: string): Reclamo | null {
  return reclamos.filter(r => r.comprobante_ids.includes(compId))
    .sort((a, b) => (a.fecha + a.created_at < b.fecha + b.created_at ? 1 : -1))[0] ?? null
}

/** Celda de la lista: fecha y medio del último reclamo; en ámbar si toca volver a llamar. */
export function CeldaReclamo({ r, hoy }: { r: Reclamo | null; hoy: string }) {
  if (!r) return null
  const toca = r.proximo_contacto && r.proximo_contacto <= hoy
  return <div style={{ fontSize: 12, whiteSpace: 'nowrap', marginTop: 3, color: '#fdba74' }}>
    Reclamada el {fecha(r.fecha)} · {MEDIOS_RECLAMO[r.medio] ?? r.medio}
    {r.promesa_fecha && <div style={{ color: '#93c5fd' }}>promete {fecha(r.promesa_fecha)}</div>}
    {r.proximo_contacto && <div style={{ color: toca ? '#fbbf24' : '#64748b' }}>{toca ? 'volver a reclamar' : 'próximo'} {fecha(r.proximo_contacto)}</div>}
  </div>
}

export function ReclamosFactura({ f, reclamos, otrasImpagas, alCambiar }: {
  f: any; reclamos: Reclamo[]; otrasImpagas: Array<{ comprobante_id: string; nv: string; saldo_c: number }>; alCambiar: () => void
}) {
  const hoy = fechaArgentina()
  const vacio = { fecha: hoy, medio: 'mail', contacto: '', detalle: '', respuesta: '', promesa_fecha: '', promesa_importe: '', proximo_contacto: '' }
  const [d, setD] = useState(vacio)
  const [otras, setOtras] = useState<string[]>([])
  const [abierto, setAbierto] = useState(false)
  const { ocupado, correr, Mensaje } = useAccion()
  const propios = reclamos.filter(r => r.comprobante_ids.includes(f.comprobante_id))
    .sort((a, b) => (a.fecha + a.created_at < b.fecha + b.created_at ? 1 : -1))
  const saldo = Number(f.saldo_c)

  function registrar() {
    correr(async () => {
      if (d.detalle.trim().length < 5) throw new Error('Contá qué se reclamó (al menos 5 caracteres)')
      const promesa = d.promesa_importe ? centavosDe(d.promesa_importe) : null
      await rpc('fact_reclamo_registrar', { p_id: crypto.randomUUID(), p_datos: {
        comprobante_ids: [f.comprobante_id, ...otras], fecha: d.fecha, medio: d.medio, contacto: d.contacto, detalle: d.detalle,
        respuesta: d.respuesta, promesa_fecha: d.promesa_fecha, promesa_importe_c: promesa ?? '', proximo_contacto: d.proximo_contacto,
      } })
      setD(vacio); setOtras([]); setAbierto(false); alCambiar()
    }, 'Reclamo registrado')
  }
  function actualizar(r: Reclamo) {
    const respuesta = prompt('Respuesta del cliente (queda registrada; lo anterior se guarda en el historial):', r.respuesta ?? '')
    if (respuesta === null) return
    const proximo = prompt('¿Cuándo volver a reclamar? (AAAA-MM-DD, vacío = sin fecha)', r.proximo_contacto ?? '')
    if (proximo === null) return
    if (proximo && !/^\d{4}-\d{2}-\d{2}$/.test(proximo)) { alert('Fecha inválida: usá AAAA-MM-DD'); return }
    correr(async () => { await rpc('fact_reclamo_actualizar', { p_id: r.id, p_datos: { respuesta, proximo_contacto: proximo } }); alCambiar() }, 'Reclamo actualizado')
  }
  function anular(r: Reclamo) {
    const m = prompt(`Anular el reclamo del ${fecha(r.fecha)} (queda en el historial). Motivo:`)
    if (!m) return
    correr(async () => { await rpc('fact_reclamo_anular', { p_id: r.id, p_motivo: m }); alCambiar() }, 'Reclamo anulado')
  }

  return (
    <div style={{ marginTop: 8 }}>
      <div style={S.fila}><h4 style={{ ...S.sub, margin: 0 }}>RECLAMOS DE PAGO ({propios.length})</h4>
        {saldo > 0 && !abierto && <button style={{ ...S.btn2, padding: '2px 10px' }} onClick={() => setAbierto(true)}>+ Registrar reclamo</button>}
        <Mensaje /></div>
      {propios.map(r => (
        <div key={r.id} style={{ borderLeft: '2px solid #334155', paddingLeft: 8, margin: '6px 0' }}>
          <div><b>{fecha(r.fecha)}</b> · {MEDIOS_RECLAMO[r.medio] ?? r.medio}{r.contacto ? ` · a ${r.contacto}` : ''}
            {r.comprobante_ids.length > 1 && <span style={S.sub}> · abarca {r.comprobante_ids.length} facturas</span>}</div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{r.detalle}</div>
          {r.respuesta && <div style={{ whiteSpace: 'pre-wrap', color: '#cbd5e1' }}>Respuesta: {r.respuesta}</div>}
          {(r.promesa_fecha || r.promesa_importe_c) && <div style={{ color: '#93c5fd' }}>Promesa de pago{r.promesa_fecha ? ` el ${fecha(r.promesa_fecha)}` : ''}{r.promesa_importe_c ? ` por ${pesos(r.promesa_importe_c)}` : ''}</div>}
          {r.proximo_contacto && <div style={{ color: r.proximo_contacto <= hoy ? '#fbbf24' : '#64748b' }}>Volver a reclamar el {fecha(r.proximo_contacto)}</div>}
          <div style={{ ...S.fila, gap: 6, marginTop: 2 }}>
            <button style={{ ...S.btn2, padding: '2px 8px' }} disabled={ocupado} onClick={() => actualizar(r)}>Cargar respuesta / próximo contacto</button>
            <button style={{ ...S.btnPeligro, padding: '2px 8px' }} disabled={ocupado} onClick={() => anular(r)}>Anular</button>
          </div>
        </div>))}
      {!propios.length && !abierto && <div style={S.sub}>Sin reclamos registrados.</div>}
      {abierto && <div style={{ border: '1px solid #1e293b', borderRadius: 6, padding: 8, marginTop: 6 }}>
        <div style={S.fila}>
          <input style={S.input} type="date" max={hoy} value={d.fecha} onChange={e => setD({ ...d, fecha: e.target.value })} />
          <select style={S.input} value={d.medio} onChange={e => setD({ ...d, medio: e.target.value })}>{Object.entries(MEDIOS_RECLAMO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
          <input style={{ ...S.input, flex: 1 }} placeholder="A quién (nombre, área, mail o teléfono)" value={d.contacto} onChange={e => setD({ ...d, contacto: e.target.value })} />
        </div>
        <textarea style={{ ...S.input, width: '100%', minHeight: 60, marginTop: 6 }} placeholder="Qué se reclamó" value={d.detalle} onChange={e => setD({ ...d, detalle: e.target.value })} />
        <textarea style={{ ...S.input, width: '100%', minHeight: 40, marginTop: 6 }} placeholder="Qué respondieron (opcional)" value={d.respuesta} onChange={e => setD({ ...d, respuesta: e.target.value })} />
        <div style={{ ...S.fila, marginTop: 6 }}>
          <label style={S.sub}>Promete pagar el <input style={S.input} type="date" value={d.promesa_fecha} onChange={e => setD({ ...d, promesa_fecha: e.target.value })} /></label>
          <input style={{ ...S.input, width: 130 }} placeholder="Importe prometido" value={d.promesa_importe} onChange={e => setD({ ...d, promesa_importe: e.target.value })} />
          <label style={S.sub}>Volver a reclamar el <input style={S.input} type="date" value={d.proximo_contacto} onChange={e => setD({ ...d, proximo_contacto: e.target.value })} /></label>
        </div>
        {otrasImpagas.length > 0 && <div style={{ marginTop: 6 }}>
          <div style={S.sub}>Incluir otras facturas impagas del cliente en este reclamo:</div>
          {otrasImpagas.map(o => <label key={o.comprobante_id} style={{ ...S.sub, display: 'inline-block', marginRight: 12 }}>
            <input type="checkbox" checked={otras.includes(o.comprobante_id)} onChange={e => setOtras(e.target.checked ? [...otras, o.comprobante_id] : otras.filter(x => x !== o.comprobante_id))} /> {o.nv} ({pesos(o.saldo_c)})</label>)}
        </div>}
        <div style={{ ...S.fila, marginTop: 6 }}>
          <button style={S.btn} disabled={ocupado} onClick={registrar}>Guardar reclamo</button>
          <button style={S.btn2} disabled={ocupado} onClick={() => setAbierto(false)}>Cancelar</button>
        </div>
      </div>}
    </div>
  )
}
