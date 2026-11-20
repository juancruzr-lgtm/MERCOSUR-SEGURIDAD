'use client'

/**
 * components/ia/ControlImagenesIAPanel.tsx
 *
 * Resumen de una línea para el Dashboard: cuánto analiza la IA, cuánto llega a
 * una persona, y qué pasó con lo que llegó.
 *
 * Las dos tasas del final son el punto. "Enviadas a revisión" sola no dice
 * nada: si de cada cien que manda se descartan noventa, el problema no es el
 * volumen sino que está mandando lo que no sirve, y eso sólo se ve cruzando
 * contra lo que decidió un humano.
 *
 * Los nueve números salen de una sola función (ia_control_imagenes_conteos):
 * una pasada sobre la tabla y el permiso aplicado por objetivo, no por fila.
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { brandColors, semanticColors } from '@/lib/brand-theme'
import TarjetaMetrica from '@/components/TarjetaMetrica'

const C = {
  card: '#1a2235', border: '#1e2d42', muted: '#64748b', faint: '#475569',
  text: '#e2e8f0', sub: '#94a3b8',
  yellow: brandColors.yellow ?? '#f59e0b',
  green: semanticColors.success ?? '#10b981',
  red: semanticColors.error ?? '#ef4444',
  violet: '#a78bfa',
}

type Conteos = {
  analizadas: number
  ok: number
  dudosas: number
  aRevision: number
  confirmadas: number
  descartadas: number
  observRevisadas: number
  observDescartadas: number
  revisadas: number
}

const VACIO: Conteos = {
  analizadas: 0, ok: 0, dudosas: 0, aRevision: 0, confirmadas: 0,
  descartadas: 0, observRevisadas: 0, observDescartadas: 0, revisadas: 0,
}

export default function ControlImagenesIAPanel({ onVerTodas }: { onVerTodas?: () => void }) {
  const [c, setC] = useState<Conteos>(VACIO)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true); setError(null)
    // Una sola llamada: la base cuenta todo en una pasada y aplica el permiso
    // una vez por objetivo. Antes eran 9 conteos sobre todo el histórico con
    // la RLS evaluada fila por fila (~125.000 evaluaciones por apertura del
    // Dashboard); fue la mayor carga de disco en la caída del 18/11/2026.
    // Misma regla de bandeja que AnalisisIAPanel: lo que no es
    // SIN_OBSERVACIONES, más la muestra de control.
    try {
      const { data, error: e } = await supabase.rpc('ia_control_imagenes_conteos')
      if (e) throw e
      const r = (Array.isArray(data) ? data[0] : data) ?? {}
      const n = (v: unknown) => Number(v ?? 0) || 0
      setC({
        analizadas: n(r.analizadas),
        ok: n(r.ok),
        dudosas: n(r.dudosas),
        aRevision: n(r.a_revision),
        confirmadas: n(r.confirmadas),
        descartadas: n(r.descartadas),
        observRevisadas: n(r.observ_revisadas),
        observDescartadas: n(r.observ_descartadas),
        revisadas: n(r.revisadas),
      })
    } catch (e: any) {
      setError(e?.message ?? 'No se pudieron cargar las métricas de IA.')
    }
    setCargando(false)
  }, [])

  useEffect(() => { cargar() }, [cargar])

  const pct = (parte: number, total: number) =>
    total > 0 ? `${((parte / total) * 100).toFixed(1)} %` : '—'

  const metricas = [
    { l: 'Analizadas', v: c.analizadas.toLocaleString('es-AR'), h: 'ronda, uniforme y libro', color: C.text },
    { l: 'OK automáticas', v: c.ok.toLocaleString('es-AR'), h: `${pct(c.ok, c.analizadas)} · no llegan a nadie`, color: C.green },
    { l: 'Dudosas', v: c.dudosas.toLocaleString('es-AR'), h: 'evidencia insuficiente', color: C.muted },
    { l: 'A revisión', v: c.aRevision.toLocaleString('es-AR'), h: `${pct(c.aRevision, c.analizadas)} de lo analizado`, color: C.yellow, destacar: true },
    { l: 'Confirmadas', v: c.confirmadas.toLocaleString('es-AR'), h: 'anomalía real', color: C.red },
    { l: 'Descartadas', v: c.descartadas.toLocaleString('es-AR'), h: 'estaban bien', color: C.text },
    { l: 'Tasa de falso positivo', v: pct(c.observDescartadas, c.observRevisadas), h: `${c.observDescartadas} de ${c.observRevisadas} observaciones`, color: C.red, destacar: true },
    { l: 'Tasa de confirmación', v: pct(c.confirmadas, c.revisadas), h: `${c.confirmadas} de ${c.revisadas} revisadas`, color: C.violet },
  ]

  return (
    <div>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:12, flexWrap:'wrap' }}>
        <span style={{ fontFamily:'Syne,sans-serif', fontSize:12, fontWeight:800, letterSpacing:1.4, textTransform:'uppercase', color:C.muted }}>
          Control de imágenes IA
        </span>
        {!cargando && !error && (
          <span style={{ fontSize:11, color:C.faint }}>histórico completo</span>
        )}
        {onVerTodas && (
          <button
            onClick={onVerTodas}
            style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', color:C.yellow, fontSize:11, fontWeight:700, fontFamily:'inherit' }}
          >
            Ver bandeja →
          </button>
        )}
      </div>

      {error ? (
        <div style={{ fontSize:12, color:C.red }}>{error}</div>
      ) : cargando ? (
        <div style={{ fontSize:12, color:C.muted }}>Cargando métricas…</div>
      ) : c.analizadas === 0 ? (
        <div style={{ fontSize:12, color:C.muted }}>Todavía no hay imágenes analizadas.</div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(142px,1fr))', gap:10 }}>
          {metricas.map(m => (
            <TarjetaMetrica
              key={m.l}
              etiqueta={m.l}
              valor={m.v}
              ayuda={m.h}
              color={m.color}
              destacar={m.destacar}
              onClick={onVerTodas}
              titulo="Ir a Revisión de fotos IA"
            />
          ))}
        </div>
      )}
    </div>
  )
}
