'use client'

//
// Mapa operativo multi-capa.
//
// Era `components/asistencia/AsistenciaMap.tsx`; se promovió acá porque ahora lo
// consumen dos pantallas: el Mapa CGO de Asistencia y la Página GPS.
// `components/asistencia/AsistenciaMap.tsx` quedó como re-export para no tocar
// el import de AppClient.
//
// Sigue siendo un componente de PRESENTACIÓN: no consulta Supabase, no calcula
// distancias y no decide nada operativo. Recibe arrays ya armados y dibuja.
//
// Todo lo agregado para la Página GPS (puntos de ronda, marcaciones históricas,
// callbacks de selección) es OPCIONAL: sin esas props se comporta exactamente
// igual que antes, que es lo que mantiene intacto el Mapa CGO.
//

import React, { useEffect, useMemo } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, Circle, Popup, TileLayer, useMap } from 'react-leaflet'

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type CapaCGO =
  | 'objetivos'
  | 'ingresos'
  | 'egresos'
  | 'supervisiones'
  | 'puntos_ronda'

export type MarkerCGO = {
  id: string
  tipo: 'ingreso' | 'egreso'
  lat: number
  lng: number
  color: string
  label: string
  empleado: string
  objetivo: string
  fecha: string
  hora: string
  distancia: string
  precision: string
  estado: string
  tipoRegistro: string
  registroId: string
  googleMapsUrl: string
}

export type ObjetivoCGO = {
  id: string
  nombre: string
  lat: number
  lng: number
  radio_metros: number
}

export type SupervisionCGO = {
  id: string
  lat: number
  lng: number
  supervisor: string
  objetivo: string
  fecha: string
  estado: string
  distancia: string
  precision: string
  dentroRadio: boolean | null
  gpsImpreciso: boolean
  googleMapsUrl: string
}

/**
 * Punto de ronda para dibujar. Es CONFIGURACIÓN: el marcador se puede
 * seleccionar, pero en esta versión no se arrastra.
 */
export type PuntoRondaCGO = {
  id: string
  nombre: string
  lat: number
  lng: number
  radioMetros: number | null
  objetivo: string
  ronda: string
  puesto: string | null
  gpsRequerido: boolean
  /** Etiqueta ya traducida del diagnóstico. El mapa no clasifica nada. */
  diagnostico: string | null
  /** true cuando el diagnóstico propone un cambio concreto. */
  conRecomendacion: boolean
  incumplimientosConsecutivos: number
}

/**
 * Marcación histórica de un punto (dónde marcó realmente el vigilador).
 * EVIDENCIA: no se arrastra, no se edita, no se borra.
 */
export type MarcacionCGO = {
  id: string
  lat: number
  lng: number
  fecha: string
  dentroRadio: boolean | null
  distancia: string
  precision: string
}

type Props = {
  markers: MarkerCGO[]
  objetivos: ObjetivoCGO[]
  supervisiones: SupervisionCGO[]
  capasActivas: Set<string>
  registroSeleccionado: string | null
  onMarkerClick: (registroId: string) => void

  // ── Opcionales: sólo los usa la Página GPS ────────────────────────────────
  puntosRonda?: PuntoRondaCGO[]
  /** Marcaciones históricas del punto seleccionado. Evidencia, sólo lectura. */
  marcaciones?: MarcacionCGO[]
  puntoSeleccionadoId?: string | null
  onPuntoClick?: (puntoId: string) => void
  onObjetivoClick?: (objetivoId: string) => void
  onSupervisionClick?: (supervisionId: string) => void
  /** Alto del mapa. Por defecto, el mismo que usaba el Mapa CGO. */
  altura?: string
}

// ── Constantes ────────────────────────────────────────────────────────────────

const FALLBACK_CENTER: [number, number] = [-32.9442, -60.6505]

const COLOR_OBJETIVO = '#2563eb'
const COLOR_PUNTO_RONDA = '#a855f7'
const COLOR_PUNTO_RONDA_ALERTA = '#f59e0b'
const COLOR_MARCACION_DENTRO = '#22c55e'
const COLOR_MARCACION_FUERA = '#ef4444'
const COLOR_SUPERVISION_DENTRO = '#38bdf8'
const COLOR_SUPERVISION_FUERA = '#ef4444'
const COLOR_SUPERVISION_IMPRECISA = '#f97316'
const COLOR_SUPERVISION_SIN_DATA = '#a78bfa'

// ── Helpers de íconos ─────────────────────────────────────────────────────────

function mkIcon(color: string, label: string, selected: boolean): L.DivIcon {
  const ring = selected
    ? 'box-shadow:0 0 0 3px rgba(255,255,255,.85),0 4px 16px rgba(0,0,0,.55);'
    : 'box-shadow:0 4px 12px rgba(0,0,0,.4);'
  return L.divIcon({
    className: '',
    html: `<span style="width:30px;height:30px;border-radius:999px;border:2px solid rgba(255,255,255,.95);background:${color};display:flex;align-items:center;justify-content:center;font-weight:900;font-size:9px;color:#111827;${ring}">${label}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -18],
  })
}

function egresoIcon(color: string, label: string, selected: boolean): L.DivIcon {
  const ring = selected
    ? 'box-shadow:0 0 0 3px rgba(255,255,255,.85),0 4px 16px rgba(0,0,0,.55);'
    : 'box-shadow:0 4px 12px rgba(0,0,0,.4);'
  return L.divIcon({
    className: '',
    html: `<span style="width:22px;height:22px;border-radius:999px;border:2px solid rgba(255,255,255,.9);background:${color};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:7px;color:#e2e8f0;${ring}">${label}</span>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -14],
  })
}

function objetivoIcon(nombre: string): L.DivIcon {
  const label = nombre.length > 16 ? nombre.slice(0, 15) + '…' : nombre
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
      <span style="width:22px;height:22px;border-radius:6px;border:2px solid rgba(255,255,255,.95);background:#2563eb;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:10px;box-shadow:0 4px 12px rgba(0,0,0,.45);">O</span>
      <span style="background:rgba(15,23,42,.82);color:#93c5fd;font-size:9px;font-weight:600;padding:1px 4px;border-radius:3px;white-space:nowrap;max-width:90px;overflow:hidden;text-overflow:ellipsis;line-height:1.3;">${label}</span>
    </div>`,
    iconSize: [100, 38],
    iconAnchor: [50, 22],
    popupAnchor: [0, -24],
  })
}

function supervisionColor(s: SupervisionCGO): string {
  if (s.gpsImpreciso) return COLOR_SUPERVISION_IMPRECISA
  if (s.dentroRadio === false) return COLOR_SUPERVISION_FUERA
  if (s.dentroRadio === true) return COLOR_SUPERVISION_DENTRO
  return COLOR_SUPERVISION_SIN_DATA
}

function puntoRondaIcon(punto: PuntoRondaCGO, seleccionado: boolean): L.DivIcon {
  const color = punto.conRecomendacion ? COLOR_PUNTO_RONDA_ALERTA : COLOR_PUNTO_RONDA
  const nombre = punto.nombre.length > 16 ? punto.nombre.slice(0, 15) + '…' : punto.nombre
  const ring = seleccionado
    ? 'box-shadow:0 0 0 3px rgba(255,255,255,.9),0 4px 16px rgba(0,0,0,.55);'
    : 'box-shadow:0 4px 12px rgba(0,0,0,.45);'
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;flex-direction:column;align-items:center;gap:2px;">
      <span style="width:22px;height:22px;border-radius:50%;border:2px solid rgba(255,255,255,.95);background:${color};color:#111827;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:10px;${ring}">P</span>
      <span style="background:rgba(15,23,42,.82);color:#e9d5ff;font-size:9px;font-weight:600;padding:1px 4px;border-radius:3px;white-space:nowrap;max-width:90px;overflow:hidden;text-overflow:ellipsis;line-height:1.3;">${nombre}</span>
    </div>`,
    iconSize: [100, 38],
    iconAnchor: [50, 22],
    popupAnchor: [0, -24],
  })
}

function marcacionIcon(dentroRadio: boolean | null): L.DivIcon {
  const color = dentroRadio === false ? COLOR_MARCACION_FUERA
    : dentroRadio === true ? COLOR_MARCACION_DENTRO
    : '#94a3b8'
  return L.divIcon({
    className: '',
    html: `<span style="width:11px;height:11px;border-radius:50%;border:1px solid rgba(255,255,255,.9);background:${color};display:block;box-shadow:0 2px 6px rgba(0,0,0,.45);"></span>`,
    iconSize: [11, 11],
    iconAnchor: [6, 6],
    popupAnchor: [0, -8],
  })
}

function supervisionIcon(color: string, label: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `<span style="width:30px;height:30px;border-radius:999px;border:2px solid rgba(255,255,255,.95);background:${color};display:flex;align-items:center;justify-content:center;font-weight:900;font-size:10px;color:#111827;box-shadow:0 4px 12px rgba(0,0,0,.4);">${label}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -18],
  })
}

function iniciales(texto: string): string {
  return texto
    .replace(',', '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0])
    .join('')
    .toUpperCase() || '?'
}

// ── Sub-componentes del mapa ──────────────────────────────────────────────────

function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap()
  const key = positions.map(p => p.join(',')).join('|')

  useEffect(() => {
    if (!positions.length) return
    if (positions.length === 1) {
      map.setView(positions[0], 17)
      return
    }
    map.fitBounds(L.latLngBounds(positions), { padding: [36, 36], maxZoom: 17 })
  }, [key, map, positions])

  return null
}

function FlyTo({ registroSeleccionado, markers }: { registroSeleccionado: string | null; markers: MarkerCGO[] }) {
  const map = useMap()

  useEffect(() => {
    if (!registroSeleccionado) return
    const m = markers.find(x => x.registroId === registroSeleccionado)
    if (m) map.flyTo([m.lat, m.lng], 17, { duration: 0.5 })
  }, [registroSeleccionado, markers, map])

  return null
}

// ── Popup content ──────────────────────────────────────────────────────────────

function PopupAsistencia({ m, tipo }: { m: MarkerCGO; tipo: 'Ingreso' | 'Egreso' }) {
  return (
    <div style={{ minWidth: 220 }}>
      <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6, color: '#0f172a' }}>{m.empleado}</div>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, color: '#374151' }}>
        <tbody>
          <tr><td style={{ paddingRight: 8, color: '#6b7280', paddingBottom: 3 }}>Tipo</td><td style={{ paddingBottom: 3, fontWeight: 600 }}>{tipo}</td></tr>
          <tr><td style={{ paddingRight: 8, color: '#6b7280', paddingBottom: 3 }}>Objetivo</td><td style={{ paddingBottom: 3 }}>{m.objetivo}</td></tr>
          <tr><td style={{ paddingRight: 8, color: '#6b7280', paddingBottom: 3 }}>Fecha</td><td style={{ paddingBottom: 3 }}>{m.fecha}</td></tr>
          <tr><td style={{ paddingRight: 8, color: '#6b7280', paddingBottom: 3 }}>Hora</td><td style={{ paddingBottom: 3, fontWeight: 600 }}>{m.hora}</td></tr>
          <tr><td style={{ paddingRight: 8, color: '#6b7280', paddingBottom: 3 }}>Distancia</td><td style={{ paddingBottom: 3 }}>{m.distancia}</td></tr>
          <tr><td style={{ paddingRight: 8, color: '#6b7280', paddingBottom: 3 }}>Precisión GPS</td><td style={{ paddingBottom: 3 }}>{m.precision}</td></tr>
          <tr><td style={{ paddingRight: 8, color: '#6b7280', paddingBottom: 3 }}>Estado</td><td style={{ paddingBottom: 3 }}>{m.estado}</td></tr>
          <tr><td style={{ paddingRight: 8, color: '#6b7280' }}>Registro</td><td>{m.tipoRegistro}</td></tr>
        </tbody>
      </table>
      <a
        href={m.googleMapsUrl}
        target="_blank"
        rel="noreferrer"
        style={{ display: 'inline-block', marginTop: 10, fontSize: 11, color: '#2563eb', fontWeight: 700, textDecoration: 'none' }}
      >
        Abrir en Google Maps ↗
      </a>
    </div>
  )
}

function PopupSupervision({ s }: { s: SupervisionCGO }) {
  return (
    <div style={{ minWidth: 220 }}>
      <div style={{ fontWeight: 800, fontSize: 13, marginBottom: 6, color: '#0f172a' }}>Supervisión</div>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, color: '#374151' }}>
        <tbody>
          <tr><td style={{ paddingRight: 8, color: '#6b7280', paddingBottom: 3 }}>Supervisor</td><td style={{ paddingBottom: 3 }}>{s.supervisor}</td></tr>
          <tr><td style={{ paddingRight: 8, color: '#6b7280', paddingBottom: 3 }}>Objetivo</td><td style={{ paddingBottom: 3 }}>{s.objetivo}</td></tr>
          <tr><td style={{ paddingRight: 8, color: '#6b7280', paddingBottom: 3 }}>Fecha/hora</td><td style={{ paddingBottom: 3 }}>{s.fecha}</td></tr>
          <tr><td style={{ paddingRight: 8, color: '#6b7280', paddingBottom: 3 }}>Estado</td><td style={{ paddingBottom: 3 }}>{s.estado}</td></tr>
          <tr><td style={{ paddingRight: 8, color: '#6b7280', paddingBottom: 3 }}>Distancia</td><td style={{ paddingBottom: 3 }}>{s.distancia}</td></tr>
          <tr><td style={{ paddingRight: 8, color: '#6b7280', paddingBottom: 3 }}>Precisión GPS</td><td style={{ paddingBottom: 3 }}>{s.precision}</td></tr>
          <tr><td style={{ paddingRight: 8, color: '#6b7280' }}>Dentro del radio</td><td>{s.dentroRadio === null ? '—' : s.dentroRadio ? 'Sí' : 'No'}</td></tr>
        </tbody>
      </table>
      <a
        href={s.googleMapsUrl}
        target="_blank"
        rel="noreferrer"
        style={{ display: 'inline-block', marginTop: 10, fontSize: 11, color: '#2563eb', fontWeight: 700, textDecoration: 'none' }}
      >
        Abrir en Google Maps ↗
      </a>
    </div>
  )
}

// ── Componente principal ───────────────────────────────────────────────────────

export default function MapaOperativo({
  markers,
  objetivos,
  supervisiones,
  capasActivas,
  registroSeleccionado,
  onMarkerClick,
  puntosRonda = [],
  marcaciones = [],
  puntoSeleccionadoId = null,
  onPuntoClick,
  onObjetivoClick,
  onSupervisionClick,
  altura = 'min(58vh, 520px)',
}: Props) {
  const ingresos = useMemo(
    () => (capasActivas.has('ingresos') ? markers.filter(m => m.tipo === 'ingreso') : []),
    [capasActivas, markers],
  )
  const egresos = useMemo(
    () => (capasActivas.has('egresos') ? markers.filter(m => m.tipo === 'egreso') : []),
    [capasActivas, markers],
  )
  const objetivosActivos = capasActivas.has('objetivos') ? objetivos : []
  const supervisionesActivas = capasActivas.has('supervisiones') ? supervisiones : []
  const puntosActivos = capasActivas.has('puntos_ronda') ? puntosRonda : []

  const allPositions = useMemo<[number, number][]>(() => [
    ...ingresos.map(m => [m.lat, m.lng] as [number, number]),
    ...egresos.map(m => [m.lat, m.lng] as [number, number]),
    ...objetivosActivos.map(o => [o.lat, o.lng] as [number, number]),
    ...supervisionesActivas.map(s => [s.lat, s.lng] as [number, number]),
    ...puntosActivos.map(p => [p.lat, p.lng] as [number, number]),
  ], [ingresos, egresos, objetivosActivos, supervisionesActivas, puntosActivos])

  return (
    <div style={{ border: '1px solid #1e2d42', borderRadius: 8, overflow: 'hidden', background: '#111827' }}>
      <div style={{ height: altura, minHeight: 340, width: '100%' }}>
        <MapContainer
          center={allPositions[0] || FALLBACK_CENTER}
          zoom={15}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds positions={allPositions} />
          <FlyTo registroSeleccionado={registroSeleccionado} markers={markers} />

          {/* Capa: objetivos + círculo de radio */}
          {objetivosActivos.map(obj => (
            <React.Fragment key={obj.id}>
              <Circle
                center={[obj.lat, obj.lng]}
                radius={obj.radio_metros}
                pathOptions={{ color: COLOR_OBJETIVO, fillColor: COLOR_OBJETIVO, fillOpacity: 0.05, weight: 1.5, dashArray: '6 4' }}
              />
              <Marker
                position={[obj.lat, obj.lng]}
                icon={objetivoIcon(obj.nombre)}
                eventHandlers={onObjetivoClick ? { click: () => onObjetivoClick(obj.id) } : undefined}
              >
                <Popup>
                  <div style={{ minWidth: 160, fontSize: 13 }}>
                    <div style={{ fontWeight: 800, marginBottom: 4, color: '#0f172a' }}>{obj.nombre}</div>
                    <div style={{ color: '#6b7280', fontSize: 12 }}>Radio permitido: {obj.radio_metros} m</div>
                  </div>
                </Popup>
              </Marker>
            </React.Fragment>
          ))}

          {/* Capa: ingresos */}
          {ingresos.map(m => (
            <Marker
              key={m.id}
              position={[m.lat, m.lng]}
              icon={mkIcon(m.color, m.label, m.registroId === registroSeleccionado)}
              eventHandlers={{ click: () => onMarkerClick(m.registroId) }}
            >
              <Popup><PopupAsistencia m={m} tipo="Ingreso" /></Popup>
            </Marker>
          ))}

          {/* Capa: egresos */}
          {egresos.map(m => (
            <Marker
              key={m.id}
              position={[m.lat, m.lng]}
              icon={egresoIcon(m.color, m.label, m.registroId === registroSeleccionado)}
              eventHandlers={{ click: () => onMarkerClick(m.registroId) }}
            >
              <Popup><PopupAsistencia m={m} tipo="Egreso" /></Popup>
            </Marker>
          ))}

          {/* Capa: supervisiones */}
          {supervisionesActivas.map(s => {
            const color = supervisionColor(s)
            return (
              <Marker
                key={s.id}
                position={[s.lat, s.lng]}
                icon={supervisionIcon(color, iniciales(s.supervisor))}
                eventHandlers={onSupervisionClick ? { click: () => onSupervisionClick(s.id) } : undefined}
              >
                <Popup><PopupSupervision s={s} /></Popup>
              </Marker>
            )
          })}

          {/* Capa: puntos de ronda + su radio configurado */}
          {puntosActivos.map(p => (
            <React.Fragment key={p.id}>
              {p.radioMetros !== null && p.radioMetros > 0 && (
                <Circle
                  center={[p.lat, p.lng]}
                  radius={p.radioMetros}
                  pathOptions={{
                    color: p.conRecomendacion ? COLOR_PUNTO_RONDA_ALERTA : COLOR_PUNTO_RONDA,
                    fillColor: p.conRecomendacion ? COLOR_PUNTO_RONDA_ALERTA : COLOR_PUNTO_RONDA,
                    fillOpacity: 0.06,
                    weight: p.id === puntoSeleccionadoId ? 2.5 : 1.5,
                  }}
                />
              )}
              <Marker
                position={[p.lat, p.lng]}
                icon={puntoRondaIcon(p, p.id === puntoSeleccionadoId)}
                eventHandlers={onPuntoClick ? { click: () => onPuntoClick(p.id) } : undefined}
              >
                <Popup>
                  <div style={{ minWidth: 190, fontSize: 13 }}>
                    <div style={{ fontWeight: 800, marginBottom: 4, color: '#0f172a' }}>{p.nombre}</div>
                    <div style={{ color: '#6b7280', fontSize: 12 }}>{p.objetivo} · {p.ronda}</div>
                    <div style={{ color: '#6b7280', fontSize: 12 }}>
                      Radio: {p.radioMetros !== null ? `${p.radioMetros} m` : '—'}
                    </div>
                    {p.diagnostico && (
                      <div style={{ marginTop: 4, fontSize: 12, fontWeight: 600, color: p.conRecomendacion ? '#b45309' : '#15803d' }}>
                        {p.diagnostico}
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            </React.Fragment>
          ))}

          {/* Marcaciones históricas del punto seleccionado. EVIDENCIA: sin
              eventHandlers, sin draggable. Sólo se miran. */}
          {marcaciones.map(m => (
            <Marker key={m.id} position={[m.lat, m.lng]} icon={marcacionIcon(m.dentroRadio)}>
              <Popup>
                <div style={{ minWidth: 170, fontSize: 12, color: '#374151' }}>
                  <div style={{ fontWeight: 800, marginBottom: 4, color: '#0f172a' }}>Marcación registrada</div>
                  <div>{m.fecha}</div>
                  <div>Distancia: {m.distancia}</div>
                  <div>Precisión: {m.precision}</div>
                  <div>Dentro del radio: {m.dentroRadio === null ? '—' : m.dentroRadio ? 'Sí' : 'No'}</div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>
    </div>
  )
}

