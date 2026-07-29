'use client'

// Etapa 3.3 · B6 — Mapa de rondas de UN objetivo, SOLO LECTURA (supervisión).
// Muestra, por punto: posición configurada (+ círculo de radio) y, cuando se
// selecciona una ejecución, la posición GPS real, la línea de diferencia y la
// distancia. No permite arrastrar, editar ni guardar. Componente nuevo: no toca
// RondaPuntosMap (usado por la configuración y por el detalle del vigilador).

import { Fragment, useEffect } from 'react'
import L from 'leaflet'
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'

export interface PuntoMapaSupervision {
  id: string
  orden: number
  nombre: string
  // Posición configurada (siempre presente para poder ubicarlo).
  config_lat: number
  config_lng: number
  config_radio: number | null
  // GPS real registrado (solo cuando se mira una ejecución y el punto se registró).
  real_lat: number | null
  real_lng: number | null
  distancia: number | null
  dentro_radio: boolean | null
  gps_ok: boolean | null
  estado: string | null
}

interface Props {
  puntos: PuntoMapaSupervision[]
  seleccionadoId: string | null
  onSeleccionar: (id: string) => void
  centroObjetivo?: [number, number] | null
}

const FALLBACK_CENTER: [number, number] = [-32.9442, -60.6505]
const COLOR_CONFIG = '#3b82f6'

function colorReal(p: PuntoMapaSupervision): string {
  if (p.dentro_radio === true) return '#22c55e'
  if (p.dentro_radio === false) return '#ef4444'
  return '#f59e0b' // registrado sin veredicto de radio (o gps no ok)
}

function iconoConfig(orden: number, sel: boolean): L.DivIcon {
  const anillo = sel
    ? 'box-shadow:0 0 0 3px rgba(255,255,255,.9),0 6px 16px rgba(0,0,0,.5);'
    : 'box-shadow:0 4px 12px rgba(0,0,0,.4);'
  return L.divIcon({
    className: '',
    // Cuadrado = posición configurada.
    html: `<span style="width:28px;height:28px;border-radius:6px;border:2px solid #fff;background:${COLOR_CONFIG};color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;${anillo}">${orden}</span>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16],
  })
}

function iconoReal(color: string, orden: number, sel: boolean): L.DivIcon {
  const anillo = sel
    ? 'box-shadow:0 0 0 3px rgba(255,255,255,.9),0 6px 16px rgba(0,0,0,.5);'
    : 'box-shadow:0 4px 12px rgba(0,0,0,.4);'
  return L.divIcon({
    className: '',
    // Círculo = posición GPS real.
    html: `<span style="width:26px;height:26px;border-radius:999px;border:2px solid #fff;background:${color};color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;${anillo}">${orden}</span>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14],
  })
}

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap()
  const key = positions.map(p => p.join(',')).join('|')
  useEffect(() => {
    map.invalidateSize()
    if (positions.length === 0) return
    if (positions.length === 1) { map.setView(positions[0], 17); return }
    map.fitBounds(L.latLngBounds(positions), { padding: [36, 36], maxZoom: 18 })
  }, [key, map, positions])
  return null
}

export default function RondaEjecucionMapa({ puntos, seleccionadoId, onSeleccionar, centroObjetivo }: Props) {
  // Defensivo: solo puntos con posición configurada válida.
  const ubicables = puntos.filter(
    p => Number.isFinite(p.config_lat) && Number.isFinite(p.config_lng),
  )

  const positions: [number, number][] = []
  ubicables.forEach(p => {
    positions.push([p.config_lat, p.config_lng])
    if (p.real_lat !== null && p.real_lng !== null) positions.push([p.real_lat, p.real_lng])
  })

  const centro = positions[0] ?? centroObjetivo ?? null
  if (!centro) {
    return <div style={S.empty}>No hay coordenadas para mostrar en el mapa.</div>
  }

  return (
    <div style={S.frame}>
      <MapContainer center={centro} zoom={17} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds positions={positions} />

        {ubicables.map(p => {
          const sel = p.id === seleccionadoId
          const tieneReal = p.real_lat !== null && p.real_lng !== null
          return (
            <Fragment key={p.id}>
              {p.config_radio !== null && (
                <Circle
                  center={[p.config_lat, p.config_lng]}
                  radius={p.config_radio}
                  pathOptions={{
                    color: COLOR_CONFIG, fillColor: COLOR_CONFIG,
                    fillOpacity: sel ? 0.12 : 0.05, weight: sel ? 2 : 1, dashArray: '6 4',
                  }}
                />
              )}

              {tieneReal && (
                <Polyline
                  positions={[[p.config_lat, p.config_lng], [p.real_lat as number, p.real_lng as number]]}
                  pathOptions={{ color: '#94a3b8', weight: 2, dashArray: '4 4' }}
                />
              )}

              <Marker
                position={[p.config_lat, p.config_lng]}
                icon={iconoConfig(p.orden, sel)}
                eventHandlers={{ click: () => onSeleccionar(p.id) }}
              >
                <Popup>
                  <div style={{ minWidth: 180 }}>
                    <strong>#{p.orden} · {p.nombre}</strong>
                    <div>Posición configurada</div>
                    <div>Radio: {p.config_radio !== null ? `${p.config_radio} m` : 'Sin definir'}</div>
                  </div>
                </Popup>
              </Marker>

              {tieneReal && (
                <Marker
                  position={[p.real_lat as number, p.real_lng as number]}
                  icon={iconoReal(colorReal(p), p.orden, sel)}
                  eventHandlers={{ click: () => onSeleccionar(p.id) }}
                >
                  <Popup>
                    <div style={{ minWidth: 180 }}>
                      <strong>#{p.orden} · {p.nombre}</strong>
                      <div>GPS real registrado</div>
                      <div>Distancia: {p.distancia !== null ? `${p.distancia} m` : '—'}</div>
                      <div>Dentro del radio: {p.dentro_radio === null ? '—' : p.dentro_radio ? 'Sí' : 'No'}</div>
                      {p.estado ? <div>Estado: {p.estado}</div> : null}
                    </div>
                  </Popup>
                </Marker>
              )}
            </Fragment>
          )
        })}
      </MapContainer>
    </div>
  )
}

const S: Record<string, React.CSSProperties> = {
  frame: {
    border: '1px solid #1e2d42', borderRadius: 10, overflow: 'hidden', background: '#0f172a',
    height: 'min(60vh, 520px)', minHeight: 340, width: '100%',
  },
  empty: {
    border: '1px dashed #1e2d42', borderRadius: 10, background: '#0f172a',
    padding: 20, fontSize: 13, color: '#94a3b8', textAlign: 'center',
  },
}
