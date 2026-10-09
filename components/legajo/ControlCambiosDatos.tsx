'use client'

/**
 * components/legajo/ControlCambiosDatos.tsx
 *
 * Bandeja de Administración: cambios de datos personales que propuso el
 * personal (pendientes de validación) y datos de la planilla histórica que
 * esperan la confirmación de la persona. Se aprueba o rechaza acá mismo.
 * La base vuelve a controlar el permiso (legajo_cambios_pendientes /
 * legajo_resolver_cambio sólo para Administración y Gerencia).
 */

import { useCallback, useEffect, useState } from 'react'
import { ETIQUETA_ORIGEN, cargarCambiosPendientes, resolverCambio } from '@/lib/datos-personales'
import type { CambioPendiente } from '@/lib/datos-personales'
import PlanillaHistorica from '@/components/legajo/PlanillaHistorica'

// Fechas AAAA-MM-DD → DD/MM/AAAA (el resto tal cual)
const fmt = (v: string | null) => !v ? '—' : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('/') : v

const card: React.CSSProperties = { background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 14, marginBottom: 10, minWidth: 0, boxSizing: 'border-box' }

function Fila({ f, onCambio }: { f: CambioPendiente; onCambio: () => void }) {
  const [rechazando, setRechazando] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hacer = async (d: 'aprobar' | 'rechazar') => { setOcupado(true); setError(null); const e = await resolverCambio(f.id, d, motivo); setOcupado(false); if (e) setError(e); else onCambio() }
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <a href={`/guardias/${f.empleado_id}?seccion=datos`} style={{ color: '#e2e8f0', fontWeight: 700, overflowWrap: 'anywhere' }}>{f.apellido}, {f.nombre}</a>
        <span style={{ fontSize: 12.5, color: '#94a3b8' }}>{new Date(f.creado_at).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</span>
      </div>
      <div style={{ fontSize: 14, color: '#cbd5e1', marginTop: 6 }}>
        <b>{f.etiqueta}</b>: {fmt(f.valor_anterior)} → <b style={{ color: '#fbbf24' }}>{fmt(f.valor_nuevo)}</b>
      </div>
      <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>
        Origen: {ETIQUETA_ORIGEN[f.origen]}{f.motivo ? ` · “${f.motivo}”` : ''}
        {f.estado === 'pendiente_confirmacion' && ' · espera que la persona lo confirme desde su legajo'}
      </div>
      {f.estado === 'pendiente' && !rechazando && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button type="button" disabled={ocupado} onClick={() => void hacer('aprobar')} style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 800, cursor: 'pointer' }}>Aprobar</button>
          <button type="button" onClick={() => setRechazando(true)} style={{ background: 'transparent', color: '#fca5a5', border: '1px solid rgba(239,68,68,.5)', borderRadius: 8, padding: '8px 14px', cursor: 'pointer' }}>Rechazar</button>
        </div>
      )}
      {rechazando && (
        <div style={{ marginTop: 8 }}>
          <input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Motivo (la persona lo va a ver)" style={{ width: '100%', boxSizing: 'border-box', background: '#0b1220', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '9px 10px' }} />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" disabled={ocupado || motivo.trim().length < 3} onClick={() => void hacer('rechazar')} style={{ background: '#f59e0b', color: '#1a1205', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 800, cursor: 'pointer' }}>Rechazar</button>
            <button type="button" onClick={() => setRechazando(false)} style={{ background: 'transparent', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 8, padding: '8px 14px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>{error}</div>}
    </div>
  )
}

export default function ControlCambiosDatos() {
  const [filas, setFilas] = useState<CambioPendiente[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cargar = useCallback(async () => { const r = await cargarCambiosPendientes(); setFilas(r.filas); setError(r.error) }, [])
  useEffect(() => { void cargar() }, [cargar])
  if (error) return <div style={{ ...card, color: '#fca5a5' }}>{error}</div>
  if (!filas) return <div style={{ color: '#64748b', padding: 24 }}>Cargando…</div>
  // Lo que espera la confirmación de la persona (planilla histórica) se ve
  // agrupado por persona en PlanillaHistorica, no como una tarjeta por dato.
  const pend = filas.filter(f => f.estado === 'pendiente')
  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#e2e8f0' }}>Cambios de datos del personal</div>
      <div style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 14px' }}>Lo que propuso cada persona desde su legajo. Los datos sensibles cambian recién cuando se aprueban.</div>
      {pend.length === 0 && <div style={{ ...card, color: '#94a3b8' }}>No hay cambios para validar.</div>}
      {pend.map(f => <Fila key={f.id} f={f} onCambio={() => void cargar()} />)}
      <PlanillaHistorica />
    </div>
  )
}
