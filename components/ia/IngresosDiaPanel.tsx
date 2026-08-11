'use client'
//
// Ingresos del día — una fila por fichaje, con el estado de sus dos fotos.
//
// Es un resumen de LECTURA. No modifica asistencia, horas ni liquidación, y
// ninguno de estos estados es una sanción.
//
// Sólo admin: `registros_asistencia` no tiene alcance por zona en su RLS
// (deuda conocida), así que mostrárselo a un supervisor filtraría mal.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { brandColors, brandTypography, semanticColors } from '@/lib/brand-theme'
import {
  ETIQUETA_ESTADO_INGRESO, COLOR_ESTADO_INGRESO,
  estadoIngreso, resumirIngresos,
  type EstadoFoto, type Ingreso,
} from '@/lib/ia/ingresos'

const FONT = brandTypography?.fontFamily ?? 'system-ui, sans-serif'
const C = {
  card: '#111827', border: '#1e2d42', muted: '#64748b', text: '#e2e8f0', sub: '#94a3b8',
  yellow: brandColors.yellow ?? '#f59e0b',
  green: semanticColors.success ?? '#22c55e',
  red: semanticColors.error ?? '#ef4444',
  blue: '#3b82f6',
}
const PALETA = { verde: C.green, amarillo: C.yellow, azul: C.blue, rojo: C.red }

const card = (extra: Record<string, unknown> = {}): React.CSSProperties => ({
  background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: '16px 18px', ...extra,
})
const badge = (color: string): React.CSSProperties => ({
  display: 'inline-block', padding: '2px 9px', borderRadius: 999,
  fontSize: 10, fontWeight: 700, background: color + '22', color, fontFamily: FONT,
})

type Fila = Ingreso & {
  id: string
  guardiaId: string | null
  objetivoId: string | null
  hora: string
}

const ETIQUETA_CLASIF: Record<string, string> = {
  SIN_OBSERVACIONES: 'Sin observaciones',
  REVISAR: 'Revisar',
  EVIDENCIA_INSUFICIENTE: 'Ev. insuficiente',
}

function CeldaFoto({ f }: { f: EstadoFoto }) {
  if (!f.recibida) {
    return <span style={badge(C.red)}>FALTA LA FOTO</span>
  }
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <span style={badge(C.muted)}>Recibida</span>
      {f.clasificacion
        ? <span style={badge(f.clasificacion === 'SIN_OBSERVACIONES' ? C.green
            : f.clasificacion === 'REVISAR' ? C.yellow : C.blue)}>
            {ETIQUETA_CLASIF[f.clasificacion]}
          </span>
        : <span style={badge(C.sub)}>Sin analizar</span>}
      {f.revision && f.revision !== 'PENDIENTE' && (
        <span style={badge(f.revision === 'CORRECTO' ? C.green : C.red)}>
          {f.revision}
        </span>
      )}
    </div>
  )
}

export default function IngresosDiaPanel({
  fecha, objetivos = [], guardias = [],
}: { fecha: string, objetivos?: any[], guardias?: any[] }) {
  const [filas, setFilas] = useState<Fila[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')

  const nombreObjetivo = useMemo(() => new Map(objetivos.map((o: any) => [o.id, o.nombre])), [objetivos])
  const nombreGuardia = useMemo(
    () => new Map(guardias.map((g: any) => [g.id, `${g.apellido ?? ''}, ${g.nombre ?? ''}`.replace(/^, |, $/, '')])),
    [guardias])

  const cargar = useCallback(async () => {
    setCargando(true); setError('')
    try {
      // Día en hora Argentina: de 03:00 UTC a 03:00 UTC del día siguiente.
      const desde = new Date(`${fecha}T03:00:00.000Z`)
      const hasta = new Date(desde.getTime() + 24 * 60 * 60 * 1000)

      const { data: regs, error: e1 } = await supabase
        .from('registros_asistencia')
        .select('id, guardia_id, created_at, hora_entrada_real, turno_id, turnos(objetivo_id)')
        .gte('created_at', desde.toISOString())
        .lt('created_at', hasta.toISOString())
        .order('created_at', { ascending: true })
      if (e1) throw new Error(e1.message)

      const registros = (regs ?? []) as any[]
      if (registros.length === 0) { setFilas([]); setCargando(false); return }

      const { data: evs } = await supabase
        .from('evidencias')
        .select('id, proceso_id, tipo_evidencia')
        .eq('proceso_tipo', 'ingreso')
        .in('proceso_id', registros.map(r => r.id))

      const evidencias = (evs ?? []) as any[]

      const { data: ans } = evidencias.length
        ? await supabase
            .from('evidencia_analisis')
            .select('evidencia_id, clasificacion_efectiva, revision_estado, analizado_at')
            .in('evidencia_id', evidencias.map(e => e.id))
            .eq('estado', 'completado')
        : { data: [] as any[] }

      // Si una evidencia tiene varias versiones de análisis, gana la más reciente.
      const analisisPorEvidencia = new Map<string, any>()
      for (const a of (ans ?? []) as any[]) {
        const previo = analisisPorEvidencia.get(a.evidencia_id)
        if (!previo || (a.analizado_at ?? '') > (previo.analizado_at ?? '')) {
          analisisPorEvidencia.set(a.evidencia_id, a)
        }
      }

      const evidenciaDe = (registroId: string, tipo: string) =>
        evidencias.find(e => e.proceso_id === registroId && e.tipo_evidencia === tipo)

      const estadoDe = (registroId: string, tipo: string): EstadoFoto => {
        const ev = evidenciaDe(registroId, tipo)
        if (!ev) return { recibida: false, clasificacion: null, revision: null }
        const a = analisisPorEvidencia.get(ev.id)
        return {
          recibida: true,
          clasificacion: a?.clasificacion_efectiva ?? null,
          revision: a?.revision_estado ?? 'PENDIENTE',
        }
      }

      setFilas(registros.map(r => ({
        id: r.id,
        guardiaId: r.guardia_id,
        objetivoId: Array.isArray(r.turnos) ? r.turnos[0]?.objetivo_id : r.turnos?.objetivo_id,
        hora: r.hora_entrada_real?.slice(0, 5)
          ?? new Date(r.created_at).toLocaleTimeString('es-AR', {
               hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' }),
        uniforme: estadoDe(r.id, 'uniforme'),
        libro: estadoDe(r.id, 'libro_guardia'),
      })))
    } catch (e: any) {
      setError(e.message || 'No se pudieron cargar los ingresos')
    } finally {
      setCargando(false)
    }
  }, [fecha])

  useEffect(() => { cargar() }, [cargar])

  const resumen = useMemo(() => resumirIngresos(filas), [filas])

  if (cargando) return <div style={{ color: C.muted, padding: 24 }}>Cargando ingresos…</div>
  if (error) return <div style={{ ...card({ borderColor: C.red + '66' }), color: C.red, fontSize: 13 }}>{error}</div>

  return (
    <div>
      <div style={card({ marginBottom: 14 })}>
        <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', fontSize: 12 }}>
          {([
            ['Ingresos', resumen.total, C.text],
            ['Con las dos fotos', resumen.completos, C.green],
            ['Sin uniforme', resumen.sinUniforme, C.red],
            ['Sin libro', resumen.sinLibro, C.red],
            ['Sin ninguna foto', resumen.sinNinguna, C.red],
            ['Pendientes de revisión', resumen.pendientes, C.yellow],
            ['Incorrectos confirmados', resumen.incorrectos, C.red],
          ] as const).map(([l, v, col]) => (
            <div key={l}>
              <div style={{ fontSize: 24, fontWeight: 900, color: col }}>{v}</div>
              <div style={{ color: C.muted }}>{l}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 11, color: C.muted, marginTop: 14, lineHeight: 1.5 }}>
          Resumen operativo de lectura. No modifica asistencia, horas ni liquidación, y ningún
          estado de esta pantalla constituye una sanción.
        </div>
      </div>

      {filas.length === 0
        ? <div style={{ ...card(), color: C.muted, fontSize: 13 }}>No hay ingresos registrados ese día.</div>
        : filas.map(f => {
            const estado = estadoIngreso(f)
            const color = PALETA[COLOR_ESTADO_INGRESO[estado]]
            return (
              <div key={f.id} style={card({ marginBottom: 8, padding: '12px 16px', borderColor: color + '44' })}>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ minWidth: 170, flex: '1 1 170px' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>
                      {f.guardiaId ? nombreGuardia.get(f.guardiaId) ?? '—' : '—'}
                    </div>
                    <div style={{ fontSize: 11, color: C.sub }}>
                      {f.objetivoId ? nombreObjetivo.get(f.objetivoId) ?? '—' : 'Sin objetivo'} · {f.hora}
                    </div>
                  </div>

                  <div style={{ minWidth: 190, flex: '1 1 190px' }}>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>UNIFORME</div>
                    <CeldaFoto f={f.uniforme} />
                  </div>

                  <div style={{ minWidth: 190, flex: '1 1 190px' }}>
                    <div style={{ fontSize: 10, color: C.muted, marginBottom: 3 }}>LIBRO DE GUARDIA</div>
                    <CeldaFoto f={f.libro} />
                  </div>

                  <div style={{ minWidth: 150 }}>
                    <span style={{ ...badge(color), fontSize: 11, padding: '4px 11px' }}>
                      {ETIQUETA_ESTADO_INGRESO[estado]}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
    </div>
  )
}
