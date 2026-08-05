'use client'

/**
 * BandejaPlanillas — Revisión del supervisor sobre el primer control (Bloque D).
 *
 * Se integra como pestaña de SupervisorMobile (no es un módulo paralelo):
 * reutiliza la sesión, el patrón visual y el alcance por zonas del supervisor.
 * La RLS del servidor limita además lo que este componente puede leer.
 *
 * El supervisor solo deja constancia operativa (revisado / observación /
 * derivar a administración) vía RPC revisar_primer_control. Nunca modifica
 * entrada, salida, horas reales ni horas liquidables.
 */

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { effectiveGuardia, selectRegistroPrincipal, resolverLineaLiquidacion } from '@/lib/liquidacion'
import { etiquetaCaracteristica } from '@/lib/caracteristica-turno'
import {
  ETIQUETA_PRIMER_CONTROL, ETIQUETA_SALIDA_AUTOMATICA, ETIQUETA_ESTADO_SOLICITUD,
  ETIQUETA_ACCION_SUPERVISOR, FILTROS_BANDEJA, filtrosDeFila,
} from '@/lib/primer-control'
import type { AccionSupervisor, EstadoPrimerControl, EstadoSolicitud, FiltroBandeja } from '@/lib/primer-control'

const ESTADOS_SIN_OBLIGACION_LOCAL = new Set(['reemplazado', 'anulado', 'cancelado'])

interface FilaBandeja {
  turnoId: string
  empleadoId: string
  vigilador: string
  fecha: string
  objetivo: string
  puesto: string
  horario: string
  entrada: string | null
  salida: string | null
  horas: number
  caracteristica: string
  tipoEvento: string | null
  salidaAutomatica: boolean
  tieneFichaje: boolean
  estadoControl: EstadoPrimerControl
  solicitudId: string | null
  solicitudTexto: string | null
  solicitudEstado: EstadoSolicitud | null
  revisado: boolean
  observaciones: number
}

function finTurnoMs(fecha: string, horaInicio: string, horaFin: string): number {
  const [y, m, d] = fecha.slice(0, 10).split('-').map(Number)
  const [hI, mI] = horaInicio.split(':').map(Number)
  const [hF, mF] = horaFin.split(':').map(Number)
  const diaExtra = (hF < hI || (hF === hI && mF <= mI)) ? 1 : 0
  return Date.UTC(y, m - 1, d + diaExtra, hF + 3, mF)
}

function fmtFecha(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

const hora = (h?: string | null) => (h ? h.slice(0, 5) : null)

export default function BandejaPlanillas({ user }: { user: any }) {
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [filas, setFilas] = useState<FilaBandeja[]>([])
  const [filtro, setFiltro] = useState<FiltroBandeja>('modificaciones_solicitadas')
  const [recargas, setRecargas] = useState(0)
  const [accionFila, setAccionFila] = useState<{ fila: FilaBandeja, accion: AccionSupervisor } | null>(null)
  const [comentario, setComentario] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [errorAccion, setErrorAccion] = useState('')

  useEffect(() => {
    let activo = true
    const cargar = async () => {
      setCargando(true)
      setError('')
      const hoy = new Date(Date.now() - 3 * 60 * 60 * 1000)
      const desde = new Date(hoy.getTime() - 30 * 86400000).toISOString().slice(0, 10)
      const hasta = hoy.toISOString().slice(0, 10)

      const [turnosR, registrosR, aceptR, soliR, reviR, guardiasR, zonasR] = await Promise.all([
        supabase.from('turnos')
          .select('id, fecha, hora_inicio, hora_fin, estado, tipo_evento, guardia_id, objetivo_id, puesto:puestos(nombre), objetivo:objetivos(nombre, es_prueba, zona_id)')
          .gte('fecha', desde).lte('fecha', hasta)
          .order('fecha', { ascending: false })
          .limit(3000),
        supabase.from('registros_asistencia')
          .select('id, turno_id, guardia_id, guardia_final_id, tipo_registro, hora_entrada_real, hora_salida_real, hora_entrada_final, hora_salida_final, horas_trabajadas, horas_liquidables, cierre_automatico, cobertura_anulada_at, turno:turnos!inner(fecha)')
          .gte('turno.fecha', desde).lte('turno.fecha', hasta)
          .limit(5000),
        supabase.from('aceptaciones_planilla').select('turno_id, empleado_id').limit(5000),
        supabase.from('solicitudes_modificacion_planilla')
          .select('id, turno_id, empleado_id, texto, estado, created_at')
          .order('created_at', { ascending: false })
          .limit(5000),
        supabase.from('revisiones_planilla').select('turno_id, empleado_id, solicitud_id, accion').limit(5000),
        supabase.from('usuarios').select('id, nombre, apellido').limit(2000),
        supabase.from('supervisor_zonas').select('zona_id').eq('supervisor_id', user?.id ?? ''),
      ])

      if (!activo) return
      const err = turnosR.error || registrosR.error || guardiasR.error
      if (err) {
        setError(err.message)
        setCargando(false)
        return
      }

      const nombrePor = new Map<string, string>((guardiasR.data ?? []).map((g: any) => [g.id, `${g.apellido}, ${g.nombre}`]))
      const zonasMias = new Set<string>(((zonasR.data ?? []) as any[]).map(z => z.zona_id))
      const registrosPorTurno = new Map<string, any[]>()
      for (const r of (registrosR.data ?? []) as any[]) {
        if (r.tipo_registro === 'ausencia' || r.cobertura_anulada_at) continue
        const arr = registrosPorTurno.get(r.turno_id) ?? []
        arr.push(r)
        registrosPorTurno.set(r.turno_id, arr)
      }
      const aceptados = new Set(((aceptR.data ?? []) as any[]).map(a => `${a.turno_id}:${a.empleado_id}`))
      const solicitudPor = new Map<string, any>()
      for (const s of ((soliR.data ?? []) as any[])) {
        const k = `${s.turno_id}:${s.empleado_id}`
        // orden desc: la primera vista es la más reciente; preferir la no resuelta
        if (!solicitudPor.has(k) || (solicitudPor.get(k).estado === 'resuelta' && s.estado !== 'resuelta')) {
          solicitudPor.set(k, s)
        }
      }
      const revisadoSet = new Set<string>()
      const obsCount = new Map<string, number>()
      for (const r of ((reviR.data ?? []) as any[])) {
        const k = `${r.turno_id}:${r.empleado_id}`
        if (r.accion === 'revisado') revisadoSet.add(k)
        if (r.accion === 'observacion') obsCount.set(k, (obsCount.get(k) ?? 0) + 1)
      }

      const ahora = Date.now()
      const resultado: FilaBandeja[] = []
      for (const t of ((turnosR.data ?? []) as any[])) {
        if ((t.objetivo as any)?.es_prueba) continue
        if (ESTADOS_SIN_OBLIGACION_LOCAL.has(t.estado || '')) continue
        if (finTurnoMs(t.fecha, t.hora_inicio, t.hora_fin) >= ahora) continue
        // Alcance por zonas (regla existente: sin zonas asignadas = alcance total)
        if (zonasMias.size > 0) {
          const zona = (t.objetivo as any)?.zona_id
          if (!zona || !zonasMias.has(zona)) continue
        }
        const registro = selectRegistroPrincipal(registrosPorTurno.get(t.id) ?? []) as any
        const empleadoId = (registro ? effectiveGuardia(registro) : null) ?? t.guardia_id
        if (!empleadoId) continue
        const linea = resolverLineaLiquidacion(t, registro ?? null)
        const k = `${t.id}:${empleadoId}`
        const solicitud = solicitudPor.get(k) ?? null
        const estadoControl: EstadoPrimerControl = solicitud && solicitud.estado !== 'resuelta'
          ? 'modificacion_solicitada'
          : aceptados.has(k) ? 'aceptado' : 'pendiente'
        resultado.push({
          turnoId: t.id,
          empleadoId,
          vigilador: nombrePor.get(empleadoId) ?? '—',
          fecha: t.fecha,
          objetivo: (t.objetivo as any)?.nombre ?? '—',
          puesto: (t.puesto as any)?.nombre ?? '—',
          horario: `${hora(t.hora_inicio)}–${hora(t.hora_fin)}`,
          entrada: hora(linea.horaEntrada),
          salida: hora(linea.horaSalida),
          horas: linea.horasLiquidables,
          caracteristica: etiquetaCaracteristica(t.tipo_evento),
          tipoEvento: t.tipo_evento ?? null,
          salidaAutomatica: Boolean(registro?.cierre_automatico),
          tieneFichaje: Boolean(registro),
          estadoControl,
          solicitudId: solicitud?.id ?? null,
          solicitudTexto: solicitud?.texto ?? null,
          solicitudEstado: (solicitud?.estado as EstadoSolicitud) ?? null,
          revisado: revisadoSet.has(k),
          observaciones: obsCount.get(k) ?? 0,
        })
      }
      setFilas(resultado)
      setCargando(false)
    }
    void cargar()
    return () => { activo = false }
  }, [user?.id, recargas])

  const contadores = useMemo(() => {
    const c = new Map<FiltroBandeja, number>()
    for (const f of FILTROS_BANDEJA) c.set(f.id, 0)
    for (const fila of filas) {
      for (const id of filtrosDeFila(fila)) c.set(id, (c.get(id) ?? 0) + 1)
    }
    return c
  }, [filas])

  const visibles = useMemo(
    () => filas.filter(f => filtrosDeFila(f).includes(filtro)),
    [filas, filtro],
  )

  const ejecutarAccion = async () => {
    if (!accionFila || enviando) return
    const { fila, accion } = accionFila
    if (accion === 'observacion' && comentario.trim().length < 3) {
      setErrorAccion('La observación requiere texto')
      return
    }
    setEnviando(true)
    setErrorAccion('')
    try {
      const { error: rpcError } = await supabase.rpc('revisar_primer_control', {
        p_turno_id: fila.turnoId,
        p_empleado_id: fila.empleadoId,
        p_accion: accion,
        p_comentario: comentario.trim() || null,
        p_solicitud_id: fila.solicitudId,
      })
      if (rpcError) throw new Error(rpcError.message)
      setAccionFila(null)
      setComentario('')
      setRecargas(v => v + 1) // releer la respuesta autoritativa del servidor
    } catch (e) {
      setErrorAccion(e instanceof Error ? e.message : 'No se pudo registrar la revisión')
    } finally {
      setEnviando(false)
    }
  }

  const card: React.CSSProperties = { background: '#111827', border: '1px solid #1e2d42', borderRadius: 12, padding: 14, marginBottom: 10 }
  const chip = (activo: boolean): React.CSSProperties => ({
    padding: '6px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer', textAlign: 'left',
    border: activo ? '1px solid #f59e0b' : '1px solid #334155',
    background: activo ? '#f59e0b18' : 'none',
    color: activo ? '#f59e0b' : '#94a3b8',
  })
  const btn: React.CSSProperties = { padding: '6px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer', border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0' }
  const muted: React.CSSProperties = { fontSize: 12, color: '#94a3b8' }

  return (
    <div>
      <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Planillas — Primer control</div>
      <div style={{ ...muted, marginBottom: 12 }}>
        Turnos finalizados de los últimos 30 días dentro de su alcance. La revisión deja constancia: no modifica horas.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
        {FILTROS_BANDEJA.map(f => (
          <button key={f.id} style={chip(filtro === f.id)} onClick={() => setFiltro(f.id)}>
            {f.label} <strong style={{ color: filtro === f.id ? '#f59e0b' : '#e2e8f0' }}>({contadores.get(f.id) ?? 0})</strong>
          </button>
        ))}
      </div>

      {cargando && <div style={{ ...muted, padding: 24, textAlign: 'center' }}>Cargando bandeja…</div>}
      {!cargando && error && <div style={{ color: '#ef4444', padding: 12 }}>{error}</div>}
      {!cargando && !error && visibles.length === 0 && (
        <div style={{ ...muted, padding: 24, textAlign: 'center' }}>Sin turnos en este grupo.</div>
      )}

      {!cargando && !error && visibles.map(f => (
        <div key={`${f.turnoId}-${f.empleadoId}`} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700 }}>{f.vigilador}</div>
            <div style={muted}>{fmtFecha(f.fecha)}</div>
          </div>
          <div style={muted}>{f.objetivo} · {f.puesto} · {f.horario}</div>
          <div style={muted}>
            Entrada: {f.entrada ?? '—'} · Salida: {f.salida ?? '—'}
            {f.salidaAutomatica && <span style={{ marginLeft: 6, color: '#f59e0b', fontWeight: 700 }}>({ETIQUETA_SALIDA_AUTOMATICA})</span>}
            {' '}· Horas: <strong style={{ color: '#f59e0b' }}>{f.horas > 0 ? f.horas.toFixed(2) : '—'}</strong>
          </div>
          <div style={muted}>
            Característica: <span style={{ color: f.tipoEvento === 'capacitacion' ? '#a78bfa' : f.tipoEvento === 'cobertura' ? '#38bdf8' : '#94a3b8' }}>{f.caracteristica}</span>
            {!f.tieneFichaje && <span style={{ marginLeft: 6, color: '#ef4444' }}>· Sin fichaje</span>}
          </div>
          <div style={{ marginTop: 6, fontSize: 12 }}>
            Primer control:{' '}
            <span style={{ fontWeight: 700, color: f.estadoControl === 'aceptado' ? '#10b981' : f.estadoControl === 'modificacion_solicitada' ? '#f59e0b' : '#94a3b8' }}>
              {ETIQUETA_PRIMER_CONTROL[f.estadoControl]}
            </span>
            {f.revisado && <span style={{ marginLeft: 8, color: '#10b981' }}>✓ Revisado</span>}
            {f.observaciones > 0 && <span style={{ marginLeft: 8, color: '#94a3b8' }}>{f.observaciones} obs.</span>}
          </div>
          {f.solicitudTexto && (
            <div style={{ marginTop: 8, background: '#0f172a', border: '1px solid #33415577', borderRadius: 8, padding: 10 }}>
              <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 4 }}>
                Solicitud del vigilador{f.solicitudEstado ? ` · ${ETIQUETA_ESTADO_SOLICITUD[f.solicitudEstado]}` : ''}
              </div>
              <div style={{ fontSize: 13, color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>{f.solicitudTexto}</div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <button style={btn} onClick={() => { setAccionFila({ fila: f, accion: 'revisado' }); setComentario(''); setErrorAccion('') }}>
              {ETIQUETA_ACCION_SUPERVISOR.revisado}
            </button>
            <button style={btn} onClick={() => { setAccionFila({ fila: f, accion: 'observacion' }); setComentario(''); setErrorAccion('') }}>
              {ETIQUETA_ACCION_SUPERVISOR.observacion}
            </button>
            <button
              style={{ ...btn, border: '1px solid #92400e', background: '#78350f', color: '#fbbf24' }}
              onClick={() => { setAccionFila({ fila: f, accion: 'derivar_administracion' }); setComentario(''); setErrorAccion('') }}
            >
              {ETIQUETA_ACCION_SUPERVISOR.derivar_administracion}
            </button>
          </div>
        </div>
      ))}

      {accionFila && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => { if (!enviando) setAccionFila(null) }}
        >
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 20, width: '100%', maxWidth: 420, border: '1px solid #334155' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>{ETIQUETA_ACCION_SUPERVISOR[accionFila.accion]}</div>
            <div style={{ ...muted, marginBottom: 10 }}>
              {accionFila.fila.vigilador} · {fmtFecha(accionFila.fila.fecha)} · {accionFila.fila.objetivo}
            </div>
            {accionFila.accion === 'derivar_administracion' && (
              <div style={{ fontSize: 11, color: '#fbbf24', marginBottom: 8 }}>
                Queda visible para Administración. No crea asistencia, no corrige fichajes ni modifica horas liquidables.
              </div>
            )}
            <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>
              Comentario{accionFila.accion === 'observacion' ? ' *' : ' (opcional)'}
            </label>
            <textarea
              value={comentario}
              onChange={e => setComentario(e.target.value)}
              rows={3}
              style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: 10, fontSize: 13, boxSizing: 'border-box', resize: 'vertical' }}
            />
            {errorAccion && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 8 }}>{errorAccion}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
              <button style={{ ...btn, background: 'transparent' }} disabled={enviando} onClick={() => setAccionFila(null)}>Cancelar</button>
              <button
                style={{ ...btn, background: '#14532d', border: '1px solid #166534', color: '#4ade80', fontWeight: 700, opacity: enviando ? 0.5 : 1 }}
                disabled={enviando}
                onClick={ejecutarAccion}
              >
                {enviando ? 'Guardando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
