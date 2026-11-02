'use client'

/**
 * Contexto de exigibilidad de supervisión (turnos de la ventana, quiénes ya
 * operaron, suspensiones) para las pantallas que NO cargan esos datos por su
 * cuenta: la pantalla admin de Supervisiones (vencidas + ranking).
 *
 * Mientras carga o si falla, devuelve CONTEXTO_EXIGIBILIDAD_VACIO
 * (`fechasTurnos: null`), que la regla interpreta como "no descartar a nadie
 * por falta de turnos": es el comportamiento anterior, nunca uno más laxo.
 */

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { cargarContextoExigibilidad } from '@/lib/supervision-universo'
import { CONTEXTO_EXIGIBILIDAD_VACIO, type ContextoExigibilidad } from '@/lib/supervisiones'

export function useContextoExigibilidad(clave: unknown = null): ContextoExigibilidad {
  const [contexto, setContexto] = useState<ContextoExigibilidad>(CONTEXTO_EXIGIBILIDAD_VACIO)

  useEffect(() => {
    let vigente = true
    void cargarContextoExigibilidad(supabase).then(resultado => {
      if (vigente) setContexto(resultado)
    })
    return () => { vigente = false }
  }, [clave])

  return contexto
}
