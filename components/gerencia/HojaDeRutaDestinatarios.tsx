'use client'

// Destinatarios de la hoja de ruta de supervisores (WhatsApp al terminar cada
// turno). Los define Gerencia; la base lo exige (hoja_ruta_guardar_destinatario).
// El envío sigue apagado hasta que Gerencia lo autorice (HOJA_DE_RUTA_WHATSAPP).

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Destinatario { usuario_id: string, descripcion: string, activo: boolean }
interface UsuarioMin { id: string, nombre: string, apellido: string, telefono: string | null }

export default function HojaDeRutaDestinatarios() {
  const [destinatarios, setDestinatarios] = useState<Destinatario[]>([])
  const [usuarios, setUsuarios] = useState<UsuarioMin[]>([])
  const [nuevo, setNuevo] = useState({ usuario_id: '', descripcion: '' })
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [esGerencia, setEsGerencia] = useState(false)

  const cargar = useCallback(async () => {
    const g = await supabase.rpc('puede_acceder_gerencia_actual')
    setEsGerencia(g.data === true)
    if (g.data !== true) return
    const [d, u] = await Promise.all([
      supabase.from('hoja_ruta_destinatarios').select('usuario_id, descripcion, activo').order('descripcion'),
      supabase.from('usuarios').select('id, nombre, apellido, telefono').eq('estado', 'activo').neq('rol', 'guardia').order('apellido').limit(500),
    ])
    if (d.error) { setError(`No disponible: ${d.error.message}`); return }
    setError('')
    setDestinatarios((d.data || []) as Destinatario[])
    setUsuarios((u.data || []) as UsuarioMin[])
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const guardar = async (usuarioId: string, descripcion: string, activo: boolean) => {
    if (guardando) return
    setGuardando(true)
    setError('')
    const { error: e } = await supabase.rpc('hoja_ruta_guardar_destinatario', { p_usuario_id: usuarioId, p_descripcion: descripcion, p_activo: activo })
    setGuardando(false)
    if (e) { setError(e.message); return }
    setNuevo({ usuario_id: '', descripcion: '' })
    await cargar()
  }

  const nombre = (id: string) => {
    const u = usuarios.find(x => x.id === id)
    return u ? `${u.apellido}, ${u.nombre}${u.telefono ? '' : ' (sin teléfono)'}` : id
  }

  if (!esGerencia) return null

  const caja: React.CSSProperties = { background: '#111827', border: '1px solid #1e2d42', borderRadius: 8, padding: 14, marginTop: 20 }
  const campo: React.CSSProperties = { background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: 8, fontSize: 13 }

  return (
    <div style={caja}>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>Hoja de ruta de supervisores — destinatarios</div>
      <div style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 10px' }}>
        Reciben por WhatsApp, al terminar cada turno, las visitas del supervisor con la novedad de cada objetivo. El envío está apagado hasta que Gerencia lo autorice.
      </div>
      {error && <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {destinatarios.map(d => (
        <div key={d.usuario_id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#e2e8f0', padding: '6px 0', borderTop: '1px solid #1e2d42' }}>
          <span style={{ flex: 1 }}>{nombre(d.usuario_id)} · {d.descripcion}</span>
          <button type="button" disabled={guardando} onClick={() => guardar(d.usuario_id, d.descripcion, !d.activo)}
            style={{ ...campo, cursor: 'pointer', color: d.activo ? '#4ade80' : '#94a3b8' }}>
            {d.activo ? 'Activo' : 'Inactivo'}
          </button>
        </div>
      ))}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
        <select style={{ ...campo, flex: '1 1 200px' }} value={nuevo.usuario_id} onChange={e => setNuevo(p => ({ ...p, usuario_id: e.target.value }))}>
          <option value="">Agregar destinatario…</option>
          {usuarios.filter(u => !destinatarios.some(d => d.usuario_id === u.id)).map(u => (
            <option key={u.id} value={u.id}>{u.apellido}, {u.nombre}{u.telefono ? '' : ' (sin teléfono)'}</option>
          ))}
        </select>
        <input style={{ ...campo, flex: '1 1 160px' }} placeholder="Cargo (ej.: Director Técnico)" value={nuevo.descripcion}
          onChange={e => setNuevo(p => ({ ...p, descripcion: e.target.value }))} />
        <button type="button" disabled={guardando || !nuevo.usuario_id || nuevo.descripcion.trim().length < 3}
          onClick={() => guardar(nuevo.usuario_id, nuevo.descripcion, true)}
          style={{ ...campo, cursor: 'pointer', background: '#1e3a5f', opacity: guardando || !nuevo.usuario_id || nuevo.descripcion.trim().length < 3 ? 0.5 : 1 }}>
          Agregar
        </button>
      </div>
    </div>
  )
}
