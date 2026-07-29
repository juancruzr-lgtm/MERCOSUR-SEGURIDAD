'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import type { RondaGuardia } from '@/lib/rondas'
import {
  etiquetaPoliticaFoto,
  mensajeContextoSuspenderRonda,
  presentarIntervalo,
  suspenderRonda,
} from '@/lib/rondas'
import type { PuntoRondaMapa } from './RondaPuntosMap'

// El mapa depende de Leaflet (window), por eso se carga solo en cliente.
// Se reutiliza RondaPuntosMap en modo lectura: ajusteHabilitado={false} desactiva
// el arrastre de marcadores; la interacción de pan/zoom queda disponible.
const RondaPuntosMap = dynamic(() => import('./RondaPuntosMap'), {
  ssr: false,
  loading: () => <div style={S.mapPlaceholder}>Cargando mapa…</div>,
})

interface Props {
  ronda: RondaGuardia
  objetivoNombre: string | null
  puestoNombre: string | null
  centroObjetivo: [number, number] | null
  iniciando: boolean
  errorInicio: string | null
  onIniciar: () => void
  onCerrar: () => void
  /**
   * Avisa que la ronda quedó suspendida en el servidor. El contenedor refresca
   * su lista: sin esto seguía ofreciendo la ronda como disponible hasta el
   * refresco periódico.
   */
  onSuspendida?: () => void
}

export default function RondaGuardiaDetalle({
  ronda,
  objetivoNombre,
  puestoNombre,
  centroObjetivo,
  iniciando,
  errorInicio,
  onIniciar,
  onCerrar,
  onSuspendida,
}: Props) {
  const [puntoSeleccionadoId, setPuntoSeleccionadoId] = useState<string | null>(null)

  // Suspender: el vigilador declara que no puede hacer la ronda por una tarea.
  const [mostrarSuspender, setMostrarSuspender] = useState(false)
  const [motivoSuspender, setMotivoSuspender] = useState('')
  const [suspendiendo, setSuspendiendo] = useState(false)
  const [suspendMensaje, setSuspendMensaje] = useState<string | null>(null)
  const [suspendida, setSuspendida] = useState(false)

  const confirmarSuspension = async () => {
    if (suspendiendo || motivoSuspender.trim().length < 3) return
    setSuspendiendo(true)
    setSuspendMensaje(null)
    try {
      const { data, error } = await suspenderRonda(ronda.ronda_id, motivoSuspender)
      if (error) { setSuspendMensaje(error); return }
      const msg = data ? mensajeContextoSuspenderRonda(data.contexto) : 'No se pudo suspender la ronda.'
      if (msg) { setSuspendMensaje(msg); return }
      setSuspendida(true)   // suspendida OK: se avisó al supervisor y quedó registrada
      onSuspendida?.()
    } finally {
      setSuspendiendo(false)
    }
  }

  const puntosMapa: PuntoRondaMapa[] = ronda.puntos.map(punto => ({
    id: punto.id,
    nombre: punto.nombre,
    orden: punto.orden,
    latitud: punto.latitud,
    longitud: punto.longitud,
    radio_metros: punto.radio_metros,
    origen_posicion: punto.origen_posicion,
  }))

  const hayCoordenadas = puntosMapa.some(p => p.latitud !== null && p.longitud !== null)

  return (
    <div style={S.overlay} role="dialog" aria-modal="true">
      <div style={S.sheet}>
        <div style={S.header}>
          <div style={{ minWidth: 0 }}>
            <div style={S.titulo}>{ronda.ronda_nombre}</div>
            <div style={S.subtitulo}>
              {puestoNombre || 'Puesto'}{objetivoNombre ? ` · ${objetivoNombre}` : ''}
            </div>
          </div>
          <button type="button" onClick={onCerrar} style={S.cerrar} aria-label="Cerrar">✕</button>
        </div>

        <div style={S.meta}>
          <span>{presentarIntervalo(ronda.intervalo_minutos)}</span>
          <span>·</span>
          <span>{ronda.cantidad_puntos} punto{ronda.cantidad_puntos === 1 ? '' : 's'}</span>
          {ronda.hora_inicio && (<><span>·</span><span>Inicio {ronda.hora_inicio.slice(0, 5)}</span></>)}
        </div>

        <div style={S.body}>
          {ronda.puntos.length === 0 ? (
            <div style={S.vacio}>Esta ronda todavía no tiene puntos configurados.</div>
          ) : (
            <>
              <ol style={S.lista}>
                {ronda.puntos.map(punto => {
                  const activo = punto.id === puntoSeleccionadoId
                  return (
                    <li
                      key={punto.id}
                      style={{ ...S.item, ...(activo ? S.itemActivo : null) }}
                      onClick={() => setPuntoSeleccionadoId(activo ? null : punto.id)}
                    >
                      <div style={S.itemOrden}>{punto.orden}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={S.itemNombre}>{punto.nombre}</div>
                        <div style={S.itemFlags}>
                          {/* Se muestra la política real, no el booleano derivado:
                              'solo_novedad' se anunciaba como "Foto opcional" y
                              después bloqueaba al marcar la novedad. */}
                          <span style={{ ...S.flag, ...(
                            punto.politica_foto === 'obligatoria' ? S.flagOn
                            : punto.politica_foto === 'solo_novedad' ? S.flagWarn
                            : S.flagOff
                          ) }}>
                            📷 {etiquetaPoliticaFoto(punto.politica_foto)}
                          </span>
                          <span style={{ ...S.flag, ...(punto.requiere_gps ? S.flagOn : S.flagOff) }}>
                            {punto.requiere_gps ? '📍 GPS requerido' : '📍 GPS opcional'}
                          </span>
                          {punto.latitud === null && (
                            <span style={{ ...S.flag, ...S.flagWarn }}>Sin ubicación</span>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>

              <div style={S.mapaWrap}>
                {hayCoordenadas || centroObjetivo ? (
                  <RondaPuntosMap
                    puntos={puntosMapa}
                    puntoSeleccionadoId={puntoSeleccionadoId}
                    ajusteHabilitado={false}
                    interaccionHabilitada={true}
                    centroObjetivo={centroObjetivo}
                    onSeleccionar={setPuntoSeleccionadoId}
                    onMover={() => { /* solo lectura: el vigilador no mueve puntos */ }}
                  />
                ) : (
                  <div style={S.mapPlaceholder}>
                    Los puntos de esta ronda todavía no tienen coordenadas para mostrar en el mapa.
                  </div>
                )}
              </div>

              {errorInicio && <div style={S.errorInicio} role="alert">{errorInicio}</div>}

              {/* Tras suspender queda deshabilitado: ofrecer "Iniciar ronda"
                  debajo del aviso de suspensión se contradice con lo que el
                  vigilador acaba de declarar. Cerrar y reabrir el detalle lo
                  vuelve a habilitar. */}
              <button
                type="button"
                style={{ ...S.iniciar, ...(iniciando || suspendida ? S.iniciarOff : null) }}
                onClick={onIniciar}
                disabled={iniciando || suspendida}
              >
                {iniciando ? 'Iniciando ronda…' : 'Iniciar ronda'}
              </button>

              {suspendida ? (
                <div style={S.suspendOk} role="status">
                  Ronda suspendida. Se avisó al supervisor y quedó registrada.
                </div>
              ) : !mostrarSuspender ? (
                <button
                  type="button"
                  style={S.suspenderLink}
                  onClick={() => { setMostrarSuspender(true); setSuspendMensaje(null) }}
                  disabled={iniciando}
                >
                  No puedo hacer la ronda ahora
                </button>
              ) : (
                <div style={S.suspendBox}>
                  <label style={S.suspendLabel} htmlFor="motivo-suspender">
                    Aclará la tarea que te lo impide
                  </label>
                  <textarea
                    id="motivo-suspender"
                    style={S.suspendTextarea}
                    value={motivoSuspender}
                    onChange={e => { setMotivoSuspender(e.target.value); setSuspendMensaje(null) }}
                    rows={2}
                    placeholder="Ej.: atendiendo una emergencia en el ingreso"
                    disabled={suspendiendo}
                  />
                  {suspendMensaje && <div style={S.errorInicio} role="alert">{suspendMensaje}</div>}
                  <div style={S.suspendBotones}>
                    <button type="button" style={S.suspendCancelar} onClick={() => setMostrarSuspender(false)} disabled={suspendiendo}>
                      Cancelar
                    </button>
                    <button
                      type="button"
                      style={{ ...S.suspendConfirmar, ...(suspendiendo || motivoSuspender.trim().length < 3 ? S.iniciarOff : null) }}
                      onClick={() => void confirmarSuspension()}
                      disabled={suspendiendo || motivoSuspender.trim().length < 3}
                    >
                      {suspendiendo ? 'Suspendiendo…' : 'Suspender ronda'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(2,6,15,.72)',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  },
  sheet: {
    width: '100%', maxWidth: 560, maxHeight: '92vh', display: 'flex', flexDirection: 'column',
    background: '#0f1729', border: '1px solid #1e2d42', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    boxShadow: '0 -12px 40px rgba(0,0,0,.5)',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    padding: '16px 16px 10px', borderBottom: '1px solid #1e2d42',
  },
  titulo: { fontSize: 17, fontWeight: 800, color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  subtitulo: { fontSize: 12, color: '#94a3b8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cerrar: {
    flexShrink: 0, width: 34, height: 34, borderRadius: 999, border: '1px solid #1e2d42',
    background: '#111827', color: '#e2e8f0', fontSize: 15, cursor: 'pointer',
  },
  meta: {
    display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center',
    padding: '10px 16px', fontSize: 12, color: '#94a3b8', borderBottom: '1px solid #1e2d42',
  },
  body: { overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 16 },
  vacio: { fontSize: 13, color: '#94a3b8', textAlign: 'center', padding: '20px 8px' },
  lista: { listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 },
  item: {
    display: 'flex', gap: 12, alignItems: 'flex-start', padding: 12,
    border: '1px solid #1e2d42', borderRadius: 12, background: '#111827', cursor: 'pointer',
  },
  itemActivo: { borderColor: '#f59e0b', background: '#161d2e' },
  itemOrden: {
    flexShrink: 0, width: 28, height: 28, borderRadius: 999, background: '#1e293b', color: '#f8fafc',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13,
  },
  itemNombre: { fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 6 },
  itemFlags: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  flag: { fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999 },
  flagOn: { background: '#0b2a1c', color: '#4ade80' },
  flagOff: { background: '#1e293b', color: '#94a3b8' },
  flagWarn: { background: '#3f2d10', color: '#f59e0b' },
  mapaWrap: { borderRadius: 12, overflow: 'hidden' },
  mapPlaceholder: {
    padding: 20, fontSize: 13, color: '#94a3b8', textAlign: 'center',
    border: '1px dashed #1e2d42', borderRadius: 12, background: '#111827',
  },
  errorInicio: {
    border: '1px solid #991b1b', borderRadius: 10, background: '#3b1116',
    color: '#fecaca', padding: 10, fontSize: 12, lineHeight: 1.45,
  },
  iniciar: {
    width: '100%', border: 'none', borderRadius: 10, background: '#f59e0b',
    color: '#111827', padding: '12px 14px', fontSize: 14, fontWeight: 900, cursor: 'pointer',
  },
  iniciarOff: { background: '#334155', color: '#64748b', cursor: 'not-allowed' },
  suspenderLink: {
    marginTop: 10, width: '100%', background: 'none', border: '1px solid #1e2d42',
    color: '#94a3b8', borderRadius: 10, padding: '10px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  suspendBox: {
    marginTop: 10, border: '1px solid #1e2d42', borderRadius: 10, background: '#0f172a', padding: 12,
  },
  suspendLabel: { display: 'block', fontSize: 12, color: '#94a3b8', fontWeight: 700, marginBottom: 6 },
  suspendTextarea: {
    width: '100%', background: '#0b1220', color: '#e2e8f0', border: '1px solid #1e2d42',
    borderRadius: 8, padding: 10, fontSize: 13, fontFamily: 'inherit', resize: 'vertical',
  },
  suspendBotones: { display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 },
  suspendCancelar: {
    border: '1px solid #1e2d42', background: '#111827', color: '#e2e8f0',
    borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
  },
  suspendConfirmar: {
    border: 'none', background: '#b45309', color: '#fffbeb',
    borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 800, cursor: 'pointer',
  },
  suspendOk: {
    marginTop: 10, fontSize: 13, color: '#fbbf24', background: '#3f2d10',
    border: '1px solid #b45309', borderRadius: 10, padding: 12,
  },
}
