'use client'

/**
 * components/legajo/CorroboracionArca.tsx
 *
 * Legajo Digital → Datos personales → Corroboración ARCA. Sólo para
 * Administración/Gerencia (si la base dice que no, no se muestra nada).
 * Muestra la última consulta guardada; «Corroborar nuevamente» consulta ARCA
 * para esta persona. No cambia ningún dato del legajo.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  TEXTO_NOVEDAD, TEXTO_RESULTADO, cargarArca, corroborarDesdeLegajo, cuilCambio, domicilioFiscal, resultadoArca,
} from '@/lib/legajo-arca'
import type { ArcaDeEmpleado } from '@/lib/legajo-arca'

const card: React.CSSProperties = { background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 14, marginBottom: 12, minWidth: 0, boxSizing: 'border-box' }
const celda: React.CSSProperties = { padding: '6px 6px', borderTop: '1px solid #1e293b', fontSize: 13.5, color: '#e2e8f0', overflowWrap: 'anywhere', verticalAlign: 'top' }
const fecha = (iso: string) => new Date(iso).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function CorroboracionArca({ empleadoId }: { empleadoId: string }) {
  const [datos, setDatos] = useState<ArcaDeEmpleado | null>(null)
  const [denegado, setDenegado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [consultando, setConsultando] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const cargar = useCallback(async () => {
    const r = await cargarArca(empleadoId); setDatos(r.datos); setDenegado(r.denegado); setError(r.error)
  }, [empleadoId])
  useEffect(() => { void cargar() }, [cargar])

  if (denegado) return null
  if (error) return <div style={{ ...card, color: '#fca5a5', fontSize: 13.5 }}>Corroboración ARCA: {error}</div>
  if (!datos) return null

  const a = datos.arca
  const res = TEXTO_RESULTADO[resultadoArca(datos)]
  const filas: [string, string | null, string | null][] = [
    ['CUIL', datos.registrado.cuil, a?.cuil ?? null],
    ['Apellido', datos.registrado.apellido, a?.apellido ?? null],
    ['Nombre', datos.registrado.nombre, a?.nombre ?? null],
  ]
  const corroborar = async () => {
    setConsultando(true); setAviso(null)
    const e = await corroborarDesdeLegajo(empleadoId)
    setConsultando(false)
    if (e) setAviso(e); else void cargar()
  }

  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ fontSize: 13, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700 }}>Corroboración ARCA</div>
        <span style={{ fontSize: 13, fontWeight: 800, color: res.color }}>{res.texto}</span>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, tableLayout: 'fixed' }}>
        <thead>
          <tr style={{ fontSize: 11.5, color: '#64748b', textAlign: 'left' }}>
            <th style={{ width: '24%', padding: '0 6px' }}></th><th style={{ padding: '0 6px' }}>MERCOSUR</th><th style={{ padding: '0 6px' }}>ARCA</th>
          </tr>
        </thead>
        <tbody>
          {filas.map(([k, m, x]) => (
            <tr key={k}>
              <td style={{ ...celda, color: '#94a3b8' }}>{k}</td>
              <td style={celda}>{m ?? '—'}</td>
              <td style={celda}>{a ? (x ?? '—') : '—'}</td>
            </tr>
          ))}
          <tr><td style={{ ...celda, color: '#94a3b8' }}>Domicilio fiscal</td><td colSpan={2} style={celda}>{domicilioFiscal(a) ?? '—'}</td></tr>
          <tr><td style={{ ...celda, color: '#94a3b8' }}>Estado fiscal</td><td colSpan={2} style={celda}>{a?.estado ?? '—'}</td></tr>
          <tr><td style={{ ...celda, color: '#94a3b8' }}>Última consulta</td><td colSpan={2} style={celda}>{a ? fecha(a.consultado_at) : 'Nunca'}</td></tr>
        </tbody>
      </table>
      {a && a.novedades.length > 0 && (
        <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13, color: '#fbbf24' }}>
          {a.novedades.map(n => <li key={n}>{TEXTO_NOVEDAD[n] ?? n}</li>)}
        </ul>
      )}
      {cuilCambio(datos) && <div style={{ fontSize: 13, color: '#fbbf24', marginTop: 6 }}>El CUIL registrado cambió después de la última consulta: corroborá nuevamente.</div>}
      {aviso && <div role="alert" style={{ fontSize: 13, color: '#fca5a5', marginTop: 6 }}>{aviso}</div>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
        <button type="button" disabled={consultando} onClick={() => void corroborar()} style={{
          background: consultando ? '#334155' : 'transparent', color: consultando ? '#64748b' : '#cbd5e1', border: '1px solid #334155',
          borderRadius: 8, padding: '8px 13px', fontSize: 14, fontWeight: 600, cursor: consultando ? 'wait' : 'pointer', minHeight: 40,
        }}>{consultando ? 'Consultando ARCA…' : 'Corroborar nuevamente'}</button>
        {datos.consultas[0] && (
          <span style={{ fontSize: 12, color: '#64748b' }}>
            Último pedido: {fecha(datos.consultas[0].at)}{datos.consultas[0].quien ? ` · ${datos.consultas[0].quien}` : ''}{datos.consultas[0].origen === 'alta' ? ' (al dar de alta)' : ''}
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 8, lineHeight: 1.45 }}>
        ARCA sirve para corroborar: no cambia nombre, apellido, CUIL ni domicilio del legajo. Si hay diferencias, se corrigen por el circuito de Datos personales.
        El estado fiscal no indica si la relación laboral está vigente.
      </div>
    </div>
  )
}
