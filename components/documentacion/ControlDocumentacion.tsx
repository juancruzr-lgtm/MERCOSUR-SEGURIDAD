'use client'

/**
 * components/documentacion/ControlDocumentacion.tsx
 *
 * Documentación del legajo, vista de Administración y Gerencia:
 *   Para revisar   lo que presentaron las personas (se valida o rechaza acá
 *                  mismo, abriendo los archivos) y lo que marcaron con error.
 *   Personas       validados vs. presentados sin validar, faltantes, vencidos,
 *                  solicitados y lo que espera la constancia de la persona.
 *
 * Para CARGAR documentos de alguien (p. ej. desde el legajo en papel) se
 * entra a su legajo → Documentación: cada persona tiene su enlace.
 *
 * Se monta sólo con `gestionar_personal`. La regla que manda es la de la base:
 * `documentacion_control` rechaza a cualquier otro. Supervisión no.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Documento } from '@/components/documentacion/DocumentacionLegajo'
import VencimientosDocumentacion from '@/components/documentacion/VencimientosDocumentacion'
import {
  esVigilador, fechaHora, resumenDocumentacion, situacionDeTipo,
} from '@/lib/documentacion'
import type { ControlDocumentacionDatos, PersonaControl, ResumenDocumentacion, TipoDocumento } from '@/lib/documentacion'
import { cargarControlDocumentacion } from '@/lib/documentacion-datos'

const card: React.CSSProperties = {
  background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 14, marginBottom: 12,
  minWidth: 0, boxSizing: 'border-box',
}
const pestaña = (activa: boolean): React.CSSProperties => ({
  background: 'none', border: 'none', borderBottom: activa ? '2px solid #f59e0b' : '2px solid transparent',
  color: activa ? '#f59e0b' : '#94a3b8', padding: '10px 12px', fontSize: 13.5, fontWeight: activa ? 700 : 400,
  cursor: 'pointer', flex: 'none',
})
const chip = (activo: boolean): React.CSSProperties => ({
  background: activo ? 'rgba(245,158,11,.15)' : 'transparent', color: activo ? '#fbbf24' : '#94a3b8',
  border: `1px solid ${activo ? 'rgba(245,158,11,.5)' : '#334155'}`, borderRadius: 999,
  padding: '6px 12px', fontSize: 13, cursor: 'pointer',
})
const etiquetaDato: React.CSSProperties = { fontSize: 10.5, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }

type Filtro = 'todos' | 'faltan' | 'vencidos' | 'para_aceptar' | 'completos'

interface Fila {
  p: PersonaControl
  r: ResumenDocumentacion
  faltantes: string[]
}

export default function ControlDocumentacion() {
  const [datos, setDatos] = useState<ControlDocumentacionDatos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [vista, setVista] = useState<'revisar' | 'personas' | 'vencimientos'>('revisar')
  const [soloVigiladores, setSoloVigiladores] = useState(true)
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const [buscar, setBuscar] = useState('')

  const cargar = useCallback(async () => {
    const r = await cargarControlDocumentacion()
    setDatos(r.datos); setError(r.error); setCargando(false)
  }, [])

  useEffect(() => { void cargar() }, [cargar])

  const tiposPorCodigo = useMemo(() => {
    const m = new Map<string, TipoDocumento>()
    for (const t of datos?.tipos ?? []) m.set(t.codigo, t)
    return m
  }, [datos])

  const filas: Fila[] = useMemo(() => {
    if (!datos) return []
    return datos.personas
      .filter(p => !soloVigiladores || esVigilador(p))
      .map(p => ({
        p,
        r: resumenDocumentacion(datos.tipos, p.documentos, datos.hoy, p.situaciones),
        faltantes: datos.tipos
          .filter(t => t.requisito === 'obligatorio')
          .filter(t => {
            const b = situacionDeTipo(t, p.documentos, datos.hoy, p.situaciones).base
            return b === 'falta' || b === 'vencido'
          })
          .map(t => t.nombre),
      }))
  }, [datos, soloVigiladores])

  const totales = useMemo(() => ({
    personas: filas.length,
    completos: filas.filter(f => f.r.validados === f.r.obligatorios).length,
    presentados: filas.reduce((a, f) => a + f.r.presentados, 0),
    paraRevisar: filas.reduce((a, f) => a + f.r.paraRevisar, 0),
    paraAceptar: filas.reduce((a, f) => a + f.r.paraAceptar, 0),
    vencidos: filas.filter(f => f.r.vencidos > 0 || f.r.porVencer > 0).length,
    observados: filas.reduce((a, f) => a + f.r.observados, 0),
  }), [filas])

  const visibles = useMemo(() => {
    const b = buscar.trim().toLowerCase()
    return filas
      .filter(f => !b || `${f.p.apellido} ${f.p.nombre} ${f.p.legajo ?? ''}`.toLowerCase().includes(b))
      .filter(f =>
        filtro === 'todos' ? true
        : filtro === 'faltan' ? f.faltantes.length > 0
        : filtro === 'vencidos' ? f.r.vencidos > 0 || f.r.porVencer > 0
        : filtro === 'para_aceptar' ? f.r.paraAceptar > 0
        : f.r.validados === f.r.obligatorios)
  }, [filas, filtro, buscar])

  if (cargando) return <div style={{ color: '#64748b', padding: 24 }}>Cargando documentación…</div>
  if (error || !datos) return <div style={{ ...card, color: '#fca5a5' }}>{error ?? 'No se pudo cargar.'}</div>

  const aRevisar = filas.flatMap(f => f.p.documentos
    .filter(d => d.estado === 'pendiente_revision')
    .map(d => ({ f, d, tipo: tiposPorCodigo.get(d.tipo) })))
  const observados = filas.flatMap(f => f.p.documentos
    .filter(d => d.estado === 'observado')
    .map(d => ({ f, d, tipo: tiposPorCodigo.get(d.tipo) })))

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', minWidth: 0 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#e2e8f0' }}>Documentación del legajo</div>
        <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4, lineHeight: 1.5 }}>
          Lo que sube cada persona queda presentado; recién cuando se revisa acá queda validado. Para cargar lo que ya
          tiene Administración, entrá al legajo de la persona → Documentación: la persona va a tener que confirmarlo.
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 140px), 1fr))', gap: 8, marginBottom: 12 }}>
        {[
          ['Personas', totales.personas, '#e2e8f0'],
          ['Con todo validado', totales.completos, '#86efac'],
          ['Para revisar', totales.paraRevisar, '#fbbf24'],
          ['Esperando constancia', totales.paraAceptar, '#93c5fd'],
          ['Vencidos o por vencer', totales.vencidos, '#fca5a5'],
        ].map(([t, n, c]) => (
          <div key={t as string} style={{ ...card, marginBottom: 0, padding: 12 }}>
            <div style={etiquetaDato}>{t}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: c as string }}>{n}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #1e2d42', marginBottom: 12, overflowX: 'auto' }}>
        <button type="button" style={pestaña(vista === 'revisar')} onClick={() => setVista('revisar')}>
          Para revisar ({aRevisar.length + observados.length})
        </button>
        <button type="button" style={pestaña(vista === 'personas')} onClick={() => setVista('personas')}>Personas</button>
        <button type="button" style={pestaña(vista === 'vencimientos')} onClick={() => setVista('vencimientos')}>Vencimientos</button>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#94a3b8', padding: '0 8px', whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={soloVigiladores} onChange={e => setSoloVigiladores(e.target.checked)} />
          Sólo vigiladores
        </label>
      </div>

      {vista === 'revisar' && (
        <>
          {aRevisar.length === 0 && observados.length === 0 && (
            <div style={{ ...card, color: '#94a3b8' }}>No hay nada para revisar.</div>
          )}
          {aRevisar.map(({ f, d, tipo }) => tipo && (
            <div key={d.id} style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <a href={`/guardias/${f.p.empleado_id}?seccion=documentacion`}
                  style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14.5, overflowWrap: 'anywhere' }}>
                  {f.p.apellido}, {f.p.nombre}
                </a>
                <span style={{ fontSize: 12.5, color: '#94a3b8' }}>Legajo {f.p.legajo ?? '—'}</span>
              </div>
              <div style={{ fontSize: 14, color: '#fbbf24', fontWeight: 700, marginTop: 4 }}>{tipo.nombre}</div>
              <Documento doc={d} tipo={tipo} esPropio={false} puedeGestionar
                nombrePersona={`${f.p.nombre} ${f.p.apellido}`} onCambio={() => void cargar()} />
            </div>
          ))}
          {observados.length > 0 && (
            <div style={{ fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.06em', fontWeight: 700, margin: '18px 2px 8px' }}>
              La persona avisó que hay un error
            </div>
          )}
          {observados.map(({ f, d, tipo }) => (
            <div key={d.id} style={card}>
              <a href={`/guardias/${f.p.empleado_id}?seccion=documentacion`}
                style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14.5, overflowWrap: 'anywhere' }}>
                {f.p.apellido}, {f.p.nombre}
              </a>
              <div style={{ fontSize: 14, color: '#fca5a5', fontWeight: 700, marginTop: 4 }}>{tipo?.nombre ?? d.tipo}</div>
              <div style={{ fontSize: 13.5, color: '#cbd5e1', marginTop: 4 }}>“{d.respuesta_comentario}”</div>
              <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 4 }}>
                Cargado el {fechaHora(d.confirmado_at)}. Entrá al legajo para cargar el correcto o anularlo.
              </div>
            </div>
          ))}
        </>
      )}

      {vista === 'vencimientos' && <VencimientosDocumentacion />}

      {vista === 'personas' && (
        <>
          <input
            placeholder="Buscar por apellido, nombre o legajo"
            value={buscar} onChange={e => setBuscar(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box', background: '#0b1220', border: '1px solid #334155',
              borderRadius: 8, color: '#e2e8f0', padding: '10px 12px', fontSize: 14.5, marginBottom: 10,
            }}
          />
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            {([
              ['todos', 'Todos'], ['faltan', 'Con faltantes'], ['vencidos', 'Vencidos o por vencer'],
              ['para_aceptar', 'Esperando constancia'], ['completos', 'Todo validado'],
            ] as [Filtro, string][]).map(([k, t]) => (
              <button key={k} type="button" style={chip(filtro === k)} onClick={() => setFiltro(k)}>{t}</button>
            ))}
          </div>
          {visibles.length === 0 && <div style={{ color: '#64748b', padding: 8 }}>Nadie.</div>}
          <div style={{ display: 'grid', gap: 8 }}>
            {visibles.map(({ p, r, faltantes }) => (
              <div key={p.empleado_id} style={{ ...card, marginBottom: 0, padding: '10px 12px', background: '#0f172a' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <a href={`/guardias/${p.empleado_id}?seccion=documentacion`}
                    style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 14, overflowWrap: 'anywhere' }}>
                    {p.apellido}, {p.nombre}
                  </a>
                  <span style={{ fontSize: 13.5, color: r.validados === r.obligatorios ? '#86efac' : '#cbd5e1' }}>
                    <b>{r.validados}</b> de {r.obligatorios} validados
                  </span>
                </div>
                <div style={{ height: 5, background: '#1e293b', borderRadius: 99, marginTop: 6, overflow: 'hidden' }}>
                  <div style={{ width: `${r.obligatorios ? (r.validados / r.obligatorios) * 100 : 0}%`, height: '100%', background: r.validados === r.obligatorios ? '#22c55e' : '#f59e0b' }} />
                </div>
                <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 6, lineHeight: 1.5 }}>
                  {[
                    r.presentados ? `${r.presentados} presentado${r.presentados > 1 ? 's' : ''} sin validar` : null,
                    r.paraRevisar ? `${r.paraRevisar} para revisar` : null,
                    r.solicitados ? `${r.solicitados} solicitado${r.solicitados > 1 ? 's' : ''}` : null,
                    r.paraAceptar ? `${r.paraAceptar} esperando constancia` : null,
                    r.observados ? `${r.observados} con observación` : null,
                    r.rechazados ? `${r.rechazados} rechazado${r.rechazados > 1 ? 's' : ''}` : null,
                    r.porVencer ? `${r.porVencer} por vencer` : null,
                  ].filter(Boolean).join(' · ')}
                  {faltantes.length > 0 && (
                    <div style={{ color: '#cbd5e1', overflowWrap: 'anywhere' }}>Falta: {faltantes.join(', ')}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
