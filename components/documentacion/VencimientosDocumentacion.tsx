'use client'

/**
 * components/documentacion/VencimientosDocumentacion.tsx
 *
 * Pestaña "Vencimientos" del control de documentación: qué venció o vence
 * en los próximos días (reporte, no avisa a nadie) y, sólo para Gerencia, el
 * interruptor de alertas, apagado por defecto.
 */

import { useCallback, useEffect, useState } from 'react'
import { fechaCorta, fechaHora } from '@/lib/documentacion'
import { cargarVencimientos, configurarAlertas, textoDias } from '@/lib/documentacion-alertas'
import type { ConfigAlertas, ReporteVencimientos } from '@/lib/documentacion-alertas'

const card: React.CSSProperties = { background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 14, marginBottom: 10, minWidth: 0, boxSizing: 'border-box' }
const chip = (a: boolean): React.CSSProperties => ({
  background: a ? 'rgba(245,158,11,.15)' : 'transparent', color: a ? '#fbbf24' : '#94a3b8',
  border: `1px solid ${a ? 'rgba(245,158,11,.5)' : '#334155'}`, borderRadius: 999, padding: '6px 12px', fontSize: 13, cursor: 'pointer',
})

function Interruptor({ cfg, onGuardado }: { cfg: ConfigAlertas; onGuardado: () => void }) {
  const [c, setC] = useState(cfg)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const cambio = JSON.stringify(c) !== JSON.stringify(cfg)
  const fila = (k: 'avisar_persona' | 'incluir_faltantes', t: string, ayuda: string) => (
    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5, color: c.activo ? '#cbd5e1' : '#64748b', marginTop: 8 }}>
      <input type="checkbox" disabled={!c.activo} checked={c[k]} onChange={e => setC({ ...c, [k]: e.target.checked })} />
      <span>{t}<br /><span style={{ fontSize: 12, color: '#64748b' }}>{ayuda}</span></span>
    </label>
  )
  return (
    <div style={{ ...card, borderColor: c.activo ? 'rgba(34,197,94,.4)' : '#1e2d42' }}>
      <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: 14.5 }}>Alertas automáticas (Gerencia)</div>
      <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 4 }}>Apagadas por defecto. Prendidas, un proceso diario registra los vencimientos y lo solicitado. No manda push, WhatsApp ni mails.</div>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 14, color: '#e2e8f0', marginTop: 10, fontWeight: 700 }}>
        <input type="checkbox" checked={c.activo} onChange={e => setC({ ...c, activo: e.target.checked })} /> Alertas prendidas
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13.5, color: c.activo ? '#cbd5e1' : '#64748b', marginTop: 8 }}>
        Avisar con
        <input type="number" min={1} max={180} disabled={!c.activo} value={c.dias_aviso}
          onChange={e => setC({ ...c, dias_aviso: Math.max(1, Math.min(180, Number(e.target.value) || 30)) })}
          style={{ width: 64, background: '#0b1220', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', padding: '4px 6px' }} />
        días de anticipación
      </label>
      {fila('avisar_persona', 'Mostrar el aviso a la persona en su app', 'Un cartel con lo que le vence o le pidieron. No le impide fichar.')}
      {fila('incluir_faltantes', 'Incluir documentos obligatorios que faltan', 'Una vez por mes, sólo vigiladores, sin contar los "no corresponde".')}
      {cfg.actualizado_at && <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>Último cambio: {fechaHora(cfg.actualizado_at)}</div>}
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>{error}</div>}
      {cambio && (
        <button type="button" disabled={ocupado} onClick={async () => { setOcupado(true); const e = await configurarAlertas(c); setOcupado(false); if (e) setError(e); else onGuardado() }}
          style={{ marginTop: 10, background: '#f59e0b', color: '#1a1205', border: 'none', borderRadius: 8, padding: '9px 14px', fontWeight: 800, cursor: 'pointer' }}>
          {ocupado ? 'Guardando…' : 'Guardar'}
        </button>
      )}
    </div>
  )
}

export default function VencimientosDocumentacion() {
  const [dias, setDias] = useState(30)
  const [datos, setDatos] = useState<ReporteVencimientos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cargar = useCallback(async () => { const r = await cargarVencimientos(dias); setDatos(r.datos); setError(r.error) }, [dias])
  useEffect(() => { void cargar() }, [cargar])

  if (error) return <div style={{ ...card, color: '#fca5a5' }}>{error}</div>
  if (!datos) return <div style={{ color: '#64748b', padding: 24 }}>Cargando…</div>
  const vencidos = datos.documentos.filter(d => d.dias < 0).length

  return (
    <>
      {datos.puede_configurar
        ? <Interruptor key={JSON.stringify(datos.config)} cfg={datos.config} onGuardado={() => void cargar()} />
        : <div style={{ fontSize: 12.5, color: '#94a3b8', margin: '0 2px 10px' }}>
            Alertas automáticas: <b style={{ color: datos.config.activo ? '#86efac' : '#94a3b8' }}>{datos.config.activo ? 'prendidas' : 'apagadas'}</b> (las maneja Gerencia).
          </div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
        <span style={{ fontSize: 13, color: '#94a3b8' }}>Vencidos y por vencer en:</span>
        {[15, 30, 60, 90].map(n => <button key={n} type="button" style={chip(dias === n)} onClick={() => setDias(n)}>{n} días</button>)}
      </div>
      {datos.documentos.length === 0 && <div style={{ ...card, color: '#94a3b8' }}>Nada vence en los próximos {datos.dias} días.</div>}
      {vencidos > 0 && <div style={{ fontSize: 13, color: '#fca5a5', margin: '0 2px 8px' }}>{vencidos} vencido{vencidos > 1 ? 's' : ''}.</div>}
      {datos.documentos.map(d => (
        <div key={d.documento_id} style={{ ...card, padding: '10px 12px', borderColor: d.dias < 0 ? 'rgba(239,68,68,.4)' : '#1e2d42' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <a href={`/guardias/${d.empleado_id}?seccion=documentacion`} style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14, overflowWrap: 'anywhere' }}>
              {d.apellido}, {d.nombre}
            </a>
            <span style={{ fontSize: 13, color: d.dias < 0 ? '#fca5a5' : '#fbbf24', fontWeight: 700 }}>{textoDias(d.dias)}</span>
          </div>
          <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 2 }}>
            {d.tipo_nombre}{d.detalle ? ` · ${d.detalle}` : ''} · {fechaCorta(d.vence_el)}
            {d.reemplazo_en_curso && <span style={{ color: '#93c5fd' }}> · ya hay uno nuevo en trámite</span>}
          </div>
        </div>
      ))}
    </>
  )
}
