'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  obtenerRondasGuardiaActual,
  calcularEstadoTemporalRonda,
  presentarIntervalo,
  type RondasGuardiaActual,
  type RondaGuardia,
  type EstadoTemporalRonda,
} from '@/lib/rondas'
import RondaGuardiaDetalle from './RondaGuardiaDetalle'

interface ObjetivoGeo {
  id: string
  lat?: number | null
  lng?: number | null
}

interface Props {
  // Objetivos ya cargados por GuardiaMobile (incluyen lat/lng): se usan solo para
  // centrar el mapa del detalle cuando los puntos no tienen coordenadas propias.
  objetivos: ObjetivoGeo[]
  // Hora reactiva provista por GuardiaMobile (se actualiza periódicamente).
  ahora: Date
}

// Refresco del turno vigente desde el servidor. El estado temporal por ronda se
// recalcula en cada render con `ahora` (barato); esto solo re-consulta la RPC.
const REFRESCO_MS = 60_000

const ESTADO_META: Record<EstadoTemporalRonda, { texto: string; fondo: string; texto_color: string }> = {
  disponible:    { texto: 'Disponible',               fondo: '#16a34a', texto_color: '#f0fdf4' },
  proxima:       { texto: 'Próxima',                  fondo: '#2563eb', texto_color: '#eff6ff' },
  fuera_horario: { texto: 'Fuera de horario',         fondo: '#b45309', texto_color: '#fffbeb' },
  sin_horario:   { texto: 'Sin configuración horaria', fondo: '#334155', texto_color: '#e2e8f0' },
}

export default function RondasGuardiaPanel({ objetivos, ahora }: Props) {
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<RondasGuardiaActual | null>(null)
  const [rondaAbierta, setRondaAbierta] = useState<RondaGuardia | null>(null)

  const cargar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCargando(true)
    const { data: resultado, error: errorRpc } = await obtenerRondasGuardiaActual()
    if (errorRpc) {
      setError(errorRpc)
      setData(null)
    } else {
      setError(null)
      setData(resultado)
    }
    setCargando(false)
  }, [])

  useEffect(() => {
    let activo = true
    void cargar()
    const timer = window.setInterval(() => { if (activo) void cargar(true) }, REFRESCO_MS)
    return () => { activo = false; window.clearInterval(timer) }
  }, [cargar])

  const centroObjetivo = (objetivoId: string | null): [number, number] | null => {
    if (!objetivoId) return null
    const obj = objetivos.find(o => o.id === objetivoId)
    if (obj?.lat == null || obj?.lng == null) return null
    return [obj.lat, obj.lng]
  }

  return (
    <section style={S.wrap} aria-label="Rondas del puesto">
      <div style={S.header}>
        <div style={S.headerTitulo}>Rondas del puesto</div>
        <button
          type="button"
          onClick={() => void cargar()}
          disabled={cargando}
          style={S.refrescar}
          aria-label="Actualizar rondas"
        >
          {cargando ? '…' : '↻'}
        </button>
      </div>

      {cargando && !data && (
        <div style={S.notaCard}>
          <span style={S.notaMuted}>Cargando rondas del puesto…</span>
        </div>
      )}

      {!cargando && error && (
        <div style={{ ...S.notaCard, borderColor: '#7f1d1d', background: '#1a1113' }}>
          <div style={{ color: '#fca5a5', fontWeight: 700, fontSize: 13 }}>No se pudieron cargar las rondas</div>
          <div style={{ color: '#f8b4b4', fontSize: 12, marginTop: 4 }}>{error}</div>
          <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 6 }}>El detalle técnico quedó registrado en la consola.</div>
        </div>
      )}

      {!cargando && !error && data && (
        <>
          {data.contexto === 'sin_usuario' && (
            <div style={S.notaCard}><span style={S.notaMuted}>No se pudo identificar tu usuario operativo.</span></div>
          )}

          {data.contexto === 'sin_turno_vigente' && (
            <div style={S.notaCard}>
              <span style={S.notaMuted}>No tenés un turno vigente en este momento. Las rondas aparecen automáticamente durante tu turno.</span>
            </div>
          )}

          {data.contexto === 'turno_sin_puesto' && (
            <div style={S.notaCard}>
              <span style={S.notaMuted}>Tu turno vigente no tiene un puesto asignado, por lo que no hay rondas para mostrar. Avisá a tu supervisor.</span>
            </div>
          )}

          {data.contexto === 'puesto_sin_rondas' && (
            <div style={S.notaCard}>
              <div style={{ fontSize: 13, color: '#e2e8f0', fontWeight: 600 }}>
                {data.puesto_nombre || 'Puesto'}{data.objetivo_nombre ? ` · ${data.objetivo_nombre}` : ''}
              </div>
              <span style={{ ...S.notaMuted, marginTop: 4, display: 'block' }}>
                Este puesto no tiene rondas activas configuradas.
              </span>
            </div>
          )}

          {data.contexto === 'ok' && (
            <>
              <div style={S.contexto}>
                {data.puesto_nombre || 'Puesto'}{data.objetivo_nombre ? ` · ${data.objetivo_nombre}` : ''}
              </div>
              <div style={S.lista}>
                {data.rondas.map(ronda => {
                  const estado = calcularEstadoTemporalRonda(ronda.hora_inicio, ahora)
                  const meta = ESTADO_META[estado]
                  const sinPuntos = ronda.cantidad_puntos === 0
                  return (
                    <div key={ronda.ronda_id} style={S.card}>
                      <div style={S.cardTop}>
                        <div style={S.cardNombre}>{ronda.ronda_nombre}</div>
                        <span style={{ ...S.badge, background: meta.fondo, color: meta.texto_color }}>
                          {meta.texto}
                        </span>
                      </div>

                      <div style={S.datos}>
                        <div style={S.dato}>
                          <span style={S.datoLabel}>Inicio</span>
                          <span style={S.datoValor}>{ronda.hora_inicio ? ronda.hora_inicio.slice(0, 5) : 'Sin horario'}</span>
                        </div>
                        <div style={S.dato}>
                          <span style={S.datoLabel}>Frecuencia</span>
                          <span style={S.datoValor}>{presentarIntervalo(ronda.intervalo_minutos)}</span>
                        </div>
                        <div style={S.dato}>
                          <span style={S.datoLabel}>Puntos</span>
                          <span style={S.datoValor}>{ronda.cantidad_puntos}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        style={{ ...S.verBtn, ...(sinPuntos ? S.verBtnOff : null) }}
                        onClick={() => setRondaAbierta(ronda)}
                        disabled={sinPuntos}
                      >
                        {sinPuntos ? 'Sin puntos para recorrer' : 'Ver recorrido'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      {rondaAbierta && data && (
        <RondaGuardiaDetalle
          ronda={rondaAbierta}
          objetivoNombre={data.objetivo_nombre}
          puestoNombre={data.puesto_nombre}
          centroObjetivo={centroObjetivo(data.objetivo_id)}
          onCerrar={() => setRondaAbierta(null)}
        />
      )}
    </section>
  )
}

const S: Record<string, React.CSSProperties> = {
  wrap: { marginTop: 8, marginBottom: 8 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, padding: '0 2px' },
  headerTitulo: { fontSize: 15, fontWeight: 800, color: '#f8fafc' },
  refrescar: {
    width: 30, height: 30, borderRadius: 999, border: '1px solid #1e2d42',
    background: '#111827', color: '#e2e8f0', fontSize: 15, cursor: 'pointer',
  },
  notaCard: {
    border: '1px solid #1e2d42', borderRadius: 12, background: '#111827', padding: 14,
  },
  notaMuted: { fontSize: 13, color: '#94a3b8', lineHeight: 1.5 },
  contexto: { fontSize: 12, color: '#94a3b8', marginBottom: 8, padding: '0 2px' },
  lista: { display: 'flex', flexDirection: 'column', gap: 10 },
  card: { border: '1px solid #1e2d42', borderRadius: 12, background: '#111827', padding: 14 },
  cardTop: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 12 },
  cardNombre: { fontSize: 15, fontWeight: 800, color: '#f8fafc', minWidth: 0 },
  badge: { flexShrink: 0, fontSize: 11, fontWeight: 800, padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap' },
  datos: { display: 'flex', gap: 8, marginBottom: 12 },
  dato: { flex: 1, background: '#0f1729', border: '1px solid #1a2436', borderRadius: 8, padding: '8px 10px' },
  datoLabel: { display: 'block', fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  datoValor: { display: 'block', fontSize: 13, fontWeight: 700, color: '#e2e8f0' },
  verBtn: {
    width: '100%', padding: '11px 12px', borderRadius: 10, border: 'none',
    background: '#f59e0b', color: '#111827', fontWeight: 800, fontSize: 14, cursor: 'pointer',
  },
  verBtnOff: { background: '#1e293b', color: '#64748b', cursor: 'not-allowed' },
}
