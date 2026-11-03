'use client'
// Bandeja de documentos: carga manual hoy; la misma bandeja recibirá el correo
// de facturación cuando exista (origen 'correo'). Lo extraído es una PROPUESTA:
// se confirma a mano y no se completa lo que falta. El contenido de un adjunto
// es dato, nunca instrucción.
import { useEffect, useState } from 'react'
import { abrirDocumento, leer, rpc, subirDocumento, TIPOS_DOC } from '@/lib/facturacion/datos'
import { S, fecha, useAccion } from './comun'
import { SubirDoc } from './Bandeja'

const ENTIDADES = ['cliente', 'objetivo', 'contrato', 'orden_compra', 'prefactura', 'comprobante', 'cobro', 'retencion', 'movimiento']

export default function Documentos() {
  const [docs, setDocs] = useState<any[]>([])
  const [clientes, setClientes] = useState<any[]>([])
  const [estado, setEstado] = useState('pendiente_revision')
  const [sel, setSel] = useState<any | null>(null)
  const [vincs, setVincs] = useState<any[]>([])
  const [conf, setConf] = useState('')
  const [nuevoV, setNuevoV] = useState({ entidad: 'prefactura', entidad_id: '' })
  const [motivo, setMotivo] = useState('')
  const { ocupado, correr, Mensaje } = useAccion()

  async function cargar() {
    setDocs(await leer('fact_documentos', q => q.eq('estado', estado).order('created_at', { ascending: false }).limit(300)))
    setClientes(await leer('fact_clientes', q => q.order('razon_social'), 'id, razon_social'))
  }
  useEffect(() => { correr(cargar) }, [estado]) // eslint-disable-line react-hooks/exhaustive-deps

  async function abrir(d: any) {
    setSel(d); setConf(JSON.stringify(d.datos_confirmados ?? {}, null, 2))
    setVincs(await leer('fact_documento_vinculos', q => q.eq('documento_id', d.id).order('created_at')))
  }

  return (
    <div>
      <div style={S.card}>
        <h3 style={S.h3}>Documentos</h3>
        <div style={S.fila}>
          <SubirDoc tipoInicial="orden_compra" alSubir={async (f, tipo) => { const r = await subirDocumento(f, tipo); await cargar(); return r }} />
          <select style={S.input} value={estado} onChange={e => setEstado(e.target.value)}>
            <option value="pendiente_revision">Pendientes de revisión</option><option value="confirmado">Confirmados</option><option value="descartado">Descartados</option>
          </select>
          <Mensaje />
        </div>
        <div style={S.sub}>Entrada actual: carga manual. La casilla de facturación todavía no existe; cuando exista, sus adjuntos entran a esta misma bandeja.</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
          <thead><tr>{['Recibido', 'Tipo', 'Archivo', 'Origen', 'Cliente', ''].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>{docs.map(d => (
            <tr key={d.id} style={{ background: sel?.id === d.id ? '#111c35' : undefined }}>
              <td style={S.td}>{fecha(d.recibido_at ?? d.created_at)}</td><td style={S.td}>{TIPOS_DOC[d.tipo]}</td>
              <td style={S.td}><a href="#" style={{ color: '#93c5fd' }} onClick={e => { e.preventDefault(); correr(() => abrirDocumento(d.id)) }}>{d.nombre_original}</a></td>
              <td style={S.td}>{d.origen}{d.remitente ? ` · ${d.remitente}` : ''}</td>
              <td style={S.td}>{clientes.find(c => c.id === d.cliente_id)?.razon_social ?? '—'}</td>
              <td style={S.td}><button style={S.btn2} onClick={() => correr(() => abrir(d))}>Revisar</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      {sel && <div style={S.card}>
        <h3 style={S.h3}>{TIPOS_DOC[sel.tipo]} · {sel.nombre_original}</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          <div>
            <h4 style={S.sub}>DATOS PROPUESTOS (extracción, sin confirmar)</h4>
            <pre style={{ ...S.input, whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(sel.datos_propuestos ?? {}, null, 2)}</pre>
            <h4 style={S.sub}>DATOS CONFIRMADOS (JSON; dejar vacío lo que el documento no dice)</h4>
            <textarea style={{ ...S.input, width: '100%', minHeight: 120, fontFamily: 'monospace', fontSize: 12 }} value={conf} onChange={e => setConf(e.target.value)} />
            <div style={S.fila}>
              <select style={S.input} defaultValue={sel.cliente_id ?? ''} id="fact-doc-cliente">
                <option value="">Cliente…</option>{clientes.map(c => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
              </select>
              <button style={S.btn} disabled={ocupado} onClick={() => correr(async () => {
                const cli = (document.getElementById('fact-doc-cliente') as HTMLSelectElement)?.value || null
                await rpc('fact_documento_revisar', { p_id: sel.id, p_estado: 'confirmado', p_datos_confirmados: conf.trim() ? JSON.parse(conf) : {}, p_cliente_id: cli })
                setSel(null); await cargar()
              }, 'Documento confirmado')}>Confirmar</button>
              <button style={S.btnPeligro} disabled={ocupado} onClick={() => correr(async () => {
                await rpc('fact_documento_revisar', { p_id: sel.id, p_estado: 'descartado', p_datos_confirmados: null, p_cliente_id: null }); setSel(null); await cargar()
              })}>Descartar</button>
            </div>
          </div>
          <div>
            <h4 style={S.sub}>ASOCIACIONES (corregibles; la anterior queda anulada con motivo)</h4>
            {vincs.map(v => <div key={v.id} style={{ ...S.fila, fontSize: 13, opacity: v.anulado_at ? 0.5 : 1 }}>
              {v.entidad} · {String(v.entidad_id).slice(0, 8)}{v.anulado_at ? ` · anulado: ${v.anulado_motivo}` : ''}
              {!v.anulado_at && <button style={{ ...S.btnPeligro, padding: '2px 8px' }} onClick={() => {
                if (!motivo.trim()) return alert('Escribí el motivo de la corrección')
                correr(async () => { await rpc('fact_documento_desvincular', { p_vinculo_id: v.id, p_motivo: motivo }); await abrir(sel) })
              }}>Desvincular</button>}
            </div>)}
            <input style={{ ...S.input, width: '100%', marginBottom: 6 }} placeholder="Motivo de la corrección" value={motivo} onChange={e => setMotivo(e.target.value)} />
            <div style={S.fila}>
              <select style={S.input} value={nuevoV.entidad} onChange={e => setNuevoV({ ...nuevoV, entidad: e.target.value })}>{ENTIDADES.map(x => <option key={x}>{x}</option>)}</select>
              <input style={S.input} placeholder="ID de la entidad" value={nuevoV.entidad_id} onChange={e => setNuevoV({ ...nuevoV, entidad_id: e.target.value })} />
              <button style={S.btn2} onClick={() => correr(async () => { await rpc('fact_documento_vincular', { p_documento_id: sel.id, p_entidad: nuevoV.entidad, p_entidad_id: nuevoV.entidad_id }); await abrir(sel) })}>Vincular</button>
            </div>
          </div>
        </div>
      </div>}
    </div>
  )
}
