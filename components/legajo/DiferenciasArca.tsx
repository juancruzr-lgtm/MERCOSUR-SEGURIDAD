'use client'

/**
 * components/legajo/DiferenciasArca.tsx
 *
 * Legajo Digital → Diferencias con ARCA (Administración/Gerencia).
 *   - Cargar la «Consulta de Relaciones Laborales» de ARCA (uno o varios .txt).
 *   - Contratos con fecha de fin (eventuales): inicio, fin, días y situación en la app.
 *   - Lo demás que requiere una decisión: activos que no figuran en ARCA, relaciones
 *     vigentes sin usuario activo, CUIL faltante, identidad distinta, DNI repetido…
 * Nada se corrige ni se da de baja solo. Cada diferencia se resuelve en su lugar
 * (o se marca «revisada» con una nota) y queda registrada.
 * DiferenciaItem se reutiliza en el legajo de cada persona (DiferenciasEmpleado).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ORDEN_TIPOS, TEXTO_TIPO, corregirIdentidad, cargarDiferencias, cargarResumen, detalleTexto, diasTexto, fechaCorta,
  bajaRegistradaPorCuil, fechaDeArchivo, importarConsulta, leerConsultaArca, reabrirDiferencia, revisarDiferencia, situacionTexto, unirRelaciones,
} from '@/lib/legajo-diferencias'
import type { Diferencia, RelacionArca, ResumenDiferencias, TipoDiferencia } from '@/lib/legajo-diferencias'

export const card: React.CSSProperties = { background: '#111827', border: '1px solid #1e2d42', borderRadius: 10, padding: 14, marginBottom: 10, minWidth: 0, boxSizing: 'border-box' }
const boton = (color = '#cbd5e1'): React.CSSProperties => ({ background: 'transparent', color, border: '1px solid #334155', borderRadius: 8, padding: '7px 12px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', minHeight: 36 })
const input: React.CSSProperties = { width: '100%', boxSizing: 'border-box', background: '#0b1220', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: '9px 10px', fontSize: 14 }
const COLOR_GRAVEDAD = { alta: '#f87171', media: '#fbbf24', baja: '#94a3b8' } as const
const celda: React.CSSProperties = { padding: '7px 6px', borderTop: '1px solid #1e293b', fontSize: 13.5, color: '#e2e8f0', verticalAlign: 'top', overflowWrap: 'anywhere' }

export function DiferenciaItem({ d, onCambio, conPersona = true }: { d: Diferencia; onCambio: () => void; conPersona?: boolean }) {
  const [revisando, setRevisando] = useState(false)
  const [bajaApp, setBajaApp] = useState<{ fecha_baja: string | null; estado: string } | null>(null)
  const [nota, setNota] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const x = d.detalle as Record<string, any>
  const hacer = async (f: () => Promise<string | null>) => { setOcupado(true); setError(null); const e = await f(); setOcupado(false); if (e) setError(e); else { setRevisando(false); setNota(''); onCambio() } }
  // ARCA no da de baja a nadie: si la persona dejó de figurar (o su contrato
  // terminó), se inicia el MISMO procedimiento de baja del legajo (fecha, motivo,
  // telegrama, vacaciones, confirmación). Nada se confirma sólo por el archivo.
  const puedeRegistrarBaja = (d.tipo === 'activo_sin_relacion' || d.tipo === 'contrato_con_fin') && Boolean(d.empleado_id)
  // Al revés: baja registrada en la app y la relación sigue vigente en ARCA.
  useEffect(() => {
    if (d.tipo !== 'relacion_sin_usuario' || !d.cuil) return
    let vivo = true
    void bajaRegistradaPorCuil(d.cuil).then(b => { if (vivo) setBajaApp(b) })
    return () => { vivo = false }
  }, [d.tipo, d.cuil])
  const situacion = situacionTexto(d)
  const puedeCargarCuil = d.tipo === 'sin_cuil' && d.empleado_id && typeof x.cuil_arca === 'string' && x.nombre_coincide === true
  return (
    <div style={{ ...card, borderLeft: `3px solid ${d.revisada ? '#334155' : COLOR_GRAVEDAD[d.gravedad]}`, opacity: d.revisada ? 0.8 : 1 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        {conPersona
          ? (d.empleado_id ? <a href={`/guardias/${d.empleado_id}?seccion=datos`} style={{ color: '#e2e8f0', fontWeight: 700 }}>{d.persona}</a> : <span style={{ color: '#e2e8f0', fontWeight: 700 }}>{d.persona}</span>)
          : <span style={{ color: '#e2e8f0', fontWeight: 700 }}>{TEXTO_TIPO[d.tipo].titulo}</span>}
        {d.cuil && <span style={{ fontSize: 12.5, color: '#94a3b8' }}>CUIL {d.cuil}</span>}
      </div>
      <div style={{ fontSize: 14, color: '#cbd5e1', marginTop: 4 }}>{detalleTexto(d)}</div>
      {situacion && <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 2 }}>En la app: {situacion}</div>}
      {d.revisada && <div style={{ fontSize: 13, color: '#86efac', marginTop: 4 }}>Revisada{d.revisado_por ? ` por ${d.revisado_por}` : ''} el {fechaCorta(d.revisado_at)}: “{d.nota}”</div>}
      {!revisando && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          {puedeCargarCuil && !d.revisada && (
            <button type="button" disabled={ocupado} style={boton('#86efac')}
              onClick={() => void hacer(() => corregirIdentidad(d.empleado_id!, 'cuil', String(x.cuil_arca), 'ARCA — Consulta de Relaciones Laborales', 'CUIL de ARCA encontrado por DNI y nombre'))}>
              Cargar CUIL {String(x.cuil_arca)} de ARCA
            </button>
          )}
          {puedeRegistrarBaja && !d.revisada && (
            <a href={`/guardias/${d.empleado_id}?seccion=situacion&baja=1&origen=arca`} style={{ ...boton('#fca5a5'), textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}>Registrar baja</a>
          )}
          {d.revisada
            ? <button type="button" disabled={ocupado} style={boton()} onClick={() => void hacer(() => reabrirDiferencia(d.clave))}>Reabrir</button>
            : <button type="button" style={boton()} onClick={() => setRevisando(true)}>Marcar revisada</button>}
        </div>
      )}
      {bajaApp && (
        <div style={{ fontSize: 13, color: '#fbbf24', marginTop: 4 }}>
          Baja {bajaApp.estado === 'confirmada' ? 'confirmada' : 'en borrador'} en la app{bajaApp.fecha_baja ? ` desde el ${fechaCorta(bajaApp.fecha_baja)}` : ''}: verificar que se registró la baja en ARCA.
        </div>
      )}
      {revisando && (
        <div style={{ marginTop: 8 }}>
          <input value={nota} onChange={e => setNota(e.target.value)} maxLength={300} style={input}
            placeholder="Qué se decidió o verificó (p. ej.: se renueva el contrato hasta…; alta en ARCA hecha el…)" />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button type="button" disabled={ocupado || nota.trim().length < 3} onClick={() => void hacer(() => revisarDiferencia(d.clave, nota))}
              style={{ ...boton('#0b1220'), background: '#16a34a', border: 'none', color: '#fff', fontWeight: 800 }}>Guardar</button>
            <button type="button" onClick={() => setRevisando(false)} style={boton()}>Cancelar</button>
          </div>
        </div>
      )}
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>{error}</div>}
    </div>
  )
}

function CargarConsulta({ onCargada }: { onCargada: () => void }) {
  const [lectura, setLectura] = useState<{ archivos: string[]; filas: RelacionArca[]; fecha: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)
  const elegir = async (lista: FileList | null) => {
    setError(null); setHecho(null); setLectura(null)
    if (!lista || !lista.length) return
    const archivos = Array.from(lista)
    const listas: RelacionArca[][] = []
    const fechas = new Set<string>()
    for (const f of archivos) {
      const r = leerConsultaArca(await f.text())
      if (r.error) { setError(`${f.name}: ${r.error}`); return }
      listas.push(r.filas)
      const fe = fechaDeArchivo(f.name); if (fe) fechas.add(fe)
    }
    if (fechas.size > 1) { setError('Los archivos son de consultas de distintas fechas: cargalos por separado.'); return }
    setLectura({ archivos: archivos.map(f => f.name), filas: unirRelaciones(listas), fecha: Array.from(fechas)[0] ?? '' })
  }
  const cargar = async () => {
    if (!lectura?.fecha) { setError('Indicá la fecha de la consulta'); return }
    setOcupado(true); setError(null)
    const r = await importarConsulta(lectura.fecha, lectura.archivos.join(', ').slice(0, 120), lectura.filas)
    setOcupado(false)
    if (typeof r === 'string') { setError(r); return }
    setHecho(`Consulta del ${fechaCorta(lectura.fecha)} cargada: ${r.nuevas} relaciones nuevas (${r.total} en total).`)
    setLectura(null); onCargada()
  }
  return (
    <div style={{ marginTop: 10 }}>
      <label style={{ ...boton('#93c5fd'), display: 'inline-flex', alignItems: 'center' }}>
        Cargar consulta de ARCA (.txt)
        <input type="file" accept=".txt,text/plain" multiple style={{ display: 'none' }} onChange={e => { void elegir(e.target.files); e.target.value = '' }} />
      </label>
      <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 6, lineHeight: 1.45 }}>
        ARCA → Mi Simplificación → Consulta de Relaciones Laborales → exportar. Cargá <b>todas</b> las relaciones vigentes de la misma consulta (si ARCA las parte en varios archivos, elegilos juntos): si falta una parte, sus personas van a aparecer como «no figura en ARCA».
      </div>
      {lectura && (
        <div style={{ ...card, marginTop: 8, background: '#0b1220' }}>
          <div style={{ fontSize: 14, color: '#e2e8f0' }}>{lectura.archivos.length} {lectura.archivos.length === 1 ? 'archivo' : 'archivos'} · <b>{lectura.filas.length}</b> relaciones laborales · {lectura.filas.filter(f => f.fin).length} con fecha de fin</div>
          <label style={{ display: 'block', fontSize: 13, color: '#94a3b8', marginTop: 8 }}>Fecha de la consulta
            <input type="date" value={lectura.fecha} onChange={e => setLectura({ ...lectura, fecha: e.target.value })} style={{ ...input, marginTop: 4, maxWidth: 220 }} />
          </label>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button type="button" disabled={ocupado} onClick={() => void cargar()} style={{ ...boton(), background: '#2563eb', border: 'none', color: '#fff', fontWeight: 800 }}>{ocupado ? 'Cargando…' : 'Cargar'}</button>
            <button type="button" onClick={() => setLectura(null)} style={boton()}>Cancelar</button>
          </div>
        </div>
      )}
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 6 }}>{error}</div>}
      {hecho && <div role="status" style={{ color: '#86efac', fontSize: 13, marginTop: 6 }}>{hecho}</div>}
    </div>
  )
}

function TablaContratos({ filas, onCambio }: { filas: Diferencia[]; onCambio: () => void }) {
  const [abierta, setAbierta] = useState<string | null>(null)
  return (
    <div style={{ ...card, overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
        <thead>
          <tr style={{ fontSize: 12, color: '#64748b', textAlign: 'left' }}>
            <th style={{ padding: '0 6px' }}>Persona</th><th style={{ padding: '0 6px' }}>Modalidad</th><th style={{ padding: '0 6px' }}>Inicio</th>
            <th style={{ padding: '0 6px' }}>Fin</th><th style={{ padding: '0 6px' }}>Situación en la app</th><th style={{ padding: '0 6px' }}></th>
          </tr>
        </thead>
        <tbody>
          {filas.map(d => {
            const x = d.detalle as Record<string, any>
            return [
              <tr key={d.clave}>
                <td style={celda}>{d.empleado_id ? <a href={`/guardias/${d.empleado_id}?seccion=datos`} style={{ color: '#e2e8f0', fontWeight: 700 }}>{d.persona}</a> : d.persona}</td>
                <td style={celda}>{x.modalidad ?? '—'}</td>
                <td style={celda}>{fechaCorta(x.inicio)}</td>
                <td style={{ ...celda, color: COLOR_GRAVEDAD[d.gravedad], fontWeight: 700 }}>{fechaCorta(x.fin)}<div style={{ fontSize: 12, fontWeight: 500 }}>{diasTexto(x.dias_restantes)}</div></td>
                <td style={{ ...celda, color: '#94a3b8' }}>{situacionTexto(d)}{d.revisada && <div style={{ color: '#86efac' }}>Revisada: “{d.nota}”</div>}</td>
                <td style={celda}><button type="button" style={boton()} onClick={() => setAbierta(abierta === d.clave ? null : d.clave)}>{abierta === d.clave ? 'Cerrar' : d.revisada ? 'Ver' : 'Revisar'}</button></td>
              </tr>,
              abierta === d.clave && <tr key={d.clave + ':x'}><td colSpan={6} style={{ padding: '4px 0' }}><DiferenciaItem d={d} onCambio={onCambio} /></td></tr>,
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function DiferenciasArca() {
  const [filas, setFilas] = useState<Diferencia[] | null>(null)
  const [resumen, setResumen] = useState<ResumenDiferencias | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [verRevisadas, setVerRevisadas] = useState(false)
  const [filtro, setFiltro] = useState<TipoDiferencia | ''>('')
  const cargar = useCallback(async () => {
    const [d, r] = await Promise.all([cargarDiferencias(), cargarResumen()])
    setFilas(d.filas); setResumen(r.resumen); setError(d.denegado ? 'Sólo Administración o Gerencia' : d.error ?? r.error)
  }, [])
  useEffect(() => { void cargar() }, [cargar])
  const pendientes = useMemo(() => (filas ?? []).filter(d => !d.revisada), [filas])
  const revisadas = useMemo(() => (filas ?? []).filter(d => d.revisada), [filas])
  if (error) return <div style={{ ...card, color: '#fca5a5' }}>{error}</div>
  if (!filas) return <div style={{ color: '#64748b', padding: 24 }}>Cargando…</div>
  const cuenta = (t: TipoDiferencia) => pendientes.filter(d => d.tipo === t).length
  const contratos = (filas ?? []).filter(d => d.tipo === 'contrato_con_fin' && (verRevisadas || !d.revisada))
  const otros = (verRevisadas ? revisadas : pendientes).filter(d => d.tipo !== 'contrato_con_fin' && (!filtro || d.tipo === filtro))
  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: '#e2e8f0' }}>Diferencias con ARCA</div>
      <div style={{ fontSize: 13, color: '#94a3b8', margin: '4px 0 12px', lineHeight: 1.45 }}>
        Compara la última consulta de relaciones laborales de ARCA con los usuarios activos y el legajo. No cambia ni da de baja a nadie: cada caso lo resuelve Administración y queda registrado.
      </div>
      <div style={card}>
        <div style={{ fontSize: 14, color: '#e2e8f0' }}>
          {resumen?.consulta
            ? <>Última consulta cargada: <b>{fechaCorta(resumen.consulta)}</b> · {resumen.relaciones} relaciones laborales</>
            : 'Todavía no se cargó ninguna consulta de ARCA.'}
        </div>
        {resumen && resumen.consultas.length > 1 && (
          <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 2 }}>Anteriores: {resumen.consultas.slice(1).map(c => `${fechaCorta(c.fecha)} (${c.relaciones})`).join(' · ')}</div>
        )}
        <CargarConsulta onCargada={() => void cargar()} />
      </div>

      <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0', margin: '16px 0 6px' }}>Contratos con fecha de fin ({cuenta('contrato_con_fin')})</div>
      <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 8 }}>{TEXTO_TIPO.contrato_con_fin.ayuda}</div>
      {contratos.length ? <TablaContratos filas={contratos} onCambio={() => void cargar()} /> : <div style={{ ...card, color: '#94a3b8' }}>Ninguno pendiente.</div>}

      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', margin: '16px 0 6px' }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0' }}>{verRevisadas ? `Revisadas (${revisadas.length})` : 'Requieren una decisión'}</div>
        <button type="button" style={boton('#93c5fd')} onClick={() => setVerRevisadas(!verRevisadas)}>{verRevisadas ? 'Ver pendientes' : `Ver revisadas (${revisadas.length})`}</button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <button type="button" style={{ ...boton(filtro === '' ? '#e2e8f0' : '#94a3b8'), background: filtro === '' ? '#1e293b' : 'transparent' }} onClick={() => setFiltro('')}>Todas</button>
        {ORDEN_TIPOS.filter(t => t !== 'contrato_con_fin' && (verRevisadas ? revisadas : pendientes).some(d => d.tipo === t)).map(t => (
          <button key={t} type="button" style={{ ...boton(filtro === t ? '#e2e8f0' : '#94a3b8'), background: filtro === t ? '#1e293b' : 'transparent' }} onClick={() => setFiltro(t)}>
            {TEXTO_TIPO[t].titulo} ({(verRevisadas ? revisadas : pendientes).filter(d => d.tipo === t).length})
          </button>
        ))}
      </div>
      {ORDEN_TIPOS.filter(t => t !== 'contrato_con_fin').map(t => {
        const g = otros.filter(d => d.tipo === t)
        if (!g.length) return null
        return (
          <div key={t} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 14.5, fontWeight: 800, color: '#cbd5e1' }}>{TEXTO_TIPO[t].titulo} ({g.length})</div>
            <div style={{ fontSize: 12.5, color: '#64748b', margin: '2px 0 6px' }}>{TEXTO_TIPO[t].ayuda}</div>
            {g.map(d => <DiferenciaItem key={d.clave} d={d} onCambio={() => void cargar()} />)}
          </div>
        )
      })}
      {!otros.length && <div style={{ ...card, color: '#94a3b8' }}>{verRevisadas ? 'No hay diferencias revisadas.' : 'No hay diferencias pendientes.'}</div>}

      {resumen && resumen.correcciones.length > 0 && (
        <>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#e2e8f0', margin: '16px 0 6px' }}>Correcciones de identidad registradas</div>
          <div style={{ ...card, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <tbody>
                {resumen.correcciones.map((c, i) => (
                  <tr key={i}>
                    <td style={celda}><a href={`/guardias/${c.empleado_id}?seccion=datos`} style={{ color: '#e2e8f0' }}>{c.persona}</a></td>
                    <td style={{ ...celda, color: '#94a3b8' }}>{c.campo.toUpperCase()}</td>
                    <td style={celda}>{c.anterior ?? '—'} → <b>{c.nuevo}</b></td>
                    <td style={{ ...celda, color: '#94a3b8' }}>{c.fuente} · {fechaCorta(c.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
