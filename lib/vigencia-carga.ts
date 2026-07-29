'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * Descarta las escrituras de estado de una carga asíncrona que dejó de ser la
 * vigente.
 *
 * Los paneles de rondas disparan la misma carga desde varios lados a la vez —el
 * intervalo, `focus`, `online`, `visibilitychange`, el botón de refrescar y los
 * cambios de filtro—, y `await` no garantiza orden de llegada. Sin un guardián,
 * la respuesta más lenta escribe última y deja la pantalla mostrando datos
 * viejos: la lista de otro objetivo, el filtro que ya no está seleccionado, o el
 * estado de una ronda anterior al último registro de punto.
 *
 * Uso: pedir el testigo al empezar y consultarlo después de cada `await`, antes
 * de tocar el estado.
 *
 *   const iniciarCarga = useVigenciaCarga()
 *
 *   const cargar = useCallback(async () => {
 *     const vigente = iniciarCarga()
 *     const { data, error } = await traer()
 *     if (!vigente()) return
 *     setDatos(data)
 *   }, [iniciarCarga])
 *
 * `iniciarCarga()` invalida las corridas anteriores, así que la última en
 * empezar es la única que puede escribir. El testigo también da `false` después
 * de desmontar, lo que evita el trabajo inútil de actualizar un componente que
 * ya no está en pantalla.
 */
export function useVigenciaCarga(): () => () => boolean {
  const generacionRef = useRef(0)
  const montadoRef = useRef(true)

  useEffect(() => {
    montadoRef.current = true
    return () => { montadoRef.current = false }
  }, [])

  return useCallback(() => {
    const propia = ++generacionRef.current
    return () => montadoRef.current && propia === generacionRef.current
  }, [])
}
