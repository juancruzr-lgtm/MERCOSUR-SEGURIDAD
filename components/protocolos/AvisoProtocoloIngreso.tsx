'use client'

/**
 * components/protocolos/AvisoProtocoloIngreso.tsx
 *
 * Aviso que aparece después de registrar la entrada, si el objetivo tiene un
 * protocolo vigente que la persona todavía no confirmó.
 *
 * Es una franja abajo, no un modal: no tapa la tarjeta del turno ni el botón
 * de salida, y se cierra con «Después» (vuelve a aparecer en el próximo
 * ingreso de otra sesión, nunca más de una vez por versión en la misma).
 */

import type { DocumentoVigilador } from '@/lib/protocolos'

export default function AvisoProtocoloIngreso({ doc, onLeer, onDespues }: {
  doc: DocumentoVigilador
  onLeer: () => void
  onDespues: () => void
}) {
  return (
    <section
      aria-label="Protocolo del objetivo pendiente de lectura"
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 800,
        padding: '0 12px calc(12px + env(safe-area-inset-bottom, 0px))',
        pointerEvents: 'none',
      }}
    >
      <div style={{
        maxWidth: 520, margin: '0 auto', pointerEvents: 'auto',
        background: '#111827', border: '1px solid rgba(59,130,246,.5)', borderLeft: '4px solid #3b82f6',
        borderRadius: 12, padding: '12px 14px', boxShadow: '0 10px 30px rgba(0,0,0,.45)', color: '#e2e8f0',
      }}>
        <div style={{ fontWeight: 800, fontSize: 14.5, color: '#93c5fd', marginBottom: 4 }}>
          Protocolo de {doc.objetivo_nombre ?? 'este objetivo'}
        </div>
        <div style={{ fontSize: 13.5, color: '#cbd5e1', lineHeight: 1.5 }}>
          {doc.cambio
            ? 'Tu protocolo cambió. Leé la versión nueva y confirmá la lectura.'
            : doc.abierto_at
            ? 'Todavía no confirmaste que leíste esta versión.'
            : 'Hay un protocolo de funciones y procedimientos para este objetivo. Leelo durante el turno.'}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button
            type="button" onClick={onLeer}
            style={{
              flex: 1, background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8,
              padding: '10px 12px', fontSize: 14, fontWeight: 800, cursor: 'pointer',
            }}
          >
            Leer ahora
          </button>
          <button
            type="button" onClick={onDespues}
            style={{
              background: 'transparent', border: '1px solid #334155', color: '#94a3b8',
              borderRadius: 8, padding: '10px 14px', fontSize: 14, cursor: 'pointer',
            }}
          >
            Después
          </button>
        </div>
      </div>
    </section>
  )
}
