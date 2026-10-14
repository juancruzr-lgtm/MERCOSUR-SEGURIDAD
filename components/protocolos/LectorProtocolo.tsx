'use client'

/**
 * components/protocolos/LectorProtocolo.tsx
 *
 * El protocolo completo del objetivo, para el vigilador. Se abre desde la
 * tarjeta del turno o desde el aviso posterior al ingreso.
 *
 * ── Qué hace ─────────────────────────────────────────────────────────────────
 * Muestra el texto íntegro tal como lo aprobó Gerencia (sin resumir ni
 * reformatear: los saltos de línea y espacios del original se respetan) y,
 * si todavía no la confirmó, el botón «Leí el protocolo».
 *
 * ── Qué NO hace ──────────────────────────────────────────────────────────────
 * No bloquea nada: se cierra siempre, con o sin confirmar. La confirmación
 * registra la lectura, no el cumplimiento, y no cuenta para Mi Desempeño.
 */

import { useEffect, useState } from 'react'
import { TEXTO_DECLARACION, fechaHoraAR } from '@/lib/protocolos'
import type { DocumentoVigilador } from '@/lib/protocolos'

export default function LectorProtocolo({ doc, desdeCopia, guardadoAt, onCerrar, onConfirmar }: {
  doc: DocumentoVigilador
  /** true si se está mostrando la copia guardada en el teléfono (sin señal). */
  desdeCopia: boolean
  guardadoAt: number | null
  onCerrar: () => void
  /** Devuelve un mensaje de error, o null si confirmó. */
  onConfirmar: () => Promise<string | null>
}) {
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Escape cierra; el fondo no se desplaza mientras está abierto.
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', tecla)
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', tecla); document.body.style.overflow = previo }
  }, [onCerrar])

  const confirmar = async () => {
    setEnviando(true)
    setError(null)
    const e = await onConfirmar()
    setEnviando(false)
    if (e) setError(e)
  }

  return (
    <div
      role="dialog" aria-modal="true" aria-label={`Protocolo de ${doc.objetivo_nombre ?? 'el objetivo'}`}
      style={{
        position: 'fixed', inset: 0, zIndex: 900, background: '#0a0e1a', color: '#e2e8f0',
        display: 'flex', flexDirection: 'column',
        paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 16px 12px',
        borderBottom: '1px solid #1e2d42', background: '#0f172a',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.06em' }}>
            Protocolo del objetivo
          </div>
          <div style={{ fontSize: 16.5, fontWeight: 800, lineHeight: 1.3, overflowWrap: 'anywhere' }}>
            {doc.objetivo_nombre ?? '—'}{doc.puesto_nombre ? ` · ${doc.puesto_nombre}` : ''}
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
            Versión {doc.numero}{doc.aprobado_at ? ` · aprobada el ${fechaHoraAR(doc.aprobado_at).slice(0, 10)}` : ''}
          </div>
        </div>
        <button
          type="button" onClick={onCerrar} aria-label="Cerrar el protocolo"
          style={{
            background: 'none', border: '1px solid #334155', color: '#cbd5e1', borderRadius: 8,
            padding: '8px 12px', fontSize: 14, cursor: 'pointer', flex: 'none',
          }}
        >
          Cerrar
        </button>
      </div>

      {desdeCopia && (
        <div style={{
          background: 'rgba(59,130,246,.10)', borderBottom: '1px solid rgba(59,130,246,.35)',
          color: '#93c5fd', fontSize: 12.5, padding: '8px 16px', lineHeight: 1.45,
        }}>
          Sin conexión: estás viendo la copia guardada en este teléfono
          {guardadoAt ? ` (${fechaHoraAR(new Date(guardadoAt).toISOString())})` : ''}.
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '16px 16px 24px' }}>
        <div style={{
          whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 15.5, lineHeight: 1.6,
          maxWidth: 680, margin: '0 auto', color: '#e2e8f0',
        }}>
          {doc.texto}
        </div>
      </div>

      <div style={{ borderTop: '1px solid #1e2d42', background: '#0f172a', padding: '12px 16px 14px' }}>
        {doc.confirmado_at ? (
          <div style={{ color: '#4ade80', fontSize: 14, fontWeight: 700, textAlign: 'center' }}>
            ✓ Confirmaste la lectura el {fechaHoraAR(doc.confirmado_at)}
          </div>
        ) : (
          <>
            <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.5, marginBottom: 10 }}>
              {TEXTO_DECLARACION}
            </div>
            {error && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 8 }}>{error}</div>}
            <button
              type="button" onClick={confirmar} disabled={enviando}
              style={{
                width: '100%', background: '#16a34a', color: '#fff', border: 'none', borderRadius: 10,
                padding: '13px 12px', fontSize: 15.5, fontWeight: 800, cursor: enviando ? 'wait' : 'pointer',
                opacity: enviando ? 0.6 : 1,
              }}
            >
              {enviando ? 'Confirmando…' : 'Leí el protocolo'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
