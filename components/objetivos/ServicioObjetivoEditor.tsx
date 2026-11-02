'use client'

/**
 * Fin de servicio y suspensiones de un objetivo (edición de objetivo).
 *
 * Sólo para quien gestiona objetivos (Dir. Operativa, Administración,
 * Gerencia): lo decide quien llama con `tieneCapacidad(user,
 * 'gestionar_objetivos')`, y la base lo revalida (trigger + RLS de la
 * migración 20261113120000).
 *
 * Se guarda APARTE del formulario del objetivo: así el "Guardar" general de
 * un supervisor nunca toca estas columnas (el trigger lo rechazaría).
 *
 * Un objetivo con fin de servicio o suspendido NO exige supervisión en esas
 * fechas (lib/supervisiones.ts → exigibilidadSupervision). No cambia el
 * estado del objetivo ni sus turnos.
 */

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fechaArgentinaDe, type SuspensionObjetivo } from '@/lib/supervisiones'

type Suspension = SuspensionObjetivo & { id: string; motivo: string }

const estilo = {
  label: { display: 'block', fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 4 } as const,
  input: {
    width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #334155',
    background: '#0f172a', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box',
  } as const,
  boton: {
    padding: '7px 12px', borderRadius: 8, border: '1px solid #f59e0b66', background: '#f59e0b1a',
    color: '#fbbf24', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  } as const,
  nota: { fontSize: 11.5, color: '#94a3b8', marginTop: 4 } as const,
}

export default function ServicioObjetivoEditor({
  objetivoId,
  fechaFinInicial,
  onGuardado,
}: {
  objetivoId: string
  fechaFinInicial?: string | null
  onGuardado?: (cambios: { fecha_fin_servicio: string | null }) => void
}) {
  const [fechaFin, setFechaFin] = useState(fechaFinInicial ?? '')
  const [suspensiones, setSuspensiones] = useState<Suspension[]>([])
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [motivo, setMotivo] = useState('')
  const [mensaje, setMensaje] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [disponible, setDisponible] = useState(true)

  const cargar = async () => {
    const { data, error } = await supabase
      .from('objetivo_suspensiones')
      .select('id, objetivo_id, desde, hasta, motivo, anulada_at')
      .eq('objetivo_id', objetivoId)
      .is('anulada_at', null)
      .order('desde', { ascending: false })
    if (error) { setDisponible(false); return }
    setSuspensiones((data ?? []) as Suspension[])
  }

  useEffect(() => { void cargar() }, [objetivoId]) // eslint-disable-line react-hooks/exhaustive-deps

  const guardarFin = async () => {
    setOcupado(true); setMensaje('')
    const valor = fechaFin || null
    const { error } = await supabase.from('objetivos').update({ fecha_fin_servicio: valor }).eq('id', objetivoId)
    setOcupado(false)
    if (error) { setMensaje(`No se guardó: ${error.message}`); return }
    setMensaje(valor ? 'Fin de servicio guardado.' : 'Fin de servicio quitado.')
    onGuardado?.({ fecha_fin_servicio: valor })
  }

  const suspender = async () => {
    if (!desde || !motivo.trim()) { setMensaje('Indicá desde cuándo y el motivo.'); return }
    if (hasta && hasta < desde) { setMensaje('«Hasta» no puede ser anterior a «desde».'); return }
    setOcupado(true); setMensaje('')
    const { error } = await supabase.from('objetivo_suspensiones')
      .insert({ objetivo_id: objetivoId, desde, hasta: hasta || null, motivo: motivo.trim() })
    setOcupado(false)
    if (error) { setMensaje(`No se guardó: ${error.message}`); return }
    setDesde(''); setHasta(''); setMotivo('')
    setMensaje('Suspensión registrada.')
    void cargar()
  }

  // Levantar = cerrar con «hasta» ayer (conserva el registro). Anular = la
  // suspensión no debió existir; también se conserva (AGENTS.md).
  const levantar = async (s: Suspension) => {
    const ayer = fechaArgentinaDe(new Date(Date.now() - 24 * 3600 * 1000))
    const nuevoHasta = ayer < s.desde ? s.desde : ayer
    const { error } = await supabase.from('objetivo_suspensiones').update({ hasta: nuevoHasta }).eq('id', s.id)
    if (error) setMensaje(`No se pudo levantar: ${error.message}`)
    void cargar()
  }
  const anular = async (s: Suspension) => {
    if (!window.confirm('¿Anular esta suspensión? Queda registrada como anulada.')) return
    const { error } = await supabase.from('objetivo_suspensiones').update({ anulada_at: new Date().toISOString() }).eq('id', s.id)
    if (error) setMensaje(`No se pudo anular: ${error.message}`)
    void cargar()
  }

  if (!disponible) {
    return (
      <div style={estilo.nota}>
        Fin de servicio y suspensiones: disponible cuando se aplique la migración 20261113120000.
      </div>
    )
  }

  const hoy = fechaArgentinaDe(new Date())

  return (
    <div>
      <label style={estilo.label}>Fecha de fin de servicio</label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input style={{ ...estilo.input, maxWidth: 180 }} type="date" value={fechaFin} onChange={e => setFechaFin(e.target.value)} />
        <button type="button" style={estilo.boton} disabled={ocupado} onClick={guardarFin}>Guardar fecha</button>
      </div>
      <div style={estilo.nota}>
        Último día con servicio. Después de esa fecha no se exige supervisión. No da de baja el objetivo.
      </div>

      <label style={{ ...estilo.label, marginTop: 14 }}>Suspender servicio</label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 130px' }}>
          <div style={estilo.nota}>Desde</div>
          <input style={estilo.input} type="date" value={desde} onChange={e => setDesde(e.target.value)} />
        </div>
        <div style={{ flex: '1 1 130px' }}>
          <div style={estilo.nota}>Hasta (vacío = sin fecha)</div>
          <input style={estilo.input} type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
        </div>
      </div>
      <input
        style={{ ...estilo.input, marginTop: 8 }}
        placeholder="Motivo (obligatorio)"
        value={motivo}
        onChange={e => setMotivo(e.target.value)}
      />
      <button type="button" style={{ ...estilo.boton, marginTop: 8 }} disabled={ocupado} onClick={suspender}>
        Suspender
      </button>

      {suspensiones.length > 0 && (
        <div style={{ marginTop: 10 }}>
          {suspensiones.map(s => {
            const vigente = s.desde <= hoy && (!s.hasta || hoy <= s.hasta)
            return (
              <div key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12.5, padding: '4px 0' }}>
                <span style={{ flex: '1 1 200px', color: vigente ? '#fbbf24' : '#cbd5e1' }}>
                  {s.desde} → {s.hasta ?? 'sin fecha'} · {s.motivo}{vigente ? ' (vigente)' : ''}
                </span>
                {(!s.hasta || s.hasta >= hoy) && (
                  <button type="button" style={{ ...estilo.boton, padding: '4px 8px' }} onClick={() => levantar(s)}>Levantar</button>
                )}
                <button type="button" style={{ ...estilo.boton, padding: '4px 8px' }} onClick={() => anular(s)}>Anular</button>
              </div>
            )
          })}
        </div>
      )}
      {mensaje && <div style={{ ...estilo.nota, color: '#e2e8f0' }}>{mensaje}</div>}
    </div>
  )
}
