'use client'

/**
 * components/supervisiones/useAccesoLegajoSupervisores.ts
 *
 * ¿El usuario actual ve los legajos operativos de supervisores? Gerencia y
 * Dirección por puesto (inmediato); Jefe de supervisores y Administración
 * sólo si la base los tiene autorizados nominalmente (una consulta). Mientras
 * consulta, no muestra nada: nunca se abre de más.
 */

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { accesoLegajoPorPuesto, resolverAccesoLegajo } from '@/lib/legajo-supervisor'
import type { SujetoAcceso } from '@/lib/capacidades'

export function useAccesoLegajoSupervisores(u: (SujetoAcceso & { id?: string | null }) | null | undefined): boolean {
  const porPuesto = accesoLegajoPorPuesto(u)
  const [acceso, setAcceso] = useState(porPuesto === 'si')
  const clave = `${u?.id ?? ''}|${u?.puesto_organizacional ?? ''}|${u?.rol ?? ''}|${u?.acceso_gerencia_delegado ? 1 : 0}`

  useEffect(() => {
    let vivo = true
    if (!u) { setAcceso(false); return }
    if (porPuesto !== 'consultar') { setAcceso(porPuesto === 'si'); return }
    setAcceso(false)
    void resolverAccesoLegajo(supabase, u).then(ok => { if (vivo) setAcceso(ok) })
    return () => { vivo = false }
  }, [clave]) // eslint-disable-line react-hooks/exhaustive-deps

  return acceso
}
