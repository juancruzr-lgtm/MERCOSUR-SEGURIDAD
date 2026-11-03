'use client'

/**
 * components/auth/NuevaPassword.tsx
 *
 * Formulario único para fijar la contraseña del usuario de la sesión actual
 * (supabase.auth.updateUser). Lo usan el perfil del vigilador, el del
 * supervisor, el menú de administración/gerencia y la recuperación por email.
 * Sólo actúa sobre la propia cuenta: no recibe ids ni usa service_role.
 */

import { useState, type CSSProperties, type ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { mensajeErrorCambioPassword, validarNuevaPassword } from '@/lib/auth-mensajes'

type Tipo = 'ok' | 'error'

export type EstilosNuevaPassword = {
  label?: CSSProperties
  input?: CSSProperties
  boton?: CSSProperties
  botonSecundario?: CSSProperties
  mensaje?: (tipo: Tipo) => CSSProperties
}

const BASE: Required<EstilosNuevaPassword> = {
  label: { display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6, fontWeight: 700 },
  input: { width: '100%', boxSizing: 'border-box', background: '#111827', border: '1px solid #334155', borderRadius: 8, padding: '10px 12px', color: '#e2e8f0', fontSize: 14, marginBottom: 12 },
  boton: { width: '100%', padding: '11px 16px', borderRadius: 8, border: 'none', background: '#eab308', color: '#0a0e1a', fontWeight: 800, fontSize: 14, cursor: 'pointer' },
  botonSecundario: { width: '100%', padding: '10px 16px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#e2e8f0', fontWeight: 700, fontSize: 13, cursor: 'pointer', marginTop: 10 },
  mensaje: tipo => ({
    fontSize: 13, padding: '8px 10px', borderRadius: 8, marginBottom: 12,
    color: tipo === 'ok' ? '#10b981' : '#fca5a5',
    border: `1px solid ${tipo === 'ok' ? 'rgba(16,185,129,.35)' : 'rgba(239,68,68,.35)'}`,
    background: tipo === 'ok' ? 'rgba(16,185,129,.12)' : 'rgba(239,68,68,.12)',
  }),
}

export default function NuevaPassword({
  estilos,
  aviso,
  textoBoton = 'Cambiar contraseña',
  onListo,
  onCancelar,
  textoCancelar = 'Cancelar',
}: {
  estilos?: EstilosNuevaPassword
  aviso?: ReactNode
  textoBoton?: string
  onListo?: () => void
  onCancelar?: () => void
  textoCancelar?: string
}) {
  const e = { ...BASE, ...estilos }
  const [nueva, setNueva] = useState('')
  const [confirmar, setConfirmar] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: Tipo } | null>(null)

  const guardar = async () => {
    setMensaje(null)
    const invalida = validarNuevaPassword(nueva, confirmar)
    if (invalida) { setMensaje({ texto: invalida, tipo: 'error' }); return }

    setGuardando(true)
    try {
      const { error } = await supabase.auth.updateUser({ password: nueva })
      if (error) { setMensaje({ texto: mensajeErrorCambioPassword(error), tipo: 'error' }); return }
      setNueva('')
      setConfirmar('')
      setMensaje({ texto: 'Contraseña actualizada correctamente.', tipo: 'ok' })
      onListo?.()
    } catch (err) {
      setMensaje({ texto: mensajeErrorCambioPassword(err), tipo: 'error' })
    } finally {
      setGuardando(false)
    }
  }

  return (
    <form onSubmit={ev => { ev.preventDefault(); void guardar() }} noValidate>
      {aviso}
      <label style={e.label} htmlFor="np-nueva">Nueva contraseña</label>
      <input id="np-nueva" type="password" autoComplete="new-password" style={e.input} value={nueva} onChange={ev => setNueva(ev.target.value)} />
      <label style={e.label} htmlFor="np-confirmar">Confirmar contraseña</label>
      <input id="np-confirmar" type="password" autoComplete="new-password" style={e.input} value={confirmar} onChange={ev => setConfirmar(ev.target.value)} />
      {mensaje && <div role={mensaje.tipo === 'error' ? 'alert' : 'status'} style={e.mensaje(mensaje.tipo)}>{mensaje.texto}</div>}
      <button type="submit" disabled={guardando} style={{ ...e.boton, opacity: guardando ? 0.6 : 1 }}>
        {guardando ? 'Guardando...' : textoBoton}
      </button>
      {onCancelar && (
        <button type="button" disabled={guardando} onClick={onCancelar} style={e.botonSecundario}>{textoCancelar}</button>
      )}
    </form>
  )
}
