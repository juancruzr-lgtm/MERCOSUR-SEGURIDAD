'use client'
//
// Capa IA sobre el detalle de una ronda ya existente.
//
// No crea ninguna tabla ni concepto paralelo: lee ronda_ejecucion_puntos,
// evidencias, evidencia_analisis y ronda_punto_referencias, y traduce el
// resultado técnico a estados operativos.
//
// No cambia obligación, orden, GPS ni alertas: es una lectura.

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { brandColors, semanticColors } from '@/lib/brand-theme'
import {
  ETIQUETA_ESTADO_PUNTO, ETIQUETA_ESTADO_RONDA, ETIQUETA_FOTO, COLOR_ESTADO_RONDA,
  estadoPunto, gpsFueraRadio, leerCoincidencia, resumirRonda,
  type EntradaPunto, type EstadoPuntoIA,
} from '@/lib/ia/rondas'

const C = {
  card: '#111827', border: '#1e2d42', muted: '#64748b', text: '#e2e8f0', sub: '#94a3b8',
  yellow: brandColors.yellow ?? '#f59e0b',
  green: semanticColors.success ?? '#22c55e',
  red: semanticColors.error ?? '#ef4444',
  gris: '#64748b',
}
const PALETA = { verde: C.green, amarillo: C.yellow, rojo: C.red, gris: C.gris }

const COLOR_PUNTO: Record<EstadoPuntoIA, string> = {
  OK: C.green,
  PUNTO_FALTANTE: C.red,
  FOTO_FALTANTE: C.red,
  FOTO_NO_COINCIDE: C.yellow,
  FOTO_INSUFICIENTE: C.yellow,
  SIN_REFERENCIA: C.muted,
  PENDIENTE: C.muted,
}

const badge = (color: string, chico = false): React.CSSProperties => ({
  display: 'inline-block', padding: chico ? '1px 7px' : '2px 9px', borderRadius: 999,
  fontSize: chico ? 10 : 11, fontWeight: 700, background: color + '22', color,
})

type PuntoEntrada = {
  ejecucion_punto_id: string
  ronda_punto_id: string
  orden: number
  nombre: string
  estado: string
  requiere_foto: boolean
}

type FilaIA = EntradaPunto & { orden: number, nombre: string }

export default function RondaIAPuntos({ puntos }: { puntos: PuntoEntrada[] }) {
  const [filas, setFilas] = useState<FilaIA[]>([])
  const [cargando, setCargando] = useState(true)

  const claves = useMemo(() => puntos.map(p => p.ejecucion_punto_id).join(','), [puntos])

  useEffect(() => {
    if (puntos.length === 0) { setFilas([]); setCargando(false); return }
    let vigente = true

    ;(async () => {
      setCargando(true)
      const ejecucionPuntoIds = puntos.map(p => p.ejecucion_punto_id)
      const rondaPuntoIds = [...new Set(puntos.map(p => p.ronda_punto_id))]

      const [{ data: gps }, { data: evs }, { data: refs }] = await Promise.all([
        supabase.from('ronda_ejecucion_puntos')
          .select('id, dentro_radio').in('id', ejecucionPuntoIds),
        supabase.from('evidencias')
          .select('id, proceso_id')
          .eq('proceso_tipo', 'ronda').eq('tipo_evidencia', 'punto_control')
          .in('proceso_id', ejecucionPuntoIds),
        supabase.from('ronda_punto_referencias')
          .select('ronda_punto_id').eq('activo', true).in('ronda_punto_id', rondaPuntoIds),
      ])

      const evidencias = (evs ?? []) as any[]
      const { data: ans } = evidencias.length
        ? await supabase.from('evidencia_analisis')
            .select('evidencia_id, clasificacion_efectiva, resultado_json, analizado_at')
            .eq('estado', 'completado')
            .in('evidencia_id', evidencias.map(e => e.id))
        : { data: [] as any[] }

      const dentroRadioPorPunto = new Map((gps ?? []).map((g: any) => [g.id, g.dentro_radio]))
      const evidenciaPorPunto = new Map(evidencias.map(e => [e.proceso_id, e.id]))
      const conReferencia = new Set((refs ?? []).map((r: any) => r.ronda_punto_id))

      // Si hay varias versiones de análisis, gana la más reciente.
      const analisisPorEvidencia = new Map<string, any>()
      for (const a of (ans ?? []) as any[]) {
        const prev = analisisPorEvidencia.get(a.evidencia_id)
        if (!prev || (a.analizado_at ?? '') > (prev.analizado_at ?? '')) {
          analisisPorEvidencia.set(a.evidencia_id, a)
        }
      }

      if (!vigente) return
      setFilas(puntos.map(p => {
        const evidenciaId = evidenciaPorPunto.get(p.ejecucion_punto_id)
        const analisis = evidenciaId ? analisisPorEvidencia.get(evidenciaId) : null
        return {
          orden: p.orden,
          nombre: p.nombre,
          cumplido: p.estado === 'cumplido',
          // 'incumplido' es "pasó y algo no dio" —casi siempre el GPS—, no que
          // haya faltado. Sólo 'pendiente' y 'omitido' son ausencia real. Antes
          // se leían todos igual y la pantalla decía "Punto no registrado" sobre
          // un punto registrado a las 21:02, con foto subida.
          registrado: p.estado === 'cumplido' || p.estado === 'incumplido',
          fotoRequerida: p.requiere_foto,
          fotoRecibida: Boolean(evidenciaId),
          tieneReferencia: conReferencia.has(p.ronda_punto_id),
          clasificacion: analisis?.clasificacion_efectiva ?? null,
          coincide: analisis ? leerCoincidencia(analisis.resultado_json) : null,
          dentroRadio: dentroRadioPorPunto.get(p.ejecucion_punto_id) ?? null,
        }
      }))
      setCargando(false)
    })()

    return () => { vigente = false }
  }, [claves]) // eslint-disable-line react-hooks/exhaustive-deps

  const resumen = useMemo(() => resumirRonda(filas), [filas])

  if (cargando) return <div style={{ color: C.muted, fontSize: 12, padding: '10px 0' }}>Cargando análisis IA…</div>
  if (filas.length === 0) return null

  const colorRonda = PALETA[COLOR_ESTADO_RONDA[resumen.estado]]

  return (
    <div style={{
      border: `1px solid ${colorRonda}44`, borderRadius: 8, padding: 14,
      background: 'rgba(10,14,26,.45)', margin: '12px 0',
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <strong style={{ fontSize: 13, color: C.text }}>Evaluación visual IA</strong>
        <span style={{ ...badge(colorRonda), fontSize: 12, padding: '3px 12px' }}>
          {ETIQUETA_ESTADO_RONDA[resumen.estado]}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11, marginBottom: 14 }}>
        {([
          ['Puntos', resumen.puntosTotales, C.text],
          ['Cumplidos', resumen.cumplidos, C.green],
          ['Faltantes', resumen.faltantes, C.red],
          ['Fotos requeridas', resumen.fotosRequeridas, C.sub],
          ['Fotos recibidas', resumen.fotosRecibidas, C.green],
          ['No coinciden', resumen.fotosNoCoinciden, C.yellow],
          ['Insuficientes', resumen.fotosInsuficientes, C.yellow],
          ['GPS fuera de radio', resumen.gpsFueraRadio, C.red],
          ['Sin referencia', resumen.sinReferencia, C.muted],
        ] as const).map(([l, v, col]) => (
          <div key={l}>
            <div style={{ fontSize: 17, fontWeight: 900, color: col }}>{v}</div>
            <div style={{ color: C.muted }}>{l}</div>
          </div>
        ))}
      </div>

      {filas.map(f => {
        const e = estadoPunto(f)
        const fuera = gpsFueraRadio(f)
        return (
          <div key={`${f.orden}-${f.nombre}`} style={{
            display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center',
            padding: '8px 0', borderTop: `1px solid ${C.border}`,
          }}>
            <div style={{ flex: '1 1 150px', minWidth: 130, fontSize: 12, color: C.text, fontWeight: 700 }}>
              {f.orden}. {f.nombre}
            </div>
            <div style={{ minWidth: 110 }}>
              <span style={{ fontSize: 10, color: C.muted, marginRight: 5 }}>GPS</span>
              <span style={badge(fuera ? C.red : f.dentroRadio === null ? C.muted : C.green, true)}>
                {fuera ? 'FUERA DE RADIO' : f.dentroRadio === null ? 'sin dato' : 'OK'}
              </span>
            </div>
            <div style={{ minWidth: 130 }}>
              <span style={{ fontSize: 10, color: C.muted, marginRight: 5 }}>Foto</span>
              <span style={badge(COLOR_PUNTO[e], true)}>{ETIQUETA_FOTO[e]}</span>
            </div>
            <div style={{ minWidth: 150 }}>
              <span style={badge(fuera && e === 'OK' ? C.yellow : COLOR_PUNTO[e])}>
                {fuera && e === 'OK' ? 'Revisar' : ETIQUETA_ESTADO_PUNTO[e]}
              </span>
            </div>
          </div>
        )
      })}

      <div style={{ fontSize: 10, color: C.muted, marginTop: 12, lineHeight: 1.5 }}>
        GPS y foto son controles independientes: la IA no reemplaza al GPS. Nada de esto
        sanciona, ni modifica la obligación, el orden ni las alertas de la ronda.
      </div>
    </div>
  )
}
