'use client'

import { Fragment, useEffect } from 'react'
import L from 'leaflet'
import { Circle, LayersControl, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import type { OrigenPosicion } from '@/lib/rondas'
import styles from './Rondas.module.css'

export interface PuntoRondaMapa {
  id: string
  nombre: string
  orden: number
  latitud: number | null
  longitud: number | null
  radio_metros: number | null
  origen_posicion: OrigenPosicion
}

interface Props {
  puntos: PuntoRondaMapa[]
  puntoSeleccionadoId: string | null
  ajusteHabilitado: boolean
  /** Un toque/click en el mapa ubica el punto que se está editando. */
  colocarHabilitado?: boolean
  interaccionHabilitada: boolean
  centroObjetivo?: [number, number] | null
  onSeleccionar: (puntoId: string) => void
  onMover: (latitud: number, longitud: number) => void
}

function etiquetaOrigen(punto: PuntoRondaMapa): string {
  if (punto.latitud === null || punto.longitud === null) return 'Sin posicionar'
  if (punto.origen_posicion === 'gps') return 'Posición GPS'
  if (punto.origen_posicion === 'manual') return 'Posición manual'
  return 'Origen no registrado'
}

function colorOrigen(punto: PuntoRondaMapa): string {
  if (punto.origen_posicion === 'gps') return '#2563eb'
  if (punto.origen_posicion === 'manual') return '#d97706'
  return '#64748b'
}

function iconoPunto(punto: PuntoRondaMapa, seleccionado: boolean): L.DivIcon {
  const anillo = seleccionado
    ? 'box-shadow:0 0 0 4px rgba(255,255,255,.9),0 8px 20px rgba(0,0,0,.5);'
    : 'box-shadow:0 6px 16px rgba(0,0,0,.4);'

  return L.divIcon({
    className: '',
    html: `<span style="width:34px;height:34px;border-radius:999px;border:2px solid #fff;background:${colorOrigen(punto)};color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:900;${anillo}">${punto.orden}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -20],
  })
}

// Sin objetivo ni puntos con coordenadas: igual se muestra el mapa (vista de
// Argentina) para poder buscar/tocar y ubicar el primer punto.
const CENTRO_POR_DEFECTO: [number, number] = [-34.6, -63.6]

function ColocarConClick({ onColocar }: { onColocar: (lat: number, lng: number) => void }) {
  useMapEvents({
    click: evento => onColocar(evento.latlng.lat, evento.latlng.lng),
  })
  return null
}

function ControlVista({
  posiciones,
  seleccionado,
  seleccionadoId,
  estructuraKey,
}: {
  posiciones: [number, number][]
  seleccionado: [number, number] | null
  seleccionadoId: string | null
  estructuraKey: string
}) {
  const map = useMap()
  const seleccionadoKey = seleccionado ? `${seleccionado[0]},${seleccionado[1]}` : ''

  useEffect(() => {
    map.invalidateSize()
    if (seleccionado) {
      // Si el punto ya está a la vista (p. ej. recién tocado en el mapa) no se
      // mueve la cámara; si vino de una búsqueda, se centra en él.
      const visible = map.getBounds().pad(-0.1).contains(seleccionado)
      if (!visible || map.getZoom() < 15) {
        map.setView(seleccionado, Math.max(map.getZoom(), 17))
      }
    }
  }, [map, seleccionadoId, seleccionadoKey])

  useEffect(() => {
    map.invalidateSize()
    if (seleccionado) return
    if (posiciones.length === 1) {
      map.setView(posiciones[0], 17)
      return
    }
    if (posiciones.length > 1) {
      map.fitBounds(L.latLngBounds(posiciones), { padding: [36, 36], maxZoom: 18 })
    }
  }, [map, estructuraKey])

  return null
}

export default function RondaPuntosMap({
  puntos,
  puntoSeleccionadoId,
  ajusteHabilitado,
  colocarHabilitado = false,
  interaccionHabilitada,
  centroObjetivo,
  onSeleccionar,
  onMover,
}: Props) {
  const posicionados = puntos.filter(
    (punto): punto is PuntoRondaMapa & { latitud: number; longitud: number } =>
      punto.latitud !== null && punto.longitud !== null,
  )
  const seleccionado = posicionados.find(punto => punto.id === puntoSeleccionadoId) ?? null
  const centro = seleccionado
    ? [seleccionado.latitud, seleccionado.longitud] as [number, number]
    : posicionados.length > 0
      ? [posicionados[0].latitud, posicionados[0].longitud] as [number, number]
      : centroObjetivo ?? null
  const zoomInicial = centro ? 17 : 5

  const posiciones = posicionados.map(
    punto => [punto.latitud, punto.longitud] as [number, number],
  )

  return (
    <div className={styles.mapFrame}>
      <MapContainer
        center={centro ?? CENTRO_POR_DEFECTO}
        zoom={zoomInicial}
        className={styles.mapCanvas}
        style={colocarHabilitado && interaccionHabilitada ? { cursor: 'crosshair' } : undefined}
        dragging={interaccionHabilitada}
        touchZoom={interaccionHabilitada}
        doubleClickZoom={interaccionHabilitada}
        scrollWheelZoom={interaccionHabilitada}
        boxZoom={interaccionHabilitada}
        keyboard={interaccionHabilitada}
      >
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Mapa">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Satélite">
            <TileLayer
              attribution="Imágenes &copy; Esri"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              maxZoom={19}
            />
          </LayersControl.BaseLayer>
        </LayersControl>
        {colocarHabilitado && interaccionHabilitada && <ColocarConClick onColocar={onMover} />}
        <ControlVista
          posiciones={posiciones}
          seleccionado={seleccionado
            ? [seleccionado.latitud, seleccionado.longitud]
            : null}
          seleccionadoId={puntoSeleccionadoId}
          estructuraKey={puntos.map(punto => `${punto.id}:${punto.orden}`).join('|')}
        />

        {posicionados.map(punto => {
          const estaSeleccionado = punto.id === puntoSeleccionadoId
          const puedeArrastrarse = estaSeleccionado && ajusteHabilitado && interaccionHabilitada

          return (
            <Fragment key={punto.id}>
              {punto.radio_metros !== null && (
                <Circle
                  center={[punto.latitud, punto.longitud]}
                  radius={punto.radio_metros}
                  pathOptions={{
                    color: colorOrigen(punto),
                    fillColor: colorOrigen(punto),
                    fillOpacity: estaSeleccionado ? 0.12 : 0.05,
                    weight: estaSeleccionado ? 2 : 1,
                    dashArray: '6 4',
                  }}
                />
              )}
              <Marker
                position={[punto.latitud, punto.longitud]}
                icon={iconoPunto(punto, estaSeleccionado)}
                draggable={puedeArrastrarse}
                eventHandlers={{
                  click: () => onSeleccionar(punto.id),
                  dragend: evento => {
                    if (!puedeArrastrarse) return
                    const marcador = evento.target as L.Marker
                    const posicion = marcador.getLatLng()
                    onMover(posicion.lat, posicion.lng)
                  },
                }}
              >
                <Popup>
                  <div className={styles.mapPopup}>
                    <strong>#{punto.orden} · {punto.nombre}</strong>
                    <span>{etiquetaOrigen(punto)}</span>
                    <span>Radio: {punto.radio_metros === null ? 'Sin definir' : `${punto.radio_metros} m`}</span>
                    {puedeArrastrarse && <span>Marcador habilitado para ajuste manual.</span>}
                  </div>
                </Popup>
              </Marker>
            </Fragment>
          )
        })}
      </MapContainer>
    </div>
  )
}
