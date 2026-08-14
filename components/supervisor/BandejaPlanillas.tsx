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
import { fetchPaginadoResult } from '@/lib/fetch-paginado'
import { formatFechaHora } from '@/lib/formato'
import {
  ESTADOS_REVISION, ETIQUETA_ESTADO_REVISION, ETIQUETA_MOTIVO_NO_CUBRE,
  ETIQUETA_NO_REQUIERE_REVISION, REVISION_SIN_TOCAR, claveRevision,
  construirRevisionPorClave, cubreElTurno, etiquetaDiferencia,
  estadoRevision, etiquetaResumenMes, filtrarFilasBandeja, motivoNoCubre,
  planCorreccionHorario,
  objetivoEnAlcance, opcionesObjetivo, opcionesPuesto, opcionesVigilador,
  requiereRevision, resumenBandejaMensual,
} from '@/lib/bandeja-planillas'
import type { EstadoRevision, FilaBandejaMensual, FiltroTernario } from '@/lib/bandeja-planillas'

const ESTADOS_SIN_OBLIGACION_LOCAL = new Set(['reemplazado', 'anulado', 'cancelado'])

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

/** Nombres legibles de los campos que audita corregir_registro_asistencia. */
const ETIQUETA_CAMPO_AUDITORIA: Record<string, string> = {
  hora_entrada_final: 'Entrada reconocida',
  hora_salida_final: 'Salida reconocida',
  horas_liquidables: 'Horas reconocidas',
  comentario_final: 'Comentario',
  guardia_final_id: 'Vigilador',
  objetivo_final_id: 'Objetivo',
  reconocido_fuera_de_turno: 'Reconocido fuera del turno programado',
}

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
  const [filas, setFilas] = useState<FilaBandejaMensual[]>([])
  const [recargas, setRecargas] = useState(0)

  const [mes, setMes] = useState(mesInicial || mesActualArg())
  const [fEmpleado, setFEmpleado] = useState(empleadoInicial ?? '')
  const [fObjetivo, setFObjetivo] = useState('')
  const [fPuesto, setFPuesto] = useState('')
  const [fEstado, setFEstado] = useState<EstadoRevision | 'todos'>('todos')
  const [fFichaje, setFFichaje] = useState<FiltroTernario>('todos')
  const [fSalidaAuto, setFSalidaAuto] = useState<FiltroTernario>('todos')
  // Arranca filtrada: la bandeja es una cola de trabajo, no el registro del
  // mes. Abrir con los 283 registros para encontrar los 75 que piden algo
  // obligaba a barrer a ojo. El boton sigue estando para ver todo.
  const [soloPendientes, setSoloPendientes] = useState(true)

  const [accionFila, setAccionFila] = useState<{ fila: FilaBandejaMensual, accion: AccionSupervisor } | null>(null)
  const [comentario, setComentario] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [errorAccion, setErrorAccion] = useState('')

  // ── Corregir horario reconocido ──
  // Reutiliza corregir_registro_asistencia: los mismos campos _final y la misma
  // tabla de auditoría que usa la corrección de Administración. No hay una
  // segunda fuente de horas.
  const [correccion, setCorreccion] = useState<FilaBandejaMensual | null>(null)
  const [corrEntrada, setCorrEntrada] = useState('')
  const [corrSalida, setCorrSalida] = useState('')
  const [corrMotivo, setCorrMotivo] = useState('')
  const [corrConfirmando, setCorrConfirmando] = useState(false)
  const [corrGuardando, setCorrGuardando] = useState(false)
  const [corrError, setCorrError] = useState('')

  // ── Auditoría por registro, para mostrar el rastro de las correcciones ──
  const [auditoria, setAuditoria] = useState<Map<string, any[]>>(new Map())
  const [auditoriaAbierta, setAuditoriaAbierta] = useState<string | null>(null)

  const abrirCorreccion = (f: FilaBandejaMensual) => {
    setCorreccion(f)
    // Arranca con lo fichado: el supervisor ajusta desde ahí.
    setCorrEntrada(f.entrada ?? f.horaInicioProg)
    setCorrSalida(f.salida ?? f.horaFinProg)
    setCorrMotivo('')
    setCorrConfirmando(false)
    setCorrError('')
  }

  const planCorr = correccion ? planCorreccionHorario({
    horaInicioProg: correccion.horaInicioProg,
    horaFinProg: correccion.horaFinProg,
    entradaReconocida: corrEntrada,
    salidaReconocida: corrSalida,
    motivo: corrMotivo,
  }) : null

  const guardarCorreccion = async () => {
    if (!correccion || !planCorr || planCorr.bloqueo || corrGuardando) return
    if (!correccion.registroId) { setCorrError('Este turno no tiene registro de asistencia para corregir.'); return }
    setCorrGuardando(true)
    setCorrError('')
    try {
      const { error: rpcError } = await supabase.rpc('corregir_registro_asistencia', {
        p_registro_id: correccion.registroId,
        p_payload: {
          hora_entrada_final: corrEntrada,
          hora_salida_final: corrSalida,
          comentario_final: corrMotivo.trim(),
        },
        p_comentario: corrMotivo.trim(),
        p_reconocer_fuera_de_turno: planCorr.requiereFueraDeTurno,
      })
      if (rpcError) throw new Error(rpcError.message)
      // La solicitud del vigilador queda resuelta con la misma RPC de siempre.
      if (correccion.solicitudId) {
        await supabase.rpc('revisar_primer_control', {
          p_turno_id: correccion.turnoId,
          p_empleado_id: correccion.empleadoId,
          p_accion: 'revisado',
          p_comentario: `Horario reconocido ${corrEntrada}–${corrSalida}: ${corrMotivo.trim()}`,
          p_solicitud_id: correccion.solicitudId,
        })
      }
      setCorreccion(null)
      setRecargas(v => v + 1)
    } catch (e) {
      setCorrError(e instanceof Error ? e.message : 'No se pudo guardar la corrección')
    } finally {
      setCorrGuardando(false)
    }
  }

  const verAuditoria = async (registroId: string) => {
    if (auditoriaAbierta === registroId) { setAuditoriaAbierta(null); return }
    setAuditoriaAbierta(registroId)
    if (auditoria.has(registroId)) return
    const { data } = await supabase
      .from('registros_asistencia_auditoria')
      .select('id, campo, valor_anterior, valor_nuevo, comentario, created_at, modificado_por')
      .eq('registro_id', registroId)
      .order('created_at', { ascending: false })
      .limit(60)
    setAuditoria(prev => new Map(prev).set(registroId, data ?? []))
  }

  // Si el contenedor cambia el filtro inicial (por ejemplo al entrar desde la
  // planilla de otro guardia), la bandeja lo adopta.
  useEffect(() => { setFEmpleado(empleadoInicial ?? '') }, [empleadoInicial])
  useEffect(() => { if (mesInicial) setMes(mesInicial) }, [mesInicial])

  useEffect(() => {
    let activo = true
    const cargar = async () => {
      setCargando(true)
      setError('')
      const { desde, hasta } = limitesDelMes(mes)

      // Todas las consultas del mes se paginan. PostgREST corta en `max_rows`
      // (1000 en este proyecto) sin devolver error: un `.limit()` mayor no lo
      // levanta, sólo hace creer que alcanza. Con 1263 turnos en agosto 2026 la
      // bandeja perdia los del 1 al 5 —el orden es por fecha descendente, así
      // que lo que se cae es el principio del mes— y ningún aviso saltaba.
      //
      // El segundo `order` por id es el que hace segura la paginación: sin un
      // desempate estable, dos páginas pueden repetir u omitir filas.
      const [turnosR, registrosR, aceptR, soliR, reviR, guardiasR, zonasR] = await Promise.all([
        fetchPaginadoResult((d, h) => supabase.from('turnos')
          .select('id, fecha, hora_inicio, hora_fin, estado, tipo_evento, guardia_id, objetivo_id, puesto_id, puesto:puestos(nombre), objetivo:objetivos(nombre, es_prueba, zona_id)')
          .gte('fecha', desde).lte('fecha', hasta)
          .order('fecha', { ascending: false }).order('id')
          .range(d, h)),
        fetchPaginadoResult((d, h) => supabase.from('registros_asistencia')
          .select('id, turno_id, guardia_id, guardia_final_id, tipo_registro, hora_entrada_real, hora_salida_real, hora_entrada_final, hora_salida_final, horas_trabajadas, horas_liquidables, cierre_automatico, cobertura_anulada_at, observacion, turno:turnos!inner(fecha)')
          .gte('turno.fecha', desde).lte('turno.fecha', hasta)
          .order('id')
          .range(d, h)),
        fetchPaginadoResult((d, h) => supabase.from('aceptaciones_planilla')
          .select('turno_id, empleado_id, turno:turnos!inner(fecha)')
          .gte('turno.fecha', desde).lte('turno.fecha', hasta)
          .order('turno_id')
          .range(d, h)),
        fetchPaginadoResult((d, h) => supabase.from('solicitudes_modificacion_planilla')
          .select('id, turno_id, empleado_id, texto, estado, created_at, turno:turnos!inner(fecha)')
          .gte('turno.fecha', desde).lte('turno.fecha', hasta)
          .order('created_at', { ascending: false }).order('id')
          .range(d, h)),
        fetchPaginadoResult((d, h) => supabase.from('revisiones_planilla')
          .select('turno_id, empleado_id, solicitud_id, accion, turno:turnos!inner(fecha)')
          .gte('turno.fecha', desde).lte('turno.fecha', hasta)
          .order('turno_id')
          .range(d, h)),
        fetchPaginadoResult((d, h) => supabase.from('usuarios')
          .select('id, nombre, apellido')
          .order('id')
          .range(d, h)),
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
      // Desdoblamiento: las ausencias salen del camino de las horas y entran
      // por uno propio, sólo para mostrarlas. `registrosPorTurno` alimenta
      // selectRegistroPrincipal y resolverLineaLiquidacion —la cadena
      // autoritativa— y sigue sin ver una sola ausencia, que es lo que impide
      // que una falta se convierta en horas.
      const registrosPorTurno = new Map<string, any[]>()
      const ausenciaPorTurno = new Map<string, any>()
      const ausenciaIds: string[] = []
      for (const r of (registrosR.data ?? []) as any[]) {
        if (r.tipo_registro === 'ausencia') {
          if (!ausenciaPorTurno.has(r.turno_id)) {
            ausenciaPorTurno.set(r.turno_id, r)
            ausenciaIds.push(r.id)
          }
          continue
        }
        if (r.cobertura_anulada_at) continue
        const arr = registrosPorTurno.get(r.turno_id) ?? []
        arr.push(r)
        registrosPorTurno.set(r.turno_id, arr)
      }

      // Quién marcó cada ausencia y cuándo: sale de la auditoría que ya escribe
      // la RPC. No hacen falta columnas nuevas en registros_asistencia.
      const autorAusencia = new Map<string, { nombre: string | null; fecha: string }>()
      if (ausenciaIds.length > 0) {
        const { data: audAus } = await supabase
          .from('registros_asistencia_auditoria')
          .select('registro_id, modificado_por, created_at')
          .in('registro_id', ausenciaIds)
          .eq('campo', 'ausencia_supervisor')
        for (const a of ((audAus ?? []) as any[])) {
          autorAusencia.set(a.registro_id, {
            nombre: nombrePor.get(a.modificado_por) ?? null,
            fecha: a.created_at,
          })
        }
      }
      // Misma construcción que consume Reportes → Diferencias: si esto viviera
      // sólo acá, la misma fila podría figurar pendiente en una pantalla y
      // resuelta en la otra.
      const revisionPor = construirRevisionPorClave(
        (aceptR.data ?? []) as any[],
        (soliR.data ?? []) as any[],
        (reviR.data ?? []) as any[],
      )
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
        const revision = revisionPor.get(claveRevision(t.id, empleadoId)) ?? REVISION_SIN_TOCAR
        // La ausencia queda a nombre del vigilador ORIGINAL, que no siempre es
        // el de la fila: si después entró un reemplazo, la fila muestra al
        // reemplazo con sus horas y la ausencia sigue nombrando al que faltó.
        const ausencia = ausenciaPorTurno.get(t.id)
        const autorAus = ausencia ? autorAusencia.get(ausencia.id) : undefined
        resultado.push({
          turnoId: t.id,
          empleadoId,
          registroId: registro?.id ?? null,
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
          esAusencia: Boolean(ausencia),
          ausenciaVigilador: ausencia ? (nombrePor.get(ausencia.guardia_id) ?? '—') : null,
          ausenciaComentario: ausencia?.observacion ?? null,
          ausenciaSupervisor: autorAus?.nombre ?? null,
          ausenciaAt: autorAus?.fecha ?? null,
          ...revision,
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
        Turnos ya finalizados del mes elegido{esAdmin ? '' : ', dentro de su alcance'}.
        Pendiente es el turno que no quedó cubierto o sobre el que el vigilador pidió algo,
        no el que simplemente no respondió.
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
        // El estado de revision y "pide accion" no son lo mismo: un turno
        // cubierto de punta a punta que el vigilador nunca respondio sigue en
        // estado 'pendiente' y no hay nada que hacer con el. Mostrar el estado
        // crudo hacia que TODAS las filas dijeran "Pendiente" mientras el
        // contador del mes decia 75 de 283.
        const pide = requiereRevision(f)
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
              {!f.tieneFichaje && !f.esAusencia && <span style={{ marginLeft: 6, color: '#ef4444' }}>· Sin fichaje</span>}
            </div>
            {/* Ausencia marcada por un supervisor. Se muestra completa —quién
                faltó, quién lo marcó y cuándo— porque es la explicación de por
                qué ese turno no tiene horas de ese vigilador. */}
            {f.esAusencia && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: '#fca5a5', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 6, padding: '6px 10px' }}>
                <div style={{ fontWeight: 600, color: '#f87171' }}>
                  Ausente · {f.ausenciaVigilador ?? '—'} · 0 h reconocidas
                </div>
                {f.ausenciaComentario && (
                  <div style={{ marginTop: 2 }}>Comentario del supervisor: {f.ausenciaComentario}</div>
                )}
                {(f.ausenciaSupervisor || f.ausenciaAt) && (
                  <div style={{ marginTop: 2, color: '#ef4444', fontSize: 11 }}>
                    {f.ausenciaSupervisor ?? 'Supervisor'}
                    {f.ausenciaAt ? ` · ${formatFechaHora(f.ausenciaAt)}` : ''}
                  </div>
                )}
                {f.tieneFichaje && (
                  <div style={{ marginTop: 4, color: '#94a3b8' }}>
                    Cubierto después por {f.vigilador}: {f.horas.toFixed(2)} h a su nombre.
                  </div>
                )}
              </div>
            )}
            <div style={{ marginTop: 6, fontSize: 12 }}>
              Estado:{' '}
              {pide ? (
                <span style={{ fontWeight: 700, color: COLOR_ESTADO[est] }}>{ETIQUETA_ESTADO_REVISION[est]}</span>
              ) : (
                <>
                  <span style={{ fontWeight: 700, color: '#10b981' }}>✓ {ETIQUETA_NO_REQUIERE_REVISION}</span>
                  {/* El estado real no se esconde: sirve para auditar quien
                      respondio y quien no, pero deja de pedir atencion. */}
                  <span style={{ marginLeft: 8, color: '#64748b', fontSize: 11 }}>
                    ({ETIQUETA_ESTADO_REVISION[est].toLowerCase()})
                  </span>
                </>
              )}
              {f.observaciones > 0 && <span style={{ marginLeft: 8, color: '#94a3b8' }}>{f.observaciones} obs.</span>}
            </div>
            {/* El motivo concreto por el que la fila pide revisión: el fichaje
                no cubre el turno programado. Es lo que hay que decidir. */}
            {(est === 'aceptado' || est === 'pendiente') && !cubreElTurno(f) && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: '#f59e0b', background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 6, padding: '6px 10px' }}>
                {!f.tieneFichaje
                  ? `Sin fichaje sobre el turno programado (${f.horaInicioProg}–${f.horaFinProg}).`
                  : `El fichaje no cubre el turno programado (${f.horaInicioProg}–${f.horaFinProg})${
                      motivoNoCubre(f) ? `: ${ETIQUETA_MOTIVO_NO_CUBRE[motivoNoCubre(f)!]}` : ''
                    }.`}
                {est === 'aceptado' && ' Aceptado por el vigilador.'}
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
              {f.registroId && (
                <button
                  style={{ ...btn, border: '1px solid #1d4ed8', background: '#1e3a8a', color: '#bfdbfe' }}
                  onClick={() => abrirCorreccion(f)}
                >
                  Corregir horario reconocido
                </button>
              )}
              {f.registroId && (
                <button style={{ ...btn, fontSize: 11.5, color: '#94a3b8' }} onClick={() => verAuditoria(f.registroId!)}>
                  {auditoriaAbierta === f.registroId ? 'Ocultar historial' : 'Ver historial'}
                </button>
              )}
            </div>

            {f.registroId && auditoriaAbierta === f.registroId && (
              <div style={{ marginTop: 10, background: '#0b1220', border: '1px solid #1e2d42', borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: .5, marginBottom: 6 }}>
                  Historial de correcciones
                </div>
                {!auditoria.has(f.registroId) && <div style={muted}>Cargando…</div>}
                {auditoria.get(f.registroId)?.length === 0 && (
                  <div style={muted}>Sin correcciones registradas.</div>
                )}
                {(auditoria.get(f.registroId) ?? []).map((a: any) => (
                  <div key={a.id} style={{ fontSize: 12, color: '#cbd5e1', paddingBottom: 6, marginBottom: 6, borderBottom: '1px solid #16202e' }}>
                    <span style={{ color: '#94a3b8' }}>{formatFechaHora(a.created_at)}</span>
                    {' · '}<strong>{ETIQUETA_CAMPO_AUDITORIA[a.campo] ?? a.campo}</strong>
                    {a.campo === 'reconocido_fuera_de_turno'
                      ? <span style={{ color: '#fbbf24' }}> · autorizado</span>
                      : <>: <span style={{ color: '#94a3b8' }}>{a.valor_anterior ?? '—'}</span> → <span style={{ color: '#10b981' }}>{a.valor_nuevo ?? '—'}</span></>}
                    {a.comentario && <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>{a.comentario}</div>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* Corregir horario reconocido — via corregir_registro_asistencia */}
      {correccion && planCorr && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => { if (!corrGuardando) setCorreccion(null) }}
        >
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 20, width: '100%', maxWidth: 460, border: '1px solid #334155', maxHeight: '88vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>Corregir horario reconocido</div>
            <div style={{ ...muted, marginBottom: 12 }}>
              {correccion.vigilador} · {fmtFecha(correccion.fecha)} · {correccion.objetivo} · {correccion.puesto}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
              <div style={{ background: '#0b1220', border: '1px solid #1e2d42', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 10.5, color: '#64748b', textTransform: 'uppercase' }}>Horario programado</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{correccion.horaInicioProg}–{correccion.horaFinProg}</div>
                <div style={muted}>{planCorr.horasProgramadas} h</div>
              </div>
              <div style={{ background: '#0b1220', border: '1px solid #1e2d42', borderRadius: 8, padding: '8px 10px' }}>
                <div style={{ fontSize: 10.5, color: '#64748b', textTransform: 'uppercase' }}>Fichaje real</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{correccion.entrada ?? '—'}–{correccion.salida ?? '—'}</div>
                <div style={muted}>{correccion.salidaAutomatica ? ETIQUETA_SALIDA_AUTOMATICA : 'Fichaje del vigilador'}</div>
              </div>
            </div>

            {correccion.solicitudTexto && (
              <div style={{ background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)', borderRadius: 8, padding: 10, marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: '#f59e0b', marginBottom: 4 }}>Lo que informa el vigilador</div>
                <div style={{ fontSize: 13, color: '#e2e8f0', whiteSpace: 'pre-wrap' }}>{correccion.solicitudTexto}</div>
              </div>
            )}

            <label style={{ display: 'block', fontSize: 11, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>
              Horario reconocido
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <input type="time" value={corrEntrada} onChange={e => setCorrEntrada(e.target.value)}
                style={{ ...sel, width: '100%', fontSize: 14 }} />
              <input type="time" value={corrSalida} onChange={e => setCorrSalida(e.target.value)}
                style={{ ...sel, width: '100%', fontSize: 14 }} />
            </div>

            <div style={{
              background: planCorr.excedeTurno ? 'rgba(245,158,11,.1)' : '#0b1220',
              border: `1px solid ${planCorr.excedeTurno ? 'rgba(245,158,11,.4)' : '#1e2d42'}`,
              borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 13,
            }}>
              Se reconocen <strong style={{ color: planCorr.excedeTurno ? '#f59e0b' : '#10b981' }}>{planCorr.horasReconocidas} h</strong>
              {' '}sobre {planCorr.horasProgramadas} h programadas
              <div style={{ ...muted, marginTop: 2 }}>{etiquetaDiferencia(planCorr.diferencia)}</div>
            </div>

            <label style={{ display: 'block', fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>Motivo *</label>
            <textarea
              value={corrMotivo}
              onChange={e => setCorrMotivo(e.target.value)}
              rows={3}
              placeholder="Ej.: verificado con el cliente, el vigilador se quedó hasta las 20:00 por relevo tardío."
              style={{ width: '100%', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', padding: 10, fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }}
            />

            {planCorr.bloqueo && <div style={{ color: '#f59e0b', fontSize: 12, marginTop: 8 }}>{planCorr.bloqueo}</div>}
            {corrError && <div style={{ color: '#ef4444', fontSize: 12, marginTop: 8 }}>{corrError}</div>}

            {/* Confirmación específica: reconocer por encima del turno programado */}
            {corrConfirmando && (
              <div style={{ marginTop: 12, background: 'rgba(245,158,11,.1)', border: '1px solid rgba(245,158,11,.45)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#f59e0b', marginBottom: 6 }}>
                  Vas a reconocer tiempo por encima del turno
                </div>
                <div style={{ fontSize: 12.5, color: '#e2e8f0' }}>
                  El turno programado es de {planCorr.horasProgramadas} h y estás reconociendo {planCorr.horasReconocidas} h
                  ({etiquetaDiferencia(planCorr.diferencia).toLowerCase()}).
                  Estas horas <strong>van a liquidación</strong> y queda registrado quién lo autorizó, cuándo y por qué.
                </div>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 14 }}>
              <button style={{ ...btn, padding: '10px 0' }} disabled={corrGuardando}
                onClick={() => corrConfirmando ? setCorrConfirmando(false) : setCorreccion(null)}>
                {corrConfirmando ? 'Volver' : 'Cancelar'}
              </button>
              <button
                style={{ ...btn, padding: '10px 0', background: '#f59e0b', color: '#111827', border: '1px solid #f59e0b', fontWeight: 700, opacity: planCorr.bloqueo || corrGuardando ? .5 : 1 }}
                disabled={!!planCorr.bloqueo || corrGuardando}
                onClick={() => {
                  // Por encima del turno pide una confirmación aparte; el resto guarda directo.
                  if (planCorr.excedeTurno && !corrConfirmando) { setCorrConfirmando(true); return }
                  void guardarCorreccion()
                }}
              >
                {corrGuardando ? 'Guardando…' : corrConfirmando ? 'Confirmar y reconocer' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

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
