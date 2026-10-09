'use client'

/**
 * components/legajo/HabilitacionLegajo.tsx
 *
 * Control de Gerencia para abrir o cerrar cada módulo del Legajo Digital al
 * personal. Pide confirmación expresa antes de abrir. No abre nada por sí solo.
 */

import { useCallback, useEffect, useState } from 'react'
import { MODULOS_LEGAJO, cambiarHabilitacion, cargarHabilitacion } from '@/lib/legajo-habilitacion'
import type { ModuloLegajo } from '@/lib/legajo-habilitacion'

const card: React.CSSProperties = { background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 14, marginBottom: 10, minWidth: 0, boxSizing: 'border-box' }

function Modulo({ m, onCambio }: { m: ModuloLegajo; onCambio: () => void }) {
  const [confirmando, setConfirmando] = useState(false)
  const [entiendo, setEntiendo] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const info = MODULOS_LEGAJO[m.modulo] ?? { nombre: m.modulo, que_ve: '' }
  const cambiar = async (abrir: boolean) => {
    setOcupado(true); setError(null)
    const e = await cambiarHabilitacion(m.modulo, abrir)
    setOcupado(false)
    if (e) setError(e); else { setConfirmando(false); setEntiendo(false); onCambio() }
  }
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <b style={{ color: '#e2e8f0', fontSize: 15 }}>{info.nombre}</b>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: m.empleados ? '#86efac' : '#fbbf24' }}>
          {m.empleados ? 'Abierto a todo el personal' : 'Cerrado: sólo Administración, Gerencia y cuentas de prueba'}
        </span>
      </div>
      <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>{info.que_ve}</div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Último cambio: {new Date(m.actualizado_at).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })}</div>
      {!confirmando && (
        <button type="button" disabled={ocupado} onClick={() => m.empleados ? void cambiar(false) : setConfirmando(true)}
          style={{ marginTop: 10, background: 'transparent', color: m.empleados ? '#fca5a5' : '#86efac', border: '1px solid #334155', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', fontWeight: 700 }}>
          {m.empleados ? 'Cerrar al personal' : 'Abrir al personal…'}
        </button>
      )}
      {confirmando && (
        <div style={{ marginTop: 10 }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: '#cbd5e1' }}>
            <input type="checkbox" checked={entiendo} onChange={e => setEntiendo(e.target.checked)} style={{ marginTop: 3 }} />
            Entiendo que todos los vigiladores van a ver esta sección en su app desde ahora.
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" disabled={!entiendo || ocupado} onClick={() => void cambiar(true)}
              style={{ background: entiendo ? '#16a34a' : '#334155', color: entiendo ? '#fff' : '#64748b', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 800, cursor: entiendo ? 'pointer' : 'not-allowed' }}>Abrir</button>
            <button type="button" onClick={() => { setConfirmando(false); setEntiendo(false) }}
              style={{ background: 'transparent', color: '#cbd5e1', border: '1px solid #334155', borderRadius: 8, padding: '8px 14px', cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>{error}</div>}
    </div>
  )
}

export default function HabilitacionLegajo() {
  const [r, setR] = useState<{ modulos: ModuloLegajo[]; error: string | null } | null>(null)
  const cargar = useCallback(async () => setR(await cargarHabilitacion()), [])
  useEffect(() => { void cargar() }, [cargar])
  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#e2e8f0' }}>Habilitación al personal</div>
      <div style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 14px', lineHeight: 1.5 }}>
        Mientras un módulo está cerrado, los vigiladores no lo ven. Se puede abrir de a uno y volver a cerrar. Sólo Gerencia lo cambia y queda registrado.
      </div>
      {!r && <div style={{ color: '#64748b', padding: 24 }}>Cargando…</div>}
      {r?.error && <div role="alert" style={{ ...card, color: '#fca5a5' }}>{r.error}</div>}
      {r?.modulos.map(m => <Modulo key={m.modulo} m={m} onCambio={() => void cargar()} />)}
    </div>
  )
}
