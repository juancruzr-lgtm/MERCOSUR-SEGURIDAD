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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  /**
   * Objetivo que se puede arrastrar. Sólo uno por vez, y sólo el seleccionado.
   *
   * Arrastrar NO guarda: se avisa la posición propuesta y quien decide es la
   * pantalla, con confirmación. Sin esta prop ningún objetivo se mueve, que es
   * como sigue comportándose el Mapa CGO de Asistencia.
   */
  objetivoArrastrableId?: string | null
  onObjetivoArrastrado?: (objetivoId: string, lat: number, lng: number) => void
  /** Posición propuesta todavía sin guardar, para dibujar ahí el radio. */
  objetivoPropuesto?: { id: string; lat: number; lng: number } | null
  /**
   * Ubicación y radio que sugiere el diagnóstico, para comparar contra los
   * actuales. Se dibuja aparte y en verde: es una propuesta, no el estado.
   */
  objetivoSugerido?: { id: string; lat: number; lng: number; radioMetros: number } | null
  /**
   * Punto de ronda que se puede arrastrar. Sólo uno, sólo el seleccionado, y
   * sólo cuando la pantalla lo pide. Arrastrar NO guarda: avisa la posición
   * propuesta y la pantalla decide, con confirmación.
   */
  puntoArrastrableId?: string | null
  onPuntoArrastrado?: (puntoId: string, lat: number, lng: number) => void
  /** Posición propuesta del punto, todavía sin guardar. */
  puntoPropuesto?: { id: string; lat: number; lng: number } | null
  /**
   * Radio que se está probando para el punto seleccionado, todavía sin guardar.
   * Se dibuja punteado sobre el radio actual para poder compararlos.
   */
  radioPreviewMetros?: number | null
  onPuntoClick?: (puntoId: string) => void
  onObjetivoClick?: (objetivoId: string) => void
  onSupervisionClick?: (supervisionId: string) => void
  /** Alto del mapa. Por defecto, el mismo que usaba el Mapa CGO. */
  altura?: string
  /**
   * Cambiar este valor reencuadra el mapa. Con `vistaId` presente, lo mueve
   * únicamente el botón de encuadrar: nada de lo que pase en la pantalla toca
   * la cámara.
   *
   * Sin `vistaId`, el encuadre se rige por las coordenadas dibujadas, que es el
   * comportamiento histórico del Mapa CGO de Asistencia.
   */
  fitToken?: string
  /**
   * Activa la memoria del encuadre y apaga el reencuadre automático.
   *
   * Con esto el mapa nunca se mueve solo: recuerda dónde lo dejó el usuario
   * —incluso si el componente se vuelve a montar— y sólo reencuadra cuando él
   * lo pide. Prender una capa deja de mandarlo a ver tres provincias.
   */
  vistaId?: string
  /**
   * Muestra el selector Calles / Satélite / Híbrido.
   *
   * Por defecto false: el Mapa CGO de Asistencia no lo pide y sigue viéndose
   * exactamente igual que antes, con el fondo de calles de OpenStreetMap.
   */
  selectorFondo?: boolean
}

// ── Constantes ────────────────────────────────────────────────────────────────

const FALLBACK_CENTER: [number, number] = [-32.9442, -60.6505]

// ── Fondos de mapa ───────────────────────────────────────────────────────────
//
// Sólo cambia la imagen de fondo (el tilePane de Leaflet). Marcadores, círculos
// de radio, selección y filtros viven en overlayPane y markerPane, que Leaflet
// dibuja SIEMPRE por encima del fondo y que este selector no toca.
//
// Ninguna de las tres capas pide API key: son los endpoints públicos de
// ArcGIS Online, los mismos que usa el plugin leaflet-providers.

export type FondoMapa = 'calles' | 'satelite' | 'hibrido'

const URL_OSM = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
// Ojo con el orden: Esri sirve {z}/{y}/{x}, al revés que OSM.
const URL_ESRI_IMAGEN = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const URL_ESRI_LIMITES = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'
const URL_ESRI_TRANSPORTE = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'

const ATRIBUCION_OSM =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
const ATRIBUCION_ESRI =
  'Tiles &copy; <a href="https://www.esri.com">Esri</a> — Source: Esri, i-cubed, USDA, USGS, ' +
  'AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'

const FONDOS: { id: FondoMapa; label: string }[] = [
  { id: 'calles', label: 'Calles' },
  { id: 'satelite', label: 'Satélite' },
  { id: 'hibrido', label: 'Híbrido' },
]

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

/**
 * Encuadra el mapa para que entre todo lo dibujado.
 *
 * CUÁNDO REENCUADRA, Y POR QUÉ ASÍ
 *
 * Reencuadrar mueve la vista abajo de los pies del usuario. Sólo se justifica
 * cuando él pidió ver otra cosa: cambió un filtro, prendió o apagó una capa.
 * Nunca cuando seleccionó un marcador para mirarlo de cerca — ahí perder el
 * zoom es exactamente lo contrario de lo que quería.
 *
 * Por eso el disparador es `fitToken`: un valor que la pantalla cambia a
 * propósito cuando corresponde reencuadrar. Atarlo a las posiciones dibujadas
 * —como estaba antes— no alcanza: seleccionar algo puede reordenar o
 * reconstruir esa lista sin que el usuario haya pedido nada, y el mapa se iba
 * para atrás solo.
 *
 * Sin `fitToken` se cae al comportamiento anterior, basado en las coordenadas.
 * Eso deja el Mapa CGO de Asistencia exactamente como estaba.
 */
/**
 * Encuadre guardado por pantalla, fuera de React.
 *
 * Vive a nivel de módulo a propósito: si el componente se vuelve a montar por
 * cualquier motivo, `MapContainer` sólo lee `center` y `zoom` al montarse y
 * volvería al encuadre inicial. Guardándolo acá, el mapa reaparece donde el
 * usuario lo dejó.
 */
const vistasGuardadas = new Map<string, { centro: [number, number]; zoom: number }>()

function FitBounds({
  positions, fitToken, vistaId,
}: {
  positions: [number, number][]
  fitToken?: string
  vistaId?: string
}) {
  const map = useMap()
  const key = positions.map(p => p.join(',')).join('|')

  // Las posiciones se leen por referencia: el array se reconstruye en cada
  // render y tenerlo en las dependencias volvería a disparar el encuadre.
  const positionsRef = useRef(positions)
  positionsRef.current = positions

  const encuadrar = useCallback(() => {
    const actuales = positionsRef.current
    if (!actuales.length) return
    if (actuales.length === 1) {
      map.setView(actuales[0], 17)
      return
    }
    map.fitBounds(L.latLngBounds(actuales), { padding: [36, 36], maxZoom: 17 })
  }, [map])

  // ── Memoria del encuadre ─────────────────────────────────────────────────
  // Sólo cuando la pantalla pide memoria (vistaId). Sin ella, el componente se
  // comporta igual que siempre, que es lo que mantiene intacto el Mapa CGO.
  useEffect(() => {
    if (!vistaId) return

    const guardada = vistasGuardadas.get(vistaId)
    if (guardada) map.setView(guardada.centro, guardada.zoom)
    else encuadrar()

    const recordar = () => {
      const centro = map.getCenter()
      vistasGuardadas.set(vistaId, { centro: [centro.lat, centro.lng], zoom: map.getZoom() })
    }
    map.on('moveend', recordar)
    map.on('zoomend', recordar)
    return () => {
      map.off('moveend', recordar)
      map.off('zoomend', recordar)
    }
  }, [map, vistaId, encuadrar])

  // ── Encuadre automático ──────────────────────────────────────────────────
  // Con `vistaId`, el encuadre deja de ser automático: lo pide el usuario con
  // el botón, que es lo que mueve `fitToken`. Nada de lo que pase en la
  // pantalla —seleccionar, analizar, recargar— le toca la cámara.
  //
  // Sin `vistaId` se conserva el comportamiento histórico: reencuadra cuando
  // cambian las coordenadas dibujadas.
  const primeraRef = useRef(true)

  useEffect(() => {
    if (vistaId) {
      // El primer disparo lo maneja el efecto de memoria, para no pelearle.
      if (primeraRef.current) { primeraRef.current = false; return }
      encuadrar()
      return
    }
    encuadrar()
  }, [fitToken ?? key, vistaId, encuadrar]) // eslint-disable-line react-hooks/exhaustive-deps

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
  radioPreviewMetros = null,
  objetivoArrastrableId = null,
  onObjetivoArrastrado,
  objetivoPropuesto = null,
  objetivoSugerido = null,
  puntoArrastrableId = null,
  onPuntoArrastrado,
  puntoPropuesto = null,
  onPuntoClick,
  onObjetivoClick,
  onSupervisionClick,
  altura = 'min(58vh, 520px)',
  selectorFondo = false,
  fitToken,
  vistaId,
}: Props) {
  // El fondo es estado local del mapa: cambiarlo no toca ningún dato, ningún
  // filtro ni la selección. Sólo se reemplaza la imagen de abajo.
  const [fondo, setFondo] = useState<FondoMapa>('calles')
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
      {selectorFondo && (
        <div style={{ display: 'flex', gap: 6, padding: '8px 10px', borderBottom: '1px solid #1e2d42', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginRight: 4 }}>Fondo</span>
          {FONDOS.map(opcion => (
            <button
              key={opcion.id}
              type="button"
              onClick={() => setFondo(opcion.id)}
              style={{
                border: `1px solid ${fondo === opcion.id ? '#f59e0b' : '#1e2d42'}`,
                background: fondo === opcion.id ? '#f59e0b' : 'transparent',
                color: fondo === opcion.id ? '#0a0e1a' : '#94a3b8',
                borderRadius: 999,
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {opcion.label}
            </button>
          ))}
        </div>
      )}
      <div style={{ height: altura, minHeight: 340, width: '100%' }}>
        <MapContainer
          center={allPositions[0] || FALLBACK_CENTER}
          zoom={15}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom
        >
          {/* Fondo. Va en el tilePane, siempre por debajo de nuestras capas.
              `key` fuerza el reemplazo limpio del tile layer al cambiar. */}
          {fondo === 'calles' && (
            <TileLayer key="fondo-calles" attribution={ATRIBUCION_OSM} url={URL_OSM} />
          )}

          {fondo !== 'calles' && (
            <TileLayer
              key="fondo-satelite"
              attribution={ATRIBUCION_ESRI}
              url={URL_ESRI_IMAGEN}
              maxNativeZoom={19}
            />
          )}

          {/* Híbrido: sobre la imagen, las referencias de Esri — límites,
              localidades y nombres de calles y rutas. Son tiles transparentes. */}
          {fondo === 'hibrido' && (
            <>
              <TileLayer key="fondo-limites" url={URL_ESRI_LIMITES} maxNativeZoom={19} />
              <TileLayer key="fondo-transporte" url={URL_ESRI_TRANSPORTE} maxNativeZoom={19} />
            </>
          )}
          <FitBounds positions={allPositions} fitToken={fitToken} vistaId={vistaId} />
          <FlyTo registroSeleccionado={registroSeleccionado} markers={markers} />

          {/* Capa: objetivos + círculo de radio */}
          {objetivosActivos.map(obj => {
            const propuesto = objetivoPropuesto?.id === obj.id ? objetivoPropuesto : null
            // El radio acompaña a la posición propuesta: lo que interesa ver es
            // dónde quedaría la zona de fichaje, no dónde estaba.
            const centro: [number, number] = propuesto ? [propuesto.lat, propuesto.lng] : [obj.lat, obj.lng]
            const arrastrable = obj.id === objetivoArrastrableId

            return (
            <React.Fragment key={obj.id}>
              <Circle
                center={centro}
                radius={obj.radio_metros}
                pathOptions={{
                  color: propuesto ? '#38bdf8' : COLOR_OBJETIVO,
                  fillColor: propuesto ? '#38bdf8' : COLOR_OBJETIVO,
                  fillOpacity: 0.05,
                  weight: propuesto ? 2 : 1.5,
                  dashArray: '6 4',
                }}
              />
              <Marker
                position={centro}
                icon={objetivoIcon(obj.nombre)}
                draggable={arrastrable}
                eventHandlers={{
                  ...(onObjetivoClick ? { click: () => onObjetivoClick(obj.id) } : {}),
                  ...(arrastrable && onObjetivoArrastrado
                    ? {
                        dragend: (evento: any) => {
                          const posicion = evento.target.getLatLng()
                          onObjetivoArrastrado(obj.id, posicion.lat, posicion.lng)
                        },
                      }
                    : {}),
                }}
              >
                <Popup>
                  <div style={{ minWidth: 160, fontSize: 13 }}>
                    <div style={{ fontWeight: 800, marginBottom: 4, color: '#0f172a' }}>{obj.nombre}</div>
                    <div style={{ color: '#6b7280', fontSize: 12 }}>Radio permitido: {obj.radio_metros} m</div>
                    {arrastrable && (
                      <div style={{ color: '#0369a1', fontSize: 12, marginTop: 4, fontWeight: 600 }}>
                        Arrastralo para proponer otra ubicación.
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            </React.Fragment>
            )
          })}

          {/* Ubicación que sugiere el diagnóstico del objetivo. Va en verde y
              aparte del marcador real: es una propuesta, no el estado. */}
          {objetivoSugerido && capasActivas.has('objetivos') && (
            <React.Fragment key={`sugerido-${objetivoSugerido.id}`}>
              <Circle
                center={[objetivoSugerido.lat, objetivoSugerido.lng]}
                radius={objetivoSugerido.radioMetros}
                pathOptions={{
                  color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.07,
                  weight: 2, dashArray: '4 4',
                }}
              />
              <Marker
                position={[objetivoSugerido.lat, objetivoSugerido.lng]}
                icon={L.divIcon({
                  className: '',
                  html: `<span style="width:20px;height:20px;border-radius:4px;border:2px solid rgba(255,255,255,.95);background:#22c55e;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:10px;color:#052e16;box-shadow:0 4px 12px rgba(0,0,0,.45);">S</span>`,
                  iconSize: [20, 20],
                  iconAnchor: [10, 10],
                  popupAnchor: [0, -12],
                })}
              >
                <Popup>
                  <div style={{ minWidth: 170, fontSize: 12, color: '#374151' }}>
                    <div style={{ fontWeight: 800, marginBottom: 4, color: '#0f172a' }}>Ubicación sugerida</div>
                    <div>Radio sugerido: {objetivoSugerido.radioMetros} m</div>
                    <div style={{ marginTop: 4, color: '#6b7280' }}>
                      Calculada sobre los fichajes reales. Todavía no se aplicó.
                    </div>
                  </div>
                </Popup>
              </Marker>
            </React.Fragment>
          )}

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
          {puntosActivos.map(p => {
            const propuestoPunto = puntoPropuesto?.id === p.id ? puntoPropuesto : null
            // El radio sigue al punto propuesto: lo que interesa ver es dónde
            // quedaría la zona de control, no dónde estaba.
            const centroPunto: [number, number] = propuestoPunto
              ? [propuestoPunto.lat, propuestoPunto.lng]
              : [p.lat, p.lng]
            const puntoArrastrable = p.id === puntoArrastrableId

            return (
            <React.Fragment key={p.id}>
              {p.radioMetros !== null && p.radioMetros > 0 && (
                <Circle
                  center={centroPunto}
                  radius={p.radioMetros}
                  pathOptions={{
                    color: propuestoPunto ? '#38bdf8'
                      : p.conRecomendacion ? COLOR_PUNTO_RONDA_ALERTA : COLOR_PUNTO_RONDA,
                    fillColor: propuestoPunto ? '#38bdf8'
                      : p.conRecomendacion ? COLOR_PUNTO_RONDA_ALERTA : COLOR_PUNTO_RONDA,
                    fillOpacity: 0.06,
                    weight: p.id === puntoSeleccionadoId ? 2.5 : 1.5,
                  }}
                />
              )}
              {/* Radio que se está probando, todavía sin guardar. Punteado y
                  encima del actual, para poder comparar uno con otro. */}
              {p.id === puntoSeleccionadoId && radioPreviewMetros !== null && radioPreviewMetros > 0 && (
                <Circle
                  center={centroPunto}
                  radius={radioPreviewMetros}
                  pathOptions={{
                    color: '#38bdf8',
                    fillColor: '#38bdf8',
                    fillOpacity: 0.08,
                    weight: 2,
                    dashArray: '6 5',
                  }}
                />
              )}
              <Marker
                position={centroPunto}
                icon={puntoRondaIcon(p, p.id === puntoSeleccionadoId)}
                draggable={puntoArrastrable}
                eventHandlers={{
                  ...(onPuntoClick ? { click: () => onPuntoClick(p.id) } : {}),
                  ...(puntoArrastrable && onPuntoArrastrado
                    ? {
                        dragend: (evento: any) => {
                          const posicion = evento.target.getLatLng()
                          onPuntoArrastrado(p.id, posicion.lat, posicion.lng)
                        },
                      }
                    : {}),
                }}
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
                    {puntoArrastrable && (
                      <div style={{ color: '#0369a1', fontSize: 12, marginTop: 4, fontWeight: 600 }}>
                        Arrastralo para proponer otra ubicación.
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            </React.Fragment>
            )
          })}

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

