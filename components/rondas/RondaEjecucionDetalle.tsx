'use client'

// Etapa 3.3 · B5 — Detalle de UNA ejecución de ronda para supervisión.
// Autocontenido, se abre como overlay accesible. Consume:
//   · obtenerDetalleEjecucionSupervisor(ejecucionId) — cabecera + puntos + refs
//   · firmarEvidenciaRonda(evidenciaId) — URL firmada efímera, bajo demanda
// No firma todas las fotos al cargar: cada evidencia se firma solo cuando el
// usuario la abre, y la URL no se persiste. No incluye todavía el mapa GPS (B6).

import { useCallback, useEffect, useState } from 'react'
import {
  obtenerDetalleEjecucionSupervisor,
  firmarEvidenciaRonda,
  mensajeContextoDetalleEjecucion,
  mensajeContextoFirmaEvidencia,
  estadoTecnicoDetalleEjecucion,
  observacionesDetalleEjecucion,
  ETIQUETA_ESTADO_TECNICO,
  COLOR_ESTADO_TECNICO,
  type DetalleEjecucionSupervisor,
  type EjecucionDetalleSupervisor,
  type PuntoEjecucionDetalle,
} from '@/lib/rondas'
import { formatFechaHora } from '@/lib/formato'

interface Props {
  ejecucionId: string
  onCerrar: () => void
}

// 24 h vía lib/formato.ts: en el detalle conviven horarios de ventana y de
// registro, y un AM/PM ahí vuelve imposible leer una ronda nocturna.
function fechaHora(iso: string | null): string {
  return iso ? formatFechaHora(iso) : '—'
}

function siNoNa(valor: boolean | null): { texto: string; color: string } {
  if (valor === null) return { texto: '—', color: '#64748b' }
  return valor ? { texto: 'Sí', color: '#4ade80' } : { texto: 'No', color: '#fca5a5' }
}

function numero(valor: number | null, sufijo = ''): string {
  return valor === null || valor === undefined ? '—' : `${valor}${sufijo}`
}

export default function RondaEjecucionDetalle({ ejecucionId, onCerrar }: Props) {
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<DetalleEjecucionSupervisor | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data: res, error: err } = await obtenerDetalleEjecucionSupervisor(ejecucionId)
    if (err) { setError(err); setData(null) }
    else { setError(null); setData(res) }
    setCargando(false)
  }, [ejecucionId])

  useEffect(() => { void cargar() }, [cargar])

  // Cerrar con Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCerrar() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCerrar])

  const contexto = data?.contexto
  const ejecucion = data?.ejecucion ?? null
  const puntos = data?.puntos ?? []

  return (
    <div style={S.overlay} role="dialog" aria-modal="true" aria-label="Detalle de la ronda" onClick={onCerrar}>
      <div style={S.sheet} onClick={e => e.stopPropagation()}>
        <div style={S.header}>
          <div style={S.headerTitulo}>Detalle de la ronda</div>
          <button type="button" onClick={onCerrar} style={S.cerrar} aria-label="Cerrar detalle">✕</button>
        </div>

        <div style={S.body}>
          {cargando && <div style={S.nota}>Cargando detalle…</div>}

          {!cargando && error && <div style={S.error} role="alert">{error}</div>}

          {!cargando && !error && contexto && contexto !== 'ok' && (
            <div style={S.nota}>{mensajeContextoDetalleEjecucion(contexto) ?? 'No se pudo cargar el detalle.'}</div>
          )}

          {!cargando && !error && contexto === 'ok' && ejecucion && (
            <>
              <Cabecera ejecucion={ejecucion} puntos={puntos} />

              {puntos.length === 0 ? (
                <div style={S.nota}>Esta ejecución no tiene puntos registrados.</div>
              ) : (
                <div style={S.puntos}>
                  {puntos.map(p => <PuntoDetalle key={p.ejecucion_punto_id} punto={p} />)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Cabecera ──────────────────────────────────────────────────────────────────

function Cabecera({ ejecucion, puntos }: { ejecucion: EjecucionDetalleSupervisor; puntos: PuntoEjecucionDetalle[] }) {
  // Estado técnico y observaciones del modelo unificado (lib/rondas.ts), en
  // campos separados del estado crudo del motor. Este contrato no trae la
  // alerta ni la ventana programada: acá no se inventan.
  const tecnico = estadoTecnicoDetalleEjecucion(ejecucion.estado, ejecucion.es_cierre_administrativo, puntos)
  const observaciones = observacionesDetalleEjecucion(ejecucion.es_cierre_administrativo, puntos)

  return (
    <div style={S.cabecera}>
      <div style={S.cabeceraTitulo}>{ejecucion.ronda_nombre}</div>
      <div style={S.cabeceraSub}>{ejecucion.puesto_nombre} · {ejecucion.objetivo_nombre}</div>

      {ejecucion.es_cierre_administrativo && (
        <div style={S.avisoAdmin} role="note">
          <strong>Cierre administrativo</strong>
          {ejecucion.cerrada_por_nombre ? ` · ${ejecucion.cerrada_por_nombre}` : ''}
          {ejecucion.cerrada_at ? ` · ${fechaHora(ejecucion.cerrada_at)}` : ''}
          {ejecucion.cerrada_motivo ? <div style={S.avisoMotivo}>{ejecucion.cerrada_motivo}</div> : null}
        </div>
      )}

      <div style={S.grid}>
        <Dato label="Vigilador" valor={ejecucion.guardia_nombre} />
        <Dato label="Estado técnico" valor={ETIQUETA_ESTADO_TECNICO[tecnico]} color={COLOR_ESTADO_TECNICO[tecnico]} />
        <Dato label="Observaciones" valor={observaciones.length > 0 ? observaciones.join(' · ') : '—'} />
        <Dato label="Estado del motor" valor={`${ejecucion.estado}${ejecucion.resultado ? ` · ${ejecucion.resultado}` : ''}`} />
        <Dato label="Inicio" valor={fechaHora(ejecucion.iniciada_at)} />
        <Dato label="Fin" valor={fechaHora(ejecucion.finalizada_at)} />
        <Dato label="Progreso" valor={`${ejecucion.puntos_completados}/${ejecucion.puntos_total} · ${ejecucion.porcentaje}%`} />
      </div>
    </div>
  )
}

function Dato({ label, valor, color }: { label: string; valor: string; color?: string }) {
  return (
    <div style={S.dato}>
      <span style={S.datoLabel}>{label}</span>
      <span style={{ ...S.datoValor, ...(color ? { color } : null) }}>{valor}</span>
    </div>
  )
}

// ── Punto ─────────────────────────────────────────────────────────────────────

function PuntoDetalle({ punto }: { punto: PuntoEjecucionDetalle }) {
  const gps = siNoNa(punto.gps_ok)
  const dentro = siNoNa(punto.dentro_radio)
  const foto = siNoNa(punto.foto_ok)

  return (
    <div style={S.punto}>
      <div style={S.puntoTop}>
        <div style={S.puntoOrden}>{punto.orden}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={S.puntoNombre}>{punto.nombre}</div>
          <div style={S.puntoMeta}>
            <span style={{ ...S.estadoChip, ...estadoPuntoStyle(punto.estado) }}>{punto.estado}</span>
            <span style={S.puntoMetaTxt}>Registrado: {fechaHora(punto.registrado_at)}</span>
            {punto.hay_novedad && <span style={{ ...S.estadoChip, ...S.chipNovedad }}>Novedad</span>}
            {/* Distingue la foto automática de la configurada: esta visita nació
                con verificación por reincidencia GPS. */}
            {punto.foto_control_gps && (
              <span style={{ ...S.estadoChip, ...S.chipControl }} title="Foto obligatoria de control por reiteración de registros fuera del radio">
                Foto de control GPS
              </span>
            )}
          </div>
        </div>
      </div>

      <div style={S.puntoGrid}>
        <Mini label="GPS real" valor={
          punto.latitud !== null && punto.longitud !== null
            ? `${punto.latitud.toFixed(6)}, ${punto.longitud.toFixed(6)}`
            : '—'
        } />
        <Mini label="Precisión" valor={numero(punto.precision_metros, ' m')} />
        <Mini label="Distancia" valor={numero(punto.distancia_metros, ' m')} />
        <Mini label="GPS ok" valor={gps.texto} color={gps.color} />
        <Mini label="Dentro del radio" valor={dentro.texto} color={dentro.color} />
        <Mini label="Foto ok" valor={foto.texto} color={foto.color} />
        <Mini label="Política de foto" valor={punto.politica_foto} />
        <Mini label="Requiere GPS" valor={punto.requiere_gps ? 'Sí' : 'No'} />
      </div>

      {punto.comentario && (
        <div style={S.comentario}><strong>Comentario:</strong> {punto.comentario}</div>
      )}

      {punto.evidencias.length > 0 && (
        <div style={S.evidencias}>
          {punto.evidencias.map((ev, i) => (
            <EvidenciaFoto key={ev.id} evidenciaId={ev.id} indice={i + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function Mini({ label, valor, color }: { label: string; valor: string; color?: string }) {
  return (
    <div style={S.mini}>
      <span style={S.miniLabel}>{label}</span>
      <span style={{ ...S.miniValor, ...(color ? { color } : null) }}>{valor}</span>
    </div>
  )
}

// ── Evidencia (firma diferida, sin cache permanente) ──────────────────────────

function EvidenciaFoto({ evidenciaId, indice }: { evidenciaId: string; indice: number }) {
  const [estado, setEstado] = useState<'idle' | 'cargando' | 'error' | 'lista'>('idle')
  const [url, setUrl] = useState<string | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)

  const ver = async () => {
    setEstado('cargando'); setMensaje(null)
    const { data, error } = await firmarEvidenciaRonda(evidenciaId)
    if (error) { setEstado('error'); setMensaje(error); return }
    if (!data || data.contexto !== 'ok' || !data.url) {
      setEstado('error')
      setMensaje(mensajeContextoFirmaEvidencia(data?.contexto ?? 'error_firma') ?? 'No se pudo cargar la foto.')
      return
    }
    setUrl(data.url); setEstado('lista')
  }

  if (estado === 'idle') {
    return (
      <button type="button" style={S.verFoto} onClick={() => void ver()}>
        📷 Ver foto {indice}
      </button>
    )
  }
  if (estado === 'cargando') {
    return <span style={S.fotoNota}>Cargando foto {indice}…</span>
  }
  if (estado === 'error') {
    return (
      <span style={S.fotoError}>
        {mensaje}{' '}
        <button type="button" style={S.reintentar} onClick={() => void ver()}>Reintentar</button>
      </span>
    )
  }
  return (
    <a href={url ?? undefined} target="_blank" rel="noreferrer" style={S.fotoLink}>
      <img
        src={url ?? undefined}
        alt={`Evidencia ${indice}`}
        style={S.fotoImg}
        // La URL firmada expira (~60 s). Si falla al recargar, se puede re-firmar.
        onError={() => { setEstado('error'); setMensaje('La foto expiró. Volvé a abrirla.') }}
      />
    </a>
  )
}

function estadoPuntoStyle(estado: string): React.CSSProperties {
  switch (estado) {
    case 'cumplido':   return { background: '#052e16', color: '#4ade80', border: '1px solid #166534' }
    case 'incumplido': return { background: '#3b1116', color: '#fca5a5', border: '1px solid #991b1b' }
    case 'omitido':    return { background: '#0f172a', color: '#94a3b8', border: '1px solid #334155' }
    default:           return { background: '#1e293b', color: '#cbd5e1', border: '1px solid #334155' } // pendiente
  }
}

const S: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(2,6,15,.74)',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  },
  sheet: {
    width: '100%', maxWidth: 620, maxHeight: '94vh', display: 'flex', flexDirection: 'column',
    background: '#0b1220', border: '1px solid #1e2d42',
    borderTopLeftRadius: 16, borderTopRightRadius: 16, boxShadow: '0 -12px 40px rgba(0,0,0,.55)',
  },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 16px', borderBottom: '1px solid #1e2d42',
  },
  headerTitulo: { fontSize: 16, fontWeight: 800, color: '#f8fafc' },
  cerrar: {
    width: 34, height: 34, borderRadius: 999, border: '1px solid #1e2d42',
    background: '#111827', color: '#e2e8f0', fontSize: 15, cursor: 'pointer',
  },
  body: { overflowY: 'auto', padding: 16 },
  nota: { fontSize: 13, color: '#94a3b8', padding: '18px 4px', textAlign: 'center' },
  error: {
    fontSize: 12, color: '#fecaca', background: '#3b1116',
    border: '1px solid #991b1b', borderRadius: 8, padding: 10,
  },
  cabecera: { marginBottom: 16 },
  cabeceraTitulo: { fontSize: 17, fontWeight: 800, color: '#f8fafc' },
  cabeceraSub: { fontSize: 12, color: '#94a3b8', marginTop: 2, marginBottom: 12 },
  avisoAdmin: {
    fontSize: 12, color: '#fecaca', background: '#3b1116',
    border: '1px solid #991b1b', borderRadius: 8, padding: 10, marginBottom: 12,
  },
  avisoMotivo: { color: '#f8b4b4', marginTop: 6, lineHeight: 1.5 },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 },
  dato: { background: '#0f172a', border: '1px solid #1a2436', borderRadius: 8, padding: '8px 10px' },
  datoLabel: { display: 'block', fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  datoValor: { display: 'block', fontSize: 13, fontWeight: 700, color: '#e2e8f0' },
  puntos: { display: 'flex', flexDirection: 'column', gap: 10 },
  punto: { border: '1px solid #1e2d42', borderRadius: 12, background: '#0f172a', padding: 12 },
  puntoTop: { display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 10 },
  puntoOrden: {
    flexShrink: 0, width: 28, height: 28, borderRadius: 999, background: '#1e293b', color: '#f8fafc',
    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 13,
  },
  puntoNombre: { fontSize: 14, fontWeight: 700, color: '#e2e8f0' },
  puntoMeta: { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 5 },
  puntoMetaTxt: { fontSize: 11, color: '#94a3b8' },
  estadoChip: { fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999, textTransform: 'capitalize' },
  chipNovedad: { background: '#3f2d10', color: '#fbbf24', border: '1px solid #b45309' },
  chipControl: { background: '#1e293b', color: '#93c5fd', border: '1px solid #2563eb' },
  puntoGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6 },
  mini: { background: '#0b1220', border: '1px solid #1a2436', borderRadius: 6, padding: '6px 8px' },
  miniLabel: { display: 'block', fontSize: 9, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.3 },
  miniValor: { display: 'block', fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginTop: 1 },
  comentario: { fontSize: 12, color: '#cbd5e1', marginTop: 10, lineHeight: 1.5 },
  evidencias: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  verFoto: {
    border: '1px solid #1e2d42', background: '#111827', color: '#e2e8f0',
    borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer',
  },
  fotoNota: { fontSize: 12, color: '#94a3b8' },
  fotoError: { fontSize: 12, color: '#fca5a5' },
  reintentar: {
    border: '1px solid #991b1b', background: 'transparent', color: '#fca5a5',
    borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
  },
  fotoLink: { display: 'inline-block' },
  fotoImg: { width: 120, height: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid #1e2d42' },
}
