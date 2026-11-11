'use client'

/**
 * components/legajo/DatosSolicitud.tsx
 *
 * Datos de la solicitud de empleo dentro del legajo (sólo Administración y
 * Gerencia): estado civil, hijos, estudios, talles, etc., y la foto original.
 * Lee legajo_datos_solicitud (20261211100000); si el empleado no ingresó por
 * Postulantes, o quien mira no es Administración, no muestra nada.
 */

import { useEffect, useState } from 'react'
import { supabase, headersSesion } from '@/lib/supabase'
import { CAMPOS_SELECCION } from '@/lib/postulantes'

type Solicitud = {
  postulacion_id: string
  fecha_entrevista: string | null
  alta_at: string | null
  datos: Record<string, string | null>
  observaciones: string | null
  archivos: { id: string; orden: number; mime: string }[]
}

const card: React.CSSProperties = { background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 14, marginBottom: 12, minWidth: 0, boxSizing: 'border-box' }

const fecha = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('es-AR') : '—')

export default function DatosSolicitud({ empleadoId }: { empleadoId: string }) {
  const [s, setS] = useState<Solicitud | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    supabase.rpc('legajo_datos_solicitud', { p_empleado_id: empleadoId }).then(({ data, error: e }) => {
      if (!vivo) return
      // Función todavía no aplicada o sin permiso: no se muestra nada (no es un error para el usuario).
      if (e) return
      setS((data as Solicitud | null) ?? null)
    })
    return () => { vivo = false }
  }, [empleadoId])

  if (!s) return null

  const abrir = async (id: string) => {
    setError(null)
    try {
      const res = await fetch(`/api/postulaciones/archivo?id=${encodeURIComponent(id)}`, { headers: await headersSesion() })
      const j = await res.json().catch(() => ({}))
      if (!res.ok || !j.url) throw new Error(j.error || 'No se pudo abrir la foto')
      window.open(j.url, '_blank', 'noopener')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir la foto')
    }
  }

  const filas = CAMPOS_SELECCION.filter(c => String(s.datos?.[c.campo] ?? '').trim())

  return (
    <div style={card}>
      <div style={{ fontSize: 13, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, marginBottom: 2 }}>Solicitud de empleo</div>
      <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 10 }}>
        Entrevista {fecha(s.fecha_entrevista)} · alta {fecha(s.alta_at)} · sólo lo ve Administración
      </div>
      {filas.length === 0 && <div style={{ fontSize: 13.5, color: '#94a3b8' }}>La solicitud no tenía datos adicionales cargados.</div>}
      {filas.map(c => (
        <div key={c.campo} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid #1e293b', fontSize: 14 }}>
          <span style={{ color: '#94a3b8' }}>{c.etiqueta}</span>
          <span style={{ color: '#e2e8f0', textAlign: 'right', overflowWrap: 'anywhere' }}>{s.datos[c.campo]}</span>
        </div>
      ))}
      {s.observaciones && (
        <div style={{ fontSize: 13.5, color: '#cbd5e1', marginTop: 10 }}><span style={{ color: '#94a3b8' }}>Observaciones de la entrevista: </span>{s.observaciones}</div>
      )}
      {s.archivos.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {s.archivos.map(a => (
            <button key={a.id} type="button" onClick={() => void abrir(a.id)}
              style={{ background: 'transparent', border: '1px solid #334155', borderRadius: 8, color: '#cbd5e1', padding: '8px 12px', fontSize: 13.5, fontWeight: 700, cursor: 'pointer', minHeight: 40 }}>
              {a.mime === 'application/pdf' ? '📄' : '🖼️'} Solicitud original · página {a.orden}
            </button>
          ))}
        </div>
      )}
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 8 }}>{error}</div>}
    </div>
  )
}
