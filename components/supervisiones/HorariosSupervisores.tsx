'use client'

/**
 * components/supervisiones/HorariosSupervisores.tsx
 *
 * Supervisiones por horario de TODOS los supervisores, con filtros por
 * supervisor, zona, objetivo y período (Etapa 2A, sólo lectura). Sirve para
 * ver rutinas (mismos lugares a la misma hora), horas nocturnas sin controles,
 * concentración al principio o al final del turno y objetivos poco visitados.
 *
 * Siempre al lado de las horas de SERVICIO programado: una hora vacía sólo
 * dice algo si había alguien de guardia. Un clic en un supervisor abre su
 * legajo operativo.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { fechaArgentina, sumarDias } from '@/lib/periodo-argentina'
import { validarRango } from '@/lib/evaluacion-supervisores'
import {
  cargarLegajoSupervisores, distribucionHoraria, matrizDiaHora, objetivosVisitados, posicionEnTurno, resumenLegajo,
} from '@/lib/legajo-supervisor'
import type { GuardiaLegajo, SupervisionLegajo } from '@/lib/legajo-supervisor'
import { BarraPosicionTurno, GraficoPorHora, MatrizDiaHora } from './GraficosHorarioSupervision'

const C = { bg: '#0f172a', borde: '#1e293b', texto: '#e2e8f0', tenue: '#94a3b8', apagado: '#64748b', celeste: '#38bdf8', amarillo: '#f59e0b', verde: '#10b981' }
const caja: React.CSSProperties = { minWidth: 0, boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.borde}`, borderRadius: 12, padding: 14 }
const campo: React.CSSProperties = { background: '#1e293b', border: '1px solid #334155', borderRadius: 8, color: C.texto, padding: '8px 10px', fontSize: 13, boxSizing: 'border-box', minWidth: 0, maxWidth: '100%' }
const th: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontSize: 11, color: C.apagado, fontWeight: 700, borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }
const td: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontSize: 12, color: C.texto, borderBottom: `1px solid ${C.borde}`, whiteSpace: 'nowrap' }
const titulo: React.CSSProperties = { fontSize: 14, fontWeight: 800, color: C.texto, marginBottom: 10 }

export default function HorariosSupervisores() {
  const hoy = fechaArgentina()
  const [desde, setDesde] = useState(sumarDias(hoy, -29))
  const [hasta, setHasta] = useState(hoy)
  const [guardias, setGuardias] = useState<GuardiaLegajo[]>([])
  const [sups, setSups] = useState<SupervisionLegajo[]>([])
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [fSup, setFSup] = useState('')
  const [fZona, setFZona] = useState('')
  const [fObj, setFObj] = useState('')

  const cargar = useCallback(async () => {
    const inv = validarRango(desde, hasta)
    if (inv) { setError(inv); return }
    setCargando(true)
    setError(null)
    const r = await cargarLegajoSupervisores(supabase, null, desde, hasta)
    setGuardias(r.guardias)
    setSups(r.supervisiones)
    setError(r.error)
    setCargando(false)
  }, [desde, hasta])

  useEffect(() => { void cargar() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const opciones = useMemo(() => {
    const s = new Map<string, string>()
    const z = new Set<string>()
    const o = new Map<string, string>()
    for (const x of sups) {
      s.set(x.supervisor_id, x.supervisor)
      if (x.zona) z.add(x.zona)
      if (x.objetivo_id) o.set(x.objetivo_id, x.objetivo ?? '—')
    }
    for (const g of guardias) s.set(g.supervisor_id, g.supervisor)
    const orden = (a: [string, string], b: [string, string]) => a[1].localeCompare(b[1], 'es')
    return { sups: Array.from(s).sort(orden), zonas: Array.from(z).sort(), objetivos: Array.from(o).sort(orden) }
  }, [sups, guardias])

  // Las guardias sólo se filtran por supervisor (y por zona, por su nombre):
  // el objetivo no recorta el servicio, que es de toda la zona.
  const supsF = useMemo(() => sups.filter(s =>
    (!fSup || s.supervisor_id === fSup) && (!fZona || s.zona === fZona) && (!fObj || s.objetivo_id === fObj)), [sups, fSup, fZona, fObj])
  const guardiasF = useMemo(() => guardias.filter(g =>
    (!fSup || g.supervisor_id === fSup) && (!fZona || (g.zona ?? '').trim().toLowerCase() === fZona.trim().toLowerCase())), [guardias, fSup, fZona])

  const horas = useMemo(() => distribucionHoraria(supsF, guardiasF), [supsF, guardiasF])
  const matriz = useMemo(() => matrizDiaHora(supsF), [supsF])
  const posicion = useMemo(() => posicionEnTurno(supsF, guardiasF), [supsF, guardiasF])
  const pocoVisitados = useMemo(() => objetivosVisitados(supsF).slice(0, 12), [supsF])
  const porSupervisor = useMemo(() => opciones.sups
    .filter(([id]) => !fSup || id === fSup)
    .map(([id, nombre]) => ({
      id, nombre,
      r: resumenLegajo(guardiasF.filter(g => g.supervisor_id === id), supsF.filter(s => s.supervisor_id === id)),
    })), [opciones.sups, fSup, guardiasF, supsF])

  return (
    <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
      <div style={{ ...caja, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: C.tenue }}>
          Desde<input type="date" value={desde} onChange={e => setDesde(e.target.value)} style={campo} />
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: C.tenue }}>
          Hasta<input type="date" value={hasta} onChange={e => setHasta(e.target.value)} style={campo} />
        </label>
        <button type="button" onClick={() => void cargar()} disabled={cargando}
                style={{ background: `${C.celeste}22`, color: C.celeste, border: `1px solid ${C.celeste}66`, borderRadius: 8, padding: '8px 12px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          {cargando ? 'Cargando…' : 'Ver período'}
        </button>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: C.tenue }}>
          Supervisor
          <select value={fSup} onChange={e => setFSup(e.target.value)} style={campo}>
            <option value="">Todos</option>
            {opciones.sups.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: C.tenue }}>
          Zona
          <select value={fZona} onChange={e => setFZona(e.target.value)} style={campo}>
            <option value="">Todas</option>
            {opciones.zonas.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 4, fontSize: 12, color: C.tenue }}>
          Objetivo
          <select value={fObj} onChange={e => setFObj(e.target.value)} style={campo}>
            <option value="">Todos</option>
            {opciones.objetivos.map(([id, n]) => <option key={id} value={id}>{n}</option>)}
          </select>
        </label>
      </div>

      {error && <div style={{ ...caja, color: '#fca5a5', fontSize: 13 }}>No se pudo cargar: {error}</div>}

      {!error && (
        <>
          <div style={caja}>
            <div style={titulo}>Supervisiones por hora del día ({supsF.length})</div>
            <GraficoPorHora filas={horas} />
            {fObj && <div style={{ fontSize: 11, color: C.apagado, marginTop: 6 }}>Con un objetivo elegido, la franja de servicio es la de toda la zona: el servicio no es por objetivo.</div>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
            <div style={caja}>
              <div style={titulo}>Por día de la semana y hora</div>
              <MatrizDiaHora matriz={matriz} />
            </div>
            <div style={caja}>
              <div style={titulo}>Dónde caen dentro del turno</div>
              <BarraPosicionTurno {...posicion} />
            </div>
          </div>

          <div style={caja}>
            <div style={titulo}>Por supervisor</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={{ ...th, textAlign: 'left' }}>Supervisor</th>
                  <th style={th}>Guardias de servicio</th><th style={th}>Hs programadas</th><th style={th}>Con GPS</th>
                  <th style={th}>Supervisiones</th><th style={th}>En turno</th><th style={th}>Fuera de turno</th>
                  <th style={th}>Sin guardia cargada</th><th style={th}>Por hora de servicio</th><th style={th} />
                </tr></thead>
                <tbody>
                  {porSupervisor.map(({ id, nombre, r }) => (
                    <tr key={id}>
                      <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{nombre}</td>
                      <td style={td}>{r.guardiasServicio}</td>
                      <td style={td}>{r.horasProgramadas}</td>
                      <td style={td}>{r.guardiasConGps}</td>
                      <td style={td}>{r.supervisiones}</td>
                      <td style={{ ...td, color: C.verde }}>{r.enTurno}</td>
                      <td style={{ ...td, color: r.fueraTurno ? C.amarillo : C.texto }}>{r.fueraTurno}</td>
                      <td style={td}>{r.sinCalendario}</td>
                      <td style={td}>{r.porHoraServicio ?? '—'}</td>
                      <td style={td}><a href={`/guardias/${id}?seccion=operativo`} style={{ color: C.celeste, fontWeight: 700, textDecoration: 'none' }}>Legajo</a></td>
                    </tr>
                  ))}
                  {!cargando && porSupervisor.length === 0 && <tr><td colSpan={10} style={{ ...td, textAlign: 'left', color: C.apagado }}>Sin datos para el período.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div style={caja}>
            <div style={titulo}>Objetivos con menos visitas en el período</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
              {pocoVisitados.map(o => (
                <div key={o.objetivo_id} style={{ border: `1px solid ${C.borde}`, borderRadius: 8, padding: 8, fontSize: 12, color: C.texto }}>
                  <div style={{ fontWeight: 700 }}>{o.objetivo}</div>
                  <div style={{ color: C.apagado }}>{o.visitas} visita{o.visitas === 1 ? '' : 's'}{o.zona ? ` · ${o.zona}` : ''}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: C.apagado, marginTop: 6 }}>
              Sólo aparecen objetivos con al menos una supervisión; los que nunca se visitaron están en Supervisiones → vencidos.
            </div>
          </div>
        </>
      )}
    </div>
  )
}
