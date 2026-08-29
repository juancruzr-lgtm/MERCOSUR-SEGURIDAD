'use client'

/**
 * components/supervisiones/ControlSupervisionesPanel.tsx
 *
 * Resumen del mes de Supervisiones para el Dashboard.
 *
 * El tablero tenía Rondas, Planillas e Imágenes IA, pero de las supervisiones
 * —que es lo que el supervisor sale a hacer al objetivo— no había una sola
 * línea: había que entrar a la pantalla para saber si se hicieron.
 *
 * Cuenta el TRABAJO ABIERTO, igual que el panel de planillas: lo que reclama
 * una decisión primero, y el volumen después. Una supervisión "incompleta" no
 * es un error del sistema: es una visita que se registró sin el checklist o
 * sin la foto obligatoria, y alguien tiene que resolverla.
 *
 * El estado lo escribe el móvil al guardar (`supervisiones.estado`), y acá NO
 * se recalcula: reproducir esa regla sería una segunda fuente de verdad para
 * la misma pregunta.
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { brandColors, semanticColors } from '@/lib/brand-theme'
import TarjetaMetrica from '@/components/TarjetaMetrica'

const C = {
  muted: '#64748b', faint: '#475569',
  yellow: brandColors.yellow ?? '#f59e0b',
  green: semanticColors.success ?? '#10b981',
  red: semanticColors.error ?? '#ef4444',
}

type Conteos = {
  total: number
  ok: number
  conObservacion: number
  critico: number
  incompleta: number
  sinFoto: number
  objetivos: number
  ultima: string | null
}

const VACIO: Conteos = {
  total: 0, ok: 0, conObservacion: 0, critico: 0,
  incompleta: 0, sinFoto: 0, objetivos: 0, ultima: null,
}

export default function ControlSupervisionesPanel({
  mes, onVerTodas,
}: { mes: string; onVerTodas?: () => void }) {
  const [c, setC] = useState<Conteos>(VACIO)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true); setError(null)
    const [y, m] = mes.split('-').map(Number)
    const desde = `${mes}-01`
    const hasta = `${mes}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`

    // El rango va sobre created_at con hora, para no perder las del último día.
    const { data, error: err } = await supabase
      .from('supervisiones')
      .select('id, estado, objetivo_id, created_at')
      .gte('created_at', `${desde}T00:00:00`)
      .lte('created_at', `${hasta}T23:59:59`)
      .order('created_at', { ascending: false })

    if (err) {
      setError('No se pudo leer las supervisiones del mes.')
      setC(VACIO); setCargando(false)
      return
    }

    const filas = data ?? []
    // Cuáles tienen al menos una foto: una supervisión sin evidencia se puede
    // haber hecho igual, pero no se puede mostrar.
    const ids = filas.map(f => f.id)
    let conFoto = new Set<string>()
    if (ids.length > 0) {
      const { data: fotos } = await supabase
        .from('supervision_fotos')
        .select('supervision_id')
        .in('supervision_id', ids)
      conFoto = new Set((fotos ?? []).map((f: any) => f.supervision_id))
    }

    setC({
      total: filas.length,
      ok: filas.filter(f => f.estado === 'ok').length,
      conObservacion: filas.filter(f => f.estado === 'con_observacion').length,
      critico: filas.filter(f => f.estado === 'critico').length,
      incompleta: filas.filter(f => f.estado === 'incompleta').length,
      sinFoto: filas.filter(f => !conFoto.has(f.id)).length,
      objetivos: new Set(filas.map(f => f.objetivo_id)).size,
      ultima: filas[0]?.created_at ?? null,
    })
    setCargando(false)
  }, [mes])

  useEffect(() => { void cargar() }, [cargar])

  // Primero lo que pide acción, después el volumen. No es un podio.
  const metricas = [
    { l: 'Críticas', v: c.critico, h: 'observación de criticidad alta', color: C.red, destacar: c.critico > 0 },
    { l: 'Incompletas', v: c.incompleta, h: 'sin checklist o sin foto obligatoria', color: C.yellow, destacar: c.incompleta > 0 },
    { l: 'Sin foto adjunta', v: c.sinFoto, h: 'quedaron sin evidencia', color: C.yellow, destacar: c.sinFoto > 0 },
    { l: 'Con observación', v: c.conObservacion, h: 'algo para corregir', color: C.yellow, destacar: false },
    { l: 'Sin novedad', v: c.ok, h: 'checklist completo y sin observaciones', color: C.green, destacar: false },
    { l: 'Objetivos visitados', v: c.objetivos, h: 'distintos, en el mes', color: C.green, destacar: false },
  ]

  const ultimaLegible = c.ultima
    ? new Date(c.ultima).toLocaleString('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires',
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    })
    : null

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, flexWrap:'wrap' }}>
        <span style={{ fontFamily:'Syne,sans-serif', fontSize:12, fontWeight:800, letterSpacing:1.4, textTransform:'uppercase', color:C.muted }}>
          Control de supervisiones
        </span>
        {!cargando && !error && (
          <span style={{ fontSize:11, color:C.faint }}>
            {mes} · {c.total} supervisión{c.total === 1 ? '' : 'es'}
            {ultimaLegible && ` · última ${ultimaLegible}`}
          </span>
        )}
        {onVerTodas && (
          <button
            onClick={onVerTodas}
            style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:C.yellow, fontSize:11, fontWeight:700, fontFamily:'inherit' }}
          >
            Ver todas →
          </button>
        )}
      </div>

      {error ? (
        <div style={{ fontSize:12, color:C.red }}>{error}</div>
      ) : cargando ? (
        <div style={{ fontSize:12, color:C.muted }}>Cargando resumen…</div>
      ) : c.total === 0 ? (
        // Cero supervisiones y cero errores no es lo mismo que "todo bien":
        // significa que nadie salió a supervisar en el mes, y hay que decirlo.
        <div style={{ fontSize:12, color:C.yellow }}>
          No hay supervisiones registradas en {mes}.
        </div>
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
              onClick={onVerTodas}
              titulo="Ir a Supervisiones"
            />
          ))}
        </div>
      )}
    </div>
  )
}
