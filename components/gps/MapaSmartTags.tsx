'use client'

/**
 * Mapa de Smart Tags (HTAG / Find Hub). Separado del Mapa Operativo a propósito:
 * acá sólo hay posiciones de Smart Tag, nunca GPS de teléfonos.
 *
 * Identidad visual propia: rombo violeta con "T" (los teléfonos y fichajes usan
 * círculos). Las uniones entre detecciones son líneas punteadas y se rotulan
 * como CONEXIÓN APROXIMADA: no es un recorrido real comprobado.
 */
import L from 'leaflet'
import { useEffect } from 'react'
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import { formatFechaHora } from '@/lib/formato'
import type { TramoAproximado } from '@/lib/gps-vehiculos/posiciones'

export interface MarcadorTag {
  id: string
  lat: number
  lng: number
  titulo: string
  horaUbicacion: string
  horaConsulta: string
  simulado: boolean
  antigua: boolean
}

function iconoTag(simulado: boolean, antigua: boolean): L.DivIcon {
  const fondo = simulado ? '#64748b' : antigua ? '#7c3aed80' : '#7c3aed'
  return L.divIcon({
    className: '',
    html: `<span style="width:20px;height:20px;transform:rotate(45deg);display:flex;align-items:center;justify-content:center;background:${fondo};border:2px ${simulado ? 'dashed' : 'solid'} #f5f3ff;box-shadow:0 3px 10px rgba(0,0,0,.45)"><b style="transform:rotate(-45deg);font-size:9px;color:#fff">T</b></span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -12],
  })
}

function Encuadre({ puntos }: { puntos: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (puntos.length === 1) map.setView(puntos[0], 15)
    else if (puntos.length > 1) map.fitBounds(L.latLngBounds(puntos), { padding: [30, 30] })
  }, [map, puntos])
  return null
}

export default function MapaSmartTags({ marcadores, tramos, altura = 380 }: {
  marcadores: MarcadorTag[]
  tramos: TramoAproximado[]
  altura?: number | string
}) {
  const puntos = marcadores.map(m => [m.lat, m.lng] as [number, number])
  return (
    <MapContainer center={[-34.6037, -58.3816]} zoom={11} style={{ height: altura, width: '100%', borderRadius: 8 }}>
      <TileLayer attribution='&copy; OpenStreetMap' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Encuadre puntos={puntos} />
      {tramos.map((t, i) => (
        <Polyline key={i} positions={t.puntos.map(p => [p.lat, p.lng] as [number, number])}
          pathOptions={{ color: '#a78bfa', weight: 2, dashArray: '6 8', opacity: 0.8 }}>
          <Popup>Conexión aproximada entre detecciones. No es el recorrido real.</Popup>
        </Polyline>
      ))}
      {marcadores.map(m => (
        <Marker key={m.id} position={[m.lat, m.lng]} icon={iconoTag(m.simulado, m.antigua)}>
          <Popup>
            <b>{m.titulo}</b>{m.simulado && <> · <b>SIMULADO</b></>}<br />
            Smart Tag (Find Hub) — no es GPS continuo<br />
            Detectado: {formatFechaHora(m.horaUbicacion)}<br />
            Consultado: {formatFechaHora(m.horaConsulta)}
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  )
}
