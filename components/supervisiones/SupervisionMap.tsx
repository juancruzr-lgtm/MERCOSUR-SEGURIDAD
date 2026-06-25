'use client'

import { useEffect, useMemo } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'

type AuditoriaGps = {
  gpsImpreciso: boolean
  distancia_objetivo_metros: number | null
  dentro_radio: boolean | null
  radio: number | null
}

type SupervisionMarker = {
  id: string
  lat: number
  lng: number
  created_at: string
  estado: string
  precision_gps: number | string
  objetivoNombre: string
  supervisorNombre: string
  googleMapsUrl: string
  auditoria: AuditoriaGps
}

type ObjetivoMarker = {
  id: string
  nombre: string
  lat: number
  lng: number
  radio_metros?: number | null
}

type Props = {
  supervisiones: SupervisionMarker[]
  objetivos: ObjetivoMarker[]
  mostrarRecorrido: boolean
  recorridoGoogleMapsUrl?: string | null
  abrirDetalle: (supervisionId: string) => void
}

const fallbackCenter: [number, number] = [-32.9442, -60.6505]

function metrosTexto(valor?: number | string | null) {
  const numero = typeof valor === 'number' ? valor : typeof valor === 'string' ? Number(valor) : NaN
  return Number.isFinite(numero) ? `${Math.round(numero).toLocaleString('es-AR')} m` : '-'
}

function fechaHora(fecha?: string | null) {
  return fecha ? new Date(fecha).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '-'
}

function iniciales(nombre: string) {
  return nombre
    .replace(',', '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(parte => parte[0])
    .join('')
    .toUpperCase() || 'S'
}

function colorSupervision(supervision: SupervisionMarker) {
  if (supervision.auditoria.gpsImpreciso) return '#f97316'
  if (supervision.auditoria.dentro_radio === false) return '#ef4444'
  if (supervision.auditoria.dentro_radio === true) return '#10b981'
  return '#a78bfa'
}

function supervisionIcon(supervision: SupervisionMarker, label: string) {
  const color = colorSupervision(supervision)
  return L.divIcon({
    className: '',
    html: `<span style="width:34px;height:34px;border-radius:999px;border:2px solid rgba(255,255,255,.95);background:${color};color:#111827;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;box-shadow:0 8px 20px rgba(0,0,0,.35);">${label}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -18],
  })
}

function objetivoIcon() {
  return L.divIcon({
    className: '',
    html: '<span style="width:24px;height:24px;border-radius:6px;border:2px solid rgba(255,255,255,.95);background:#2563eb;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;box-shadow:0 8px 20px rgba(0,0,0,.35);">O</span>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -14],
  })
}

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap()
  const key = positions.map(position => position.join(',')).join('|')

  useEffect(() => {
    if (positions.length === 0) return

    if (positions.length === 1) {
      map.setView(positions[0], 17)
      return
    }

    map.fitBounds(L.latLngBounds(positions), {
      padding: [36, 36],
      maxZoom: 18,
    })
  }, [key, map, positions])

  return null
}

export default function SupervisionMap({
  supervisiones,
  objetivos,
  mostrarRecorrido,
  recorridoGoogleMapsUrl,
  abrirDetalle,
}: Props) {
  const posicionesBounds = useMemo(
    () => [
      ...supervisiones.map(supervision => [supervision.lat, supervision.lng] as [number, number]),
      ...objetivos.map(objetivo => [objetivo.lat, objetivo.lng] as [number, number]),
    ],
    [supervisiones, objetivos],
  )
  const recorrido = useMemo(
    () => mostrarRecorrido
      ? [...supervisiones]
          .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
          .map(supervision => [supervision.lat, supervision.lng] as [number, number])
      : [],
    [mostrarRecorrido, supervisiones],
  )

  return (
    <div style={{ border:'1px solid #1e2d42', borderRadius:8, overflow:'hidden', background:'#111827', marginBottom:20 }}>
      {mostrarRecorrido && recorrido.length > 1 && recorridoGoogleMapsUrl && (
        <div style={{ display:'flex', justifyContent:'space-between', gap:12, alignItems:'center', padding:12, borderBottom:'1px solid #1e2d42' }}>
          <div style={{ color:'#cbd5e1', fontSize:13 }}>Recorrido con {recorrido.length} punto(s)</div>
          <a href={recorridoGoogleMapsUrl} target="_blank" rel="noreferrer" style={{ color:'#f59e0b', fontWeight:800, fontSize:13, textDecoration:'none' }}>
            Abrir recorrido completo en Google Maps
          </a>
        </div>
      )}

      <div style={{ height:'min(62vh, 560px)', minHeight:360, width:'100%' }}>
        <MapContainer center={posicionesBounds[0] || fallbackCenter} zoom={16} style={{ height:'100%', width:'100%' }} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds positions={posicionesBounds} />

          {recorrido.length > 1 && (
            <Polyline positions={recorrido} pathOptions={{ color:'#f59e0b', weight:4, opacity:.85 }} />
          )}

          {objetivos.map(objetivo => (
            <Marker key={`objetivo-${objetivo.id}`} position={[objetivo.lat, objetivo.lng]} icon={objetivoIcon()}>
              <Popup>
                <div style={{ minWidth:180 }}>
                  <strong>Objetivo</strong>
                  <div>{objetivo.nombre}</div>
                  <div>Radio: {metrosTexto(objetivo.radio_metros)}</div>
                </div>
              </Popup>
            </Marker>
          ))}

          {supervisiones.map((supervision, index) => {
            const label = mostrarRecorrido ? String(index + 1) : iniciales(supervision.supervisorNombre)

            return (
              <Marker key={supervision.id} position={[supervision.lat, supervision.lng]} icon={supervisionIcon(supervision, label)}>
                <Popup>
                  <div style={{ minWidth:230 }}>
                    <strong>{supervision.objetivoNombre}</strong>
                    <div style={{ marginTop:4 }}>{supervision.supervisorNombre}</div>
                    <div>Fecha/hora: {fechaHora(supervision.created_at)}</div>
                    <div>Estado: {supervision.estado}</div>
                    <div>Precisión GPS: {metrosTexto(supervision.precision_gps)}</div>
                    <div>Distancia al objetivo: {metrosTexto(supervision.auditoria.distancia_objetivo_metros)}</div>
                    <div>Dentro del radio: {supervision.auditoria.dentro_radio === null ? '-' : supervision.auditoria.dentro_radio ? 'Sí' : 'No'}</div>
                    <div>GPS impreciso: {supervision.auditoria.gpsImpreciso ? 'Sí' : 'No'}</div>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginTop:10 }}>
                      <button type="button" onClick={() => abrirDetalle(supervision.id)} style={{ border:'none', borderRadius:6, padding:'7px 10px', background:'#f59e0b', color:'#111827', fontWeight:800, cursor:'pointer' }}>
                        Ver detalle
                      </button>
                      <a href={supervision.googleMapsUrl} target="_blank" rel="noreferrer" style={{ borderRadius:6, padding:'7px 10px', background:'#1f2937', color:'#e2e8f0', fontWeight:800, textDecoration:'none' }}>
                        Abrir en Google Maps
                      </a>
                    </div>
                  </div>
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>
      </div>
    </div>
  )
}
