'use client'

/**
 * components/estatuto/AvisoEstatuto.tsx
 *
 * "Tenés que leer y aceptar el Estatuto Interno", al entrar a la app.
 *
 * ── Un aviso que insiste, sin bloquear ───────────────────────────────────────
 * Decisión de JC (16/10/2026). Hasta acá era sólo una tarjeta con "Después"
 * que la escondía toda la sesión: se pasaba de largo. Ahora son dos piezas:
 *
 *   tarjeta  en el flujo de la pantalla, debajo de lo urgente. Mientras esté
 *            pendiente NO se puede esconder: no tapa ningún botón, así que no
 *            hay razón para sacarla.
 *   cartel   a pantalla completa, como AvisoEvaluacion. Se cierra con
 *            "Después" y vuelve cada vez que se abre la app y, si la app queda
 *            abierta, cada 4 horas (REINSISTIR_MS en lib/estatuto).
 *
 * ── Nunca bloquea el fichaje ─────────────────────────────────────────────────
 * Pedido de Gerencia (08/10) confirmado por JC (16/10): el Estatuto no impide
 * fichar entrada o salida, ver los turnos ni responder alertas. El cartel se
 * cierra con un solo toque y la base no ata el fichaje al Estatuto. No es una
 * compuerta como la captura de teléfono.
 *
 * ── Qué no hace ──────────────────────────────────────────────────────────────
 * No acepta nada ni registra nada. Lleva a la sección donde se lee y se acepta,
 * que exige abrir el documento antes (lo valida `estatuto_aceptar`).
 */

import { useCallback, useEffect, useState } from 'react'
import {
  CLAVE_SESION_CARTEL, TEXTO_CARTEL, TITULO_CARTEL, estadoAceptacion,
  mostrarCartel, valorPospuesto, versionVigente,
} from '@/lib/estatuto'
import type { VersionEstatuto } from '@/lib/estatuto'
import { cargarDeEmpleado, cargarVersiones } from '@/lib/estatuto-datos'

/** Cada cuánto se revisa, con la app abierta, si ya toca volver a mostrar el cartel. */
const REVISAR_MS = 5 * 60 * 1000

function leerPospuesto(): string | null {
  try { return sessionStorage.getItem(CLAVE_SESION_CARTEL) } catch { return null }
}

export default function AvisoEstatuto({ empleadoId, destino }: {
  empleadoId: string
  /** A dónde lleva "Leer y aceptar" (Mi Legajo → Estatuto, o /estatuto). */
  destino: string
}) {
  const [vigente, setVigente] = useState<VersionEstatuto | null>(null)
  const [pendiente, setPendiente] = useState(false)
  const [cartel, setCartel] = useState(false)

  const cargar = useCallback(async () => {
    const { versiones, error } = await cargarVersiones()
    // Ante cualquier error, no se muestra: un aviso que aparece por un fallo de
    // red le pediría a la persona algo que quizás ya hizo.
    if (error) { setPendiente(false); return }
    const v = versionVigente(versiones)
    if (!v) { setPendiente(false); return }
    const d = await cargarDeEmpleado(empleadoId)
    if (d.error) { setPendiente(false); return }
    const estado = estadoAceptacion(v, d.aceptaciones, empleadoId)
    setVigente(v)
    setPendiente(estado === 'pendiente')
    setCartel(mostrarCartel(estado, v.id, leerPospuesto(), Date.now()))
  }, [empleadoId])

  useEffect(() => { void cargar() }, [cargar])

  // Volver a la app (desde otra app o con la pantalla apagada) relee: quizás
  // aceptó en otro dispositivo, o ya pasaron las 4 horas.
  useEffect(() => {
    const alVolver = () => { if (document.visibilityState === 'visible') void cargar() }
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [cargar])

  // Con la app abierta y en primer plano: sólo el reloj, sin consultar la base.
  useEffect(() => {
    if (!pendiente || !vigente) return
    const id = setInterval(() => {
      setCartel(mostrarCartel('pendiente', vigente.id, leerPospuesto(), Date.now()))
    }, REVISAR_MS)
    return () => clearInterval(id)
  }, [pendiente, vigente])

  if (!pendiente || !vigente) return null

  const despues = () => {
    try { sessionStorage.setItem(CLAVE_SESION_CARTEL, valorPospuesto(vigente.id, Date.now())) } catch { /* vuelve a aparecer */ }
    setCartel(false)
  }

  return <VistaAvisoEstatuto destino={destino} cartel={cartel} onDespues={despues} />
}

/**
 * Lo que se ve, sin datos ni efectos (se prueba con renderToStaticMarkup).
 * La tarjeta no tiene "Después": sólo el cartel se puede cerrar.
 */
export function VistaAvisoEstatuto({ destino, cartel, onDespues }: {
  destino: string
  cartel: boolean
  onDespues: () => void
}) {
  return (
    <>
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
        <a
          href={destino}
          style={{
            display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: 12,
            background: '#f59e0b', color: '#1a1205', borderRadius: 8,
            padding: '10px 12px', fontSize: 14, fontWeight: 800,
          }}
        >
          Leer y aceptar
        </a>
      </section>

      {cartel && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Estatuto Interno pendiente de aceptación"
          style={{
            // Un escalón debajo de AvisoEvaluacion (1000): si aparecen los dos,
            // primero se ve la evaluación, que se muestra una sola vez.
            position: 'fixed', inset: 0, zIndex: 999, background: 'rgba(2,6,23,.82)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div style={{
            background: '#0f172a', border: '1px solid rgba(245,158,11,.45)', borderRadius: 14,
            padding: 22, maxWidth: 400, width: '100%', boxSizing: 'border-box',
            boxShadow: '0 24px 60px rgba(0,0,0,.5)',
          }}>
            <div style={{ fontSize: 30, marginBottom: 10 }}>📜</div>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#fbbf24', lineHeight: 1.35 }}>
              {TITULO_CARTEL}
            </div>
            <div style={{ fontSize: 13.5, color: '#cbd5e1', lineHeight: 1.6, marginTop: 10 }}>
              {TEXTO_CARTEL}
            </div>
            <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.5, marginTop: 10 }}>
              Podés seguir usando la app y fichar normalmente. Este aviso va a
              volver hasta que lo aceptes.
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <a
                href={destino}
                style={{
                  flex: 1, textAlign: 'center', textDecoration: 'none',
                  background: '#f59e0b', color: '#1a1205', borderRadius: 10,
                  padding: '12px 14px', fontSize: 14, fontWeight: 800,
                }}
              >
                Leer y aceptar
              </a>
              <button
                type="button"
                onClick={onDespues}
                style={{
                  background: '#1e293b', border: '1px solid #334155', color: '#94a3b8',
                  borderRadius: 10, padding: '12px 14px', fontSize: 14, cursor: 'pointer',
                }}
              >
                Después
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
