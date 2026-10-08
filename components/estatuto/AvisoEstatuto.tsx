'use client'

/**
 * components/estatuto/AvisoEstatuto.tsx
 *
 * "Tenés que leer y aceptar el Estatuto Interno", al entrar a la app.
 *
 * ── Por qué NO es un modal ───────────────────────────────────────────────────
 * AvisoEvaluacion es un cartel a pantalla completa (position:fixed) y la
 * captura de teléfono es una compuerta que no se puede saltear. Este aviso NO
 * repite ninguno de los dos patrones: la Gerencia pidió que el Estatuto nunca
 * impida fichar entrada o salida, ver los turnos ni responder alertas. Por eso
 * es una tarjeta dentro del flujo de la pantalla, debajo de lo urgente, que se
 * puede pasar de largo con el dedo y que no tapa ningún botón.
 *
 * ── Cuándo aparece ───────────────────────────────────────────────────────────
 * Mientras haya una versión PUBLICADA que la persona no aceptó. "Después" lo
 * esconde sólo por esta sesión y sólo para esa versión, como AvisoEvaluacion:
 * cerrar el cartel no es aceptar, y mañana vuelve. No hay "no mostrar más".
 *
 * ── Qué no hace ──────────────────────────────────────────────────────────────
 * No acepta nada ni registra nada. Lleva a la sección donde se lee y se acepta.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  CLAVE_SESION_CARTEL, TEXTO_CARTEL, TITULO_CARTEL, estadoAceptacion,
  mostrarCartel, versionVigente,
} from '@/lib/estatuto'
import type { VersionEstatuto } from '@/lib/estatuto'
import { cargarDeEmpleado, cargarVersiones } from '@/lib/estatuto-datos'

export default function AvisoEstatuto({ empleadoId, destino }: {
  empleadoId: string
  /** A dónde lleva "Abrir el estatuto" (Mi Legajo → Estatuto, o /estatuto). */
  destino: string
}) {
  const [vigente, setVigente] = useState<VersionEstatuto | null>(null)
  const [visible, setVisible] = useState(false)

  const cargar = useCallback(async () => {
    const { versiones, error } = await cargarVersiones()
    // Ante cualquier error, no se muestra: un aviso que aparece por un fallo de
    // red le pediría a la persona algo que quizás ya hizo.
    if (error) { setVisible(false); return }
    const v = versionVigente(versiones)
    if (!v) { setVisible(false); return }
    const d = await cargarDeEmpleado(empleadoId)
    if (d.error) { setVisible(false); return }
    let pospuesto: string | null = null
    try { pospuesto = sessionStorage.getItem(CLAVE_SESION_CARTEL) } catch { /* sin sessionStorage aparece */ }
    setVigente(v)
    setVisible(mostrarCartel(estadoAceptacion(v, d.aceptaciones, empleadoId), v.id, pospuesto))
  }, [empleadoId])

  useEffect(() => { void cargar() }, [cargar])

  if (!visible || !vigente) return null

  return (
    <section
      aria-label="Estatuto Interno pendiente de aceptación"
      style={{
        background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.45)',
        borderLeft: '4px solid #f59e0b', borderRadius: 10, padding: '14px 14px 12px',
        marginBottom: 12, color: '#e2e8f0',
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 14.5, color: '#fbbf24', marginBottom: 6, lineHeight: 1.35 }}>
        {TITULO_CARTEL}
      </div>
      <div style={{ fontSize: 13.5, color: '#cbd5e1', lineHeight: 1.55 }}>
        {TEXTO_CARTEL}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <a
          href={destino}
          style={{
            flex: '1 1 160px', textAlign: 'center', textDecoration: 'none',
            background: '#f59e0b', color: '#1a1205', borderRadius: 8,
            padding: '10px 12px', fontSize: 14, fontWeight: 800,
          }}
        >
          Abrir el estatuto
        </a>
        <button
          type="button"
          onClick={() => {
            try { sessionStorage.setItem(CLAVE_SESION_CARTEL, vigente.id) } catch { /* da igual */ }
            setVisible(false)
          }}
          style={{
            background: 'transparent', border: '1px solid #334155', color: '#94a3b8',
            borderRadius: 8, padding: '10px 12px', fontSize: 14, cursor: 'pointer',
          }}
        >
          Después
        </button>
      </div>
    </section>
  )
}
