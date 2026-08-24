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
 * Cuenta con `head: true`: nueve consultas de conteo, ninguna fila viaja.
 */

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { brandColors, semanticColors } from '@/lib/brand-theme'

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
    // `head: true` pide sólo el contador: no transfiere filas.
    const contar = async (aplicar: (q: any) => any) => {
      const { count, error: e } = await aplicar(
        supabase.from('evidencia_analisis').select('id', { count: 'exact', head: true }),
      )
      if (e) throw e
      return count ?? 0
    }
    const completado = (q: any) => q.eq('estado', 'completado')
    // Regla vigente de la bandeja: todo lo que no es SIN_OBSERVACIONES, más la
    // muestra de control que entra a propósito para poder detectar falsos
    // negativos. Es la misma condición que aplica AnalisisIAPanel.
    const enBandeja = (q: any) =>
      completado(q).or('clasificacion_efectiva.neq.SIN_OBSERVACIONES,en_muestra_control.is.true')
    const observacion = (q: any) =>
      completado(q).neq('clasificacion_efectiva', 'SIN_OBSERVACIONES')

    try {
      const [
        analizadas, ok, dudosas, aRevision, confirmadas, descartadas,
        observRevisadas, observDescartadas, revisadas,
      ] = await Promise.all([
        contar(completado),
        contar(q => completado(q).eq('clasificacion_efectiva', 'SIN_OBSERVACIONES')),
        contar(q => completado(q).eq('clasificacion_efectiva', 'EVIDENCIA_INSUFICIENTE')),
        contar(enBandeja),
        contar(q => completado(q).eq('revision_estado', 'INCORRECTO')),
        contar(q => completado(q).eq('revision_estado', 'CORRECTO')),
        contar(q => observacion(q).neq('revision_estado', 'PENDIENTE')),
        contar(q => observacion(q).eq('revision_estado', 'CORRECTO')),
        contar(q => completado(q).neq('revision_estado', 'PENDIENTE')),
      ])
      setC({
        analizadas, ok, dudosas, aRevision, confirmadas, descartadas,
        observRevisadas, observDescartadas, revisadas,
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
            <div
              key={m.l}
              style={{
                background: C.card,
                border: `1px solid ${m.destacar ? 'rgba(245,158,11,.34)' : C.border}`,
                borderRadius: 8,
                padding: '11px 12px',
              }}
            >
              <div style={{ fontSize:10, fontWeight:700, letterSpacing:.7, textTransform:'uppercase', color:C.muted }}>{m.l}</div>
              <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, fontSize:22, marginTop:4, letterSpacing:-.4, color:m.color, fontVariantNumeric:'tabular-nums' }}>
                {m.v}
              </div>
              <div style={{ fontSize:10.5, color:C.faint, marginTop:2 }}>{m.h}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
