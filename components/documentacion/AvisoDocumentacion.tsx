'use client'

/**
 * components/documentacion/AvisoDocumentacion.tsx
 *
 * Cartel en la app del vigilador con sus alertas de documentación (vencidos,
 * por vencer, lo que pidió Administración). APAGADO por defecto: la base sólo
 * devuelve alertas si Gerencia prendió "avisar a la persona".
 *
 * Mismo criterio que AvisoEstatuto: tarjeta en la pantalla, no modal. Nunca
 * impide fichar ni ver turnos. "Entendido" las marca vistas. Ante cualquier
 * error no se muestra.
 */

import { useEffect, useState } from 'react'
import { cargarMisAlertas, marcarAlertaVista, textoAlerta } from '@/lib/documentacion-alertas'
import type { AlertaPersona } from '@/lib/documentacion-alertas'

export default function AvisoDocumentacion({ destino }: { destino: string }) {
  const [alertas, setAlertas] = useState<AlertaPersona[]>([])

  useEffect(() => {
    let vivo = true
    void cargarMisAlertas().then(a => { if (vivo) setAlertas(a) }).catch(() => {})
    return () => { vivo = false }
  }, [])

  if (!alertas.length) return null
  const visibles = alertas.slice(0, 3)

  return (
    <section aria-label="Documentación del legajo" style={{
      background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.4)', borderLeft: '4px solid #3b82f6',
      borderRadius: 10, padding: '14px 14px 12px', marginBottom: 12, color: '#e2e8f0',
    }}>
      <div style={{ fontWeight: 800, fontSize: 14.5, color: '#93c5fd', marginBottom: 6 }}>Tu legajo: documentación</div>
      {visibles.map(a => (
        <div key={a.id} style={{ fontSize: 13.5, color: '#cbd5e1', lineHeight: 1.55 }}>• {textoAlerta(a)}</div>
      ))}
      {alertas.length > visibles.length && (
        <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>y {alertas.length - visibles.length} más.</div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <a href={destino} style={{
          flex: '1 1 160px', textAlign: 'center', textDecoration: 'none', background: '#3b82f6',
          color: '#fff', borderRadius: 8, padding: '10px 12px', fontSize: 14, fontWeight: 800,
        }}>Ver mi documentación</a>
        <button type="button"
          onClick={() => { const ids = alertas.map(a => a.id); setAlertas([]); void Promise.all(ids.map(marcarAlertaVista)) }}
          style={{ background: 'transparent', border: '1px solid #334155', color: '#94a3b8', borderRadius: 8, padding: '10px 12px', fontSize: 14, cursor: 'pointer' }}>
          Entendido
        </button>
      </div>
    </section>
  )
}
