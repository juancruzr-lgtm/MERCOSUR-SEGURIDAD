'use client'

// Mapa de la ubicación de UN objetivo: marcador + radio configurado.
//
// Solo lectura y de un único punto, así que no reutiliza los mapas de rondas ni
// de supervisiones: esos esperan colecciones (puntos de ronda, recorridos de
// supervisor) y traen selección, popups y capas que acá sobran. Comparte con
// ellos la base —react-leaflet, el mismo TileLayer de OpenStreetMap y `Circle`
// para el radio—, que es lo que hace que se vea igual que el resto.
//
// Leaflet necesita `window`: el consumidor lo monta con next/dynamic ssr:false.

import { useEffect } from 'react'
import L from 'leaflet'
import { Circle, MapContainer, Marker, TileLayer, useMap } from 'react-leaflet'

interface Props {
  lat: number
  lng: number
  radioMetros: number | null
  nombre: string
}

function iconoObjetivo(): L.DivIcon {
  return L.divIcon({
    className: '',
    html: '<span style="width:26px;height:26px;border-radius:999px;border:2px solid #fff;background:#f59e0b;display:block;box-shadow:0 6px 16px rgba(0,0,0,.45)"></span>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  })
}

/** Recentra cuando cambian las coordenadas (p. ej. tras actualizar ubicación). */
function Recentrar({ lat, lng }: { lat: number; lng: number }) {
  const mapa = useMap()
  useEffect(() => {
    mapa.setView([lat, lng], mapa.getZoom())
    // El contenedor arranca oculto dentro de un acordeón: sin esto Leaflet
    // calcula mal el tamaño y el mapa queda en gris.
    setTimeout(() => mapa.invalidateSize(), 0)
  }, [mapa, lat, lng])
  return null
}

export default function ObjetivoUbicacionMap({ lat, lng, radioMetros, nombre }: Props) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={17}
      style={{ height: 260, width: '100%', borderRadius: 10 }}
      scrollWheelZoom={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Recentrar lat={lat} lng={lng} />
      <Marker position={[lat, lng]} icon={iconoObjetivo()} title={nombre} />
      {radioMetros !== null && radioMetros > 0 && (
        <Circle
          center={[lat, lng]}
          radius={radioMetros}
          pathOptions={{ color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.12, weight: 2 }}
        />
      )}
    </MapContainer>
  )
}
