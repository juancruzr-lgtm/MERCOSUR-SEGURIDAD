'use client'

/**
 * BandejaPlanillas — Revisión de planillas (primer control), mensual.
 *
 * UNA sola bandeja con dos puntos de montaje: la pestaña Planillas de
 * SupervisorMobile y la sección "Revisión de planillas" de administración. No
 * hay copias ni lógica paralela: lo que cambia entre una y otra son props
 * (alcance y densidad), no el comportamiento.
 *
 * Trabaja sobre UN MES calendario, el mismo período con el que se cierra la
 * liquidación. Antes era una ventana fija de 30 días y las consultas de
 * aceptaciones, solicitudes y revisiones se pedían SIN filtro de fecha, con un
 * tope de 5000 filas: traían el historial completo y, al superarlo, habrían
 * cortado en silencio haciendo reaparecer como pendientes turnos ya revisados.
 * Ahora las tres van acotadas al mes por join con turnos.
 *
 * Alcance: administración ve todos los objetivos; supervisión, los de sus
 * zonas (objetivoEnAlcance en lib/bandeja-planillas). La RLS del servidor sigue
 * siendo el límite real.
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
  ETIQUETA_SALIDA_AUTOMATICA, ETIQUETA_ESTADO_SOLICITUD, ETIQUETA_ACCION_SUPERVISOR,
} from '@/lib/primer-control'
import type { AccionSupervisor, EstadoPrimerControl, EstadoSolicitud } from '@/lib/primer-control'
import { limitesDelMes } from '@/lib/calendario-mes'
import {
  ESTADOS_REVISION, ETIQUETA_ESTADO_REVISION, cubreElTurno,
  estadoRevision, etiquetaResumenMes, filtrarFilasBandeja,
  objetivoEnAlcance, opcionesObjetivo, opcionesPuesto, opcionesVigilador,
  resumenBandejaMensual,
} from '@/lib/bandeja-planillas'
import type { EstadoRevision, FilaBandejaMensual, FiltroTernario } from '@/lib/bandeja-planillas'

const ESTADOS_SIN_OBLIGACION_LOCAL = new Set(['reemplazado', 'anulado', 'cancelado'])

/** Tope por consulta. Si se alcanza, se avisa en pantalla en vez de cortar callado. */
const TOPE_FILAS = 3000

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

const mesActualArg = () =>
  new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 7)

const COLOR_ESTADO: Record<EstadoRevision, string> = {
  pendiente: '#94a3b8',
  aceptado: '#10b981',
  modificacion_solicitada: '#f59e0b',
  revisado_supervisor: '#10b981',
  pendiente_regularizacion: '#fbbf24',
  resuelto: '#60a5fa',
}

export interface BandejaPlanillasProps {
  user: any
  /** Administración ve todos los objetivos; supervisión, los de sus zonas. */
  esAdmin?: boolean
  /** Mes inicial 'YYYY-MM'. Por defecto, el mes en curso. */
  mesInicial?: string
  /** Abre filtrada por un vigilador (link desde la planilla del guardia). */
  empleadoInicial?: string | null
  /** 'comoda' en escritorio; 'compacta' en la vista móvil del supervisor. */
  densidad?: 'comoda' | 'compacta'
}

export default function BandejaPlanillas({
  user,
  esAdmin = false,
  mesInicial,
  empleadoInicial = null,
  densidad = 'compacta',
}: BandejaPlanillasProps) {
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState('')
  const [aviso, setAviso] = useState('')
  const [filas, setFilas] = useState<FilaBandejaMensual[]>([])
  const [recargas, setRecargas] = useState(0)

  const [mes, setMes] = useState(mesInicial || mesActualArg())
  const [fEmpleado, setFEmpleado] = useState(empleadoInicial ?? '')
  const [fObjetivo, setFObjetivo] = useState('')
  const [fPuesto, setFPuesto] = useState('')
  const [fEstado, setFEstado] = useState<EstadoRevision | 'todos'>('todos')
  const [fFichaje, setFFichaje] = useState<FiltroTernario>('todos')
  const [fSalidaAuto, setFSalidaAuto] = useState<FiltroTernario>('todos')
  const [soloPendientes, setSoloPendientes] = useState(false)

  const [accionFila, setAccionFila] = useState<{ fila: FilaBandejaMensual, accion: AccionSupervisor } | null>(null)
  const [comentario, setComentario] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [errorAccion, setErrorAccion] = useState('')

  // Si el contenedor cambia el filtro inicial (por ejemplo al entrar desde la
  // planilla de otro guardia), la bandeja lo adopta.
  useEffect(() => { setFEmpleado(empleadoInicial ?? '') }, [empleadoInicial])
  useEffect(() => { if (mesInicial) setMes(mesInicial) }, [mesInicial])

  useEffect(() => {
    let activo = true
    const cargar = async () => {
      setCargando(true)
      setError('')
      setAviso('')
      const { desde, hasta } = limitesDelMes(mes)

      // Las cuatro consultas auxiliares van acotadas al mes por join con turnos:
      // ninguna trae historial completo.
      const [turnosR, registrosR, aceptR, soliR, reviR, guardiasR, zonasR] = await Promise.all([
        supabase.from('turnos')
          .select('id, fecha, hora_inicio, hora_fin, estado, tipo_evento, guardia_id, objetivo_id, puesto_id, puesto:puestos(nombre), objetivo:objetivos(nombre, es_prueba, zona_id)')
          .gte('fecha', desde).lte('fecha', hasta)
          .order('fecha', { ascending: false })
          .limit(TOPE_FILAS),
        supabase.from('registros_asistencia')
          .select('id, turno_id, guardia_id, guardia_final_id, tipo_registro, hora_entrada_real, hora_salida_real, hora_entrada_final, hora_salida_final, horas_trabajadas, horas_liquidables, cierre_automatico, cobertura_anulada_at, turno:turnos!inner(fecha)')
          .gte('turno.fecha', desde).lte('turno.fecha', hasta)
          .limit(TOPE_FILAS),
        supabase.from('aceptaciones_planilla')
          .select('turno_id, empleado_id, turno:turnos!inner(fecha)')
          .gte('turno.fecha', desde).lte('turno.fecha', hasta)
          .limit(TOPE_FILAS),
        supabase.from('solicitudes_modificacion_planilla')
          .select('id, turno_id, empleado_id, texto, estado, created_at, turno:turnos!inner(fecha)')
          .gte('turno.fecha', desde).lte('turno.fecha', hasta)
          .order('created_at', { ascending: false })
          .limit(TOPE_FILAS),
        supabase.from('revisiones_planilla')
          .select('turno_id, empleado_id, solicitud_id, accion, turno:turnos!inner(fecha)')
          .gte('turno.fecha', desde).lte('turno.fecha', hasta)
          .limit(TOPE_FILAS),
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
      if ((turnosR.data ?? []).length >= TOPE_FILAS) {
        setAviso(`Se alcanzó el tope de ${TOPE_FILAS} turnos para este mes: puede faltar información. Filtrá por objetivo o vigilador.`)
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
      const derivadoSet = new Set<string>()
      const obsCount = new Map<string, number>()
      for (const r of ((reviR.data ?? []) as any[])) {
        const k = `${r.turno_id}:${r.empleado_id}`
        if (r.accion === 'revisado') revisadoSet.add(k)
        if (r.accion === 'derivar_administracion') derivadoSet.add(k)
        if (r.accion === 'observacion') obsCount.set(k, (obsCount.get(k) ?? 0) + 1)
      }

      const ahora = Date.now()
      const resultado: FilaBandejaMensual[] = []
      for (const t of ((turnosR.data ?? []) as any[])) {
        if ((t.objetivo as any)?.es_prueba) continue
        if (ESTADOS_SIN_OBLIGACION_LOCAL.has(t.estado || '')) continue
        if (finTurnoMs(t.fecha, t.hora_inicio, t.hora_fin) >= ahora) continue
        if (!objetivoEnAlcance((t.objetivo as any)?.zona_id, esAdmin, zonasMias)) continue

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
          objetivoId: t.objetivo_id,
          objetivo: (t.objetivo as any)?.nombre ?? '—',
          puestoId: t.puesto_id ?? null,
          puesto: (t.puesto as any)?.nombre ?? '—',
          horario: `${hora(t.hora_inicio)}–${hora(t.hora_fin)}`,
          horaInicioProg: hora(t.hora_inicio) ?? '',
          horaFinProg: hora(t.hora_fin) ?? '',
          entrada: hora(linea.horaEntrada),
          salida: hora(linea.horaSalida),
          horas: linea.horasLiquidables,
          caracteristica: etiquetaCaracteristica(t.tipo_evento),
          salidaAutomatica: Boolean(registro?.cierre_automatico),
          tieneFichaje: Boolean(registro),
          estadoControl,
          solicitudId: solicitud?.id ?? null,
          solicitudTexto: solicitud?.texto ?? null,
          solicitudEstado: (solicitud?.estado as EstadoSolicitud) ?? null,
          revisado: revisadoSet.has(k),
          derivado: derivadoSet.has(k),
          observaciones: obsCount.get(k) ?? 0,
        })
      }
      setFilas(resultado)
      setCargando(false)
    }
    void cargar()
    return () => { activo = false }
  }, [user?.id, esAdmin, mes, recargas])

  const resumen = useMemo(() => resumenBandejaMensual(filas), [filas])
  const visibles = useMemo(() => filtrarFilasBandeja(filas, {
    empleadoId: fEmpleado || null,
    objetivoId: fObjetivo || null,
    puestoId: fPuesto || null,
    estado: fEstado,
    conFichaje: fFichaje,
    salidaAutomatica: fSalidaAuto,
    soloPendientes,
  }), [filas, fEmpleado, fObjetivo, fPuesto, fEstado, fFichaje, fSalidaAuto, soloPendientes])

  const optVigiladores = useMemo(() => opcionesVigilador(filas), [filas])
  const optObjetivos = useMemo(() => opcionesObjetivo(filas), [filas])
  const optPuestos = useMemo(() => opcionesPuesto(filas), [filas])

  const limpiarFiltros = () => {
    setFEmpleado(''); setFObjetivo(''); setFPuesto('')
    setFEstado('todos'); setFFichaje('todos'); setFSalidaAuto('todos')
    setSoloPendientes(false)
  }
  const hayFiltros = !!(fEmpleado || fObjetivo || fPuesto) ||
    fEstado !== 'todos' || fFichaje !== 'todos' || fSalidaAuto !== 'todos' || soloPendientes

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

  const ancho = densidad === 'comoda'
  const card: React.CSSProperties = { background: '#111827', border: '1px solid #1e2d42', borderRadius: 12, padding: 14, marginBottom: 10 }
  const btn: React.CSSProperties = { padding: '6px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer', border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0' }
  const muted: React.CSSProperties = { fontSize: 12, color: '#94a3b8' }
  const sel: React.CSSProperties = {
    background: '#0f172a', border: '1px solid #1e2d42', borderRadius: 8,
    color: '#e2e8f0', padding: '6px 9px', fontSize: 12.5, minWidth: 0,
  }
  const campo = (etiqueta: string, hijo: React.ReactNode) => (
    <div style={{ minWidth: 0 }}>
      <label style={{ display: 'block', fontSize: 10.5, color: '#64748b', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 3 }}>{etiqueta}</label>
      {hijo}
    </div>
  )

  return (
    <div>
      <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 4 }}>Revisión de planillas</div>
      <div style={{ ...muted, marginBottom: 12 }}>
        Turnos ya finalizados del mes elegido{esAdmin ? '' : ', dentro de su alcance'}. La revisión deja constancia: no modifica horas.
      </div>

      {/* Resumen del mes */}
      <div style={{
        background: resumen.cerrado ? 'rgba(16,185,129,.08)' : '#0b1220',
        border: `1px solid ${resumen.cerrado ? 'rgba(16,185,129,.35)' : '#1e2d42'}`,
        borderRadius: 10, padding: '10px 14px', marginBottom: 12,
        display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <input
          type="month"
          value={mes}
          onChange={e => e.target.value && setMes(e.target.value)}
          style={{ ...sel, width: 'auto' }}
        />
        <strong style={{ fontSize: 13.5, color: resumen.cerrado ? '#10b981' : '#e2e8f0' }}>
          {cargando ? 'Cargando…' : etiquetaResumenMes(mes, resumen)}
        </strong>
      </div>

      {/* Filtros */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: ancho ? 'repeat(auto-fit, minmax(150px, 1fr))' : '1fr 1fr',
        gap: 8, marginBottom: 10,
      }}>
        {campo('Estado', (
          <select style={{ ...sel, width: '100%' }} value={fEstado} onChange={e => setFEstado(e.target.value as EstadoRevision | 'todos')}>
            <option value="todos">Todos</option>
            {ESTADOS_REVISION.map(e => (
              <option key={e} value={e}>{ETIQUETA_ESTADO_REVISION[e]} ({resumen.porEstado[e]})</option>
            ))}
          </select>
        ))}
        {campo('Vigilador', (
          <select style={{ ...sel, width: '100%' }} value={fEmpleado} onChange={e => setFEmpleado(e.target.value)}>
            <option value="">Todos</option>
            {optVigiladores.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        ))}
        {campo('Objetivo', (
          <select style={{ ...sel, width: '100%' }} value={fObjetivo} onChange={e => setFObjetivo(e.target.value)}>
            <option value="">Todos</option>
            {optObjetivos.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        ))}
        {campo('Posición operativa', (
          <select style={{ ...sel, width: '100%' }} value={fPuesto} onChange={e => setFPuesto(e.target.value)}>
            <option value="">Todas</option>
            {optPuestos.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
          </select>
        ))}
        {campo('Fichaje', (
          <select style={{ ...sel, width: '100%' }} value={fFichaje} onChange={e => setFFichaje(e.target.value as FiltroTernario)}>
            <option value="todos">Con y sin fichaje</option>
            <option value="si">Solo con fichaje</option>
            <option value="no">Solo sin fichaje</option>
          </select>
        ))}
        {campo('Salida automática', (
          <select style={{ ...sel, width: '100%' }} value={fSalidaAuto} onChange={e => setFSalidaAuto(e.target.value as FiltroTernario)}>
            <option value="todos">Todas</option>
            <option value="si">Solo salida automática</option>
            <option value="no">Sin salida automática</option>
          </select>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <button
          type="button"
          onClick={() => setSoloPendientes(v => !v)}
          style={{
            ...btn,
            border: soloPendientes ? '1px solid #f59e0b' : '1px solid #334155',
            background: soloPendientes ? '#f59e0b18' : '#1e293b',
            color: soloPendientes ? '#f59e0b' : '#e2e8f0',
          }}
        >
          {soloPendientes ? '✓ ' : ''}Solo lo pendiente ({resumen.pendientes})
        </button>
        {hayFiltros && (
          <button type="button" style={btn} onClick={limpiarFiltros}>Limpiar filtros</button>
        )}
        <span style={muted}>
          {cargando ? '' : `${visibles.length} de ${resumen.total} registros del mes`}
        </span>
      </div>

      {aviso && (
        <div style={{ color: '#f59e0b', background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: 10 }}>
          {aviso}
        </div>
      )}
      {cargando && <div style={{ ...muted, padding: 24, textAlign: 'center' }}>Cargando bandeja…</div>}
      {!cargando && error && <div style={{ color: '#ef4444', padding: 12 }}>{error}</div>}
      {!cargando && !error && visibles.length === 0 && (
        <div style={{ ...muted, padding: 24, textAlign: 'center' }}>
          {resumen.total === 0
            ? 'No hay turnos finalizados para revisar en este mes.'
            : 'Ningún registro coincide con los filtros elegidos.'}
        </div>
      )}

      {!cargando && !error && visibles.map(f => {
        const est = estadoRevision(f)
        return (
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
              Característica: {f.caracteristica}
              {!f.tieneFichaje && <span style={{ marginLeft: 6, color: '#ef4444' }}>· Sin fichaje</span>}
            </div>
            <div style={{ marginTop: 6, fontSize: 12 }}>
              Estado: <span style={{ fontWeight: 700, color: COLOR_ESTADO[est] }}>{ETIQUETA_ESTADO_REVISION[est]}</span>
              {f.observaciones > 0 && <span style={{ marginLeft: 8, color: '#94a3b8' }}>{f.observaciones} obs.</span>}
            </div>
            {/* Aceptado pero el fichaje no cubre el turno: entró tarde o se fue
                antes. La conformidad del vigilador no cierra eso solo. */}
            {est === 'aceptado' && !cubreElTurno(f) && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: '#f59e0b', background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 6, padding: '6px 10px' }}>
                Aceptado por el vigilador, pero el fichaje no cubre el turno programado
                ({f.horaInicioProg}–{f.horaFinProg}): {f.entrada && f.horaInicioProg && f.entrada > f.horaInicioProg ? 'entró tarde' : 'se retiró antes'}.
              </div>
            )}
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
        )
      })}

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
              rows={4}
              style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: 10, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
            />
            {errorAccion && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 8 }}>{errorAccion}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
              <button style={{ ...btn, padding: '10px 0' }} disabled={enviando} onClick={() => setAccionFila(null)}>Cancelar</button>
              <button
                style={{ ...btn, padding: '10px 0', background: '#f59e0b', color: '#111827', border: '1px solid #f59e0b', fontWeight: 700, opacity: enviando ? .6 : 1 }}
                disabled={enviando}
                onClick={ejecutarAccion}
              >
                {enviando ? 'Registrando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
