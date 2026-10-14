'use client'

/**
 * components/habilitacion/FotoCredencial.tsx
 *
 * Arriba del legajo de cada vigilador (dentro de «Credencial y Habilitación»):
 * la foto de su credencial, frente y dorso, apenas se entra. Si la subió y
 * falta revisarla, se aprueba o rechaza acá mismo: aprobada cuenta como
 * «tiene credencial» (lo registra la base) y se copia al servidor. Si no hay
 * foto, muestra lo que respondió el vigilador (en trámite / no tiene y por qué).
 * Cada apertura de una foto queda registrada (documentacion_abrir).
 */

import { useCallback, useEffect, useState } from 'react'
import { abrirArchivo, revisarDocumento } from '@/lib/documentacion-datos'
import { cargarCredencialDeEmpleado, declaracionTexto } from '@/lib/credencial-pedido'
import type { CredencialDeEmpleado } from '@/lib/credencial-pedido'
import { fechaCorta } from '@/lib/habilitacion'

const boton = (ok: boolean): React.CSSProperties => ({
  background: ok ? '#16a34a' : 'transparent', color: ok ? '#fff' : '#fca5a5', border: ok ? 'none' : '1px solid rgba(239,68,68,.5)',
  borderRadius: 8, padding: '8px 13px', fontWeight: 800, fontSize: 13.5, cursor: 'pointer',
})

function Imagen({ id, cara }: { id: string; cara: string | null }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [grande, setGrande] = useState(false)
  useEffect(() => {
    let vivo = true
    void abrirArchivo(id, 'ver').then(r => { if (vivo) { setUrl(r.url); setError(r.error) } })
    return () => { vivo = false }
  }, [id])
  return (
    <figure style={{ margin: 0, flex: '1 1 160px', minWidth: 0, maxWidth: 320 }}>
      {url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={url} alt={`Credencial: ${cara ?? 'foto'}`} onClick={() => setGrande(g => !g)}
            style={{ width: '100%', maxHeight: grande ? 'none' : 180, objectFit: grande ? 'contain' : 'cover', borderRadius: 8, border: '1px solid #334155', cursor: 'zoom-in', background: '#0b1220' }} />
        : <div style={{ height: 120, borderRadius: 8, border: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'center', color: error ? '#fca5a5' : '#64748b', fontSize: 12.5, padding: 8, textAlign: 'center' }}>{error ?? 'Cargando…'}</div>}
      <figcaption style={{ fontSize: 12, color: '#94a3b8', marginTop: 3 }}>{cara ?? 'Foto'}</figcaption>
    </figure>
  )
}

export default function FotoCredencial({ empleadoId, onCambio }: { empleadoId: string; onCambio?: () => void }) {
  const [datos, setDatos] = useState<CredencialDeEmpleado | null>(null)
  const [rechazando, setRechazando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cargar = useCallback(async () => { const r = await cargarCredencialDeEmpleado(empleadoId); setDatos(r.datos); setError(r.error) }, [empleadoId])
  useEffect(() => { void cargar() }, [cargar])

  if (!datos) return error ? <div style={{ color: '#fca5a5', fontSize: 13, marginTop: 8 }}>Foto de la credencial: {error}</div> : null
  const f = datos.foto
  const pendiente = f?.estado === 'pendiente_revision'
  const decl = declaracionTexto(datos.declaracion)

  const revisar = async (d: 'aprobar' | 'rechazar') => {
    setOcupado(true); setError(null)
    const e = await revisarDocumento(f!.documento_id, d, d === 'rechazar' ? motivo : undefined)
    setOcupado(false)
    if (e) { setError(e); return }
    setRechazando(false); setMotivo(''); void cargar(); onCambio?.()
  }

  if (!f) {
    return (
      <div style={{ marginTop: 10, padding: '9px 12px', borderRadius: 10, border: '1px dashed #334155', fontSize: 13.5, color: '#cbd5e1' }}>
        <b>Foto de la credencial:</b> no hay.{' '}
        {decl ? <span style={{ color: '#fbbf24' }}>{decl}</span> : <span style={{ color: '#94a3b8' }}>El vigilador todavía no respondió el pedido de credencial.</span>}
      </div>
    )
  }

  const servidor = f.servidor.length && f.servidor.every(s => s.estado === 'hecha') ? 'Copiada al servidor (ADMINISTRACION/POLICIA/CREDENCIALES)'
    : f.servidor.some(s => s.estado === 'error') ? 'No se pudo copiar al servidor (se reintenta)'
    : f.servidor.length ? 'Se está copiando al servidor' : null
  return (
    <div style={{ marginTop: 10, padding: 10, borderRadius: 10, border: `1px solid ${pendiente ? '#f59e0b88' : '#16a34a66'}`, background: pendiente ? 'rgba(245,158,11,.06)' : 'rgba(22,163,74,.05)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: pendiente ? '#fbbf24' : '#86efac' }}>
          {pendiente ? 'Foto de la credencial para revisar' : 'Foto de la credencial aceptada'}
        </div>
        <div style={{ fontSize: 12.5, color: '#94a3b8' }}>
          {f.vence_el ? `vence ${fechaCorta(f.vence_el)}` : 'sin vencimiento'} · subida el {fechaCorta(f.subido_at)}{f.origen === 'vigilador' ? ' por el vigilador' : ''}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 8 }}>
        {f.archivos.map(a => <Imagen key={a.id} id={a.id} cara={a.cara} />)}
      </div>
      {servidor && <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{servidor}</div>}
      {pendiente && !rechazando && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 12.5, color: '#cbd5e1', marginBottom: 6 }}>Mirá que sea legible, que sea de esta persona y que el vencimiento coincida con el de la foto ({f.vence_el ? fechaCorta(f.vence_el) : '—'}).</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" disabled={ocupado} style={boton(true)} onClick={() => void revisar('aprobar')}>Aprobar: tiene credencial</button>
            <button type="button" disabled={ocupado} style={boton(false)} onClick={() => setRechazando(true)}>Rechazar</button>
          </div>
        </div>
      )}
      {rechazando && (
        <div style={{ marginTop: 8 }}>
          <input value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={200} placeholder="Motivo (lo ve el vigilador y se le vuelve a pedir)"
            style={{ width: '100%', boxSizing: 'border-box', background: '#0b1220', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '8px 10px', fontSize: 14 }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="button" disabled={ocupado || motivo.trim().length < 3} style={boton(false)} onClick={() => void revisar('rechazar')}>Rechazar</button>
            <button type="button" style={{ ...boton(false), color: '#cbd5e1', border: '1px solid #334155' }} onClick={() => setRechazando(false)}>Cancelar</button>
          </div>
        </div>
      )}
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>{error}</div>}
    </div>
  )
}
