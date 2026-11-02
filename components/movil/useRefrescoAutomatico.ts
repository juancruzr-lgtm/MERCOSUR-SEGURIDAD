'use client'

/**
 * Refresco automático con la política única de lib/refresco-movil.ts:
 * intervalo (por defecto 3 min) sólo con pantalla visible + disparo
 * compartido al volver a primer plano (≥30 s desde la última carga; la
 * reconexión dispara siempre).
 *
 * `cargar` debe ser estable (useCallback). Quien carga por su cuenta (montaje,
 * botón ↻) llama a `marcarCarga()` para que el disparo de primer plano cuente
 * desde ahí.
 */

import { useCallback, useEffect, useRef } from 'react'
import {
  INTERVALO_REFRESCO_MS,
  MIN_ENTRE_CARGAS_PRIMER_PLANO_MS,
  debeRecargarPorPrimerPlano,
  disparadorPrimerPlano,
} from '@/lib/refresco-movil'

export function useRefrescoAutomatico(
  cargar: () => unknown,
  opciones: { intervaloMs?: number; minEntreCargasMs?: number; activo?: boolean } = {},
): { marcarCarga: () => void } {
  const intervaloMs = opciones.intervaloMs ?? INTERVALO_REFRESCO_MS
  const minMs = opciones.minEntreCargasMs ?? MIN_ENTRE_CARGAS_PRIMER_PLANO_MS
  const activo = opciones.activo ?? true
  const ultimaRef = useRef<number | null>(null)

  const marcarCarga = useCallback(() => { ultimaRef.current = Date.now() }, [])

  useEffect(() => {
    if (!activo) return
    const ejecutar = () => {
      ultimaRef.current = Date.now()
      void cargar()
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      ejecutar()
    }, intervaloMs)

    const desuscribir = disparadorPrimerPlano()?.suscribir(motivo => {
      if (!debeRecargarPorPrimerPlano(Date.now(), ultimaRef.current, motivo, minMs)) return
      ejecutar()
    })

    return () => {
      window.clearInterval(timer)
      desuscribir?.()
    }
  }, [cargar, intervaloMs, minMs, activo])

  return { marcarCarga }
}
