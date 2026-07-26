'use client'

import { Fragment, useEffect } from 'react'
import L from 'leaflet'
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap } from 'react-leaflet'
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

function ControlVista({
  posiciones,
  seleccionado,
}: {
  posiciones: [number, number][]
  seleccionado: [number, number] | null
}) {
  const map = useMap()
  const posicionesKey = posiciones.map(posicion => posicion.join(',')).join('|')
  const seleccionadoKey = seleccionado?.join(',') ?? ''

  useEffect(() => {
    map.invalidateSize()
    if (seleccionado) {
      map.setView(seleccionado, Math.max(map.getZoom(), 17))
      return
    }
    if (posiciones.length === 1) {
      map.setView(posiciones[0], 17)
      return
    }
    if (posiciones.length > 1) {
      map.fitBounds(L.latLngBounds(posiciones), { padding: [36, 36], maxZoom: 18 })
    }
  }, [map, posicionesKey, seleccionadoKey])

  return null
}

export default function RondaPuntosMap({
  puntos,
  puntoSeleccionadoId,
  ajusteHabilitado,
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

  if (!centro) {
    return (
      <div className={styles.mapEmpty}>
        El mapa estará disponible cuando el objetivo o al menos un punto tenga coordenadas.
      </div>
    )
  }

  const posiciones = posicionados.map(
    punto => [punto.latitud, punto.longitud] as [number, number],
  )

  return (
    <div className={styles.mapFrame}>
      <MapContainer center={centro} zoom={17} className={styles.mapCanvas} scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ControlVista
          posiciones={posiciones}
          seleccionado={seleccionado
            ? [seleccionado.latitud, seleccionado.longitud]
            : null}
        />

        {posicionados.map(punto => {
          const estaSeleccionado = punto.id === puntoSeleccionadoId
          const puedeArrastrarse = estaSeleccionado && ajusteHabilitado

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
