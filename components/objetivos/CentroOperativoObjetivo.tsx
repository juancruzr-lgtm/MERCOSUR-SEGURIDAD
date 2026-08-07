'use client'

// Centro Operativo del Objetivo — vista de detalle de un objetivo.
//
// Extraído de app/dashboard/AppClient.tsx sin cambios funcionales. Vivía como
// función local y por eso no podía reutilizarse desde SupervisorMobile, que es
// el motivo por el que hoy el supervisor no puede abrir el legajo del objetivo.
//
// Los estilos `S.btn*` de AppClient se reemplazaron por sus equivalentes de
// components/ui/base (mismos valores) y `Badge` se importa del mismo módulo.
//
// Los datos ya no llegan por props desde AppClient: el componente los pide a
// lib/legajo-objetivo.ts con el `objetivoId`. Es lo que le permite montarse
// desde cualquier pantalla sin arrastrar el estado global del panel de admin.

import { useCallback, useEffect, useState } from 'react'
import { supabase, headersSesion } from '@/lib/supabase'
import { Badge, btn, btnPrimary, btnSecondary } from '@/components/ui/base'
import RondasSupervisionPanel from '@/components/rondas/RondasSupervisionPanel'
import styles from './CentroOperativoObjetivo.module.css'
import {
  cargarLegajoObjetivo, cargarRondasObjetivo, derivarEstadoObjetivo,
  indexarRegistrosPorTurno, turnoTieneEntrada, nombrePersona,
  presentacionSemaforo, fechaHoyLocal,
  cargarProgramacionMensualObjetivo, filtrarProgramacionMensual, origenTurno,
  ETIQUETA_SIN_ASIGNAR,
} from '@/lib/legajo-objetivo'
import type {
  FiltroAsignacion, LegajoObjetivo, ObjetivoLegajo, PersonaLegajo,
  RondaLegajo, TurnoLegajo, TurnoMensualLegajo,
} from '@/lib/legajo-objetivo'
import { diaSemanaCorto } from '@/lib/programacion'
import { etiquetaCaracteristica } from '@/lib/caracteristica-turno'
import { listarRondaAlertasObjetivo } from '@/lib/rondas'
import { formatFechaHora } from '@/lib/formato'
import {
  ETIQUETA_ESTADO_ASIGNACION, ETIQUETA_MOTIVO_OMISION,
  accionesCelda, armarGrillaMensual, celdaTieneAcciones,
  estadoAsignacion, esTurnoFuturo,
  filtrarGrillaMensual, planificarAsignacionRango,
  resumenAsignacionMensual, turnosEnConflicto,
} from '@/lib/asignacion-mensual'
import type {
  EstadoAsignacion, FilaGrillaPosicion, FiltrosGrillaMensual,
  PatronDias, PlanAsignacion, TurnoGrilla, VigiladorGrilla,
} from '@/lib/asignacion-mensual'
import {
  ETIQUETA_GENERACION_CELDA, motivoBloqueoGeneracion,
  planificarGeneracionGrilla, resumenResultadoGeneracion,
} from '@/lib/generacion-grilla'
import type { PlanGeneracionGrilla, ResultadoGeneracionGrilla } from '@/lib/generacion-grilla'
import {
  ETIQUETA_MOTIVO_OMISION_PUBLICACION, etiquetaAlcancePublicacion,
  planificarPublicacion, puedePublicarProgramacion,
} from '@/lib/publicacion-programacion'
import type { FiltroPublicacion, PlanPublicacion as PlanPublicacionMensual } from '@/lib/publicacion-programacion'
import {
  SeccionUbicacion, SeccionAsistencias, SeccionRondas,
  SeccionSupervisiones, SeccionNovedades,
} from './LegajoSecciones'
import {
  cargarPosicionesOperativas, cargarDependenciasPosicion, cargarDependenciasEliminacion,
  crearPosicionOperativa, editarPosicionOperativa, duplicarPosicionOperativa, eliminarPosicionOperativa,
  construirCambiosEdicion, sugerirNombreDuplicado, motivoBloqueoDesactivar, motivoBloqueoEliminar,
  puedeEscribirPosiciones, filtroConfigurarCobertura,
} from '@/lib/puestos'
import type { PosicionOperativa, DependenciasPosicion, DependenciasEliminacion } from '@/lib/puestos'

const S = { btn, btnPrimary, btnSecondary }

// Mapeo temporal objetivo → URL rondas JWM.
// Indexado por nombre exacto del objetivo (case-sensitive).
// Reemplazar con tabla objetivo_integraciones cuando escale.
const JWM_RONDAS_URL: Record<string, string> = {
  'ACA':                'https://overseas.jwmyun.com/setup/dept',
  'Club Universitario': 'https://overseas.jwmyun.com/setup/dept',
  'PNC Remolques':      'https://overseas.jwmyun.com/setup/dept',
}

// ── CENTRO OPERATIVO DEL OBJETIVO ────────────────────────────────────
function CentroOperativoObjetivo({ objetivoId, onVolver, onNavigate, esAdmin, rolUsuario }: {
  objetivoId: string
  onVolver: () => void
  onNavigate?: (destino: string, filtro?: any) => void
  esAdmin?: boolean
  rolUsuario?: 'admin' | 'supervisor' | 'guardia' | 'vigilador'
}) {
  const hoy = fechaHoyLocal()

  // ── Datos del legajo ──
  const [datos, setDatos] = useState<LegajoObjetivo | null>(null)
  const [cargando, setCargando] = useState(true)
  const [rondasDirty, setRondasDirty] = useState(false)

  const recargar = useCallback(async () => {
    setCargando(true)
    setDatos(await cargarLegajoObjetivo(objetivoId, hoy))
    setCargando(false)
  }, [objetivoId, hoy])

  useEffect(() => { void recargar() }, [recargar])

  // Al actualizar la ubicación se parchea el objetivo en memoria en vez de
  // recargar el legajo entero: el resto de los datos no cambió y una recarga
  // cerraría las secciones que el usuario tenga abiertas.
  const aplicarObjetivo = useCallback((o: ObjetivoLegajo) => {
    setDatos(prev => prev ? { ...prev, objetivo: o } : prev)
  }, [])

  // Solo admin y supervisor escriben coordenadas. RLS lo vuelve a validar en el
  // servidor; esto evita ofrecer una acción que va a fallar.
  const puedeEditarUbicacion = rolUsuario === 'admin' || rolUsuario === 'supervisor' || esAdmin === true

  // ── Rondas nativas pendientes ──
  // Solo el contador para el resumen de arriba: el detalle y la intervención
  // viven en la pestaña Alertas de RondasSupervisionPanel, más abajo. Sin esto
  // el resumen del objetivo no decía nada de rondas nativas —su única métrica
  // de rondas era "Checkpoints JWM hoy", del sistema importado.
  const [rondasPendientes, setRondasPendientes] = useState<number | null>(null)

  useEffect(() => {
    let vivo = true
    setRondasPendientes(null)
    void listarRondaAlertasObjetivo(objetivoId, 'pendiente').then(({ data }) => {
      if (!vivo) return
      setRondasPendientes(data?.contexto === 'ok' ? data.alertas.length : 0)
    })
    return () => { vivo = false }
  }, [objetivoId])

  // ── Programación mensual (dentro de la sección de turnos) ──
  // Solo lectura por ahora: la asignación de vigiladores llega en el próximo
  // bloque y va a montarse sobre esta misma vista.
  const [mostrarMensual, setMostrarMensual] = useState(false)
  const [mesMensual, setMesMensual] = useState(() => hoy.slice(0, 7))
  const [turnosMensual, setTurnosMensual] = useState<TurnoMensualLegajo[]>([])
  const [personasMensual, setPersonasMensual] = useState<PersonaLegajo[]>([])
  const [mensualCargando, setMensualCargando] = useState(false)
  const [mensualError, setMensualError] = useState<string | null>(null)
  const [filtroPuestoMensual, setFiltroPuestoMensual] = useState('')
  const [filtroAsignacionMensual, setFiltroAsignacionMensual] = useState<FiltroAsignacion>('todos')

  const cargarMensual = useCallback(async () => {
    setMensualCargando(true)
    setMensualError(null)
    const res = await cargarProgramacionMensualObjetivo(objetivoId, mesMensual)
    setTurnosMensual(res.turnos)
    setPersonasMensual(res.personas)
    setMensualError(res.error)
    setMensualCargando(false)
  }, [objetivoId, mesMensual])

  useEffect(() => {
    if (!mostrarMensual) return
    void cargarMensual()
  }, [mostrarMensual, cargarMensual])

  // ── Asignación de vigiladores sobre la grilla mensual ──
  // Prototipo funcional (Bloque E): pasa turnos de Programado a Asignado.
  // No publica, no notifica. Vista Grilla (por defecto) o Lista (existente).
  const [vistaMensual, setVistaMensual] = useState<'grilla' | 'lista'>('grilla')
  const [vigiladoresActivos, setVigiladoresActivos] = useState<VigiladorGrilla[]>([])
  const [sugeridoPorPuesto, setSugeridoPorPuesto] = useState<Map<string, string>>(new Map())
  const [filtroEstadoMensual, setFiltroEstadoMensual] = useState<EstadoAsignacion | 'todos'>('todos')
  const [filtroGuardiaMensual, setFiltroGuardiaMensual] = useState('')
  const [filtroConflictoMensual, setFiltroConflictoMensual] = useState<'todos' | 'con' | 'sin'>('todos')

  useEffect(() => {
    if (!mostrarMensual) return
    let vivo = true
    void supabase.from('usuarios').select('id, nombre, apellido, estado, rol')
      .in('rol', ['guardia', 'vigilador']).eq('estado', 'activo').order('apellido')
      .then(({ data }) => {
        if (!vivo || !data) return
        setVigiladoresActivos(data.map((u: any) => ({ id: u.id, nombre: `${u.apellido}, ${u.nombre}`, estado: u.estado })))
      })
    void supabase.from('servicios_objetivo').select('puesto_id, guardia_habitual_id')
      .eq('objetivo_id', objetivoId).eq('activo', true)
      .then(({ data }) => {
        if (!vivo || !data) return
        const mapa = new Map<string, string>()
        for (const s of data as any[]) if (s.puesto_id && s.guardia_habitual_id) mapa.set(s.puesto_id, s.guardia_habitual_id)
        setSugeridoPorPuesto(mapa)
      })
    return () => { vivo = false }
  }, [mostrarMensual, objetivoId])

  const nombreVigiladorGrilla = (id: string | null) => {
    if (!id) return null
    return vigiladoresActivos.find(v => v.id === id)?.nombre ?? nombrePersona(id, personasMensual)
  }

  // La grilla de asignación es solo para cobertura normal: capacitaciones y
  // coberturas/reemplazos quedan fuera de este bloque (restricción explícita).
  // La Vista Lista, en cambio, sigue mostrando todos los turnos del mes sin
  // filtrar — eso no cambia.
  const turnosGrilla: TurnoGrilla[] = turnosMensual
    .filter(t => (t.tipo_evento ?? 'normal') === 'normal')
    .map(t => ({
    id: t.id, puesto_id: t.puesto_id, puesto_nombre: t.puesto_nombre,
    fecha: t.fecha, hora_inicio: t.hora_inicio, hora_fin: t.hora_fin,
    guardia_id: t.guardia_id, guardia_nombre: nombreVigiladorGrilla(t.guardia_id),
    guardia_habitual_id: t.puesto_id ? sugeridoPorPuesto.get(t.puesto_id) ?? null : null,
    estado: t.estado, tipo_evento: t.tipo_evento, publicado: t.publicado,
  }))

  const [anioMensual, mesNumMensual] = mesMensual.split('-').map(Number)
  const desdeMes = `${mesMensual}-01`
  const hastaMes = `${mesMensual}-${String(new Date(anioMensual, mesNumMensual, 0).getDate()).padStart(2, '0')}`
  const grillaMensual = armarGrillaMensual(turnosGrilla, desdeMes, hastaMes)
  const conflictosGrilla = turnosEnConflicto(turnosGrilla)
  const horaActualRef = new Date()
  const horaActualStr = `${String(horaActualRef.getHours()).padStart(2,'0')}:${String(horaActualRef.getMinutes()).padStart(2,'0')}`
  const resumenMensual = resumenAsignacionMensual(turnosGrilla, hoy, horaActualStr)

  // ── Modal: acciones sobre un turno (clic en celda) ──
  // Un solo modal con menú: asignar/cambiar/quitar vigilador, cambiar el
  // horario de ese día y anular. Las tres últimas van por /api/turnos/editar,
  // que ya audita el cambio y revalida en servidor qué se puede tocar según
  // el turno sea futuro, en curso o finalizado. No se creó ninguna RPC nueva.
  type ModoCelda = 'menu' | 'vigilador' | 'horario' | 'quitar' | 'anular'
  const [celdaEditando, setCeldaEditando] = useState<TurnoGrilla | null>(null)
  const [modoCelda, setModoCelda] = useState<ModoCelda>('menu')
  const [guardiaCelda, setGuardiaCelda] = useState('')
  const [horaInicioCelda, setHoraInicioCelda] = useState('')
  const [horaFinCelda, setHoraFinCelda] = useState('')
  const [motivoCelda, setMotivoCelda] = useState('')
  const [errorCelda, setErrorCelda] = useState('')
  const [asignandoCelda, setAsignandoCelda] = useState(false)

  // ── Modal: asignación por rango / por fila completa ──
  const [filaAsignando, setFilaAsignando] = useState<FilaGrillaPosicion | null>(null)
  const [modoFilaCompleta, setModoFilaCompleta] = useState(false)
  const [rangoDesde, setRangoDesde] = useState('')
  const [rangoHasta, setRangoHasta] = useState('')
  const [rangoGuardia, setRangoGuardia] = useState('')
  const [rangoPatron, setRangoPatron] = useState<PatronDias>('todos')
  const [rangoExcluir, setRangoExcluir] = useState('')
  const [asignandoRango, setAsignandoRango] = useState(false)
  const [resultadoRango, setResultadoRango] = useState<string | null>(null)

  const abrirCelda = (t: TurnoGrilla) => {
    setCeldaEditando(t)
    setModoCelda('menu')
    setGuardiaCelda(t.guardia_id ?? t.guardia_habitual_id ?? '')
    setHoraInicioCelda(t.hora_inicio)
    setHoraFinCelda(t.hora_fin)
    setMotivoCelda('')
    setErrorCelda('')
  }

  const cerrarCelda = () => {
    setCeldaEditando(null)
    setModoCelda('menu')
    setMotivoCelda('')
    setErrorCelda('')
  }

  /**
   * Cambios que no son "asignar sobre un turno vacío": los ejecuta
   * /api/turnos/editar, que audita y revalida en servidor. `snapshot` le
   * permite detectar que el turno cambió desde que se abrió el modal.
   */
  const editarTurnoCelda = async (
    cambios: Record<string, string | null>,
    comentario: string,
    snapshot: Record<string, string | null>,
  ): Promise<boolean> => {
    if (!celdaEditando) return false
    setAsignandoCelda(true)
    setErrorCelda('')
    try {
      const res = await fetch('/api/turnos/editar', {
        method: 'POST',
        headers: await headersSesion(),
        body: JSON.stringify({ turno_id: celdaEditando.id, cambios, comentario, snapshot }),
      })
      const result = await res.json()
      if (!res.ok) throw new Error(result.error || 'No se pudo guardar el cambio')
      await cargarMensual()
      cerrarCelda()
      return true
    } catch (e) {
      setErrorCelda(e instanceof Error ? e.message : 'No se pudo guardar el cambio')
      return false
    } finally {
      setAsignandoCelda(false)
    }
  }

  const confirmarHorarioCelda = async () => {
    if (!celdaEditando) return
    if (!horaInicioCelda || !horaFinCelda) { setErrorCelda('Completá el horario.'); return }
    if (horaInicioCelda === horaFinCelda) { setErrorCelda('El horario de fin no puede ser igual al de inicio.'); return }
    if (horaInicioCelda === celdaEditando.hora_inicio && horaFinCelda === celdaEditando.hora_fin) {
      setErrorCelda('El horario es el mismo que ya tenía.'); return
    }
    await editarTurnoCelda(
      { hora_inicio: horaInicioCelda, hora_fin: horaFinCelda },
      `Cambio de horario desde la grilla: ${celdaEditando.hora_inicio}–${celdaEditando.hora_fin} → ${horaInicioCelda}–${horaFinCelda}`,
      { hora_inicio: celdaEditando.hora_inicio, hora_fin: celdaEditando.hora_fin },
    )
  }

  const confirmarQuitarVigilador = async () => {
    if (!celdaEditando || motivoCelda.trim().length < 3) return
    await editarTurnoCelda(
      { guardia_id: null },
      `Vigilador quitado desde la grilla: ${motivoCelda.trim()}`,
      { guardia_id: celdaEditando.guardia_id ?? null },
    )
  }

  const confirmarAnularCelda = async () => {
    if (!celdaEditando || motivoCelda.trim().length < 3) return
    await editarTurnoCelda(
      { estado: 'anulado' },
      `Anulación desde la grilla: ${motivoCelda.trim()}`,
      { estado: celdaEditando.estado },
    )
  }

  const ejecutarAsignacion = async (turnoIds: string[], guardiaId: string, masiva: boolean): Promise<{ ok: boolean; error?: string; resumen?: string }> => {
    if (turnoIds.length === 0) return { ok: false, error: 'No hay turnos válidos para asignar.' }
    const { data, error } = await supabase.rpc('asignar_vigilador_turnos', {
      p_operacion_id: crypto.randomUUID(),
      p_guardia_id: guardiaId,
      p_turno_ids: turnoIds,
      p_masiva: masiva,
    })
    if (error) return { ok: false, error: error.message }
    await cargarMensual()
    const r = data as any
    return { ok: true, resumen: `${r.asignadas} asignado(s) · ${r.ya_asignadas} ya asignado(s) · ${r.omitidas} omitido(s)` }
  }

  const confirmarCelda = async () => {
    if (!celdaEditando || !guardiaCelda) return
    if (guardiaCelda === celdaEditando.guardia_id) { setErrorCelda('Ya está asignado a ese vigilador.'); return }

    // Turno vacío: la RPC de asignación, que además valida superposiciones del
    // vigilador. Turno que ya tiene a otro: reasignación por la vía auditada
    // (la RPC la rechaza a propósito y remite a la edición del turno).
    if (!celdaEditando.guardia_id) {
      setAsignandoCelda(true)
      setErrorCelda('')
      const res = await ejecutarAsignacion([celdaEditando.id], guardiaCelda, false)
      setAsignandoCelda(false)
      if (!res.ok) { setErrorCelda(res.error ?? 'No se pudo asignar.'); return }
      cerrarCelda()
      return
    }

    const anterior = nombreVigiladorGrilla(celdaEditando.guardia_id) ?? 'sin asignar'
    const nuevo = nombreVigiladorGrilla(guardiaCelda) ?? guardiaCelda
    await editarTurnoCelda(
      { guardia_id: guardiaCelda },
      `Cambio de vigilador desde la grilla: ${anterior} → ${nuevo}`,
      { guardia_id: celdaEditando.guardia_id },
    )
  }

  const abrirRango = (fila: FilaGrillaPosicion, filaCompleta: boolean) => {
    const fechas = [...fila.celdas.keys()].sort()
    setFilaAsignando(fila)
    setModoFilaCompleta(filaCompleta)
    setRangoDesde(filaCompleta ? (fechas[0] ?? desdeMes) : desdeMes)
    setRangoHasta(filaCompleta ? (fechas[fechas.length - 1] ?? hastaMes) : hastaMes)
    setRangoGuardia(sugeridoPorPuesto.get(fila.puesto_id) ?? '')
    setRangoPatron('todos')
    setRangoExcluir('')
    setResultadoRango(null)
  }

  const planRango: PlanAsignacion | null = filaAsignando && rangoGuardia
    ? planificarAsignacionRango({
        fila: filaAsignando,
        desde: rangoDesde || desdeMes,
        hasta: rangoHasta || hastaMes,
        guardiaId: rangoGuardia,
        patron: rangoPatron,
        excluir: rangoExcluir.split(',').map(s => s.trim()).filter(Boolean),
        fechaActual: hoy,
        horaActual: horaActualStr,
        turnosVigilador: turnosGrilla.filter(t => t.guardia_id === rangoGuardia),
      })
    : null

  const confirmarRango = async () => {
    if (!planRango || !rangoGuardia || planRango.turno_ids.length === 0) return
    setAsignandoRango(true)
    setResultadoRango(null)
    const res = await ejecutarAsignacion(planRango.turno_ids, rangoGuardia, true)
    setAsignandoRango(false)
    if (!res.ok) { setResultadoRango(`❌ ${res.error}`); return }
    setResultadoRango(`✅ ${res.resumen}`)
  }

  // ── Publicación de la programación mensual ──
  // Cambia únicamente turnos.publicado — nunca horarios, posiciones,
  // vigiladores, asistencias, GPS ni horas; no crea ni elimina turnos.
  // Mismo modelo de permisos que la asignación de vigiladores (admin o
  // supervisor dentro de su zona); no se amplía.
  const puedePublicar = puedePublicarProgramacion(rolUsuario) || esAdmin === true
  const [modoSeleccionPublicar, setModoSeleccionPublicar] = useState(false)
  const [turnosSeleccionadosPublicar, setTurnosSeleccionadosPublicar] = useState<Set<string>>(new Set())
  const [modalPublicar, setModalPublicar] = useState(false)
  const [publicarDesde, setPublicarDesde] = useState('')
  const [publicarHasta, setPublicarHasta] = useState('')
  const [publicarPosiciones, setPublicarPosiciones] = useState<Set<string>>(new Set())
  const [publicando, setPublicando] = useState(false)
  const [resultadoPublicar, setResultadoPublicar] = useState<string | null>(null)
  const [errorPublicar, setErrorPublicar] = useState('')

  const posicionesGrilla = grillaMensual.filas.map(f => ({ id: f.puesto_id, nombre: f.puesto_nombre }))
    .filter((p, i, arr) => p.id && arr.findIndex(x => x.id === p.id) === i)

  const toggleSeleccionCelda = (turnoId: string) => {
    setTurnosSeleccionadosPublicar(prev => {
      const next = new Set(prev)
      if (next.has(turnoId)) next.delete(turnoId); else next.add(turnoId)
      return next
    })
  }

  const abrirPublicar = () => {
    setErrorPublicar('')
    setResultadoPublicar(null)
    if (turnosSeleccionadosPublicar.size === 0) {
      setPublicarDesde(desdeMes)
      setPublicarHasta(hastaMes)
      setPublicarPosiciones(new Set())
    }
    setModalPublicar(true)
  }

  const filtroPublicar: FiltroPublicacion = turnosSeleccionadosPublicar.size > 0
    ? { modo: 'turnos', turnoIds: [...turnosSeleccionadosPublicar] }
    : { modo: 'rango', desde: publicarDesde || desdeMes, hasta: publicarHasta || hastaMes, puestoIds: publicarPosiciones.size > 0 ? [...publicarPosiciones] : null }

  const planPublicar: PlanPublicacionMensual = planificarPublicacion(turnosGrilla, filtroPublicar)

  const confirmarPublicar = async () => {
    if (planPublicar.turno_ids.length === 0) return
    setPublicando(true)
    setErrorPublicar('')
    setResultadoPublicar(null)
    const nombresPos = publicarPosiciones.size > 0
      ? posicionesGrilla.filter(p => publicarPosiciones.has(p.id)).map(p => p.nombre)
      : undefined
    const alcance = etiquetaAlcancePublicacion(filtroPublicar, nombresPos)
    const { data, error } = await supabase.rpc('publicar_turnos_programacion', {
      p_objetivo_id: objetivoId,
      p_turno_ids: planPublicar.turno_ids,
      p_alcance: alcance,
    })
    setPublicando(false)
    if (error) { setErrorPublicar(error.message); return }
    const r = data as any
    setResultadoPublicar(`✅ ${r.publicados} publicado(s) · ${r.ya_publicados} ya publicado(s) · ${r.omitidos} omitido(s)`)
    setTurnosSeleccionadosPublicar(new Set())
    setModoSeleccionPublicar(false)
    await cargarMensual()
  }

  const cerrarModalPublicar = () => {
    setModalPublicar(false)
    setResultadoPublicar(null)
    setErrorPublicar('')
  }

  // ── Programación desde la grilla: crear los turnos de una posición ──
  // Evita el rodeo de salir a la pantalla de Programación para el caso
  // cotidiano ("esta posición, de lunes a viernes, de 22 a 06"). No reemplaza
  // ni modifica "Generar mes": ese camino sigue igual.
  //
  // Mismo modelo de permisos que la asignación y la publicación (admin o
  // supervisor); la RPC crear_turnos_posicion_objetivo revalida todo en
  // servidor y es la única vía de escritura.
  const [modalGenerar, setModalGenerar] = useState(false)
  const [genPuesto, setGenPuesto] = useState('')
  const [genHoraInicio, setGenHoraInicio] = useState('')
  const [genHoraFin, setGenHoraFin] = useState('')
  const [genDesde, setGenDesde] = useState('')
  const [genHasta, setGenHasta] = useState('')
  const [genPatron, setGenPatron] = useState<PatronDias>('todos')
  const [genExcluir, setGenExcluir] = useState('')
  const [generandoTurnos, setGenerandoTurnos] = useState(false)
  const [resultadoGenerar, setResultadoGenerar] = useState<string | null>(null)
  const [errorGenerar, setErrorGenerar] = useState('')

  // El rango arranca desde hoy (no desde el 1°) para no ofrecer por defecto un
  // montón de días pasados que igual no se pueden crear.
  const desdeSugerido = hoy > desdeMes && hoy <= hastaMes ? hoy : desdeMes

  const abrirGenerar = (fila?: FilaGrillaPosicion) => {
    setGenPuesto(fila?.puesto_id ?? '')
    setGenHoraInicio(fila?.hora_inicio ?? '')
    setGenHoraFin(fila?.hora_fin ?? '')
    setGenDesde(desdeSugerido)
    setGenHasta(hastaMes)
    setGenPatron('todos')
    setGenExcluir('')
    setResultadoGenerar(null)
    setErrorGenerar('')
    setModalGenerar(true)
  }

  const bloqueoGenerar = motivoBloqueoGeneracion({
    puestoId: genPuesto, horaInicio: genHoraInicio, horaFin: genHoraFin,
    desde: genDesde, hasta: genHasta,
  })

  // El plan se calcula contra los turnos del mes ya cargados. Las fechas del
  // formulario están acotadas a ese mes justamente para que lo que se muestra
  // acá coincida con lo que la RPC va a encontrar.
  const planGenerar: PlanGeneracionGrilla | null = bloqueoGenerar ? null
    : planificarGeneracionGrilla({
        puestoId: genPuesto,
        horaInicio: genHoraInicio,
        horaFin: genHoraFin,
        desde: genDesde,
        hasta: genHasta,
        patron: genPatron,
        excluir: genExcluir.split(',').map(s => s.trim()).filter(Boolean),
        turnosExistentes: turnosMensual.map(t => ({
          puesto_id: t.puesto_id, fecha: t.fecha,
          hora_inicio: t.hora_inicio, hora_fin: t.hora_fin,
          estado: t.estado, tipo_evento: t.tipo_evento,
        })),
        fechaActual: hoy,
        horaActual: horaActualStr,
      })

  const confirmarGenerar = async () => {
    if (!planGenerar || planGenerar.fechas_a_crear.length === 0 || generandoTurnos) return
    setGenerandoTurnos(true)
    setErrorGenerar('')
    setResultadoGenerar(null)
    const { data, error } = await supabase.rpc('crear_turnos_posicion_objetivo', {
      p_operacion_id: crypto.randomUUID(),
      p_objetivo_id: objetivoId,
      p_puesto_id: genPuesto,
      p_hora_inicio: genHoraInicio,
      p_hora_fin: genHoraFin,
      p_fechas: planGenerar.fechas_a_crear,
    })
    setGenerandoTurnos(false)
    if (error) { setErrorGenerar(error.message); return }
    setResultadoGenerar(`✅ ${resumenResultadoGeneracion(data as ResultadoGeneracionGrilla)}`)
    await cargarMensual()
  }

  // ── Posiciones operativas: alta, edición, duplicación, desactivación ──
  // Preferencia de este bloque: admin escribe, supervisor solo lee (no se
  // amplían permisos silenciosamente). El servidor (RPC) vuelve a validar
  // todo — este flag solo gobierna qué botones se muestran.
  const puedeEscribirPos = puedeEscribirPosiciones(rolUsuario) || esAdmin === true
  const [posicionesOp, setPosicionesOp] = useState<PosicionOperativa[]>([])
  const [coberturaPorPosicion, setCoberturaPorPosicion] = useState<Set<string>>(new Set())
  const [cargandoPosiciones, setCargandoPosiciones] = useState(true)

  const cargarPosiciones = useCallback(async () => {
    setCargandoPosiciones(true)
    const res = await cargarPosicionesOperativas(objetivoId)
    setPosicionesOp(res.posiciones)
    setCoberturaPorPosicion(res.conCobertura)
    setCargandoPosiciones(false)
  }, [objetivoId])

  useEffect(() => { void cargarPosiciones() }, [cargarPosiciones])

  const horaActualLocal = () => {
    const d = new Date()
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  }

  // Modal único para crear/editar/duplicar (mismo formulario, distinto envío).
  const [modalPosicion, setModalPosicion] = useState<null | { modo: 'crear' | 'editar' | 'duplicar'; base?: PosicionOperativa }>(null)
  const [formPosicion, setFormPosicion] = useState({ nombre: '', orden: '', observacion: '', activo: true })
  const [errorPosicion, setErrorPosicion] = useState('')
  const [guardandoPosicion, setGuardandoPosicion] = useState(false)

  const abrirCrearPosicion = () => {
    setFormPosicion({ nombre: '', orden: '', observacion: '', activo: true })
    setErrorPosicion('')
    setModalPosicion({ modo: 'crear' })
  }
  const abrirEditarPosicion = (p: PosicionOperativa) => {
    setFormPosicion({ nombre: p.nombre, orden: p.orden != null ? String(p.orden) : '', observacion: p.observacion ?? '', activo: p.activo })
    setErrorPosicion('')
    setModalPosicion({ modo: 'editar', base: p })
  }
  const abrirDuplicarPosicion = (p: PosicionOperativa) => {
    setFormPosicion({ nombre: sugerirNombreDuplicado(p.nombre, posicionesOp), orden: '', observacion: '', activo: true })
    setErrorPosicion('')
    setModalPosicion({ modo: 'duplicar', base: p })
  }

  const guardarPosicion = async () => {
    if (!modalPosicion) return
    if (!formPosicion.nombre.trim()) { setErrorPosicion('El nombre es obligatorio.'); return }
    setGuardandoPosicion(true)
    setErrorPosicion('')
    const ordenNum = formPosicion.orden.trim() ? Number(formPosicion.orden) : null
    let error: string | null = null
    if (modalPosicion.modo === 'crear') {
      ;({ error } = await crearPosicionOperativa(objetivoId, formPosicion.nombre, ordenNum, formPosicion.observacion))
    } else if (modalPosicion.modo === 'duplicar' && modalPosicion.base) {
      ;({ error } = await duplicarPosicionOperativa(modalPosicion.base.id, formPosicion.nombre))
    } else if (modalPosicion.modo === 'editar' && modalPosicion.base) {
      const cambios = construirCambiosEdicion(modalPosicion.base, {
        nombre: formPosicion.nombre, orden: ordenNum, observacion: formPosicion.observacion, activo: modalPosicion.base.activo,
      })
      if (Object.keys(cambios).length > 1) ({ error } = await editarPosicionOperativa(cambios))
    }
    setGuardandoPosicion(false)
    if (error) { setErrorPosicion(error); return }
    await cargarPosiciones()
    setModalPosicion(null)
  }

  // Desactivar: primero muestra qué la bloquea (lectura), después confirma.
  const [desactivando, setDesactivando] = useState<PosicionOperativa | null>(null)
  const [depDesactivar, setDepDesactivar] = useState<DependenciasPosicion | null>(null)
  const [cargandoDepDesactivar, setCargandoDepDesactivar] = useState(false)
  const [errorDesactivar, setErrorDesactivar] = useState('')
  const [confirmandoDesactivar, setConfirmandoDesactivar] = useState(false)

  const abrirDesactivar = async (p: PosicionOperativa) => {
    setDesactivando(p)
    setErrorDesactivar('')
    setDepDesactivar(null)
    setCargandoDepDesactivar(true)
    const { data } = await cargarDependenciasPosicion(p.id, hoy, horaActualLocal())
    setDepDesactivar(data)
    setCargandoDepDesactivar(false)
  }
  const confirmarDesactivar = async () => {
    if (!desactivando) return
    setConfirmandoDesactivar(true)
    setErrorDesactivar('')
    const { error } = await editarPosicionOperativa({ id: desactivando.id, activo: false })
    setConfirmandoDesactivar(false)
    if (error) { setErrorDesactivar(error); return }
    await cargarPosiciones()
    setDesactivando(null)
  }
  const activarPosicion = async (p: PosicionOperativa) => {
    setErrorPosicion('')
    const { error } = await editarPosicionOperativa({ id: p.id, activo: true })
    if (error) { setErrorPosicion(error); return }
    await cargarPosiciones()
  }

  // Eliminación excepcional: solo cuando no queda ninguna referencia.
  const [eliminando, setEliminando] = useState<{ p: PosicionOperativa; dep: DependenciasEliminacion } | null>(null)
  const [motivoEliminar, setMotivoEliminar] = useState('')
  const [errorEliminar, setErrorEliminar] = useState('')
  const [confirmandoEliminar, setConfirmandoEliminar] = useState(false)

  const abrirEliminar = async (p: PosicionOperativa) => {
    setErrorPosicion('')
    const { data, error } = await cargarDependenciasEliminacion(p.id)
    if (error || !data) { setErrorPosicion(error ?? 'No se pudieron revisar las dependencias.'); return }
    setMotivoEliminar('')
    setErrorEliminar('')
    setEliminando({ p, dep: data })
  }
  const confirmarEliminar = async () => {
    if (!eliminando) return
    setConfirmandoEliminar(true)
    setErrorEliminar('')
    const { ok, error } = await eliminarPosicionOperativa(eliminando.p.id, motivoEliminar)
    setConfirmandoEliminar(false)
    if (!ok) { setErrorEliminar(error ?? 'No se pudo eliminar.'); return }
    await cargarPosiciones()
    setEliminando(null)
  }

  const irAConfigurarCobertura = (p: PosicionOperativa) => {
    onNavigate?.('servicios_objetivo', filtroConfigurarCobertura(objetivoId, p.id))
  }

  // ── Historial de rondas JWM ──
  const [historial, setHistorial] = useState<RondaLegajo[]>([])
  const [histDesde, setHistDesde] = useState(hoy)
  const [histHasta, setHistHasta] = useState(hoy)
  const [histLoading, setHistLoading] = useState(false)

  const cargarHistorial = async (desde: string, hasta: string) => {
    setHistLoading(true)
    const { rondas } = await cargarRondasObjetivo(objetivoId, desde, hasta)
    setHistorial(rondas)
    setHistLoading(false)
  }

  useEffect(() => { void cargarHistorial(histDesde, histHasta) }, [objetivoId])

  // ── Modal importación de rondas JWM ──
  const [showModal, setShowModal] = useState(false)
  const [modalStep, setModalStep] = useState<'form'|'loading'|'done'|'error'>('form')
  const [fechaDesde, setFechaDesde] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d.toLocaleDateString('sv-SE')
  })
  const [fechaHasta, setFechaHasta] = useState(hoy)
  const [jwmToken, setJwmToken] = useState('')
  const [modalMsg, setModalMsg] = useState('')
  const [modalCount, setModalCount] = useState(0)

  const importarRondas = async () => {
    setModalStep('loading')
    setModalMsg('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const resp = await fetch('/api/jwm/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token ?? ''}` },
        body: JSON.stringify({ token: jwmToken, fecha_desde: fechaDesde, fecha_hasta: fechaHasta, objetivo_id: objetivoId }),
      })
      const json = await resp.json()
      if (!resp.ok) {
        setModalStep('error')
        setModalMsg(json?.message ?? json?.error ?? 'Error desconocido')
        return
      }
      setModalCount(json.filas_nuevas ?? 0)
      setModalStep('done')
    } catch (e: any) {
      setModalStep('error')
      setModalMsg(e?.message ?? 'Error de red')
    }
  }

  const cerrarModal = () => {
    setShowModal(false)
    setModalStep('form')
    setJwmToken(''); setModalMsg('')
  }

  // Todas las derivaciones salen del servicio: no se recalcula nada acá.
  const objetivo          = datos?.objetivo ?? null
  const turnosHoy         = datos?.turnosHoy ?? []
  const registros         = datos?.registros ?? []
  const ultimaSupervision = datos?.ultimaSupervision ?? null
  const novedadesObj      = datos?.novedadesActivas ?? []
  const personas          = datos?.personas ?? []

  const { turnosActivos, turnosProximos, turnosSinFichar, alertas, semaforo } =
    derivarEstadoObjetivo(turnosHoy, registros, novedadesObj)

  const { color: semaforoColor, label: semaforoLabel } = presentacionSemaforo(semaforo)

  const registrosPorTurno = indexarRegistrosPorTurno(registros)
  const tieneEntrada = (t: TurnoLegajo) => turnoTieneEntrada(t.id, registrosPorTurno)
  const estaSinFichar = (t: TurnoLegajo) => turnosSinFichar.some(x => x.id === t.id)

  const nombreGuardia = (id?: string | null) => nombrePersona(id, personas)
  const ejecutarConConfirmacionRondas = (accion: () => void) => {
    if (
      !rondasDirty ||
      window.confirm('Hay cambios de rondas sin guardar. Si continuás podrían perderse. ¿Querés continuar?')
    ) {
      accion()
    }
  }

  if (cargando && !datos) {
    return (
      <div className={styles.root} style={{ padding: 16, color: '#64748b' }}>
        <button
          type="button"
          style={{ ...S.btn, ...S.btnSecondary, minHeight:44, padding:'6px 12px', fontSize:12, marginBottom:16 }}
          onClick={onVolver}
        >
          ← Volver
        </button>
        <div>Cargando objetivo…</div>
      </div>
    )
  }

  if (!objetivo) {
    return (
      <div className={styles.root} style={{ padding: 16 }}>
        <button type="button" style={{ ...S.btn, ...S.btnSecondary, minHeight:44, padding:'6px 12px', fontSize:12 }} onClick={() => ejecutarConConfirmacionRondas(onVolver)}>← Volver</button>
        <div style={{ color: '#ef4444', marginTop: 16 }}>
          {datos?.error || 'No se pudo cargar el objetivo.'}
        </div>
      </div>
    )
  }
  const hora = (h: string) => h?.slice(0, 5) || '—'
  // 24 h vía lib/formato.ts: `toLocaleDateString` con opciones de hora devuelve
  // AM/PM en los runtimes con ICU reciente.
  const fechaCorta = (iso: string) => (iso ? formatFechaHora(iso) : '—')

  const card: React.CSSProperties = { background:'#111827', border:'1px solid #1e2d42', borderRadius:12, padding:16, marginBottom:16 }
  const secTitle: React.CSSProperties = { fontFamily:'Syne,sans-serif', fontWeight:700, fontSize:14, color:'#e2e8f0', marginBottom:10, textTransform:'uppercase', letterSpacing:1 }
  const pill = (color: string, text: string) => (
    <span style={{ background: color + '22', color, border:`1px solid ${color}44`, borderRadius:6, padding:'2px 8px', fontSize:11, fontWeight:600 }}>{text}</span>
  )

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.header} style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
        <button type="button" style={{ ...S.btn, ...S.btnSecondary, minHeight:44, padding:'6px 12px', fontSize:12 }} onClick={onVolver}>← Volver</button>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontFamily:'Syne,sans-serif', fontSize:22, fontWeight:800, color:'#f8fafc', overflowWrap:'anywhere' }}>{objetivo.nombre}</div>
          <div style={{ color:'#94a3b8', fontSize:13 }}>{objetivo.cliente || '—'} {objetivo.direccion ? `· ${objetivo.direccion}` : ''}</div>
        </div>
        <div className={styles.status} style={{ textAlign:'right' }}>
          <div style={{ width:14, height:14, borderRadius:'50%', background:semaforoColor, display:'inline-block', marginRight:6, boxShadow:`0 0 8px ${semaforoColor}` }} />
          <span style={{ fontFamily:'Syne,sans-serif', fontWeight:700, color:semaforoColor, fontSize:15 }}>{semaforoLabel}</span>
        </div>
      </div>

      {/* Estado general */}
      <div className={styles.summaryGrid} style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(130px,1fr))', gap:10, marginBottom:16 }}>
        {[
          { label:'Turnos hoy',   value:turnosHoy.length,   color:'#3b82f6', anchor:'sec-turnos' },
          { label:'Activos ahora',value:turnosActivos.length,color:'#10b981', anchor:'sec-turnos' },
          { label:'Sin fichar',   value:turnosSinFichar.length, color:'#f59e0b', anchor:'sec-turnos' },
          { label:'Alertas',      value:alertas.length,     color: alertas.length > 0 ? '#ef4444' : '#64748b', anchor:'sec-alertas' },
          { label:'Novedades',    value:novedadesObj.length, color: novedadesObj.length > 0 ? '#f59e0b' : '#64748b', anchor:'sec-alertas' },
          { label:'Rondas pendientes', value: rondasPendientes ?? '…', color: (rondasPendientes ?? 0) > 0 ? '#ef4444' : '#64748b', anchor:'sec-rondas-nativas' },
          { label:'Checkpoints JWM hoy', value:historial.length, color:'#a78bfa', anchor:'sec-historial' },
        ].map(({ label, value, color, anchor }) => (
          <div
            key={label}
            onClick={() => ejecutarConConfirmacionRondas(() => document.getElementById(anchor)?.scrollIntoView({ behavior:'smooth', block:'start' }))}
            style={{ background:'#1a2235', border:'1px solid #1e2d42', borderRadius:8, padding:'10px 14px', cursor:'pointer', transition:'border-color 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = '#334155')}
            onMouseLeave={e => (e.currentTarget.style.borderColor = '#1e2d42')}
          >
            <div style={{ fontSize:10, color:'#64748b', textTransform:'uppercase' as const, letterSpacing:1, marginBottom:4 }}>{label}</div>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:22, fontWeight:800, color }}>{value}</div>
            <div style={{ fontSize:10, color:'#334155', marginTop:4 }}>Ver detalle ↓</div>
          </div>
        ))}
      </div>

      {/* Posiciones operativas: alta/edición/duplicación/desactivación desde el
          legajo. El horario y los días de cada posición no viven acá — son de
          servicios_objetivo; "Configurar cobertura" abre ese formulario. */}
      <div style={card}>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
          <div style={{ ...secTitle, flex:1, marginBottom:0 }}>Posiciones operativas</div>
          {puedeEscribirPos && (
            <button type="button" style={{ ...S.btn, ...S.btnPrimary, padding:'6px 12px', fontSize:12 }} onClick={abrirCrearPosicion}>
              + Agregar posición operativa
            </button>
          )}
        </div>
        {errorPosicion && !modalPosicion && <div style={{ fontSize:12, color:'#ef4444', marginBottom:8 }}>{errorPosicion}</div>}
        {cargandoPosiciones ? (
          <div style={{ color:'#64748b', fontSize:13 }}>Cargando…</div>
        ) : posicionesOp.length === 0 ? (
          <div style={{ color:'#64748b', fontSize:13 }}>Sin posiciones operativas todavía.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {posicionesOp.map(p => {
              const sinCobertura = p.activo && !coberturaPorPosicion.has(p.id)
              return (
                <div key={p.id} style={{ background:'#1a2235', border:'1px solid #1e2d42', borderRadius:8, padding:'10px 14px', opacity: p.activo ? 1 : 0.65 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                    <span style={{ color:'#e2e8f0', fontWeight:600, fontSize:13 }}>{p.nombre}</span>
                    {p.orden != null && <span style={{ color:'#475569', fontSize:11 }}>#{p.orden}</span>}
                    <Badge type={p.activo ? 'activo' : 'inactivo'}>{p.activo ? 'Activa' : 'Inactiva'}</Badge>
                    {sinCobertura && <Badge type="advertencia">Sin cobertura configurada</Badge>}
                  </div>
                  {p.observacion && <div style={{ fontSize:12, color:'#64748b', marginTop:4 }}>{p.observacion}</div>}
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginTop:8 }}>
                    <button type="button" style={{ ...S.btn, ...S.btnSecondary, padding:'5px 10px', fontSize:11 }} onClick={() => irAConfigurarCobertura(p)}>Configurar cobertura</button>
                    {puedeEscribirPos && <>
                      <button type="button" style={{ ...S.btn, ...S.btnSecondary, padding:'5px 10px', fontSize:11 }} onClick={() => abrirEditarPosicion(p)}>Editar</button>
                      <button type="button" style={{ ...S.btn, ...S.btnSecondary, padding:'5px 10px', fontSize:11 }} onClick={() => abrirDuplicarPosicion(p)}>Duplicar</button>
                      {p.activo ? (
                        <button type="button" style={{ ...S.btn, padding:'5px 10px', fontSize:11, background:'rgba(239,68,68,.1)', color:'#ef4444', border:'1px solid rgba(239,68,68,.3)' }} onClick={() => abrirDesactivar(p)}>Desactivar</button>
                      ) : (
                        <>
                          <button type="button" style={{ ...S.btn, padding:'5px 10px', fontSize:11, background:'rgba(16,185,129,.1)', color:'#10b981', border:'1px solid rgba(16,185,129,.3)' }} onClick={() => activarPosicion(p)}>Activar</button>
                          <button type="button" style={{ ...S.btn, ...S.btnSecondary, padding:'5px 10px', fontSize:11 }} onClick={() => abrirEliminar(p)}>Eliminar…</button>
                        </>
                      )}
                    </>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Modal: crear / editar / duplicar posición operativa */}
      {modalPosicion && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }} onClick={() => setModalPosicion(null)}>
          <div style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:12, padding:20, width:380, maxWidth:'90vw' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:15, fontWeight:700, marginBottom:12 }}>
              {modalPosicion.modo === 'crear' ? 'Agregar posición operativa' : modalPosicion.modo === 'duplicar' ? `Duplicar "${modalPosicion.base?.nombre}"` : `Editar "${modalPosicion.base?.nombre}"`}
            </div>
            <label style={{ fontSize:11, color:'#64748b', textTransform:'uppercase' }}>Nombre *</label>
            <input style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'8px 10px', fontSize:13, marginTop:4, marginBottom:10 }} value={formPosicion.nombre} onChange={e => setFormPosicion({ ...formPosicion, nombre: e.target.value })} placeholder="Vigilador 1, Recepción, Garita norte…" />
            <label style={{ fontSize:11, color:'#64748b', textTransform:'uppercase' }}>Orden (vacío = automático)</label>
            <input type="number" style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'8px 10px', fontSize:13, marginTop:4, marginBottom:10 }} value={formPosicion.orden} onChange={e => setFormPosicion({ ...formPosicion, orden: e.target.value })} />
            <label style={{ fontSize:11, color:'#64748b', textTransform:'uppercase' }}>Observación (opcional)</label>
            <textarea style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'8px 10px', fontSize:13, marginTop:4, marginBottom:10, minHeight:60 }} value={formPosicion.observacion} onChange={e => setFormPosicion({ ...formPosicion, observacion: e.target.value })} />
            {errorPosicion && <div style={{ fontSize:12, color:'#ef4444', marginBottom:8 }}>{errorPosicion}</div>}
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:8 }}>
              <button type="button" style={{ ...S.btn, ...S.btnSecondary, padding:'6px 14px', fontSize:12 }} onClick={() => setModalPosicion(null)}>Cancelar</button>
              <button type="button" style={{ ...S.btn, ...S.btnPrimary, padding:'6px 14px', fontSize:12, opacity: !formPosicion.nombre.trim() || guardandoPosicion ? 0.5 : 1 }} disabled={!formPosicion.nombre.trim() || guardandoPosicion} onClick={guardarPosicion}>
                {guardandoPosicion ? 'Guardando…' : modalPosicion.modo === 'crear' ? 'Crear' : modalPosicion.modo === 'duplicar' ? 'Duplicar' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: desactivar (muestra qué la bloquea antes de confirmar) */}
      {desactivando && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }} onClick={() => setDesactivando(null)}>
          <div style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:12, padding:20, width:400, maxWidth:'90vw' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:15, fontWeight:700, marginBottom:8 }}>Desactivar "{desactivando.nombre}"</div>
            {cargandoDepDesactivar || !depDesactivar ? (
              <div style={{ color:'#64748b', fontSize:13 }}>Revisando dependencias…</div>
            ) : motivoBloqueoDesactivar(depDesactivar) ? (
              <div style={{ fontSize:13, color:'#f59e0b', background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.3)', borderRadius:8, padding:10 }}>
                {motivoBloqueoDesactivar(depDesactivar)}
              </div>
            ) : (
              <>
                <div style={{ fontSize:13, color:'#e2e8f0', marginBottom:8 }}>Sin turnos futuros vigentes ni servicios activos vinculados. No aparecerá en nuevas altas; los históricos siguen visibles.</div>
                {errorDesactivar && <div style={{ fontSize:12, color:'#ef4444', marginBottom:8 }}>{errorDesactivar}</div>}
              </>
            )}
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:14 }}>
              <button type="button" style={{ ...S.btn, ...S.btnSecondary, padding:'6px 14px', fontSize:12 }} onClick={() => setDesactivando(null)}>Cancelar</button>
              {depDesactivar && !motivoBloqueoDesactivar(depDesactivar) && (
                <button type="button" style={{ ...S.btn, padding:'6px 14px', fontSize:12, background:'rgba(239,68,68,.15)', color:'#fecaca', border:'1px solid rgba(239,68,68,.45)', opacity: confirmandoDesactivar ? 0.5 : 1 }} disabled={confirmandoDesactivar} onClick={confirmarDesactivar}>
                  {confirmandoDesactivar ? 'Desactivando…' : 'Confirmar desactivación'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: eliminación excepcional (solo sin referencias) */}
      {eliminando && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }} onClick={() => setEliminando(null)}>
          <div style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:12, padding:20, width:400, maxWidth:'90vw' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:15, fontWeight:700, marginBottom:8 }}>Eliminar "{eliminando.p.nombre}"</div>
            {motivoBloqueoEliminar(eliminando.dep) ? (
              <div style={{ fontSize:13, color:'#f59e0b', background:'rgba(245,158,11,.08)', border:'1px solid rgba(245,158,11,.3)', borderRadius:8, padding:10 }}>
                {motivoBloqueoEliminar(eliminando.dep)}
              </div>
            ) : (
              <>
                <div style={{ fontSize:13, color:'#e2e8f0', marginBottom:8 }}>Nunca tuvo turnos, servicios ni historial más allá de su creación. La eliminación es física (no se puede deshacer) y queda auditada.</div>
                <label style={{ fontSize:11, color:'#64748b', textTransform:'uppercase' }}>Motivo</label>
                <input style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'8px 10px', fontSize:13, marginTop:4, marginBottom:8 }} value={motivoEliminar} onChange={e => setMotivoEliminar(e.target.value)} placeholder="Creada por error…" />
                {errorEliminar && <div style={{ fontSize:12, color:'#ef4444', marginBottom:8 }}>{errorEliminar}</div>}
              </>
            )}
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:8 }}>
              <button type="button" style={{ ...S.btn, ...S.btnSecondary, padding:'6px 14px', fontSize:12 }} onClick={() => setEliminando(null)}>Cancelar</button>
              {!motivoBloqueoEliminar(eliminando.dep) && (
                <button type="button" style={{ ...S.btn, padding:'6px 14px', fontSize:12, background:'rgba(239,68,68,.15)', color:'#fecaca', border:'1px solid rgba(239,68,68,.45)', opacity: confirmandoEliminar ? 0.5 : 1 }} disabled={confirmandoEliminar} onClick={confirmarEliminar}>
                  {confirmandoEliminar ? 'Eliminando…' : 'Eliminar definitivamente'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. Ubicación */}
      <SeccionUbicacion
        objetivo={objetivo}
        puedeEditar={puedeEditarUbicacion}
        onActualizado={aplicarObjetivo}
      />

      {/* 3. Turnos del día */}
      <div id="sec-turnos" style={card}>
        <div style={secTitle}>Turnos hoy</div>
        {turnosHoy.length === 0 ? (
          <div style={{ color:'#64748b', fontSize:13 }}>Sin turnos programados para hoy.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {turnosHoy.map((t: TurnoLegajo) => {
              const regs = registrosPorTurno.get(t.id) || []
              const reg = regs.find((r: any) => r.hora_entrada_real) || regs[0]
              const activo = turnosActivos.some((x: TurnoLegajo) => x.id === t.id)
              const sinFichar = estaSinFichar(t)
              const estadoColor = t.estado === 'descubierto' || !t.guardia_id ? '#ef4444' : activo && !reg?.hora_salida_real ? '#10b981' : sinFichar ? '#f59e0b' : '#64748b'
              return (
                <div className={styles.turnRow} key={t.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 12px', background:'#0f172a', borderRadius:8, borderLeft:`3px solid ${estadoColor}` }}>
                  <div className={styles.turnTime} style={{ minWidth:90, fontFamily:'Syne,sans-serif', fontWeight:700, fontSize:13, color:'#e2e8f0' }}>{hora(t.hora_inicio)} – {hora(t.hora_fin)}</div>
                  <div style={{ flex:1, fontSize:13, color:'#94a3b8' }}>{nombreGuardia(t.guardia_id)}</div>
                  <div className={styles.turnStatus} style={{ fontSize:11 }}>
                    {!t.guardia_id ? pill('#ef4444','Sin guardia')
                      : t.estado === 'descubierto' ? pill('#ef4444','Descubierto')
                      : reg?.hora_entrada_real && !reg?.hora_salida_real ? pill('#10b981','En turno')
                      : reg?.hora_entrada_real && reg?.hora_salida_real ? pill('#64748b','Completado')
                      : sinFichar ? pill('#f59e0b','Sin fichar')
                      : pill('#3b82f6','Programado')}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {turnosProximos.length > 0 && (
          <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid #1e2d42' }}>
            <div style={{ fontSize:11, color:'#64748b', textTransform:'uppercase', letterSpacing:1, marginBottom:8 }}>Próximos</div>
            {turnosProximos.map((t: TurnoLegajo) => (
              <div className={styles.upcomingRow} key={t.id} style={{ display:'flex', gap:12, padding:'6px 0', borderBottom:'1px solid #0f172a', fontSize:13, color:'#94a3b8' }}>
                <span style={{ fontFamily:'Syne,sans-serif', fontWeight:700, color:'#e2e8f0', minWidth:90 }}>{hora(t.hora_inicio)} – {hora(t.hora_fin)}</span>
                <span>{nombreGuardia(t.guardia_id)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Programación mensual: el mes completo del objetivo, sin ocultar
            turnos sin vigilador ni limitar a hoy/próximos. Prototipo
            funcional de asignación (Bloque E): Programado → Asignado.
            No publica, no notifica. */}
        <div style={{ marginTop:12, paddingTop:12, borderTop:'1px solid #1e2d42' }}>
          <button
            type="button"
            style={{ ...S.btn, ...S.btnSecondary, padding:'6px 14px', fontSize:12 }}
            onClick={() => setMostrarMensual(v => !v)}
          >
            {mostrarMensual ? 'Ocultar programación mensual' : 'Ver programación mensual'}
          </button>

          {mostrarMensual && (() => {
            const posiciones = Array.from(
              new Map(
                turnosMensual
                  .filter(t => t.puesto_id)
                  .map(t => [t.puesto_id as string, t.puesto_nombre ?? '—']),
              ).entries(),
            )
            const guardiasEnMes = Array.from(
              new Map(
                turnosGrilla.filter(t => t.guardia_id)
                  .map(t => [t.guardia_id as string, t.guardia_nombre ?? '—']),
              ).entries(),
            )
            const filtrosGrilla: FiltrosGrillaMensual = {
              puestoId: filtroPuestoMensual || null,
              estado: filtroEstadoMensual,
              guardiaId: filtroGuardiaMensual || null,
              conConflicto: filtroConflictoMensual === 'todos' ? null : filtroConflictoMensual === 'con',
            }
            const idsVisibles = new Set(filtrarGrillaMensual(turnosGrilla, filtrosGrilla).map(t => t.id))
            const nombreVigilador = (t: TurnoMensualLegajo) =>
              t.guardia_id ? nombrePersona(t.guardia_id, personasMensual) : ETIQUETA_SIN_ASIGNAR
            const filtradosLista = filtrarProgramacionMensual(turnosMensual, {
              puestoId: filtroPuestoMensual || null,
              asignacion: filtroAsignacionMensual,
            })
            return (
              <div style={{ marginTop:12 }}>
                {/* Resumen del mes — se recalcula sin F5 tras cada asignación. */}
                <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:12 }}>
                  {[
                    { label:'Turnos futuros', valor: resumenMensual.futuros, color:'#e2e8f0' },
                    { label: ETIQUETA_ESTADO_ASIGNACION.programado, valor: resumenMensual.programados, color:'#f59e0b' },
                    { label: ETIQUETA_ESTADO_ASIGNACION.asignado, valor: resumenMensual.asignados, color:'#10b981' },
                    { label: ETIQUETA_ESTADO_ASIGNACION.publicado, valor: resumenMensual.publicados, color:'#60a5fa' },
                  ].map(chip => (
                    <div key={chip.label} style={{ background:'#0b1220', border:'1px solid #1e2d42', borderRadius:8, padding:'6px 12px', textAlign:'center' }}>
                      <div style={{ fontFamily:'Syne,sans-serif', fontSize:16, fontWeight:700, color:chip.color }}>{chip.valor}</div>
                      <div style={{ fontSize:10, color:'#64748b' }}>{chip.label}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:10 }}>
                  <div style={{ display:'flex', gap:4 }}>
                    <button type="button" style={{ ...S.btn, ...(vistaMensual === 'grilla' ? S.btnPrimary : S.btnSecondary), padding:'6px 12px', fontSize:12 }} onClick={() => setVistaMensual('grilla')}>Vista Grilla</button>
                    <button type="button" style={{ ...S.btn, ...(vistaMensual === 'lista' ? S.btnPrimary : S.btnSecondary), padding:'6px 12px', fontSize:12 }} onClick={() => setVistaMensual('lista')}>Vista Lista</button>
                  </div>
                  <input
                    type="month"
                    value={mesMensual}
                    onChange={e => setMesMensual(e.target.value)}
                    style={{ background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'6px 10px', fontSize:13 }}
                  />
                  <select
                    value={filtroPuestoMensual}
                    onChange={e => setFiltroPuestoMensual(e.target.value)}
                    style={{ background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'6px 10px', fontSize:13 }}
                  >
                    <option value="">Todas las posiciones</option>
                    {posiciones.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
                  </select>
                  {vistaMensual === 'grilla' ? (
                    <>
                      <select value={filtroEstadoMensual} onChange={e => setFiltroEstadoMensual(e.target.value as any)} style={{ background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'6px 10px', fontSize:13 }}>
                        <option value="todos">Todos los estados</option>
                        <option value="programado">{ETIQUETA_ESTADO_ASIGNACION.programado}</option>
                        <option value="asignado">{ETIQUETA_ESTADO_ASIGNACION.asignado}</option>
                        <option value="publicado">{ETIQUETA_ESTADO_ASIGNACION.publicado}</option>
                      </select>
                      <select value={filtroGuardiaMensual} onChange={e => setFiltroGuardiaMensual(e.target.value)} style={{ background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'6px 10px', fontSize:13 }}>
                        <option value="">Todos los vigiladores</option>
                        {guardiasEnMes.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
                      </select>
                      <select value={filtroConflictoMensual} onChange={e => setFiltroConflictoMensual(e.target.value as any)} style={{ background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'6px 10px', fontSize:13 }}>
                        <option value="todos">Con y sin conflicto</option>
                        <option value="con">Solo con conflicto</option>
                        <option value="sin">Solo sin conflicto</option>
                      </select>
                    </>
                  ) : (
                    <select
                      value={filtroAsignacionMensual}
                      onChange={e => setFiltroAsignacionMensual(e.target.value as FiltroAsignacion)}
                      style={{ background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'6px 10px', fontSize:13 }}
                    >
                      <option value="todos">Todos</option>
                      <option value="con">Con vigilador</option>
                      <option value="sin">Sin vigilador</option>
                    </select>
                  )}
                  <span style={{ fontSize:12, color:'#64748b' }}>
                    {mensualCargando ? 'Cargando…' : vistaMensual === 'grilla'
                      ? `${idsVisibles.size} de ${turnosGrilla.length} turnos del mes`
                      : `${filtradosLista.length} de ${turnosMensual.length} turnos del mes`}
                  </span>
                </div>

                {puedePublicar && (
                  <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:10 }}>
                    {vistaMensual === 'grilla' && (
                      <button
                        type="button"
                        title="Crear los turnos de una posición operativa para este mes"
                        style={{ ...S.btn, ...S.btnSecondary, padding:'6px 14px', fontSize:12 }}
                        onClick={() => abrirGenerar()}
                      >
                        + Agregar turnos
                      </button>
                    )}
                    <button type="button" style={{ ...S.btn, ...S.btnPrimary, padding:'6px 14px', fontSize:12 }} onClick={abrirPublicar}>
                      Publicar programación
                    </button>
                    {vistaMensual === 'grilla' && (
                      <button
                        type="button"
                        style={{ ...S.btn, ...(modoSeleccionPublicar ? S.btnPrimary : S.btnSecondary), padding:'6px 12px', fontSize:12 }}
                        onClick={() => { setModoSeleccionPublicar(v => !v); setTurnosSeleccionadosPublicar(new Set()) }}
                      >
                        {modoSeleccionPublicar ? 'Cancelar selección' : 'Seleccionar turnos para publicar'}
                      </button>
                    )}
                    {modoSeleccionPublicar && turnosSeleccionadosPublicar.size > 0 && (
                      <span style={{ fontSize:12, color:'#60a5fa' }}>{turnosSeleccionadosPublicar.size} turno(s) seleccionado(s)</span>
                    )}
                  </div>
                )}
                {mensualError && <div style={{ color:'#ef4444', fontSize:12, marginBottom:8 }}>{mensualError}</div>}
                {!mensualCargando && turnosMensual.length === 0 && !mensualError && (
                  <div style={{ color:'#64748b', fontSize:13 }}>
                    Sin turnos programados para este mes.
                    {puedePublicar && vistaMensual === 'grilla' && ' Usá “+ Agregar turnos” para crearlos desde acá.'}
                  </div>
                )}

                {vistaMensual === 'grilla' && grillaMensual.filas.length > 0 && (
                  <div style={{ overflowX:'auto', maxHeight:480, overflowY:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                      <thead>
                        <tr>
                          <th style={{ position:'sticky', left:0, top:0, zIndex:2, background:'#111827', textAlign:'left', padding:'6px 8px', color:'#64748b', fontSize:10, textTransform:'uppercase', borderBottom:'1px solid #1e2d42', minWidth:170 }}>Posición · Horario</th>
                          {grillaMensual.fechas.map(f => (
                            <th key={f} style={{ position:'sticky', top:0, background:'#111827', textAlign:'center', padding:'4px 6px', color:'#64748b', fontSize:10, borderBottom:'1px solid #1e2d42', minWidth:52 }}>{f.slice(8, 10)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {grillaMensual.filas
                          .filter(fila => !filtroPuestoMensual || fila.puesto_id === filtroPuestoMensual)
                          .map(fila => (
                          <tr key={`${fila.puesto_id}|${fila.hora_inicio}`}>
                            <td style={{ position:'sticky', left:0, background:'#0b1220', padding:'6px 8px', borderBottom:'1px solid #0f172a' }}>
                              <div style={{ color:'#e2e8f0', fontWeight:600 }}>{fila.puesto_nombre}</div>
                              <div style={{ color:'#64748b', fontFamily:'Syne,sans-serif' }}>{fila.hora_inicio}–{fila.hora_fin}</div>
                              <div style={{ display:'flex', gap:4, marginTop:4, flexWrap:'wrap' }}>
                                {puedePublicar && (
                                  <button type="button" title="Crear los turnos que falten en esta posición y horario" style={{ ...S.btn, ...S.btnPrimary, padding:'2px 6px', fontSize:10 }} onClick={() => abrirGenerar(fila)}>+ Agregar</button>
                                )}
                                <button type="button" title="Asignar desde/hasta con patrón de días" style={{ ...S.btn, ...S.btnSecondary, padding:'2px 6px', fontSize:10 }} onClick={() => abrirRango(fila, false)}>Rango</button>
                                <button type="button" title="Asignar todos los turnos visibles de esta posición" style={{ ...S.btn, ...S.btnSecondary, padding:'2px 6px', fontSize:10 }} onClick={() => abrirRango(fila, true)}>Fila completa</button>
                              </div>
                            </td>
                            {grillaMensual.fechas.map(f => {
                              const t = fila.celdas.get(f)
                              if (!t || !idsVisibles.has(t.id)) return <td key={f} style={{ borderBottom:'1px solid #0f172a', padding:4 }} />
                              const futuro = esTurnoFuturo(t, hoy, horaActualStr)
                              const conConflicto = conflictosGrilla.has(t.id)
                              const est = estadoAsignacion(t)
                              const seleccionadoPublicar = turnosSeleccionadosPublicar.has(t.id)
                              const colorFondo = seleccionadoPublicar ? 'rgba(96,165,250,.22)'
                                : conConflicto ? 'rgba(239,68,68,.15)'
                                : est === 'publicado' ? 'rgba(96,165,250,.12)'
                                : est === 'asignado' ? 'rgba(16,185,129,.1)' : 'rgba(148,163,184,.08)'
                              const colorTexto = conConflicto ? '#ef4444' : est === 'publicado' ? '#60a5fa' : est === 'asignado' ? '#10b981' : '#94a3b8'
                              return (
                                <td key={f} style={{ borderBottom:'1px solid #0f172a', padding:2, textAlign:'center' }}>
                                  <button
                                    type="button"
                                    disabled={!modoSeleccionPublicar && !futuro}
                                    onClick={() => modoSeleccionPublicar ? toggleSeleccionCelda(t.id) : (futuro && abrirCelda(t))}
                                    title={modoSeleccionPublicar ? 'Click para incluir/excluir de la publicación' : conConflicto ? 'Conflicto: superpuesto con otro turno del mismo vigilador' : ETIQUETA_ESTADO_ASIGNACION[est]}
                                    style={{
                                      width:'100%', minWidth:48, padding:'5px 3px', borderRadius:6, fontSize:10.5,
                                      background: colorFondo, color: colorTexto,
                                      border: seleccionadoPublicar ? '1px solid #60a5fa' : conConflicto ? '1px solid rgba(239,68,68,.4)' : '1px solid transparent',
                                      cursor: (modoSeleccionPublicar || futuro) ? 'pointer' : 'default', opacity: (modoSeleccionPublicar || futuro) ? 1 : 0.55,
                                    }}
                                  >
                                    {seleccionadoPublicar ? '✓ ' : ''}{t.guardia_nombre ? t.guardia_nombre.split(',')[0] : '—'}
                                  </button>
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {vistaMensual === 'lista' && filtradosLista.length > 0 && (
                  <div style={{ overflowX:'auto', maxHeight:420, overflowY:'auto' }}>
                    <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                      <thead>
                        <tr>
                          {['Fecha','Día','Posición operativa','Horario','Vigilador','Estado','Caract.','Origen'].map(h => (
                            <th key={h} style={{ textAlign:'left', padding:'6px 8px', color:'#64748b', fontSize:11, textTransform:'uppercase', letterSpacing:0.5, borderBottom:'1px solid #1e2d42', position:'sticky', top:0, background:'#111827' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtradosLista.map(t => (
                          <tr key={t.id} style={{ borderBottom:'1px solid #0f172a' }}>
                            <td style={{ padding:'6px 8px', color:'#e2e8f0' }}>{t.fecha}</td>
                            <td style={{ padding:'6px 8px', color:'#94a3b8' }}>{diaSemanaCorto(t.fecha)}</td>
                            <td style={{ padding:'6px 8px', color:'#e2e8f0' }}>{t.puesto_nombre ?? '—'}</td>
                            <td style={{ padding:'6px 8px', color:'#94a3b8', fontFamily:'Syne,sans-serif', fontWeight:700 }}>{hora(t.hora_inicio)} – {hora(t.hora_fin)}</td>
                            <td style={{ padding:'6px 8px', color: t.guardia_id ? '#e2e8f0' : '#f59e0b' }}>{nombreVigilador(t)}</td>
                            <td style={{ padding:'6px 8px', color:'#94a3b8' }}>
                              {t.estado}
                              {t.publicado && <span style={{ marginLeft:6, color:'#60a5fa', fontWeight:700 }}>· Publicado</span>}
                            </td>
                            <td style={{ padding:'6px 8px', color:'#94a3b8' }}>{etiquetaCaracteristica(t.tipo_evento)}</td>
                            <td style={{ padding:'6px 8px', color: t.servicio_base_id ? '#60a5fa' : '#94a3b8' }}>{origenTurno(t)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })()}
        </div>
      </div>

      {/* Modal: publicar programación (mes / rango / posiciones / turnos elegidos) */}
      {modalPublicar && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }} onClick={cerrarModalPublicar}>
          <div style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:12, padding:20, width:480, maxWidth:'92vw', maxHeight:'85vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:15, fontWeight:700, marginBottom:4 }}>Publicar programación</div>
            <div style={{ fontSize:12, color:'#64748b', marginBottom:12 }}>
              Solo cambia el estado a Publicado. No modifica horarios, posiciones, vigiladores, asistencias, GPS ni horas. No crea ni elimina turnos.
            </div>

            {turnosSeleccionadosPublicar.size > 0 ? (
              <div style={{ fontSize:13, color:'#e2e8f0', marginBottom:12 }}>
                Alcance: <strong>{turnosSeleccionadosPublicar.size} turno(s) seleccionado(s) manualmente</strong> en la grilla.
              </div>
            ) : (
              <>
                <div style={{ display:'flex', gap:8, marginBottom:10 }}>
                  <div style={{ flex:1 }}>
                    <label style={{ fontSize:11, color:'#64748b', textTransform:'uppercase' }}>Desde</label>
                    <input type="date" value={publicarDesde || desdeMes} onChange={e => setPublicarDesde(e.target.value)}
                      style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'7px 9px', fontSize:13, marginTop:4 }} />
                  </div>
                  <div style={{ flex:1 }}>
                    <label style={{ fontSize:11, color:'#64748b', textTransform:'uppercase' }}>Hasta</label>
                    <input type="date" value={publicarHasta || hastaMes} onChange={e => setPublicarHasta(e.target.value)}
                      style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'7px 9px', fontSize:13, marginTop:4 }} />
                  </div>
                </div>
                <div style={{ marginBottom:12 }}>
                  <label style={{ fontSize:11, color:'#64748b', textTransform:'uppercase' }}>Posiciones (vacío = todas)</label>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:6 }}>
                    {posicionesGrilla.map(p => {
                      const activa = publicarPosiciones.has(p.id)
                      return (
                        <button key={p.id} type="button"
                          onClick={() => setPublicarPosiciones(prev => {
                            const next = new Set(prev)
                            if (next.has(p.id)) next.delete(p.id); else next.add(p.id)
                            return next
                          })}
                          style={{ ...S.btn, ...(activa ? S.btnPrimary : S.btnSecondary), padding:'4px 10px', fontSize:11 }}
                        >
                          {p.nombre}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </>
            )}

            <div style={{ background:'#0b1220', border:'1px solid #1e2d42', borderRadius:8, padding:10, marginBottom:12 }}>
              <div style={{ fontSize:13, color:'#e2e8f0', marginBottom:4 }}>
                <strong style={{ color:'#60a5fa' }}>{planPublicar.resumen.validos}</strong> turno(s) se van a publicar
                {planPublicar.resumen.ya_publicados > 0 && <> · {planPublicar.resumen.ya_publicados} ya estaban publicados</>}
                {planPublicar.resumen.omitidos > 0 && <> · {planPublicar.resumen.omitidos} se omiten</>}
              </div>
              {planPublicar.resumen.omitidos > 0 && (
                <ul style={{ margin:'6px 0 0', paddingLeft:18, fontSize:11.5, color:'#94a3b8' }}>
                  {(Object.entries(planPublicar.resumen.omitidos_por_motivo) as [keyof typeof planPublicar.resumen.omitidos_por_motivo, number][])
                    .filter(([, n]) => n > 0)
                    .map(([motivo, n]) => (
                      <li key={motivo}>{n} × {ETIQUETA_MOTIVO_OMISION_PUBLICACION[motivo]}</li>
                    ))}
                </ul>
              )}
            </div>

            {errorPublicar && <div style={{ color:'#ef4444', fontSize:12, marginBottom:10 }}>{errorPublicar}</div>}
            {resultadoPublicar && <div style={{ color:'#10b981', fontSize:12, marginBottom:10 }}>{resultadoPublicar}</div>}

            <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
              <button type="button" style={{ ...S.btn, ...S.btnSecondary }} onClick={cerrarModalPublicar}>Cerrar</button>
              <button type="button" style={{ ...S.btn, ...S.btnPrimary }} disabled={publicando || planPublicar.turno_ids.length === 0} onClick={confirmarPublicar}>
                {publicando ? 'Publicando…' : `Confirmar publicación (${planPublicar.resumen.validos})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: acciones sobre un turno (clic en celda de la grilla) */}
      {celdaEditando && (() => {
        const acc = accionesCelda(celdaEditando, hoy, horaActualStr, puedePublicar)
        const cabecera = `${celdaEditando.puesto_nombre} · ${celdaEditando.fecha} · ${celdaEditando.hora_inicio}–${celdaEditando.hora_fin}`
        const opcion = (texto: string, sub: string, destructivo: boolean, onClick: () => void) => (
          <button
            type="button"
            onClick={onClick}
            style={{
              width:'100%', textAlign:'left', background:'#0f172a',
              border:`1px solid ${destructivo ? '#7f1d1d' : '#1e2d42'}`, borderRadius:8,
              padding:'9px 12px', cursor:'pointer', marginBottom:6,
            }}
          >
            <div style={{ fontSize:13, color: destructivo ? '#f87171' : '#e2e8f0', fontWeight:600 }}>{texto}</div>
            <div style={{ fontSize:11, color:'#64748b' }}>{sub}</div>
          </button>
        )
        return (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }} onClick={() => cerrarCelda()}>
          <div style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:12, padding:20, width:380, maxWidth:'90vw', maxHeight:'85vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:15, fontWeight:700, marginBottom:4 }}>
              {modoCelda === 'menu' ? 'Turno' :
               modoCelda === 'vigilador' ? (celdaEditando.guardia_id ? 'Cambiar vigilador' : 'Asignar vigilador') :
               modoCelda === 'horario' ? 'Cambiar horario de este día' : 'Anular turno'}
            </div>
            <div style={{ fontSize:12, color:'#64748b', marginBottom:4 }}>{cabecera}</div>
            <div style={{ fontSize:12, marginBottom:12 }}>
              <span style={{ color: celdaEditando.guardia_nombre ? '#e2e8f0' : '#f59e0b' }}>
                {celdaEditando.guardia_nombre ?? ETIQUETA_SIN_ASIGNAR}
              </span>
              {celdaEditando.publicado && <span style={{ color:'#60a5fa', fontWeight:700 }}> · Publicado</span>}
            </div>

            {conflictosGrilla.has(celdaEditando.id) && (
              <div style={{ fontSize:11, color:'#ef4444', marginBottom:8 }}>Este turno tiene un conflicto de horario con otro turno del vigilador asignado.</div>
            )}

            {modoCelda === 'menu' && (
              <>
                {celdaEditando.publicado && (
                  <div style={{ fontSize:11, color:'#60a5fa', background:'rgba(96,165,250,.08)', border:'1px solid rgba(96,165,250,.3)', borderRadius:6, padding:'6px 10px', marginBottom:10 }}>
                    Ya se le avisó al vigilador. Si cambiás algo, conviene avisarle.
                  </div>
                )}
                {acc.asignar && opcion('Asignar vigilador', 'Elegir quién cubre este turno', false, () => { setModoCelda('vigilador'); setErrorCelda('') })}
                {acc.cambiarVigilador && opcion('Cambiar vigilador', 'Reemplazar a quien está asignado', false, () => { setModoCelda('vigilador'); setErrorCelda('') })}
                {acc.quitarVigilador && opcion('Quitar vigilador', 'El turno queda sin cubrir', false, () => { setModoCelda('quitar'); setErrorCelda('') })}
                {acc.cambiarHorario && opcion('Cambiar horario', 'Solo para este día', false, () => {
                  setHoraInicioCelda(celdaEditando.hora_inicio); setHoraFinCelda(celdaEditando.hora_fin)
                  setModoCelda('horario'); setErrorCelda('')
                })}
                {acc.anular && opcion('Anular turno', 'Deja de contar, pero queda el registro', true, () => { setModoCelda('anular'); setErrorCelda('') })}
                {!celdaTieneAcciones(acc) && (
                  <div style={{ fontSize:12, color:'#64748b' }}>
                    Este turno ya no se modifica desde la grilla (ya empezó, es pasado o está anulado).
                  </div>
                )}
              </>
            )}

            {modoCelda === 'vigilador' && (
              <>
                <label style={{ fontSize:11, color:'#64748b', textTransform:'uppercase' }}>Vigilador</label>
                <select style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'8px 10px', fontSize:13, marginTop:4, marginBottom:8 }} value={guardiaCelda} onChange={e => setGuardiaCelda(e.target.value)}>
                  <option value="">Seleccionar…</option>
                  {vigiladoresActivos.map(v => (
                    <option key={v.id} value={v.id}>{v.nombre}{v.id === celdaEditando.guardia_habitual_id ? ' (sugerido)' : ''}</option>
                  ))}
                </select>
                {celdaEditando.guardia_habitual_id && guardiaCelda !== celdaEditando.guardia_habitual_id && (
                  <div style={{ fontSize:11, color:'#60a5fa', marginBottom:8 }}>Sugerencia habitual: {nombreVigiladorGrilla(celdaEditando.guardia_habitual_id)}</div>
                )}
              </>
            )}

            {modoCelda === 'horario' && (
              <div style={{ display:'flex', gap:8, marginBottom:8 }}>
                <div style={{ flex:1 }}>
                  <label style={{ fontSize:11, color:'#64748b' }}>Hora inicio</label>
                  <input type="time" style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'6px 8px', fontSize:12 }} value={horaInicioCelda} onChange={e => setHoraInicioCelda(e.target.value)} />
                </div>
                <div style={{ flex:1 }}>
                  <label style={{ fontSize:11, color:'#64748b' }}>Hora fin</label>
                  <input type="time" style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'6px 8px', fontSize:12 }} value={horaFinCelda} onChange={e => setHoraFinCelda(e.target.value)} />
                </div>
              </div>
            )}

            {(modoCelda === 'anular' || modoCelda === 'quitar') && (
              <>
                <div style={{ fontSize:12, color:'#e2e8f0', marginBottom:8 }}>
                  {modoCelda === 'anular'
                    ? 'El turno deja de contar para cobertura, planillas y liquidación. No se borra: queda registrado como anulado.'
                    : 'El turno queda programado pero sin vigilador asignado.'}
                </div>
                <label style={{ fontSize:11, color:'#64748b' }}>Motivo *</label>
                <input
                  style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'6px 8px', fontSize:12, marginTop:4, marginBottom:8 }}
                  value={motivoCelda}
                  onChange={e => setMotivoCelda(e.target.value)}
                  placeholder={modoCelda === 'anular' ? 'Ej.: el cliente cancela el servicio ese día' : 'Ej.: pidió el día'}
                />
              </>
            )}

            {errorCelda && <div style={{ fontSize:12, color:'#ef4444', marginBottom:8 }}>{errorCelda}</div>}

            <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:8 }}>
              <button type="button" style={{ ...S.btn, ...S.btnSecondary, padding:'6px 14px', fontSize:12 }}
                onClick={() => modoCelda === 'menu' ? cerrarCelda() : (setModoCelda('menu'), setErrorCelda(''))}>
                {modoCelda === 'menu' ? 'Cerrar' : 'Volver'}
              </button>
              {modoCelda === 'vigilador' && (
                <button type="button" style={{ ...S.btn, ...S.btnPrimary, padding:'6px 14px', fontSize:12, opacity: !guardiaCelda || asignandoCelda ? 0.5 : 1 }} disabled={!guardiaCelda || asignandoCelda} onClick={confirmarCelda}>
                  {asignandoCelda ? 'Guardando…' : 'Confirmar'}
                </button>
              )}
              {modoCelda === 'horario' && (
                <button type="button" style={{ ...S.btn, ...S.btnPrimary, padding:'6px 14px', fontSize:12, opacity: asignandoCelda ? 0.5 : 1 }} disabled={asignandoCelda} onClick={confirmarHorarioCelda}>
                  {asignandoCelda ? 'Guardando…' : 'Guardar horario'}
                </button>
              )}
              {modoCelda === 'quitar' && (
                <button type="button" style={{ ...S.btn, ...S.btnPrimary, padding:'6px 14px', fontSize:12, opacity: motivoCelda.trim().length < 3 || asignandoCelda ? 0.5 : 1 }} disabled={motivoCelda.trim().length < 3 || asignandoCelda} onClick={confirmarQuitarVigilador}>
                  {asignandoCelda ? 'Guardando…' : 'Quitar vigilador'}
                </button>
              )}
              {modoCelda === 'anular' && (
                <button type="button" style={{ ...S.btn, padding:'6px 14px', fontSize:12, background:'#7f1d1d', color:'#fecaca', border:'1px solid #991b1b', opacity: motivoCelda.trim().length < 3 || asignandoCelda ? 0.5 : 1 }} disabled={motivoCelda.trim().length < 3 || asignandoCelda} onClick={confirmarAnularCelda}>
                  {asignandoCelda ? 'Anulando…' : 'Anular turno'}
                </button>
              )}
            </div>
          </div>
        </div>
        )
      })()}

      {/* Modal: crear los turnos de una posición (programación desde la grilla) */}
      {modalGenerar && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }} onClick={() => setModalGenerar(false)}>
          <div style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:12, padding:20, width:480, maxWidth:'90vw', maxHeight:'85vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:15, fontWeight:700, marginBottom:4 }}>Agregar turnos</div>
            <div style={{ fontSize:12, color:'#64748b', marginBottom:12 }}>
              Crea los turnos de una posición para este mes. Se crean sin vigilador: la asignación es el paso siguiente.
            </div>

            <label style={{ fontSize:11, color:'#64748b' }}>Posición operativa</label>
            <select
              style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'8px 10px', fontSize:13, marginTop:4, marginBottom:8 }}
              value={genPuesto}
              onChange={e => setGenPuesto(e.target.value)}
            >
              <option value="">Seleccionar…</option>
              {posicionesOp.filter(p => p.activo).map(p => (
                <option key={p.id} value={p.id}>{p.nombre}</option>
              ))}
            </select>

            <div style={{ display:'flex', gap:8, marginBottom:8 }}>
              <div style={{ flex:1 }}>
                <label style={{ fontSize:11, color:'#64748b' }}>Hora inicio</label>
                <input type="time" style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'6px 8px', fontSize:12 }} value={genHoraInicio} onChange={e => setGenHoraInicio(e.target.value)} />
              </div>
              <div style={{ flex:1 }}>
                <label style={{ fontSize:11, color:'#64748b' }}>Hora fin</label>
                <input type="time" style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'6px 8px', fontSize:12 }} value={genHoraFin} onChange={e => setGenHoraFin(e.target.value)} />
              </div>
            </div>
            {genHoraInicio && genHoraFin && genHoraFin < genHoraInicio && (
              <div style={{ fontSize:11, color:'#60a5fa', marginBottom:8 }}>Turno nocturno: termina al día siguiente.</div>
            )}

            <div style={{ display:'flex', gap:8, marginBottom:8 }}>
              <div style={{ flex:1 }}>
                <label style={{ fontSize:11, color:'#64748b' }}>Desde</label>
                <input type="date" min={desdeMes} max={hastaMes} style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'6px 8px', fontSize:12 }} value={genDesde} onChange={e => setGenDesde(e.target.value)} />
              </div>
              <div style={{ flex:1 }}>
                <label style={{ fontSize:11, color:'#64748b' }}>Hasta</label>
                <input type="date" min={desdeMes} max={hastaMes} style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'6px 8px', fontSize:12 }} value={genHasta} onChange={e => setGenHasta(e.target.value)} />
              </div>
            </div>

            <label style={{ fontSize:11, color:'#64748b' }}>Días</label>
            <select style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'8px 10px', fontSize:13, marginTop:4, marginBottom:8 }} value={genPatron} onChange={e => setGenPatron(e.target.value as PatronDias)}>
              <option value="todos">Todos los días</option>
              <option value="lun_vie">Lunes a viernes</option>
              <option value="sab_dom">Sábados y domingos</option>
            </select>

            <label style={{ fontSize:11, color:'#64748b' }}>Excluir fechas puntuales (YYYY-MM-DD separadas por coma)</label>
            <input style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'6px 8px', fontSize:12, marginTop:4, marginBottom:8 }} value={genExcluir} onChange={e => setGenExcluir(e.target.value)} placeholder={`${desdeSugerido}, ${hastaMes}`} />

            {bloqueoGenerar && <div style={{ fontSize:12, color:'#f59e0b', marginBottom:10 }}>{bloqueoGenerar}</div>}

            {planGenerar && (
              <div style={{ background:'#0b1220', border:'1px solid #1e2d42', borderRadius:8, padding:10, marginBottom:10, fontSize:12 }}>
                <div style={{ color:'#e2e8f0', marginBottom:4 }}>
                  Se van a crear <strong style={{ color:'#10b981' }}>{planGenerar.resumen.validos}</strong> turno(s) de {planGenerar.resumen.total} día(s) del rango.
                </div>
                <div style={{ color:'#64748b' }}>
                  Ya existen: {planGenerar.resumen.ya_existen} · Fechas pasadas: {planGenerar.resumen.fechas_pasadas} · Fuera del patrón o excluidos: {planGenerar.resumen.omitidos}
                </div>
                {planGenerar.filas.filter(f => f.estado !== 'valido' && f.estado !== 'fuera_de_patron').length > 0 && (
                  <div style={{ marginTop:6, color:'#94a3b8', maxHeight:100, overflowY:'auto' }}>
                    {planGenerar.filas.filter(f => f.estado !== 'valido' && f.estado !== 'fuera_de_patron').slice(0, 8).map(f => (
                      <div key={f.fecha}>· {f.fecha} ({f.dia_semana}): {ETIQUETA_GENERACION_CELDA[f.estado]}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {errorGenerar && <div style={{ fontSize:12, color:'#ef4444', marginBottom:8 }}>{errorGenerar}</div>}
            {resultadoGenerar && <div style={{ fontSize:12, color:'#10b981', marginBottom:8 }}>{resultadoGenerar}</div>}

            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button type="button" style={{ ...S.btn, ...S.btnSecondary, padding:'6px 14px', fontSize:12 }} onClick={() => setModalGenerar(false)}>Cerrar</button>
              <button
                type="button"
                style={{ ...S.btn, ...S.btnPrimary, padding:'6px 14px', fontSize:12, opacity: !planGenerar || planGenerar.resumen.validos === 0 || generandoTurnos ? 0.5 : 1 }}
                disabled={!planGenerar || planGenerar.resumen.validos === 0 || generandoTurnos}
                onClick={confirmarGenerar}
              >
                {generandoTurnos ? 'Creando…' : `Crear (${planGenerar?.resumen.validos ?? 0})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: asignación por rango / por fila completa */}
      {filaAsignando && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000 }} onClick={() => setFilaAsignando(null)}>
          <div style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:12, padding:20, width:460, maxWidth:'90vw', maxHeight:'85vh', overflowY:'auto' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontFamily:'Syne,sans-serif', fontSize:15, fontWeight:700, marginBottom:4 }}>
              {modoFilaCompleta ? 'Asignar todos los turnos visibles de esta posición' : 'Asignar por rango'}
            </div>
            <div style={{ fontSize:12, color:'#64748b', marginBottom:12 }}>{filaAsignando.puesto_nombre} · {filaAsignando.hora_inicio}–{filaAsignando.hora_fin}</div>

            {!modoFilaCompleta && (
              <div style={{ display:'flex', gap:8, marginBottom:8 }}>
                <div style={{ flex:1 }}>
                  <label style={{ fontSize:11, color:'#64748b' }}>Asignar desde</label>
                  <input type="date" style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'6px 8px', fontSize:12 }} value={rangoDesde} onChange={e => setRangoDesde(e.target.value)} />
                </div>
                <div style={{ flex:1 }}>
                  <label style={{ fontSize:11, color:'#64748b' }}>Asignar hasta</label>
                  <input type="date" style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'6px 8px', fontSize:12 }} value={rangoHasta} onChange={e => setRangoHasta(e.target.value)} />
                </div>
              </div>
            )}

            <label style={{ fontSize:11, color:'#64748b' }}>Vigilador</label>
            <select style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'8px 10px', fontSize:13, marginTop:4, marginBottom:8 }} value={rangoGuardia} onChange={e => setRangoGuardia(e.target.value)}>
              <option value="">Seleccionar…</option>
              {vigiladoresActivos.map(v => (
                <option key={v.id} value={v.id}>{v.nombre}{v.id === sugeridoPorPuesto.get(filaAsignando.puesto_id) ? ' (sugerido)' : ''}</option>
              ))}
            </select>

            {!modoFilaCompleta && (
              <>
                <label style={{ fontSize:11, color:'#64748b' }}>Días</label>
                <select style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'8px 10px', fontSize:13, marginTop:4, marginBottom:8 }} value={rangoPatron} onChange={e => setRangoPatron(e.target.value as PatronDias)}>
                  <option value="todos">Todos los días</option>
                  <option value="lun_vie">Lunes a viernes</option>
                  <option value="sab_dom">Sábados y domingos</option>
                </select>
                <label style={{ fontSize:11, color:'#64748b' }}>Excluir fechas puntuales (YYYY-MM-DD separadas por coma)</label>
                <input style={{ width:'100%', background:'#0f172a', border:'1px solid #1e2d42', borderRadius:8, color:'#e2e8f0', padding:'6px 8px', fontSize:12, marginTop:4, marginBottom:8 }} value={rangoExcluir} onChange={e => setRangoExcluir(e.target.value)} placeholder="2026-08-15, 2026-08-16" />
              </>
            )}

            {planRango && (
              <div style={{ background:'#0b1220', border:'1px solid #1e2d42', borderRadius:8, padding:10, marginBottom:10, fontSize:12 }}>
                <div style={{ color:'#e2e8f0', marginBottom:4 }}>
                  <strong>{planRango.resumen.validos}</strong> válido(s) de <strong>{planRango.resumen.total}</strong> turno(s) del rango.
                </div>
                <div style={{ color:'#64748b' }}>Ya asignados a este vigilador: {planRango.resumen.ya_asignados} · Conflictos detectados: {planRango.resumen.conflictos} · Omitidos: {planRango.resumen.omitidos}</div>
                {planRango.filas.filter(f => f.estado === 'omitido').length > 0 && (
                  <div style={{ marginTop:6, color:'#94a3b8', maxHeight:100, overflowY:'auto' }}>
                    {planRango.filas.filter(f => f.estado === 'omitido').slice(0, 8).map(f => (
                      <div key={f.turno_id}>· {f.fecha}: {f.motivo ? ETIQUETA_MOTIVO_OMISION[f.motivo as keyof typeof ETIQUETA_MOTIVO_OMISION] ?? f.motivo : ''}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {resultadoRango && <div style={{ fontSize:12, marginBottom:8, color: resultadoRango.startsWith('✅') ? '#10b981' : '#ef4444' }}>{resultadoRango}</div>}
            <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
              <button type="button" style={{ ...S.btn, ...S.btnSecondary, padding:'6px 14px', fontSize:12 }} onClick={() => setFilaAsignando(null)}>Cerrar</button>
              <button
                type="button"
                style={{ ...S.btn, ...S.btnPrimary, padding:'6px 14px', fontSize:12, opacity: !planRango || planRango.resumen.validos === 0 || asignandoRango ? 0.5 : 1 }}
                disabled={!planRango || planRango.resumen.validos === 0 || asignandoRango}
                onClick={confirmarRango}
              >
                {asignandoRango ? 'Asignando…' : `Confirmar (${planRango?.resumen.validos ?? 0})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Asistencias y 5. Rondas. Ambas cargan al desplegarse. */}
      <SeccionAsistencias
        objetivoId={objetivoId}
        onVerTodas={onNavigate ? () => ejecutarConConfirmacionRondas(() => onNavigate('asistencia', { tipo:'objetivo', objetivoId })) : undefined}
      />
      <SeccionRondas
        objetivoId={objetivoId}
        onVerHistorial={() => ejecutarConConfirmacionRondas(() =>
          document.getElementById('sec-rondas-nativas')?.scrollIntoView({ behavior:'smooth', block:'start' }),
        )}
      />

      {/* Última supervisión */}
      <div style={card}>
        <div style={secTitle}>Última supervisión</div>
        {!ultimaSupervision ? (
          <div style={{ color:'#64748b', fontSize:13 }}>Sin supervisiones registradas.</div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            <div style={{ display:'flex', gap:12, alignItems:'center' }}>
              <div style={{ fontSize:13, color:'#94a3b8' }}>{fechaCorta(ultimaSupervision.created_at)}</div>
              <Badge type={ultimaSupervision.estado}>{ultimaSupervision.estado?.replace('_',' ') || '—'}</Badge>
            </div>
            <div style={{ fontSize:13, color:'#64748b' }}>
              Supervisor: <span style={{ color:'#e2e8f0' }}>{ultimaSupervision.supervisor?.apellido}, {ultimaSupervision.supervisor?.nombre}</span>
            </div>
            {ultimaSupervision.observaciones && (
              <div style={{ fontSize:12, color:'#94a3b8', background:'#0f172a', borderRadius:6, padding:'6px 10px', marginTop:4 }}>{ultimaSupervision.observaciones}</div>
            )}
          </div>
        )}
      </div>

      {/* Alertas y novedades */}
      {(alertas.length > 0 || novedadesObj.length > 0) && (
        <div id="sec-alertas" style={card}>
          <div style={secTitle}>Alertas y novedades activas</div>
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {novedadesObj.slice(0, 5).map((n: any) => (
              <div key={n.id} style={{ display:'flex', gap:10, alignItems:'flex-start', padding:'8px 10px', background:'#0f172a', borderRadius:8, borderLeft:`3px solid ${n.prioridad==='urgente'?'#ef4444':n.prioridad==='importante'?'#f59e0b':'#3b82f6'}` }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, color:'#e2e8f0' }}>{n.descripcion}</div>
                  <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>{n.tipo} · {fechaCorta(n.created_at)}</div>
                </div>
                <Badge type={n.prioridad}>{n.prioridad}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6-7. Supervisiones con su checklist. 8. Novedades. */}
      <SeccionSupervisiones
        objetivoId={objetivoId}
        onVerDetalle={onNavigate ? () => ejecutarConConfirmacionRondas(() => onNavigate('supervisiones', { tipo:'objetivo', objetivoId })) : undefined}
      />
      <SeccionNovedades
        objetivoId={objetivoId}
        onVerTodas={onNavigate ? () => ejecutarConConfirmacionRondas(() => onNavigate('novedades', { tipo:'objetivo', objetivoId })) : undefined}
      />

      {/* Configuración nativa, independiente del historial importado de JWM. */}
      {(rolUsuario === 'admin' || rolUsuario === 'supervisor') && (
        <div id="sec-rondas-nativas" style={card}>
          {objetivo.zona_id === null && (
            <div style={{ color:'#fbbf24', background:'rgba(245,158,11,.1)', border:'1px solid rgba(245,158,11,.35)', borderRadius:8, padding:10, marginBottom:12, fontSize:13 }}>
              Objetivo sin zona operativa asignada.
            </div>
          )}
          <RondasSupervisionPanel
            objetivoId={objetivoId}
            centroObjetivo={
              objetivo.lat !== null && objetivo.lng !== null
                ? [objetivo.lat, objetivo.lng]
                : null
            }
            onRondasDirtyChange={setRondasDirty}
          />
        </div>
      )}

      {/* Integraciones — Rondas y Cámaras */}
      {JWM_RONDAS_URL[objetivo.nombre] && (
        <div style={card}>
          <div style={secTitle}>Integraciones</div>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            <a
              href={JWM_RONDAS_URL[objetivo.nombre]}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...S.btn, ...S.btnSecondary, fontSize:13, textDecoration:'none', display:'inline-flex', alignItems:'center', gap:6 }}
            >
              🔄 Rondas JWM
            </a>
            {esAdmin && (
              <button
                style={{ ...S.btn, ...S.btnSecondary, fontSize:13 }}
                onClick={() => { setShowModal(true); setModalStep('form') }}
              >
                📥 Recopilar datos de rondas
              </button>
            )}
            <button style={{ ...S.btn, ...S.btnSecondary, fontSize:13, opacity:0.45, cursor:'not-allowed' }} disabled>
              📷 Cámaras <span style={{ fontSize:10, color:'#475569' }}>(próximamente)</span>
            </button>
          </div>
        </div>
      )}

      {/* Historial legado de checkpoints JWM */}
      {JWM_RONDAS_URL[objetivo.nombre] && (
        <div id="sec-historial" style={card}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:10, marginBottom:12 }}>
            <div style={secTitle}>Historial JWM</div>
            <div className={styles.historyControls} style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
              <input className={styles.dateInput} type="date" value={histDesde} onChange={e => setHistDesde(e.target.value)}
                style={{ background:'#0f172a', border:'1px solid #334155', borderRadius:6, padding:'5px 8px', color:'#e2e8f0', fontSize:12 }} />
              <span style={{ color:'#475569', fontSize:12 }}>→</span>
              <input className={styles.dateInput} type="date" value={histHasta} onChange={e => setHistHasta(e.target.value)}
                style={{ background:'#0f172a', border:'1px solid #334155', borderRadius:6, padding:'5px 8px', color:'#e2e8f0', fontSize:12 }} />
              <button
                style={{ ...S.btn, ...S.btnSecondary, fontSize:12, padding:'5px 10px' }}
                onClick={() => cargarHistorial(histDesde, histHasta)}
              >
                Buscar
              </button>
            </div>
          </div>

          {histLoading ? (
            <div style={{ color:'#475569', fontSize:13 }}>Cargando…</div>
          ) : historial.length === 0 ? (
            <div style={{ color:'#475569', fontSize:13 }}>Sin controles importados para el período seleccionado.</div>
          ) : (
            <div>
              <div style={{ fontSize:11, color:'#64748b', marginBottom:8 }}>{historial.length} controles</div>
              <div style={{ overflowX:'auto' }}>
                <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                  <thead>
                    <tr style={{ borderBottom:'1px solid #1e2d42' }}>
                      {['Fecha y hora','Checkpoint','Dispositivo','Estado','Observación'].map(h => (
                        <th key={h} style={{ padding:'6px 10px', textAlign:'left', color:'#64748b', fontWeight:600, fontSize:11, textTransform:'uppercase', letterSpacing:0.5, whiteSpace:'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {historial.map((r: any) => (
                      <tr key={r.id} style={{ borderBottom:'1px solid #0f172a' }}>
                        <td style={{ padding:'7px 10px', color:'#93c5fd', whiteSpace:'nowrap', fontFamily:'Syne,sans-serif', fontWeight:600 }}>
                          {formatFechaHora(r.fecha_hora)}
                        </td>
                        <td style={{ padding:'7px 10px', color:'#e2e8f0' }}>{r.checkpoint || '—'}</td>
                        <td style={{ padding:'7px 10px', color:'#94a3b8', whiteSpace:'nowrap' }}>{r.dispositivo_id || '—'}</td>
                        <td style={{ padding:'7px 10px' }}>
                          <span style={{ background:'#052e1688', color:'#4ade80', border:'1px solid #166534', borderRadius:4, padding:'2px 7px', fontSize:11 }}>
                            {r.estado || 'ok'}
                          </span>
                        </td>
                        <td style={{ padding:'7px 10px', color:'#64748b', fontSize:11 }}>
                          {r.raw_data?.observacion || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Modal importación de rondas JWM */}
      {showModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:16 }}>
          <div style={{ background:'#111827', border:'1px solid #1e2d42', borderRadius:14, padding:24, width:'100%', maxWidth:420 }}>
            <div style={{ fontFamily:'Syne,sans-serif', fontWeight:800, fontSize:16, color:'#f8fafc', marginBottom:16 }}>
              Importar historial de rondas JWM
            </div>

            {modalStep === 'form' && (
              <>
                <div className={styles.modalDates} style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
                  <div>
                    <div style={{ fontSize:11, color:'#64748b', marginBottom:4 }}>Desde</div>
                    <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
                      style={{ width:'100%', background:'#0f172a', border:'1px solid #334155', borderRadius:6, padding:'7px 10px', color:'#e2e8f0', fontSize:13 }} />
                  </div>
                  <div>
                    <div style={{ fontSize:11, color:'#64748b', marginBottom:4 }}>Hasta</div>
                    <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
                      style={{ width:'100%', background:'#0f172a', border:'1px solid #334155', borderRadius:6, padding:'7px 10px', color:'#e2e8f0', fontSize:13 }} />
                  </div>
                </div>
                <div style={{ marginBottom:6 }}>
                  <div style={{ fontSize:11, color:'#64748b', marginBottom:4 }}>Token JWM</div>
                  <input type="password" value={jwmToken} onChange={e => setJwmToken(e.target.value)}
                    placeholder="eyJ0eXAiOiJKV1Qi..."
                    style={{ width:'100%', background:'#0f172a', border:'1px solid #334155', borderRadius:6, padding:'7px 10px', color:'#e2e8f0', fontSize:13 }} />
                </div>
                <div style={{ fontSize:11, color:'#475569', marginBottom:16, lineHeight:1.6 }}>
                  Obtené el token en JWM: F12 → Application → Local Storage → <strong style={{color:'#64748b'}}>token</strong>.
                </div>
                <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                  <button style={{ ...S.btn, ...S.btnSecondary, fontSize:13 }} onClick={cerrarModal}>Cancelar</button>
                  <button style={{ ...S.btn, ...S.btnPrimary, fontSize:13 }} onClick={importarRondas} disabled={!jwmToken}>
                    Importar
                  </button>
                </div>
              </>
            )}

            {modalStep === 'loading' && (
              <div style={{ textAlign:'center', padding:'24px 0', color:'#94a3b8', fontSize:14 }}>
                ⏳ Importando rondas desde JWM…
              </div>
            )}

            {modalStep === 'done' && (
              <>
                <div style={{ background:'#052e16', border:'1px solid #166534', borderRadius:8, padding:14, marginBottom:16, textAlign:'center' }}>
                  <div style={{ fontSize:22, marginBottom:4 }}>✅</div>
                  <div style={{ fontFamily:'Syne,sans-serif', fontWeight:700, fontSize:15, color:'#4ade80' }}>
                    {modalCount} {modalCount === 1 ? 'control nuevo importado' : 'controles nuevos importados'}
                  </div>
                  <div style={{ fontSize:12, color:'#64748b', marginTop:4 }}>Del {fechaDesde} al {fechaHasta}</div>
                </div>
                <div style={{ display:'flex', justifyContent:'flex-end' }}>
                  <button style={{ ...S.btn, ...S.btnPrimary, fontSize:13 }} onClick={cerrarModal}>Cerrar</button>
                </div>
              </>
            )}

            {modalStep === 'error' && (
              <>
                <div style={{ background:'#1c1917', border:'1px solid #44403c', borderRadius:8, padding:12, marginBottom:16, fontSize:13, color:'#f87171' }}>
                  {modalMsg || 'Error al importar datos.'}
                </div>
                <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                  <button style={{ ...S.btn, ...S.btnSecondary, fontSize:13 }} onClick={() => setModalStep('form')}>Reintentar</button>
                  <button style={{ ...S.btn, ...S.btnSecondary, fontSize:13 }} onClick={cerrarModal}>Cerrar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Admin: accesos rápidos */}
      {esAdmin && (
        <div style={card}>
          <div style={secTitle}>Accesos rápidos</div>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            <button
              style={{ ...S.btn, ...S.btnSecondary, fontSize:13 }}
              onClick={() => ejecutarConConfirmacionRondas(() => onNavigate?.('reportes', { tipo:'objetivo', objetivoId }))}
            >
              📊 Reportes
            </button>
            <button style={{ ...S.btn, ...S.btnSecondary, fontSize:13, opacity:0.45, cursor:'not-allowed' }} disabled>
              📋 Protocolos <span style={{ fontSize:10, color:'#475569' }}>(próximamente)</span>
            </button>
            <button style={{ ...S.btn, ...S.btnSecondary, fontSize:13, opacity:0.45, cursor:'not-allowed' }} disabled>
              📁 Documentación <span style={{ fontSize:10, color:'#475569' }}>(próximamente)</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default CentroOperativoObjetivo
