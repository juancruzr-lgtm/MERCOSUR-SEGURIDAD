'use client'

/**
 * components/documentacion/AuditoriaDocumentacion.tsx
 *
 * Para Gerencia: quién abrió documentos de quién, qué intervenciones hubo
 * (revisiones, constancias, anulaciones) y los cambios de datos personales.
 * La base sólo responde a Gerencia (documentacion_auditoria).
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fechaHora } from '@/lib/documentacion'

type Fila = { at: string; quien: string | null; de: string | null; tipo?: string; modo?: string; evento?: string; campo?: string; origen?: string; estado?: string; propio?: boolean }
type Datos = { accesos: Fila[]; intervenciones: Fila[]; cambios_datos: Fila[] }

const EVENTO: Record<string, string> = {
  cargado: 'cargó', aprobado: 'validó', rechazado: 'rechazó', anulado: 'anuló', reemplazado: 'quedó reemplazado',
  conformidad: 'dio conformidad', recepcion: 'confirmó recepción', toma_conocimiento: 'tomó conocimiento',
  observacion: 'avisó un error', importado_historico: 'importó del archivo histórico', verificacion_fallida: 'falló la verificación',
}

export default function AuditoriaDocumentacion() {
  const [dias, setDias] = useState(30)
  const [vista, setVista] = useState<'accesos' | 'intervenciones' | 'cambios_datos'>('accesos')
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cargar = useCallback(async () => {
    const { data, error: e } = await supabase.rpc('documentacion_auditoria', { p_dias: dias })
    if (e) { setError(e.message); setDatos(null) } else { setDatos(data as Datos); setError(null) }
  }, [dias])
  useEffect(() => { void cargar() }, [cargar])

  if (error) return <div style={{ color: '#94a3b8', padding: 16 }}>{error}</div>
  if (!datos) return <div style={{ color: '#64748b', padding: 16 }}>Cargando…</div>
  const filas = datos[vista]
  const texto = (f: Fila) => vista === 'accesos'
    ? `${f.quien ?? '—'} ${f.modo === 'descargar' ? 'descargó' : 'vio'} ${f.tipo} ${f.propio ? '(propio)' : `de ${f.de ?? '—'}`}`
    : vista === 'intervenciones'
      ? `${f.quien ?? 'sistema'} — ${EVENTO[f.evento ?? ''] ?? f.evento} ${f.tipo} de ${f.de ?? '—'}`
      : `${f.quien ?? '—'} — ${f.campo} de ${f.de ?? '—'} (${f.origen}, ${f.estado})`
  const boton = (a: boolean): React.CSSProperties => ({ background: a ? 'rgba(245,158,11,.15)' : 'transparent', color: a ? '#fbbf24' : '#94a3b8', border: `1px solid ${a ? 'rgba(245,158,11,.5)' : '#334155'}`, borderRadius: 999, padding: '6px 12px', fontSize: 13, cursor: 'pointer' })

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        {([['accesos', `Accesos (${datos.accesos.length})`], ['intervenciones', `Intervenciones (${datos.intervenciones.length})`], ['cambios_datos', `Cambios de datos (${datos.cambios_datos.length})`]] as const)
          .map(([k, t]) => <button key={k} type="button" style={boton(vista === k)} onClick={() => setVista(k)}>{t}</button>)}
        <select value={dias} onChange={e => setDias(Number(e.target.value))}
          style={{ marginLeft: 'auto', background: '#0b1220', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 8, padding: '6px 8px' }}>
          {[7, 30, 90, 365].map(d => <option key={d} value={d}>Últimos {d} días</option>)}
        </select>
      </div>
      {filas.length === 0 && <div style={{ color: '#94a3b8', padding: 12 }}>Sin movimientos en el período.</div>}
      {filas.map((f, i) => (
        <div key={i} style={{ fontSize: 13, color: '#cbd5e1', padding: '6px 2px', borderTop: i ? '1px solid #1e293b' : 'none' }}>
          <span style={{ color: '#64748b', marginRight: 8 }}>{fechaHora(f.at)}</span>{texto(f)}
        </div>
      ))}
    </div>
  )
}
