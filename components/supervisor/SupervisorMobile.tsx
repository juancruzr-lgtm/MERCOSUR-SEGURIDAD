'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function SupervisorMobile({ user }: any) {
  const [tab, setTab] = useState('inicio')

  const cerrarSesion = async () => {
    await supabase.auth.signOut()
    window.location.href = '/dashboard'
  }

  const tabs = [
    { id: 'inicio', label: 'Inicio', icon: '🏠' },
    { id: 'turnos', label: 'Turnos', icon: '📅' },
    { id: 'guardias', label: 'Guardias', icon: '👮' },
    { id: 'alertas', label: 'Alertas', icon: '⚠️' },
  ]

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0a0e1a',
        color: '#e2e8f0',
        paddingBottom: 72,
        fontFamily: 'Arial, sans-serif',
      }}
    >
      <header
        style={{
          padding: 20,
          borderBottom: '1px solid #1e2d42',
          background: '#111827',
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 800, color: '#f59e0b' }}>
          Supervisor Mobile
        </div>

        <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 4 }}>
          {user?.nombre} {user?.apellido}
        </div>

        <button
          onClick={cerrarSesion}
          style={{
            marginTop: 10,
            background: '#dc2626',
            color: 'white',
            border: 'none',
            padding: '8px 12px',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          Cerrar sesión
        </button>
      </header>

      <main style={{ padding: 20 }}>
        {tab === 'inicio' && (
          <section>
            <h2>Inicio</h2>
            <div style={card}>Panel operativo del supervisor.</div>
            <div style={card}>Próximo paso: ver turnos del objetivo piloto.</div>
          </section>
        )}

        {tab === 'turnos' && (
          <section>
            <h2>Turnos</h2>
            <div style={card}>Acá vamos a mostrar los turnos del día.</div>
          </section>
        )}

        {tab === 'guardias' && (
          <section>
            <h2>Guardias</h2>
            <div style={card}>Acá vamos a mostrar guardias activos.</div>
          </section>
        )}

        {tab === 'alertas' && (
          <section>
            <h2>Alertas</h2>
            <div style={card}>Acá van alertas de asistencia, GPS y cobertura.</div>
          </section>
        )}
      </main>

      <nav
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          display: 'flex',
          background: '#111827',
          borderTop: '1px solid #1e2d42',
        }}
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1,
              padding: '10px 4px',
              background: tab === t.id ? 'rgba(245,158,11,.12)' : 'transparent',
              color: tab === t.id ? '#f59e0b' : '#94a3b8',
              border: 'none',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            <div style={{ fontSize: 20 }}>{t.icon}</div>
            <div>{t.label}</div>
          </button>
        ))}
      </nav>
    </div>
  )
}

const card: React.CSSProperties = {
  background: '#111827',
  border: '1px solid #1e2d42',
  borderRadius: 12,
  padding: 16,
  marginBottom: 12,
}
