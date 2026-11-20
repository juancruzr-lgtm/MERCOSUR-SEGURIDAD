'use client'
// Propuestas de horas de Reportes (POST /api/facturacion/horas, accion 'proponer') bajo demanda.
//
// Antes, abrir Prefacturas u Horas calculaba la propuesta de TODOS los objetivos (≈25 pedidos de
// 3 a 11 s, de a 4) y los pedidos seguían corriendo al salir de la pantalla: carga de base que
// importa desde la caída por Disk IO del 18/11. Ahora:
//   · montar la pantalla NO calcula nada (sólo muestra lo que ya esté en la caché del mes);
//   · se calcula con el botón «Calcular propuestas» o por fila (al abrir sus turnos);
//   · al desmontar o cambiar de mes se abortan los pedidos en curso (AbortController);
//   · lo calculado queda en memoria por mes mientras la pestaña del navegador esté abierta.
// La lógica de cálculo (servidor) no cambia: es exactamente el mismo pedido.
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/facturacion/datos'

export type PropuestaObjetivo = { propuesta: any; error: string | null }
export type PedidoPropuesta = { contratoId: string; objetivoId: string }
export const claveObjetivo = (contratoId: string, objetivoId: string) => `${contratoId}:${objetivoId}`

type Entrada = { props: Record<string, PropuestaObjetivo>; calculadoAt: number | null }
// Caché en memoria por mes, compartida entre Prefacturas y Horas. Se pierde al recargar la página.
const cache = new Map<string, Entrada>()
export function limpiarCachePropuestas() { cache.clear() }
const entradaDe = (mes: string): Entrada => {
  let e = cache.get(mes)
  if (!e) { e = { props: {}, calculadoAt: null }; cache.set(mes, e) }
  return e
}

const esAborto = (e: any, signal: AbortSignal) => signal.aborted || e?.name === 'AbortError'

/**
 * Pide las propuestas de a `concurrencia`. Si el signal se aborta, deja de pedir y no registra
 * nada más (los pedidos en vuelo se cancelan en el navegador).
 */
export async function calcularPropuestas(
  pedidos: PedidoPropuesta[], mes: string,
  { signal, alObtener, concurrencia = 4 }: { signal: AbortSignal; alObtener: (k: string, v: PropuestaObjetivo) => void; concurrencia?: number },
) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(concurrencia, pedidos.length) }, async () => {
    while (i < pedidos.length && !signal.aborted) {
      const x = pedidos[i++]
      const k = claveObjetivo(x.contratoId, x.objetivoId)
      try {
        const propuesta = await api('horas', { accion: 'proponer', contrato_id: x.contratoId, objetivo_id: x.objetivoId, mes }, 'POST', { signal })
        if (!signal.aborted) alObtener(k, { propuesta, error: null })
      } catch (e: any) {
        if (esAborto(e, signal)) return
        alObtener(k, { propuesta: null, error: e?.message ?? 'No se pudo calcular' })
      }
    }
  }))
}

export function usePropuestasHoras(mes: string) {
  const [props, setProps] = useState<Record<string, PropuestaObjetivo>>(() => ({ ...(cache.get(mes)?.props ?? {}) }))
  const [calculadoAt, setCalculadoAt] = useState<number | null>(() => cache.get(mes)?.calculadoAt ?? null)
  const [enCurso, setEnCurso] = useState(0)
  const controles = useRef(new Set<AbortController>())

  useEffect(() => {
    // Al montar o cambiar de mes: sólo lo que ya estaba calculado. Nada de pedidos.
    const e = cache.get(mes)
    setProps({ ...(e?.props ?? {}) })
    setCalculadoAt(e?.calculadoAt ?? null)
    const vivos = controles.current
    return () => { vivos.forEach(c => c.abort()); vivos.clear(); setEnCurso(0) }
  }, [mes])

  /** Calcula las propuestas pedidas. Sin `forzar`, saltea las que ya están bien calculadas en la caché del mes. */
  const calcular = useCallback(async (pedidos: PedidoPropuesta[], { forzar = false }: { forzar?: boolean } = {}) => {
    const entrada = entradaDe(mes)
    const faltan = forzar ? pedidos : pedidos.filter(p => {
      const v = entrada.props[claveObjetivo(p.contratoId, p.objetivoId)]
      return !v || Boolean(v.error)
    })
    if (!faltan.length) return
    const ctrl = new AbortController()
    controles.current.add(ctrl)
    setEnCurso(n => n + 1)
    try {
      await calcularPropuestas(faltan, mes, {
        signal: ctrl.signal,
        alObtener: (k, v) => { entrada.props[k] = v; setProps(p => ({ ...p, [k]: v })) },
      })
      if (!ctrl.signal.aborted) { entrada.calculadoAt = Date.now(); setCalculadoAt(entrada.calculadoAt) }
    } finally {
      controles.current.delete(ctrl)
      if (!ctrl.signal.aborted) setEnCurso(n => Math.max(0, n - 1))
    }
  }, [mes])

  return { props, calcular, calculando: enCurso > 0, calculadoAt }
}
