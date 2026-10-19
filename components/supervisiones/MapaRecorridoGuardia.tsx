'use client'

/**
 * components/supervisiones/MapaRecorridoGuardia.tsx
 *
 * Recorrido de una guardia de supervisor sobre el mapa (Leaflet + OSM, igual
 * que SupervisionMap). Se carga con dynamic(..., { ssr:false }).
 *
 * Lo que se dibuja como línea es SÓLO lo que tiene evidencia: tramos entre
 * puntos GPS registrados con pocos minutos entre sí (tramosConEvidencia). Un
 * hueco sin puntos queda sin línea; los puntos aislados o imprecisos se
 * muestran como puntos. No se traza nada entre supervisiones: eso sería
 * inventar el trayecto.
 */

import { useEffect, useMemo } from 'react'
import L from 'leaflet'
import { CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import { tramosConEvidencia, type PuntoRecorrido, type SupervisionLegajo } from '@/lib/legajo-supervisor'
import { formatFechaHora } from '@/lib/formato'

const centroPorDefecto: [number, number] = [-32.9442, -60.6505]

function iconoSupervision(n: number) {
  return L.divIcon({
    className: '',
    html: `<span style="width:28px;height:28px;border-radius:999px;border:2px solid #fff;background:#10b981;color:#111827;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;box-shadow:0 6px 16px rgba(0,0,0,.35);">${n}</span>`,
    iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14],
  })
}

function Encuadre({ posiciones }: { posiciones: [number, number][] }) {
  const map = useMap()
  const clave = posiciones.length ? `${posiciones.length}:${posiciones[0].join(',')}:${posiciones[posiciones.length - 1].join(',')}` : ''
  useEffect(() => {
    if (posiciones.length === 0) return
    if (posiciones.length === 1) { map.setView(posiciones[0], 16); return }
    map.fitBounds(L.latLngBounds(posiciones), { padding: [30, 30], maxZoom: 17 })
  }, [clave]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
}

export default function MapaRecorridoGuardia({ puntos, supervisiones }: {
  puntos: PuntoRecorrido[]
  supervisiones: SupervisionLegajo[]
}) {
  const { tramos, sueltos, cortes } = useMemo(() => tramosConEvidencia(puntos), [puntos])
  const conGps = useMemo(
    () => supervisiones.filter(s => s.lat !== null && s.lng !== null)
      .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [supervisiones],
  )
  const posiciones = useMemo<[number, number][]>(
    () => [...tramos.flat(), ...sueltos, ...conGps.map(s => [s.lat as number, s.lng as number] as [number, number])],
    [tramos, sueltos, conGps],
  )

  return (
    <div style={{ border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '8px 12px', fontSize: 12, color: '#94a3b8', display: 'flex', gap: 14, flexWrap: 'wrap', background: '#0f172a' }}>
        <span><span style={{ color: '#f59e0b', fontWeight: 800 }}>━</span> Recorrido registrado por GPS ({tramos.length} tramo{tramos.length === 1 ? '' : 's'})</span>
        <span><span style={{ color: '#f59e0b' }}>●</span> Punto GPS suelto o impreciso ({sueltos.length})</span>
        <span><span style={{ color: '#10b981' }}>●</span> Supervisión ({conGps.length})</span>
        {cortes > 0 && <span>Sin línea donde no hay puntos GPS: {cortes} hueco{cortes === 1 ? '' : 's'} sin evidencia del trayecto.</span>}
        {puntos.length === 0 && <span style={{ color: '#fca5a5' }}>La app no registró puntos GPS en esta guardia: sólo se muestran las supervisiones.</span>}
      </div>
      <div style={{ height: 'min(58vh, 520px)', minHeight: 320 }}>
        <MapContainer center={posiciones[0] ?? centroPorDefecto} zoom={14} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
          <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                     url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <Encuadre posiciones={posiciones} />
          {tramos.map((t, i) => (
            <Polyline key={`t${i}`} positions={t} pathOptions={{ color: '#f59e0b', weight: 4, opacity: 0.85 }} />
          ))}
          {sueltos.map((p, i) => (
            <CircleMarker key={`s${i}`} center={p} radius={3} pathOptions={{ color: '#f59e0b', fillOpacity: 0.8, weight: 1 }} />
          ))}
          {conGps.map((s, i) => (
            <Marker key={s.supervision_id} position={[s.lat as number, s.lng as number]} icon={iconoSupervision(i + 1)}>
              <Popup>
                <div style={{ minWidth: 200 }}>
                  <strong>{s.objetivo ?? 'Objetivo'}</strong>
                  <div>{formatFechaHora(s.created_at)}</div>
                  <div>Estado: {s.estado}</div>
                  <div>Distancia al objetivo: {s.distancia_objetivo_m === null ? '—' : `${s.distancia_objetivo_m} m`}</div>
                  {s.observaciones && <div style={{ marginTop: 4 }}>{s.observaciones}</div>}
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  )
}
