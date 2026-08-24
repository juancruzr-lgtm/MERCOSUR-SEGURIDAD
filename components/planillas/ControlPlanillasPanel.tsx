'use client'

/**
 * components/planillas/ControlPlanillasPanel.tsx
 *
 * Resumen del mes de Revisión de planillas para el Dashboard.
 *
 * Cuenta el TRABAJO ABIERTO, no el universo. La bandeja dice "134 pendientes
 * de 569 registros"; ese 569 sale de su propia definición de qué turno del mes
 * ya está finalizado, y reproducirla acá sería una segunda fuente de verdad
 * para la misma pregunta — exactamente lo que rompió las horas del mes.
 *
 * Así que este panel cuenta lo que sí es inequívoco: lo que alguien pidió, lo
 * que alguien cerró y lo que quedó derivado. Para el total del mes está el
 * enlace a la bandeja, que es su dueña.
 *
 * El estado de cada turno/empleado lo derivan `construirRevisionPorClave` y
 * `contarPorEstadoRevision`, las mismas funciones que usa la bandeja. Acá no
 * hay lógica de estados propia — y antes sí la había: se contaba
 * `solicitudEstado` a secas, así que una solicitud ya resuelta o ya revisada
 * seguía sumando a "Modificación solicitada". El número aparecía en el tablero
 * y al entrar no había ninguna fila.
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fetchPaginadoResult } from '@/lib/fetch-paginado'
import { construirRevisionPorClave, claveRevision, contarPorEstadoRevision } from '@/lib/bandeja-planillas'
import { brandColors, semanticColors } from '@/lib/brand-theme'
import TarjetaMetrica from '@/components/TarjetaMetrica'

const C = {
  card: '#1a2235', border: '#1e2d42', muted: '#64748b', faint: '#475569',
  text: '#e2e8f0',
  yellow: brandColors.yellow ?? '#f59e0b',
  green: semanticColors.success ?? '#10b981',
  red: semanticColors.error ?? '#ef4444',
}

type Conteos = {
  aceptadas: number
  modificacion: number
  resueltas: number
  revisadas: number
  derivadas: number
  conAccion: number
}

const VACIO: Conteos = { aceptadas: 0, modificacion: 0, revisadas: 0, derivadas: 0, resueltas: 0, conAccion: 0 }

export default function ControlPlanillasPanel({
  mes, onVerBandeja,
}: { mes: string; onVerBandeja?: () => void }) {
  const [c, setC] = useState<Conteos>(VACIO)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true); setError(null)
    const [y, m] = mes.split('-').map(Number)
    const desde = `${mes}-01`
    const hasta = `${mes}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`

    // Mismas consultas que la bandeja, paginadas: el mes supera las 1000 filas
    // que devuelve PostgREST y el recorte es silencioso.
    const [acep, soli, revi] = await Promise.all([
      fetchPaginadoResult((d, h) => supabase.from('aceptaciones_planilla')
        .select('turno_id, empleado_id, turno:turnos!inner(fecha)')
        .gte('turno.fecha', desde).lte('turno.fecha', hasta)
        .order('turno_id').range(d, h)),
      fetchPaginadoResult((d, h) => supabase.from('solicitudes_modificacion_planilla')
        .select('id, turno_id, empleado_id, texto, estado, created_at, turno:turnos!inner(fecha)')
        .gte('turno.fecha', desde).lte('turno.fecha', hasta)
        .order('created_at', { ascending: false }).order('id').range(d, h)),
      fetchPaginadoResult((d, h) => supabase.from('revisiones_planilla')
        .select('turno_id, empleado_id, accion, created_at, turno:turnos!inner(fecha)')
        .gte('turno.fecha', desde).lte('turno.fecha', hasta)
        .order('turno_id').range(d, h)),
    ])

    const fallo = acep.error || soli.error || revi.error
    if (fallo) {
      setError(fallo.message ?? 'No se pudo cargar el resumen de planillas.')
      setCargando(false)
      return
    }

    const porClave = construirRevisionPorClave(acep.data, soli.data, revi.data)

    const { modificacion, revisadas, derivadas, resueltas } = contarPorEstadoRevision(porClave)

    const aceptadas = new Set(acep.data.map(a => claveRevision(a.turno_id, a.empleado_id))).size

    setC({ aceptadas, modificacion, revisadas, derivadas, resueltas, conAccion: porClave.size })
    setCargando(false)
  }, [mes])

  useEffect(() => { cargar() }, [cargar])

  const metricas = [
    { l: 'Modificación solicitada', v: c.modificacion, h: 'el vigilador pidió algo', color: C.yellow, destacar: c.modificacion > 0 },
    { l: 'Derivadas a administración', v: c.derivadas, h: 'esperan regularización', color: C.yellow, destacar: c.derivadas > 0 },
    { l: 'Aceptadas por vigilador', v: c.aceptadas, h: 'sin nada por resolver', color: C.green, destacar: false },
    { l: 'Revisadas por supervisor', v: c.revisadas, h: 'cerradas', color: C.green, destacar: false },
    { l: 'Resueltas por administración', v: c.resueltas, h: 'cerradas del otro lado', color: C.green, destacar: false },
  ]

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, flexWrap:'wrap' }}>
        <span style={{ fontFamily:'Syne,sans-serif', fontSize:12, fontWeight:800, letterSpacing:1.4, textTransform:'uppercase', color:C.muted }}>
          Control de planillas
        </span>
        {!cargando && !error && (
          <span style={{ fontSize:11, color:C.faint }}>
            {mes} · {c.conAccion} registro{c.conAccion === 1 ? '' : 's'} con acción
          </span>
        )}
        {onVerBandeja && (
          <button
            onClick={onVerBandeja}
            style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:C.yellow, fontSize:11, fontWeight:700, fontFamily:'inherit' }}
          >
            Ver bandeja →
          </button>
        )}
      </div>

      {error ? (
        <div style={{ fontSize:12, color:C.red }}>{error}</div>
      ) : cargando ? (
        <div style={{ fontSize:12, color:C.muted }}>Cargando resumen…</div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:10 }}>
          {metricas.map(m => (
            <TarjetaMetrica
              key={m.l}
              etiqueta={m.l}
              valor={m.v}
              ayuda={m.h}
              color={m.v > 0 ? m.color : C.muted}
              destacar={m.destacar}
              onClick={onVerBandeja}
              titulo="Ir a Revisión de planillas"
            />
          ))}
        </div>
      )}
    </div>
  )
}
