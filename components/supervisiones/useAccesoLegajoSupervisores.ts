'use client'

/**
 * components/supervisiones/useAccesoLegajoSupervisores.ts
 *
 * ¿El usuario actual consulta legajos y evaluaciones de supervisores? Lo
 * responde la base (lista de autorizaciones individuales): ningún puesto
 * alcanza por sí solo. A los vigiladores ni se les pregunta. Mientras
 * consulta, no muestra nada: nunca se abre de más.
 */

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { accesoLegajoPorPuesto, resolverAccesoLegajo } from '@/lib/legajo-supervisor'
import type { SujetoAcceso } from '@/lib/capacidades'

export function useAccesoLegajoSupervisores(u: (SujetoAcceso & { id?: string | null }) | null | undefined): boolean {
  const [acceso, setAcceso] = useState(false)
  const clave = `${u?.id ?? ''}|${u?.puesto_organizacional ?? ''}|${u?.rol ?? ''}`

  useEffect(() => {
    let vivo = true
    setAcceso(false)
    if (!u || accesoLegajoPorPuesto(u) === 'no') return
    void resolverAccesoLegajo(supabase, u).then(ok => { if (vivo) setAcceso(ok) })
    return () => { vivo = false }
  }, [clave]) // eslint-disable-line react-hooks/exhaustive-deps

  return acceso
}
