'use client'

// Entrenamiento Operativo — qué se le enseña a esta persona y si sirvió.
//
// Dos listas, y la diferencia entre las dos importa:
//
//   LO QUE CORRESPONDE ENSEÑARLE   se calcula ahora, con los hechos del
//                                  período. Todavía no se le mandó nada.
//   LO QUE YA RECIBIÓ              salió de verdad, con fecha, y al lado la
//                                  comparación con cómo le fue después.
//
// El texto que se muestra acá es EXACTAMENTE el que le llega al vigilador.
// Mostrar un resumen distinto haría imposible saber qué le dijimos.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { ensenanzasDeEmpleado } from '@/lib/entrenador-datos'
import type { FuentesEntrenador } from '@/lib/entrenador-datos'
import {
  ETIQUETA_ENTRENAMIENTO, ETIQUETA_SEVERIDAD, correspondeNotificar, evolucion,
} from '@/lib/entrenador-operativo'
import type { ClaveEntrenamiento, Ensenanza, EnvioPrevio } from '@/lib/entrenador-operativo'
import type { ResultadoCumplimiento } from '@/lib/cumplimiento'

const S = {
  caja:  { background:'#0f172a', border:'1px solid #1e2d42', borderRadius:10, padding:16, marginTop:14 },
  tenue: { fontSize:11.5, color:'#94a3b8' },
  dim:   { fontSize:13, color:'#e2e8f0' },
  chip:  { fontSize:9.5, fontWeight:700, padding:'2px 7px', borderRadius:999, whiteSpace:'nowrap' as const },
  item:  { padding:'10px 0', borderBottom:'1px solid #1e2d4266' },
  texto: { fontSize:12.5, color:'#cbd5e1', lineHeight:1.55, marginTop:5,
           background:'#0b1220', border:'1px solid #1e2d42', borderRadius:8, padding:'9px 11px' },
}

const COLOR_SEVERIDAD: Record<string, string> = {
  aislada:      '#64748b',
  reincidencia: '#f59e0b',
  patron:       '#ef4444',
}

/** Una fila de `entrenamiento_operativo`, tal como vuelve de PostgREST. */
interface FilaEntrenamiento {
  id: string
  tipo: string
  dimension: string
  periodo: string
  severidad: string
  motivo: string
  texto: string
  metrica_previa: number | null
  incidencias_previas: number | null
  requeridos_previos: number | null
  notificado_at: string | null
  canal: string | null
  periodo_posterior: string | null
  metrica_posterior: number | null
}

interface Props {
  empleadoId: string
  periodo: string
  resultado: ResultadoCumplimiento
  fuentes: FuentesEntrenador
}

function Severidad({ s }: { s: string }) {
  const c = COLOR_SEVERIDAD[s] ?? '#64748b'
  return (
    <span style={{ ...S.chip, color:c, background:c + '1a', border:`1px solid ${c}55` }}>
      {ETIQUETA_SEVERIDAD[s as keyof typeof ETIQUETA_SEVERIDAD] ?? s}
    </span>
  )
}

export default function BloqueEntrenamiento({ empleadoId, periodo, resultado, fuentes }: Props) {
  const [historial, setHistorial] = useState<FilaEntrenamiento[]>([])
  const [error, setError] = useState('')

  const cargar = useCallback(async () => {
    setError('')
    const { data, error: err } = await supabase
      .from('entrenamiento_operativo')
      .select('id, tipo, dimension, periodo, severidad, motivo, texto, metrica_previa, '
        + 'incidencias_previas, requeridos_previos, notificado_at, canal, '
        + 'periodo_posterior, metrica_posterior')
      .eq('empleado_id', empleadoId)
      .order('generado_at', { ascending: false })
      .limit(50)
    // El historial no corta la pantalla: si falla, las enseñanzas calculadas se
    // muestran igual. Lo que no se puede hacer es esconder el error.
    if (err) { setError(err.message); return }
    setHistorial((data ?? []) as any[])
  }, [empleadoId])

  useEffect(() => { void cargar() }, [cargar])

  const ensenanzas = useMemo(
    () => ensenanzasDeEmpleado(periodo, resultado, fuentes),
    [periodo, resultado, fuentes],
  )

  const previos: EnvioPrevio[] = useMemo(
    () => historial
      .filter(h => h.notificado_at)
      .map(h => ({ clave: h.tipo, periodo: h.periodo, enviadoEn: h.notificado_at as string })),
    [historial],
  )

  const ahora = useMemo(() => new Date(), [])

  /**
   * Cuál se mandaría AHORA. Una sola, la más prioritaria que pase el cooldown.
   *
   * Se calcula con la misma función que usa la ruta de envío: si esta pantalla
   * dijera una y la ruta mandara otra, no habría forma de explicarle a nadie
   * por qué recibió lo que recibió.
   */
  const aMandar = useMemo(() => {
    const elegibles = ensenanzas.filter(e => correspondeNotificar(e, previos, ahora))
    return elegibles[0] ?? null
  }, [ensenanzas, previos, ahora])

  /** La nota de hoy de la dimensión de un entrenamiento, para comparar. */
  const notaActual = (dimension: string): number | null => {
    const d = resultado.dimensiones.find(x => x.clave === dimension)
    return d?.nota ?? null
  }

  const motivoNoNotifica = (e: Ensenanza): string => {
    if (e.severidad === 'aislada') {
      return 'Incidencia aislada: se ve acá y no genera aviso.'
    }
    const previo = previos.find(p => p.clave === e.clave)
    if (previo && previo.periodo === e.periodo) {
      return 'Ya recibió este entrenamiento por este período.'
    }
    if (previo) {
      return `En espera: recibió el mismo entrenamiento hace poco (cooldown de ${e.cooldownDias} días).`
    }
    return 'No corresponde en esta corrida.'
  }

  return (
    <div style={S.caja}>
      <div style={{ ...S.tenue, letterSpacing:.5, marginBottom:4 }}>ENTRENAMIENTO OPERATIVO</div>
      <div style={{ ...S.tenue, lineHeight:1.5, marginBottom:10 }}>
        Lo que el sistema le diría al vigilador para que corrija, con las mismas incidencias
        del Cumplimiento. <b>No incluye el puntaje</b>: recibe instrucciones, no una nota.
      </div>

      {error && (
        <div style={{ ...S.tenue, color:'#fca5a5', marginBottom:10 }}>
          No se pudo leer el historial de entrenamientos: {error}. Lo calculado abajo no depende de él.
        </div>
      )}

      {ensenanzas.length === 0 ? (
        <div style={S.dim}>Sin incidencias que ameriten una instrucción en este período.</div>
      ) : (
        <>
          <div style={{ ...S.tenue, letterSpacing:.5, marginTop:6, marginBottom:2 }}>
            LO QUE CORRESPONDE ENSEÑARLE
          </div>
          {ensenanzas.map(e => {
            const elegida = aMandar && aMandar.clave === e.clave
            return (
              <div key={e.clave} style={S.item}>
                <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                  <span style={{ ...S.dim, fontWeight:600 }}>
                    {ETIQUETA_ENTRENAMIENTO[e.clave as ClaveEntrenamiento] ?? e.clave}
                  </span>
                  <Severidad s={e.severidad} />
                  {elegida && (
                    <span style={{ ...S.chip, color:'#38bdf8', background:'#38bdf81a', border:'1px solid #38bdf855' }}>
                      SE MANDARÍA ESTE
                    </span>
                  )}
                </div>
                <div style={{ ...S.tenue, marginTop:3 }}>{e.motivo}</div>
                <div style={S.texto}>{e.texto}</div>
                {!elegida && (
                  <div style={{ ...S.tenue, marginTop:4, color:'#64748b' }}>
                    {motivoNoNotifica(e)}
                  </div>
                )}
              </div>
            )
          })}
          {aMandar && (
            <div style={{ ...S.tenue, marginTop:10, lineHeight:1.5 }}>
              De todo lo anterior sale <b>un solo aviso</b>. Cinco mensajes el mismo día no
              enseñan cinco cosas: enseñan a silenciar las notificaciones.
            </div>
          )}
        </>
      )}

      {historial.length > 0 && (
        <div style={{ marginTop:16 }}>
          <div style={{ ...S.tenue, letterSpacing:.5, marginBottom:2 }}>
            LO QUE YA RECIBIÓ
          </div>
          {historial.map(h => {
            const ev = evolucion(
              h.metrica_previa === null ? null : Number(h.metrica_previa),
              h.periodo === periodo ? null : notaActual(h.dimension),
            )
            const color = ev.sentido === 'mejora' ? '#10b981'
              : ev.sentido === 'empeora' ? '#ef4444' : '#94a3b8'
            return (
              <div key={h.id} style={S.item}>
                <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                  <span style={{ ...S.dim, fontWeight:600 }}>
                    {ETIQUETA_ENTRENAMIENTO[h.tipo as ClaveEntrenamiento] ?? h.tipo}
                  </span>
                  <span style={S.tenue}>{h.periodo}</span>
                  <Severidad s={h.severidad} />
                  {h.notificado_at
                    ? <span style={S.tenue}>
                        entregado {h.notificado_at.slice(8, 10)}/{h.notificado_at.slice(5, 7)}
                        {h.canal ? ` · ${h.canal}` : ''}
                      </span>
                    : <span style={{ ...S.tenue, color:'#fcd34d' }}>generado, sin entregar</span>}
                </div>
                <div style={S.texto}>{h.texto}</div>
                <div style={{ ...S.tenue, marginTop:4, color }}>{ev.texto}</div>
              </div>
            )
          })}
          <div style={{ ...S.tenue, marginTop:8, lineHeight:1.5 }}>
            La comparación es sobre la misma dimensión del mensaje, no sobre el puntaje
            general, y <b>no genera nota</b>: describe si mejoró, no lo premia ni lo castiga.
          </div>
        </div>
      )}
    </div>
  )
}
