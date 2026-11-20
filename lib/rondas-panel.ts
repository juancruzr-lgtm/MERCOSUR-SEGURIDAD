// Selección de rondas del Control de Rondas (Dashboard Gerencial).
// Pedido de Gerencia del 19/11/2026: ver la última ronda hecha (hora y resultado)
// y a qué hora va la próxima.
import type { RondaProgramada } from '@/lib/rondas'

function ms(iso: string): number {
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : t
}

export function rondaRelevante(rondas: RondaProgramada[], ahora: number = Date.now()): RondaProgramada | null {
  // Cambio del 19/11/2026 (pedido de Gerencia: "que el panel me marque las
  // últimas rondas"): una ronda que el vigilador YA hizo o está haciendo cuenta
  // como la última aunque su ventana siga abierta. Antes se esperaba al
  // vencimiento y una ronda hecha a las 21:31 no se veía hasta las 23:30.
  let mejor: RondaProgramada | null = null
  for (const r of rondas) {
    const cuenta = ms(r.vencimiento_at) <= ahora || r.ejecucion_id !== null
    if (!cuenta) continue
    if (mejor === null || ms(r.vencimiento_at) > ms(mejor.vencimiento_at)) mejor = r
  }
  if (mejor) return mejor

  // Sin ninguna ronda hecha ni vencida todavía (ronda recién cargada o turno
  // que todavía no llegó a su primera ventana): se muestra la próxima, así el
  // objetivo no desaparece del carril. La tarjeta sale como "Próxima".
  let proxima: RondaProgramada | null = null
  for (const r of rondas) {
    if (proxima === null || ms(r.ventana_inicio) < ms(proxima.ventana_inicio)) proxima = r
  }
  return proxima
}

/** Hora real de una ronda hecha: fin, o inicio si sigue en curso. */
export function horaHecha(r: RondaProgramada): string | null {
  return r.finalizada_at ?? r.iniciada_at
}

/** La última ronda que el vigilador hizo o está haciendo. */
export function ultimaHecha(rondas: RondaProgramada[]): RondaProgramada | null {
  let mejor: RondaProgramada | null = null
  for (const r of rondas) {
    const t = horaHecha(r)
    if (!t) continue
    if (mejor === null || ms(t) > ms(horaHecha(mejor) ?? t)) mejor = r
  }
  return mejor
}

/** Inicio de la próxima ronda que todavía no empezó (ventana futura, sin ejecución). */
export function proximaAt(rondas: RondaProgramada[], ahora: number = Date.now()): string | null {
  let mejor: string | null = null
  for (const r of rondas) {
    if (r.ejecucion_id !== null || ms(r.ventana_inicio) <= ahora) continue
    if (mejor === null || ms(r.ventana_inicio) < ms(mejor)) mejor = r.ventana_inicio
  }
  return mejor
}
