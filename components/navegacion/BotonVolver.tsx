'use client'

// Botón «Volver» común a todas las secciones del panel de administración
// (pedido de Gerencia del 20/11/2026). Vuelve a la sección desde la que se
// llegó; si no hay ninguna (se entró por un enlace o recién se abrió la app),
// vuelve al Panel Principal.

import { useCallback, useEffect, useRef } from 'react'

const INICIO = 'dashboard'

/** Recuerda las secciones visitadas y devuelve la función para volver. */
export function usePilaSecciones(page: string, setPage: (p: string) => void) {
  const pila = useRef<string[]>([])
  const anterior = useRef(page)
  const volviendo = useRef(false)

  useEffect(() => {
    if (anterior.current === page) return
    if (volviendo.current) volviendo.current = false
    else pila.current.push(anterior.current)
    // No acumular la misma sección dos veces seguidas.
    if (pila.current.length > 1 && pila.current[pila.current.length - 1] === pila.current[pila.current.length - 2]) pila.current.pop()
    if (pila.current.length > 50) pila.current.shift()
    anterior.current = page
  }, [page])

  return useCallback(() => {
    let destino = pila.current.pop()
    while (destino !== undefined && destino === anterior.current) destino = pila.current.pop()
    volviendo.current = true
    setPage(destino ?? INICIO)
  }, [setPage])
}

export default function BotonVolver({ page, onVolver }: { page: string; onVolver: () => void }) {
  if (page === INICIO) return null
  return (
    <button
      type="button"
      onClick={onVolver}
      aria-label="Volver a la pantalla anterior"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 14,
        padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
        background: 'transparent', color: '#cbd5e1', border: '1px solid #334155',
        fontFamily: 'inherit',
      }}
    >
      ← Volver
    </button>
  )
}
