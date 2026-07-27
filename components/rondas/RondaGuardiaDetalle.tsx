'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import type { RondaGuardia } from '@/lib/rondas'
import { presentarIntervalo } from '@/lib/rondas'
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
  onCerrar: () => void
}

export default function RondaGuardiaDetalle({
  ronda,
  objetivoNombre,
  puestoNombre,
  centroObjetivo,
  onCerrar,
}: Props) {
  const [puntoSeleccionadoId, setPuntoSeleccionadoId] = useState<string | null>(null)

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
                          <span style={{ ...S.flag, ...(punto.requiere_foto ? S.flagOn : S.flagOff) }}>
                            {punto.requiere_foto ? '📷 Foto requerida' : '📷 Foto opcional'}
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
}
