'use client'

/**
 * components/estatuto/EstatutoInterno.tsx
 *
 * La sección "Estatuto Interno" de Mi Legajo (y de /estatuto).
 *
 * ── Dos modos ────────────────────────────────────────────────────────────────
 *   propio   la persona lee su Estatuto (las veces que quiera) y lo acepta
 *   ajeno    Administración/Gerencia mira la constancia de otro desde su legajo
 *
 * En modo ajeno no hay botón de aceptar ni se registra apertura: la RPC lo
 * impediría igual (toma la identidad de auth.uid()), pero además no tiene
 * sentido ofrecerle a un administrativo "aceptar" el estatuto de otro.
 *
 * ── El orden que pidió la Gerencia ───────────────────────────────────────────
 * 1. abrir el documento   → se registra la apertura (estatuto_aperturas)
 * 2. recién ahí se habilita la casilla con la declaración
 * 3. "Aceptar estatuto"   → constancia (estatuto_aceptaciones)
 * La base exige el paso 1 antes del 3: saltear la pantalla no saltea la regla.
 *
 * ── Sin el Word original ─────────────────────────────────────────────────────
 * Decisión de Gerencia (08/10/2026): acá no se ofrece el archivo editable a
 * nadie —ni al vigilador ni en el legajo de cada empleado—. Se lee en la app
 * (o en la copia PDF). El original lo bajan Administración y Gerencia desde
 * Estatuto Interno → Versiones, por /api/estatuto/original, que valida el
 * permiso: el archivo ya no está en una dirección pública.
 */

import { useCallback, useEffect, useState } from 'react'
import DocumentoEstatuto from '@/components/estatuto/DocumentoEstatuto'
import {
  ACLARACION_PAPEL, aceptacionDe, contenidoDeVersion, declaracionHabilitada,
  TEXTO_DECLARACION, estadoAceptacion, etiquetaVersion, fechaHoraArgentina, puedeAceptar,
  versionVigente,
} from '@/lib/estatuto'
import type { AceptacionEstatuto, AperturaEstatuto, VersionEstatuto } from '@/lib/estatuto'
import {
  aceptarEstatuto, cargarDeEmpleado, cargarVersiones, registrarApertura,
} from '@/lib/estatuto-datos'

const card: React.CSSProperties = {
  background: '#111827', border: '1px solid #1e2d42', borderRadius: 10,
  padding: 16, marginBottom: 14,
}
const etiqueta: React.CSSProperties = {
  fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em',
}
const boton = (primario: boolean, habilitado = true): React.CSSProperties => ({
  display: 'block', width: '100%', textAlign: 'center', textDecoration: 'none',
  background: primario ? (habilitado ? '#f59e0b' : '#334155') : 'transparent',
  color: primario ? (habilitado ? '#1a1205' : '#64748b') : '#cbd5e1',
  border: primario ? 'none' : '1px solid #334155',
  borderRadius: 10, padding: '13px 14px', fontSize: 15, fontWeight: primario ? 800 : 600,
  cursor: habilitado ? 'pointer' : 'not-allowed', marginBottom: 10, boxSizing: 'border-box',
})

function hashCorto(h: string | null | undefined): string {
  return h ? `${h.slice(0, 12)}…${h.slice(-6)}` : '—'
}

function Constancia({ a, titulo }: { a: AceptacionEstatuto; titulo: string }) {
  return (
    <div style={{ ...card, borderColor: 'rgba(34,197,94,.4)', background: 'rgba(34,197,94,.06)' }}>
      <div style={{ fontWeight: 800, color: '#86efac', marginBottom: 8 }}>{titulo}</div>
      <div style={{ fontSize: 14, color: '#e2e8f0', lineHeight: 1.55, marginBottom: 8 }}>
        “{a.declaracion}”
      </div>
      <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6 }}>
        {etiquetaVersion(a.version_identificador)} · aceptada el {fechaHoraArgentina(a.aceptado_at)}
        <br />Documento abierto el {fechaHoraArgentina(a.abierto_at)}
        <br />Huella del archivo (SHA-256): <span style={{ fontFamily: 'monospace' }}>{hashCorto(a.archivo_sha256)}</span>
      </div>
    </div>
  )
}

export default function EstatutoInterno({ empleadoId, esPropio }: {
  empleadoId: string
  /** true = quien mira es la propia persona; false = Administración mirando un legajo. */
  esPropio: boolean
}) {
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [vigente, setVigente] = useState<VersionEstatuto | null>(null)
  const [aceptaciones, setAceptaciones] = useState<AceptacionEstatuto[]>([])
  const [aperturas, setAperturas] = useState<AperturaEstatuto[]>([])

  const [abierto, setAbierto] = useState(false)
  const [aperturaFallo, setAperturaFallo] = useState(false)
  const [casilla, setCasilla] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [errorAceptar, setErrorAceptar] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const [v, d] = await Promise.all([cargarVersiones(), cargarDeEmpleado(empleadoId)])
    setError(v.error ?? d.error)
    setVigente(versionVigente(v.versiones))
    setAceptaciones(d.aceptaciones)
    setAperturas(d.aperturas)
    setCargando(false)
  }, [empleadoId])

  useEffect(() => { void cargar() }, [cargar])

  if (cargando) return <div style={{ color: '#64748b', padding: 24, textAlign: 'center' }}>Cargando Estatuto Interno…</div>

  const estado = estadoAceptacion(vigente, aceptaciones, empleadoId)
  const constanciaVigente = aceptacionDe(vigente, aceptaciones, empleadoId)
  const anteriores = aceptaciones.filter(a => a.id !== constanciaVigente?.id)
  const contenido = contenidoDeVersion(vigente?.identificador)
  const aperturaRegistrada = !!vigente && aperturas.some(p => p.version_id === vigente.id)
  const situacion = { estado, abiertoEnPantalla: abierto, aperturaRegistrada, enviando }

  // Abrir = mostrar el texto (o abrir una de las copias). Se registra la
  // primera vez; si falla, la persona igual lee, pero no se le deja aceptar
  // hasta que la base tenga la apertura (la RPC la exige).
  const abrir = async () => {
    setAbierto(true)
    if (!esPropio || !vigente || aperturaRegistrada) return
    const ok = await registrarApertura(vigente.id)
    setAperturaFallo(!ok)
    if (ok) {
      setAperturas(prev => [...prev, {
        version_id: vigente.id, empleado_id: empleadoId, abierto_at: new Date().toISOString(),
      }])
    }
  }

  const aceptar = async () => {
    if (!vigente || !puedeAceptar({ ...situacion, casillaMarcada: casilla })) return
    setEnviando(true); setErrorAceptar(null)
    const r = await aceptarEstatuto(vigente.id)
    setEnviando(false)
    if (!r.ok) { setErrorAceptar(r.error ?? 'No se pudo registrar la aceptación. Probá de nuevo.'); return }
    await cargar()
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', minWidth: 0, width: '100%', boxSizing: 'border-box', overflowWrap: 'anywhere' }}>
      {error && (
        <div style={{ ...card, borderColor: 'rgba(239,68,68,.45)', color: '#fca5a5', fontSize: 13.5 }}>
          No se pudo leer el Estatuto: {error}
        </div>
      )}

      {/* Encabezado: qué documento y en qué estado está la persona */}
      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 17, color: '#f8fafc', marginBottom: 6 }}>
          Estatuto Interno — Mercosur Seguridad SRL
        </div>
        {vigente ? (
          <>
            <div style={{ fontSize: 14, color: '#cbd5e1', lineHeight: 1.6 }}>
              {etiquetaVersion(vigente.identificador)}
              {vigente.publicado_at && <> · vigente desde el {fechaHoraArgentina(vigente.publicado_at)}</>}
            </div>
            <div style={{ marginTop: 10 }}>
              {estado === 'aceptado' ? (
                <span style={{ color: '#86efac', fontWeight: 700, fontSize: 14 }}>
                  {esPropio ? 'Ya aceptaste esta versión' : 'Aceptó esta versión'}
                </span>
              ) : (
                <span style={{ color: '#fbbf24', fontWeight: 700, fontSize: 14 }}>
                  {esPropio ? 'Pendiente de tu aceptación' : 'Pendiente de aceptación'}
                </span>
              )}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 14, color: '#94a3b8', lineHeight: 1.6 }}>
            Todavía no hay una versión publicada del Estatuto Interno.
          </div>
        )}
      </div>

      {vigente && (
        <>
          {/* Una sola opción: leer dentro de la app, las veces que quiera.
              Sin Word ni PDF (Gerencia, 08/10/2026). */}
          <div style={card}>
            <div style={{ ...etiqueta, marginBottom: 10 }}>Documento</div>
            {contenido ? (
              <button type="button" style={boton(!abierto)} onClick={() => abierto ? setAbierto(false) : void abrir()}>
                {abierto ? 'Ocultar Estatuto Interno' : 'Leer Estatuto Interno'}
              </button>
            ) : (
              <div style={{ fontSize: 13.5, color: '#94a3b8', marginBottom: 10, lineHeight: 1.5 }}>
                Esta versión todavía no se puede leer en la app. Consultá con Administración.
              </div>
            )}
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
              Huella del original (SHA-256): <span style={{ fontFamily: 'monospace' }}>{hashCorto(vigente.archivo_sha256)}</span>
            </div>
          </div>

          {abierto && contenido && (
            <div style={{ marginBottom: 14 }}>
              <DocumentoEstatuto contenido={contenido} />
            </div>
          )}

          {/* Declaración: sólo para la propia persona y mientras esté pendiente */}
          {esPropio && estado === 'pendiente' && (
            <div style={{ ...card, borderColor: 'rgba(245,158,11,.45)' }}>
              <div style={{ ...etiqueta, marginBottom: 10 }}>Aceptación</div>
              {!declaracionHabilitada(situacion) && (
                <div style={{ fontSize: 13.5, color: '#fbbf24', marginBottom: 12, lineHeight: 1.5 }}>
                  Para poder aceptar, primero abrí el documento completo.
                </div>
              )}
              {aperturaFallo && !aperturaRegistrada && (
                <div style={{ fontSize: 13.5, color: '#fca5a5', marginBottom: 12, lineHeight: 1.5 }}>
                  No se pudo registrar que abriste el documento. Revisá la conexión y
                  {' '}<button type="button" onClick={() => { setAbierto(false); void abrir() }}
                    style={{ background: 'none', border: 'none', color: '#fbbf24', textDecoration: 'underline', padding: 0, font: 'inherit', cursor: 'pointer' }}>
                    volvé a intentarlo
                  </button>.
                </div>
              )}
              <label style={{
                display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 14,
                opacity: declaracionHabilitada(situacion) ? 1 : 0.5,
                cursor: declaracionHabilitada(situacion) ? 'pointer' : 'not-allowed',
              }}>
                <input
                  type="checkbox"
                  checked={casilla}
                  disabled={!declaracionHabilitada(situacion)}
                  onChange={e => setCasilla(e.target.checked)}
                  style={{ width: 22, height: 22, flex: 'none', marginTop: 2 }}
                />
                <span style={{ fontSize: 15, color: '#e2e8f0', lineHeight: 1.55 }}>
                  {TEXTO_DECLARACION}
                </span>
              </label>
              <button
                type="button"
                disabled={!puedeAceptar({ ...situacion, casillaMarcada: casilla })}
                onClick={() => { void aceptar() }}
                style={boton(true, puedeAceptar({ ...situacion, casillaMarcada: casilla }))}
              >
                {enviando ? 'Registrando…' : 'Aceptar estatuto'}
              </button>
              {errorAceptar && <div style={{ fontSize: 13.5, color: '#fca5a5' }}>{errorAceptar}</div>}
            </div>
          )}
        </>
      )}

      {constanciaVigente && (
        <Constancia a={constanciaVigente} titulo={esPropio ? 'Tu constancia de aceptación' : 'Constancia de aceptación'} />
      )}

      {anteriores.length > 0 && (
        <div style={card}>
          <div style={{ ...etiqueta, marginBottom: 10 }}>Versiones anteriores aceptadas</div>
          {anteriores.map(a => (
            <div key={a.id} style={{ fontSize: 13.5, color: '#cbd5e1', lineHeight: 1.6, marginBottom: 6 }}>
              {etiquetaVersion(a.version_identificador)} · aceptada el {fechaHoraArgentina(a.aceptado_at)}
            </div>
          ))}
        </div>
      )}

      {!esPropio && !constanciaVigente && aceptaciones.length === 0 && (
        <div style={{ ...card, color: '#94a3b8', fontSize: 14 }}>
          Sin constancias de aceptación del Estatuto Interno.
        </div>
      )}

      <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6, padding: '0 4px 16px' }}>
        {ACLARACION_PAPEL}
      </div>
    </div>
  )
}
