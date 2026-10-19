'use client'

/**
 * components/supervisor/RastreoGpsVistaAdmin.tsx
 *
 * Registra el recorrido GPS de un supervisor MIENTRAS USA LA VISTA DE
 * ADMINISTRACIÓN (corrección C, JC 19/10). Hoy es el caso de Sergio Martínez:
 * supervisor con jefatura, el único que trabaja desde esa vista.
 *
 * Es el MISMO GPS que usa SupervisorMobile (useSupervisorGps): arranca y para
 * con su guardia programada (supervisores_guardia) y cada punto queda
 * vinculado a esa guardia (turno_supervisor_id), así aparece en su legajo, en
 * los mapas y en la evaluación igual que el de los demás. No dibuja nada.
 *
 * Sólo se monta en la vista de Administración; en la vista Supervisor ya
 * registra SupervisorMobile, así que nunca hay dos registrando a la vez.
 * Relee sus guardias cada 5 minutos: así el recorrido arranca y termina con
 * el horario aunque la pantalla quede abierta.
 */

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fechaArgentina, sumarDias } from '@/lib/periodo-argentina'
import { useSupervisorGps, type ObjetivoGeo, type TurnoSupervisorRow } from '@/lib/supervisor-gps'

const RELECTURA_MS = 5 * 60_000

export default function RastreoGpsVistaAdmin({ userId }: { userId: string }) {
  const [guardias, setGuardias] = useState<TurnoSupervisorRow[]>([])
  const [objetivos, setObjetivos] = useState<ObjetivoGeo[]>([])

  useEffect(() => {
    let vivo = true
    const cargarGuardias = async () => {
      const hoy = fechaArgentina()
      const { data, error } = await supabase
        .from('supervisores_guardia')
        .select('id, supervisor_id, fecha, hora_inicio, hora_fin, estado')
        .eq('supervisor_id', userId)
        .gte('fecha', sumarDias(hoy, -1))
        .lte('fecha', sumarDias(hoy, 1))
      // Ante error se conserva lo último leído (no se corta un recorrido en curso).
      if (vivo && !error) setGuardias((data ?? []) as TurnoSupervisorRow[])
    }
    void cargarGuardias()
    void supabase.from('objetivos').select('id, lat, lng, radio_metros').eq('estado', 'activo')
      .then(({ data, error }) => { if (vivo && !error) setObjetivos((data ?? []) as ObjetivoGeo[]) })
    const t = setInterval(() => void cargarGuardias(), RELECTURA_MS)
    return () => { vivo = false; clearInterval(t) }
  }, [userId])

  useSupervisorGps(userId, guardias, objetivos)
  return null
}
