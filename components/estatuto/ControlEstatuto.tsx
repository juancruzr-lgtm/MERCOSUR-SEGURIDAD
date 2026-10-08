'use client'

/**
 * components/estatuto/ControlEstatuto.tsx
 *
 * Control del Estatuto Interno para Administración y Gerencia: versiones,
 * cuántos alcanzados, cuántos aceptaron, quiénes faltan, y publicar.
 *
 * ── Quién lo ve ──────────────────────────────────────────────────────────────
 * Se monta sólo con `gestionar_personal` (Administración, Gerencia, y el
 * override de acceso admin pleno). La regla que manda es la de la base:
 * `estatuto_control` rechaza a cualquier otro aunque llegue hasta acá.
 * Supervisión no: la constancia es documentación laboral.
 *
 * ── Publicar ─────────────────────────────────────────────────────────────────
 * El botón aparece sólo para Gerencia y pide confirmación. Publicar convierte
 * la versión en vigente y le vuelve a pedir la aceptación a todos; no se puede
 * deshacer ni cambiar el documento después (lo impide la base).
 *
 * ── Universo ─────────────────────────────────────────────────────────────────
 * Usuarios activos, sin cuentas de prueba: vigiladores, supervisores y
 * personal administrativo. Lo define la RPC, no esta pantalla.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import DocumentoEstatuto from '@/components/estatuto/DocumentoEstatuto'
import EstatutoInterno from '@/components/estatuto/EstatutoInterno'
import {
  contenidoDeVersion, etiquetaVersion, fechaHoraArgentina, resumenControl, versionVigente,
} from '@/lib/estatuto'
import type { PersonaControl, VersionEstatuto } from '@/lib/estatuto'
import { cargarControl, cargarVersiones, publicarVersion } from '@/lib/estatuto-datos'
import { esGerenciaReal } from '@/lib/capacidades'
import type { SujetoAcceso } from '@/lib/capacidades'

const card: React.CSSProperties = {
  background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 16, marginBottom: 14,
}
const pestaña = (activa: boolean): React.CSSProperties => ({
  background: 'none', border: 'none', borderBottom: activa ? '2px solid #f59e0b' : '2px solid transparent',
  color: activa ? '#f59e0b' : '#94a3b8', padding: '10px 12px', fontSize: 13.5, fontWeight: activa ? 700 : 400,
  cursor: 'pointer', flex: 'none',
})
const dato: React.CSSProperties = { minWidth: 0 }
const datoEtiqueta: React.CSSProperties = {
  fontSize: 10.5, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em',
}

/**
 * El listado nominal como TARJETAS apiladas, no como tabla.
 *
 * A 390 px la tabla de cuatro columnas cortaba la última ("Última versión
 * aceptada") y obligaba a desplazar de costado. Cada persona es un bloque con
 * su nombre arriba y los datos debajo en una grilla que se reacomoda sola
 * (`minmax(min(100%, …), 1fr)`): en el celular quedan uno o dos por fila, en
 * la computadora los cuatro en línea. Nada puede ser más ancho que la pantalla.
 */
function Listado({ personas, conFecha }: { personas: PersonaControl[]; conFecha: boolean }) {
  if (personas.length === 0) return <div style={{ color: '#64748b', fontSize: 13.5, padding: 8 }}>Nadie.</div>
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {personas.map(p => (
        <div key={p.empleado_id} style={{
          border: '1px solid #1e2d42', borderRadius: 8, padding: '10px 12px', background: '#0f172a', minWidth: 0,
        }}>
          <a href={`/guardias/${p.empleado_id}?seccion=estatuto`}
            style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14, overflowWrap: 'anywhere' }}>
            {p.apellido}, {p.nombre}
          </a>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))',
            gap: '6px 12px', marginTop: 6, fontSize: 13, color: '#cbd5e1',
          }}>
            <div style={dato}><div style={datoEtiqueta}>Legajo</div>{p.legajo ?? '—'}</div>
            <div style={dato}><div style={datoEtiqueta}>Puesto</div>{p.puesto ?? p.rol ?? '—'}</div>
            <div style={dato}>
              <div style={datoEtiqueta}>{conFecha ? 'Aceptó' : 'Abrió el documento'}</div>
              {conFecha ? fechaHoraArgentina(p.aceptado_at) : (p.abierto_at ? fechaHoraArgentina(p.abierto_at) : 'No')}
            </div>
            <div style={dato}>
              <div style={datoEtiqueta}>Última versión aceptada</div>
              {p.ultima_version_aceptada
                ? <>{etiquetaVersion(p.ultima_version_aceptada)} · {fechaHoraArgentina(p.ultima_aceptacion_at)}</>
                : '—'}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ControlEstatuto({ user }: { user: SujetoAcceso & { id: string } }) {
  const [vista, setVista] = useState<'control' | 'versiones' | 'propio'>('control')
  const [versiones, setVersiones] = useState<VersionEstatuto[]>([])
  const [seleccion, setSeleccion] = useState<string | null>(null)
  const [personas, setPersonas] = useState<PersonaControl[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [publicando, setPublicando] = useState(false)
  const [verBorrador, setVerBorrador] = useState<string | null>(null)
  const esGerencia = esGerenciaReal(user) || user.acceso_gerencia_delegado === true

  const cargarTodo = useCallback(async () => {
    setCargando(true)
    const v = await cargarVersiones()
    setVersiones(v.versiones)
    const vig = versionVigente(v.versiones)
    const elegida = seleccion ?? vig?.id ?? v.versiones[0]?.id ?? null
    setSeleccion(elegida)
    if (elegida) {
      const c = await cargarControl(elegida)
      setPersonas(c.personas)
      setError(v.error ?? c.error)
    } else {
      setPersonas([])
      setError(v.error)
    }
    setCargando(false)
  }, [seleccion])

  useEffect(() => { void cargarTodo() }, [cargarTodo])

  const vigente = useMemo(() => versionVigente(versiones), [versiones])
  const elegida = versiones.find(v => v.id === seleccion) ?? null
  const resumen = useMemo(() => resumenControl(personas), [personas])

  const publicar = async (v: VersionEstatuto) => {
    const ok = window.confirm(
      `¿Publicar el Estatuto Interno (${etiquetaVersion(v.identificador).toLowerCase()})?\n\n` +
      'Pasa a ser la versión vigente: se le pedirá la aceptación a todo el personal activo. ' +
      'Una vez publicada, el documento no se puede modificar ni despublicar.',
    )
    if (!ok) return
    setPublicando(true)
    const r = await publicarVersion(v.id)
    setPublicando(false)
    if (r.error) { setError(r.error); return }
    await cargarTodo()
  }

  return (
    <div style={{ maxWidth: 1000, minWidth: 0, width: '100%', boxSizing: 'border-box' }}>
      <div style={{ fontWeight: 800, fontSize: 20, color: '#f8fafc', marginBottom: 4 }}>Estatuto Interno</div>
      <div style={{ fontSize: 13.5, color: '#94a3b8', marginBottom: 12, lineHeight: 1.5 }}>
        Versiones, aceptaciones y pendientes. Las constancias son inmutables y no
        reemplazan las firmadas en papel.
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid #1e2d42', marginBottom: 14, overflowX: 'auto' }}>
        <button type="button" style={pestaña(vista === 'control')} onClick={() => setVista('control')}>Aceptaciones</button>
        <button type="button" style={pestaña(vista === 'versiones')} onClick={() => setVista('versiones')}>Versiones</button>
        <button type="button" style={pestaña(vista === 'propio')} onClick={() => setVista('propio')}>Mi aceptación</button>
      </div>

      {error && <div style={{ ...card, borderColor: 'rgba(239,68,68,.45)', color: '#fca5a5', fontSize: 13.5 }}>{error}</div>}
      {cargando && <div style={{ color: '#64748b', padding: 16 }}>Cargando…</div>}

      {!cargando && vista === 'control' && (
        <>
          {!vigente && (
            <div style={{ ...card, borderColor: 'rgba(245,158,11,.45)', color: '#fbbf24', fontSize: 13.5, lineHeight: 1.5 }}>
              No hay ninguna versión publicada: todavía no se le pide la aceptación a nadie.
              {elegida && <> Se muestra el estado de la {etiquetaVersion(elegida.identificador).toLowerCase()} ({elegida.estado}).</>}
            </div>
          )}
          {versiones.length > 1 && (
            <div style={{ marginBottom: 12 }}>
              <select
                value={seleccion ?? ''}
                onChange={e => setSeleccion(e.target.value || null)}
                style={{ background: '#0f172a', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 8, padding: '8px 10px', maxWidth: '100%', boxSizing: 'border-box' }}
              >
                {versiones.map(v => (
                  <option key={v.id} value={v.id}>
                    {etiquetaVersion(v.identificador)} · {v.estado}{v.id === vigente?.id ? ' (vigente)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: 10, marginBottom: 14 }}>
            {[
              { l: 'Activos alcanzados', v: resumen.alcanzados, c: '#e2e8f0' },
              { l: 'Aceptaron', v: resumen.aceptaron, c: '#86efac' },
              { l: 'Pendientes', v: resumen.pendientes, c: '#fbbf24' },
              { l: 'Abrieron sin aceptar', v: resumen.abrieronSinAceptar, c: '#94a3b8' },
            ].map(k => (
              <div key={k.l} style={{ ...card, marginBottom: 0 }}>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }}>{k.l}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: k.c }}>{k.v}</div>
              </div>
            ))}
          </div>
          <div style={card}>
            <div style={{ fontWeight: 700, color: '#fbbf24', marginBottom: 8 }}>Pendientes ({resumen.pendientes})</div>
            <Listado personas={resumen.listaPendientes} conFecha={false} />
          </div>
          <div style={card}>
            <div style={{ fontWeight: 700, color: '#86efac', marginBottom: 8 }}>Aceptaron ({resumen.aceptaron})</div>
            <Listado personas={resumen.listaAceptaron} conFecha />
          </div>
        </>
      )}

      {!cargando && vista === 'versiones' && (
        <>
          {versiones.length === 0 && <div style={{ ...card, color: '#94a3b8' }}>No hay versiones cargadas.</div>}
          {versiones.map(v => {
            const contenido = contenidoDeVersion(v.identificador)
            return (
              <div key={v.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <div style={{ fontWeight: 800, color: '#f8fafc' }}>
                      {etiquetaVersion(v.identificador)}
                      {v.id === vigente?.id && <span style={{ color: '#86efac', fontSize: 12.5, marginLeft: 8 }}>VIGENTE</span>}
                    </div>
                    <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6, marginTop: 4 }}>
                      {v.estado === 'publicado'
                        ? `publicada el ${fechaHoraArgentina(v.publicado_at)}`
                        : 'BORRADOR (no se le muestra al personal)'}
                      <br />Archivo: <a href={v.archivo_ruta} download={v.archivo_nombre} style={{ color: '#cbd5e1', overflowWrap: 'anywhere' }}>{v.archivo_nombre}</a> ({v.archivo_bytes.toLocaleString('es-AR')} bytes)
                      <br />SHA-256: <span style={{ fontFamily: 'monospace', fontSize: 12, overflowWrap: 'anywhere' }}>{v.archivo_sha256}</span>
                      {contenido && contenido.texto_sha256 !== v.texto_sha256 && (
                        <><br /><span style={{ color: '#fca5a5' }}>El texto empaquetado en la app no coincide con el registrado para esta versión.</span></>
                      )}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    {contenido && (
                      <button type="button" onClick={() => setVerBorrador(verBorrador === v.id ? null : v.id)}
                        style={{ background: 'transparent', border: '1px solid #334155', color: '#cbd5e1', borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>
                        {verBorrador === v.id ? 'Ocultar texto' : 'Ver texto'}
                      </button>
                    )}
                    {esGerencia && v.estado === 'borrador' && (
                      <button type="button" disabled={publicando} onClick={() => { void publicar(v) }}
                        style={{ background: '#f59e0b', border: 'none', color: '#1a1205', fontWeight: 800, borderRadius: 8, padding: '8px 12px', cursor: 'pointer' }}>
                        {publicando ? 'Publicando…' : 'Publicar'}
                      </button>
                    )}
                  </div>
                </div>
                {verBorrador === v.id && contenido && (
                  <div style={{ marginTop: 12 }}><DocumentoEstatuto contenido={contenido} /></div>
                )}
              </div>
            )
          })}
          {!esGerencia && (
            <div style={{ fontSize: 12.5, color: '#64748b' }}>Publicar una versión es exclusivo de Gerencia.</div>
          )}
        </>
      )}

      {vista === 'propio' && <EstatutoInterno empleadoId={user.id} esPropio />}
    </div>
  )
}
