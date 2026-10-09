'use client'

/**
 * components/legajo/PlanillaHistorica.tsx
 *
 * Datos recuperados de la planilla histórica de legajos (ago-2024), agrupados
 * por persona: qué se recuperó, en qué estado está cada dato (espera
 * confirmación, confirmado, validado, rechazado, descartado) y quién intervino.
 * Sólo consulta: la persona confirma desde su legajo y la validación se hace en
 * la bandeja de arriba. Así Administración no tiene que abrir el Excel.
 */

import { useEffect, useMemo, useState } from 'react'
import { ESTADO_PLANILLA, agruparPlanilla, cargarPlanillaHistorica, resumirPlanilla } from '@/lib/legajo-planilla'
import type { DatoPlanilla } from '@/lib/legajo-planilla'
import type { EstadoCambio } from '@/lib/datos-personales'

const fmt = (v: string | null) => !v ? '—' : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v.split('-').reverse().join('/') : v
const fecha = (v: string | null) => v ? new Date(v).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : ''
const card: React.CSSProperties = { background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 12, marginBottom: 8, minWidth: 0, boxSizing: 'border-box' }
const control: React.CSSProperties = { background: '#0f172a', color: '#e2e8f0', border: '1px solid #1e2d42', borderRadius: 8, padding: '6px 8px', fontSize: 13, minWidth: 0 }

type Carga = Awaited<ReturnType<typeof cargarPlanillaHistorica>>

export default function PlanillaHistorica() {
  const [c, setC] = useState<Carga | null>(null)
  const [texto, setTexto] = useState('')
  const [estado, setEstado] = useState<EstadoCambio | ''>('')
  useEffect(() => { void cargarPlanillaHistorica().then(setC) }, [])

  const resumen = useMemo(() => resumirPlanilla(c?.datos ?? []), [c])
  const grupos = useMemo(() => c ? agruparPlanilla(c.datos, c.personas, { texto, estado }) : [], [c, texto, estado])

  if (!c) return <div style={{ color: '#64748b', padding: 12 }}>Cargando datos recuperados…</div>
  if (c.error) return <div role="alert" style={{ ...card, color: '#fca5a5' }}>{c.error}</div>
  if (c.datos.length === 0) return null

  const linea = (d: DatoPlanilla) => {
    const e = ESTADO_PLANILLA[d.estado]
    const quien = d.revisado_por ? c.revisores.get(d.revisado_por) : null
    const nota = d.estado === 'rechazado' ? d.motivo_rechazo : d.estado === 'descartado' ? (d.motivo ?? '').split(' · ').slice(1).join(' · ') || d.motivo : null
    return (
      <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', padding: '6px 0', borderTop: '1px solid #1e293b' }}>
        <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          <span style={{ color: '#94a3b8' }}>{c.etiquetas.get(d.campo) ?? d.campo}:</span>{' '}
          <b style={{ color: '#e2e8f0' }}>{fmt(d.valor_nuevo)}</b>
          {d.valor_anterior && <span style={{ color: '#64748b' }}> (en la app: {fmt(d.valor_anterior)})</span>}
          {nota && <div style={{ fontSize: 12, color: '#94a3b8' }}>{nota}</div>}
        </div>
        <div style={{ fontSize: 12, color: e.color, textAlign: 'right' }}>
          {e.texto}{quien ? ` · ${quien}` : ''}{d.revisado_at ? ` · ${fecha(d.revisado_at)}` : ''}
        </div>
      </div>
    )
  }

  return (
    <section aria-label="Datos recuperados de la planilla histórica" style={{ marginTop: 22 }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: '#e2e8f0' }}>Datos recuperados de la planilla histórica</div>
      <div style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 12px' }}>
        Planilla LEGAJOS EMPLEADOS (ago-2024). Ningún dato se aplica solo: la persona lo confirma o corrige desde su legajo y después se valida acá arriba.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 130px), 1fr))', gap: 8, marginBottom: 10 }}>
        {([
          ['Datos recuperados', resumen.total, '#e2e8f0'], ['Personas', resumen.personas, '#e2e8f0'],
          ['Esperan confirmación', resumen.pendiente_confirmacion, '#93c5fd'], ['Confirmados, a validar', resumen.pendiente, '#fbbf24'],
          ['Validados', resumen.aprobado + resumen.aplicado, '#86efac'], ['Rechazados', resumen.rechazado, '#fca5a5'],
          ['Descartados', resumen.descartado, '#94a3b8'],
        ] as [string, number, string][]).map(([t, n, col]) => (
          <div key={t} style={{ background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 10 }}>
            <div style={{ fontSize: 10.5, color: '#64748b', textTransform: 'uppercase' }}>{t}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: col }}>{n}</div>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <input value={texto} onChange={e => setTexto(e.target.value)} placeholder="Buscar persona o legajo" aria-label="Buscar persona o legajo" style={{ ...control, flex: '1 1 180px' }} />
        <select value={estado} onChange={e => setEstado(e.target.value as EstadoCambio | '')} aria-label="Estado" style={control}>
          <option value="">Todos los estados</option>
          {(Object.keys(ESTADO_PLANILLA) as EstadoCambio[]).filter(k => k !== 'aplicado').map(k => <option key={k} value={k}>{ESTADO_PLANILLA[k].texto}</option>)}
        </select>
      </div>
      {grupos.length === 0 && <div style={{ ...card, color: '#94a3b8' }}>No hay datos con ese filtro.</div>}
      {grupos.map(g => (
        <details key={g.empleado_id} style={card}>
          <summary style={{ cursor: 'pointer', color: '#e2e8f0', fontWeight: 700, overflowWrap: 'anywhere' }}>
            {g.apellido}, {g.nombre}{g.legajo ? ` · Leg. ${g.legajo}` : ''}
            <span style={{ color: '#94a3b8', fontWeight: 400 }}> — {g.datos.length} dato{g.datos.length === 1 ? '' : 's'}</span>
          </summary>
          <div style={{ marginTop: 6, fontSize: 13.5 }}>
            {g.datos.map(linea)}
            <a href={`/guardias/${g.empleado_id}?seccion=datos`} style={{ display: 'inline-block', marginTop: 6, fontSize: 12.5, color: '#93c5fd' }}>Abrir legajo</a>
          </div>
        </details>
      ))}
    </section>
  )
}
