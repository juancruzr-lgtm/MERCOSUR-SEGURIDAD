'use client'

// Rondas pausadas plegadas: en Revisión Operativa se muestra sólo el título con
// la cantidad y se despliegan al tocarlo (pedido de Gerencia del 20/11/2026:
// al entrar desde una tarjeta del Panel se ve primero lo de esa tarjeta, no las
// rondas pausadas). El aviso sigue visible: una ronda pausada no genera alerta.

import { useState } from 'react'
import RondasPausadasPanel from './RondasPausadasPanel'

export default function RondasPausadasPlegable({ estilo }: { estilo?: React.CSSProperties }) {
  const [abierto, setAbierto] = useState(false)
  const [cantidad, setCantidad] = useState<number | null>(null)

  if (cantidad === 0 && !abierto) {
    // Sin pausas vigentes no ocupa lugar; el panel queda montado para enterarse si aparece alguna.
    return <div style={{ display: 'none' }}><RondasPausadasPanel objetivoId={null} onConteo={setCantidad} /></div>
  }

  return (
    <div style={estilo}>
      <button
        type="button"
        onClick={() => setAbierto(a => !a)}
        aria-expanded={abierto}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
          background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
          color: '#f59e0b', fontSize: 14, fontWeight: 700, fontFamily: 'inherit', textAlign: 'left',
        }}
      >
        <span>⏸ Rondas pausadas{cantidad !== null ? ` (${cantidad})` : ''}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>{abierto ? 'Ocultar ▲' : 'Ver ▼'}</span>
      </button>
      {/* Montado siempre para tener la cantidad; visible sólo al abrir. */}
      <div style={{ display: abierto ? 'block' : 'none', marginTop: 12 }}>
        <RondasPausadasPanel objetivoId={null} onConteo={setCantidad} />
      </div>
    </div>
  )
}
