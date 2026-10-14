'use client'

/**
 * components/legajo/DiferenciasEmpleado.tsx
 *
 * Legajo de una persona → Datos personales: sus diferencias con ARCA pendientes
 * (contrato con fecha de fin, no figura en ARCA, CUIL faltante, identidad…) y las
 * correcciones de identidad registradas. Sólo Administración/Gerencia: si la base
 * dice que no, no se muestra nada. La lista completa está en Legajo Digital →
 * Diferencias con ARCA.
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cargarDiferencias, fechaCorta } from '@/lib/legajo-diferencias'
import type { Diferencia } from '@/lib/legajo-diferencias'
import { DiferenciaItem, card } from '@/components/legajo/DiferenciasArca'

interface Correccion { campo: string; valor_anterior: string | null; valor_nuevo: string | null; fuente: string; realizado_at: string; realizado_por: string | null }

export default function DiferenciasEmpleado({ empleadoId }: { empleadoId: string }) {
  const [filas, setFilas] = useState<Diferencia[] | null>(null)
  const [historial, setHistorial] = useState<Correccion[]>([])
  const [verRevisadas, setVerRevisadas] = useState(false)
  const cargar = useCallback(async () => {
    const r = await cargarDiferencias(empleadoId)
    if (r.denegado || r.error) { setFilas(null); return }
    setFilas(r.filas)
    const h = await supabase.rpc('legajo_identidad_historial', { p_empleado: empleadoId })
    setHistorial((h.data ?? []) as Correccion[])
  }, [empleadoId])
  useEffect(() => { void cargar() }, [cargar])
  if (!filas) return null
  // La fecha de ingreso faltante ya se ve en el formulario de datos.
  const visibles = filas.filter(d => d.tipo !== 'sin_fecha_ingreso')
  const pend = visibles.filter(d => !d.revisada)
  const rev = visibles.filter(d => d.revisada)
  if (!visibles.length && !historial.length) return null
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ fontSize: 13, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>Diferencias con ARCA</div>
        <span style={{ fontSize: 13, fontWeight: 800, color: pend.length ? '#fbbf24' : '#86efac' }}>{pend.length ? `${pend.length} pendiente${pend.length === 1 ? '' : 's'}` : 'Sin pendientes'}</span>
      </div>
      <div style={{ marginTop: 8 }}>
        {pend.map(d => <DiferenciaItem key={d.clave} d={d} conPersona={false} onCambio={() => void cargar()} />)}
        {verRevisadas && rev.map(d => <DiferenciaItem key={d.clave} d={d} conPersona={false} onCambio={() => void cargar()} />)}
      </div>
      {rev.length > 0 && (
        <button type="button" onClick={() => setVerRevisadas(!verRevisadas)} style={{ background: 'none', border: 'none', color: '#93c5fd', fontSize: 13.5, cursor: 'pointer', padding: 0 }}>
          {verRevisadas ? 'Ocultar revisadas' : `Ver revisadas (${rev.length})`}
        </button>
      )}
      {historial.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 13, color: '#94a3b8' }}>
          <div style={{ fontWeight: 700, color: '#cbd5e1', marginBottom: 2 }}>Correcciones de identidad</div>
          {historial.map((c, i) => (
            <div key={i}>{fechaCorta(c.realizado_at)} · {c.campo.toUpperCase()}: {c.valor_anterior ?? '—'} → <b style={{ color: '#e2e8f0' }}>{c.valor_nuevo}</b> · {c.fuente}{c.realizado_por ? ` · ${c.realizado_por}` : ''}</div>
          ))}
        </div>
      )}
    </div>
  )
}
