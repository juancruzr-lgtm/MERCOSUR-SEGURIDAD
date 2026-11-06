'use client'

/**
 * Administración/Gerencia eligen qué supervisores pueden CARGAR entrevistas
 * (nunca aprobar, dar de alta ni crear cuentas). La base lo vuelve a controlar
 * en postulacion_habilitar_supervisor.
 */
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Sup = { id: string; nombre: string; apellido: string; puesto_organizacional: string }

export default function HabilitadosPostulantes() {
  const [sups, setSups] = useState<Sup[] | null>(null)
  const [hab, setHab] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const [u, h] = await Promise.all([
      supabase.from('usuarios').select('id, nombre, apellido, puesto_organizacional')
        .eq('estado', 'activo').in('puesto_organizacional', ['supervisor', 'jefe_supervisores', 'direccion_operativa']).order('apellido'),
      supabase.from('postulaciones_habilitados').select('usuario_id'),
    ])
    if (u.error || h.error) { setError((u.error ?? h.error)?.message ?? 'Error'); return }
    setSups((u.data ?? []) as Sup[])
    setHab(new Set((h.data ?? []).map((r: { usuario_id: string }) => r.usuario_id)))
  }, [])
  useEffect(() => { void cargar() }, [cargar])

  const cambiar = async (id: string, habilitar: boolean) => {
    setOcupado(id); setError(null)
    const { error: e } = await supabase.rpc('postulacion_habilitar_supervisor', { p_usuario: id, p_habilitar: habilitar })
    setOcupado(null)
    if (e) setError(e.message); else void cargar()
  }

  return (
    <details style={{ background: '#111827', border: '1px solid #1e2d42', borderRadius: 12, padding: 14, margin: '16px auto 0', maxWidth: 900 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 800, color: '#e2e8f0' }}>Supervisores que pueden cargar entrevistas</summary>
      <div style={{ fontSize: 12.5, color: '#94a3b8', margin: '6px 0 10px' }}>Cargan y revisan sólo sus entrevistas. No aprueban ingresos, no dan de alta ni crean cuentas.</div>
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13 }}>{error}</div>}
      {!sups && !error && <div style={{ color: '#64748b' }}>Cargando…</div>}
      {sups?.map(s => (
        <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid #1f2937', color: '#e2e8f0', fontSize: 14, minHeight: 40 }}>
          <input type="checkbox" checked={hab.has(s.id)} disabled={ocupado === s.id} onChange={e => void cambiar(s.id, e.target.checked)} style={{ width: 20, height: 20 }} />
          <span style={{ flex: 1 }}>{s.apellido}, {s.nombre}</span>
          <span style={{ fontSize: 12, color: '#64748b' }}>{s.puesto_organizacional.replace('_', ' ')}</span>
        </label>
      ))}
    </details>
  )
}
