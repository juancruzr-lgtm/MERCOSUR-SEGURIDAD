'use client'

/**
 * components/protocolos/ControlProtocolos.tsx
 *
 * Control general de protocolos para Administración y Gerencia: por objetivo,
 * si rige un protocolo, si sólo hay borrador, y cuántos vigiladores
 * confirmaron la lectura. Cada fila abre el mismo panel de la ficha del
 * objetivo (texto, edición, historial, lecturas).
 *
 * La lista la arma protocolo_resumen_general: sólo objetivos activos, no de
 * prueba, dentro del alcance de quien mira.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import ProtocoloObjetivoPanel from '@/components/protocolos/ProtocoloObjetivoPanel'
import type { ResumenObjetivo } from '@/lib/protocolos'
import { cargarResumenGeneral } from '@/lib/protocolos-datos'

type Filtro = 'todos' | 'sin_vigente'

const card: React.CSSProperties = {
  background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 16, marginBottom: 14,
}
const chip = (activo: boolean): React.CSSProperties => ({
  border: `1px solid ${activo ? '#f59e0b' : '#334155'}`, background: activo ? 'rgba(245,158,11,.12)' : 'transparent',
  color: activo ? '#fbbf24' : '#94a3b8', borderRadius: 99, padding: '5px 12px', fontSize: 12.5, cursor: 'pointer',
})

export default function ControlProtocolos() {
  const [filas, setFilas] = useState<ResumenObjetivo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [abierto, setAbierto] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const r = await cargarResumenGeneral()
    setCargando(false)
    if (r.error) { setError(r.error); return }
    setError(null)
    setFilas(r.data ?? [])
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  const totales = useMemo(() => ({
    conVigente: filas.filter(f => f.vigentes > 0).length,
    soloBorrador: filas.filter(f => f.vigentes === 0 && f.borradores + f.pendientes_aprobacion > 0).length,
    sinNada: filas.filter(f => f.vigentes + f.borradores + f.pendientes_aprobacion === 0).length,
  }), [filas])

  const visibles = filas.filter(f => filtro === 'todos' || f.vigentes === 0)

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={card}>
        <div style={{ fontSize: 18, fontWeight: 800, color: '#e2e8f0' }}>📋 Protocolos por objetivo</div>
        <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4, lineHeight: 1.5 }}>
          Lo que cada vigilador lee desde la tarjeta de su turno. La última versión guardada en la ficha del objetivo es la que rige.
          La confirmación de lectura no acredita cumplimiento ni cuenta para Mi Desempeño.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: 10, marginTop: 14 }}>
          {[
            ['Con protocolo que rige', `${totales.conVigente} de ${filas.length}`],
            ['Sólo borrador', String(totales.soloBorrador)],
            ['Sin protocolo', String(totales.sinNada)],
          ].map(([e, v]) => (
            <div key={e} style={{ border: '1px solid #1e2d42', borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 10.5, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }}>{e}</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums' }}>{v}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 14 }}>
          {([['todos', 'Todos'], ['sin_vigente', 'Sin protocolo que rija']] as [Filtro, string][]).map(([k, t]) => (
            <button key={k} type="button" style={chip(filtro === k)} onClick={() => setFiltro(k)}>{t}</button>
          ))}
          <button type="button" style={{ ...chip(false), marginLeft: 'auto' }} onClick={() => void cargar()}>Actualizar</button>
        </div>
      </div>

      {error && <div style={{ ...card, color: '#f87171', fontSize: 13 }}>No se pudo cargar: {error}</div>}
      {cargando && filas.length === 0 && <div style={{ ...card, color: '#64748b', fontSize: 13 }}>Cargando…</div>}

      <div style={{ display: 'grid', gap: 8 }}>
        {visibles.map(f => (
          <div key={f.objetivo_id}>
            <button
              type="button"
              onClick={() => setAbierto(a => a === f.objetivo_id ? null : f.objetivo_id)}
              aria-expanded={abierto === f.objetivo_id}
              style={{
                width: '100%', textAlign: 'left', cursor: 'pointer', background: '#0f172a', color: '#e2e8f0',
                border: `1px solid ${abierto === f.objetivo_id ? '#f59e0b' : '#1e2d42'}`, borderRadius: 8, padding: '10px 12px',
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: '4px 12px', alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{f.objetivo_nombre}</span>
              <span style={{ fontSize: 12.5, color: f.vigentes ? '#4ade80' : '#94a3b8' }}>
                {f.vigentes ? 'Rige' : f.borradores + f.pendientes_aprobacion ? 'Sólo borrador' : 'Sin protocolo'}
              </span>
              <span style={{ fontSize: 12.5, color: '#cbd5e1', fontVariantNumeric: 'tabular-nums' }}>
                {f.vigentes ? `Confirmaron ${f.vigiladores_confirmaron} de ${f.vigiladores_esperados}` : '—'}
              </span>
            </button>
            {abierto === f.objetivo_id && (
              <div style={{ marginTop: 8 }}>
                <ProtocoloObjetivoPanel objetivoId={f.objetivo_id} />
              </div>
            )}
          </div>
        ))}
        {!cargando && !error && visibles.length === 0 && <div style={{ ...card, color: '#64748b', fontSize: 13 }}>Nada para mostrar con este filtro.</div>}
      </div>
    </div>
  )
}
