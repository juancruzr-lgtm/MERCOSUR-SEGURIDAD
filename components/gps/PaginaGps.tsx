'use client'

//
// PÁGINA GPS — Mapa Operativo
//
// Vista transversal de todo lo que el sistema ya sabe sobre ubicaciones. No es
// una fuente de verdad: cada dato sigue perteneciendo a su módulo.
//
//   Objetivos       → `objetivos`               CONFIGURACIÓN · sólo lectura acá
//   Ingresos/egresos→ `registros_asistencia`    EVIDENCIA · nunca se edita
//   Supervisiones   → `supervisiones`           EVIDENCIA · nunca se edita
//   Puntos de ronda → `ronda_puntos`            CONFIGURACIÓN · se puede corregir
//   Marcaciones     → `ronda_ejecucion_puntos`  EVIDENCIA · nunca se edita
//
// Las capas de evidencia se arman desde los datos que el dashboard YA tiene
// cargados, con los helpers de lib/gps-asistencia.ts. Los puntos de ronda los
// trae lib/gps-mapa.ts, que es el único que consulta por su cuenta.
//
// Corregir un punto usa `aplicarSugerenciaGps()` → `actualizarPunto()`: la misma
// ruta que el editor de Rondas, con la misma auditoría. No hay ningún UPDATE
// paralelo en esta pantalla.
//

import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Objetivo, RegistroAsistencia, Turno, Usuario } from '@/lib/supabase'
import { formatFechaHora } from '@/lib/formato'
import {
  GPS_PRECISION_MAX_METROS,
  auditoriaSupervisionGps,
  distanciaMetrosCoordenadas,
  estadoGpsTexto,
  gpsRegistroAsistencia,
  metrosGpsTexto,
} from '@/lib/gps-asistencia'
import { actualizarUbicacionObjetivo } from '@/lib/legajo-objetivo'
import {
  aplicarSugerenciaGpsObjetivo,
  cargarHistorialUbicaciones,
  contarPuntosRondaObjetivo,
  diagnosticarGpsObjetivo,
  establecerTipoUbicacion,
  sugerenciaObjetivoAplicable,
  type DiagnosticoGpsObjetivo,
  type UbicacionVigencia,
} from '@/lib/gps-objetivos'
import {
  cargarMarcacionesPunto,
  cargarPuntosRondaGps,
  etiquetaDiagnostico,
  proponeCambio,
  LIMITE_MARCACIONES,
  type MarcacionPunto,
  type PuntoRondaGps,
} from '@/lib/gps-mapa'
import { actualizarPunto, aplicarSugerenciaGps, diagnosticarGpsPunto } from '@/lib/rondas'
import type { MarcacionCGO, MarkerCGO, ObjetivoCGO, PuntoRondaCGO, SupervisionCGO } from './MapaOperativo'
import PanelDetalle, { type SeleccionGps } from './PanelDetalle'
import styles from './Gps.module.css'

const MapaOperativo = dynamic(() => import('./MapaOperativo'), {
  ssr: false,
  loading: () => (
    <div style={{ height: 420, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111827', border: '1px solid #1e2d42', borderRadius: 8, color: '#94a3b8' }}>
      Cargando mapa…
    </div>
  ),
})

// Mismo tope que el Mapa CGO: la protección no se afloja por estrenar pantalla.
const LIMITE_MARCADORES = 150
const MAX_DIAS_RANGO = 30

type FiltroPuntos = 'todos' | 'con_recomendacion' | 'fallas_repetidas' | 'sin_datos'

const CAPAS: { id: string; label: string }[] = [
  { id: 'objetivos', label: 'Objetivos' },
  { id: 'ingresos', label: 'Ingresos' },
  { id: 'egresos', label: 'Egresos' },
  { id: 'supervisiones', label: 'Supervisiones' },
  { id: 'puntos_ronda', label: 'Puntos de ronda' },
]

function hoyISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function haceDiasISO(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() - dias)
  return d.toISOString().slice(0, 10)
}

function iniciales(texto: string): string {
  return texto.replace(',', '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
    .map(p => p[0]).join('').toUpperCase() || '?'
}

export default function PaginaGps({
  objetivos,
  registros,
  turnos,
  guardias,
  supervisiones,
  onObjetivoActualizado,
}: {
  objetivos: Objetivo[]
  registros: RegistroAsistencia[]
  turnos: Turno[]
  guardias: Usuario[]
  supervisiones: any[]
  /** Avisa al dashboard que un objetivo cambió, para refrescar su lista. */
  onObjetivoActualizado?: (objetivo: any) => void
}) {
  // ── Filtros ───────────────────────────────────────────────────────────────
  const [desde, setDesde] = useState(haceDiasISO(7))
  const [hasta, setHasta] = useState(hoyISO())
  const [objetivoId, setObjetivoId] = useState('')
  const [vigiladorId, setVigiladorId] = useState('')
  const [filtroPuntos, setFiltroPuntos] = useState<FiltroPuntos>('todos')

  const [capasActivas, setCapasActivas] = useState<Set<string>>(
    new Set(['objetivos', 'puntos_ronda']),
  )

  // ── Puntos de ronda ───────────────────────────────────────────────────────
  const [puntos, setPuntos] = useState<PuntoRondaGps[]>([])
  const [puntosTruncados, setPuntosTruncados] = useState(false)
  const [cargandoPuntos, setCargandoPuntos] = useState(true)

  // ── Selección y acciones ──────────────────────────────────────────────────
  const [seleccion, setSeleccion] = useState<SeleccionGps | null>(null)
  const [marcaciones, setMarcaciones] = useState<MarcacionPunto[]>([])
  const [cargandoMarcaciones, setCargandoMarcaciones] = useState(false)
  const [analizando, setAnalizando] = useState(false)
  const [aplicando, setAplicando] = useState(false)
  const [guardandoRadio, setGuardandoRadio] = useState(false)
  const [guardandoObjetivo, setGuardandoObjetivo] = useState(false)
  // Posición propuesta al arrastrar el marcador de un objetivo. Todavía no se
  // guardó nada: arrastrar propone, confirmar guarda.
  const [objetivoPropuesto, setObjetivoPropuesto] = useState<{ id: string; lat: number; lng: number } | null>(null)
  const [diagnosticoObjetivo, setDiagnosticoObjetivo] = useState<DiagnosticoGpsObjetivo | null>(null)
  const [analizandoObjetivo, setAnalizandoObjetivo] = useState(false)
  const [aplicandoObjetivo, setAplicandoObjetivo] = useState(false)
  // El marcador sólo se arrastra en modo mover: hay que pedirlo explícitamente.
  const [modoMover, setModoMover] = useState(false)
  const [cambiandoTipo, setCambiandoTipo] = useState(false)
  const [historialUbicaciones, setHistorialUbicaciones] = useState<UbicacionVigencia[]>([])
  const [puntosRondaObjetivo, setPuntosRondaObjetivo] = useState(0)
  const [vigenteDesde, setVigenteDesde] = useState('')
  // Mover un punto de ronda: mismo criterio que el objetivo. Arrastrar propone,
  // confirmar guarda.
  const [modoMoverPunto, setModoMoverPunto] = useState(false)
  const [puntoPropuesto, setPuntoPropuesto] = useState<{ id: string; lat: number; lng: number } | null>(null)
  const [guardandoPunto, setGuardandoPunto] = useState(false)
  // Radio tentativo del punto seleccionado, todavía sin guardar. Sólo se dibuja.
  const [radioPreview, setRadioPreview] = useState<number | null>(null)
  const [mensaje, setMensaje] = useState('')
  const [error, setError] = useState('')

  const nombresObjetivo = useMemo(
    () => new Map(objetivos.map(o => [o.id, o.nombre])),
    [objetivos],
  )

  const cargarPuntos = useCallback(async () => {
    setCargandoPuntos(true)
    const resultado = await cargarPuntosRondaGps(nombresObjetivo, objetivoId || null)
    if (resultado.error) setError(resultado.error)
    setPuntos(resultado.puntos)
    setPuntosTruncados(resultado.truncado)
    setCargandoPuntos(false)
    return resultado.puntos
  }, [nombresObjetivo, objetivoId])

  useEffect(() => { void cargarPuntos() }, [cargarPuntos])

  const rangoExcesivo = useMemo(() => {
    if (!desde || !hasta) return false
    return Math.round((new Date(hasta).getTime() - new Date(desde).getTime()) / 86400000) > MAX_DIAS_RANGO
  }, [desde, hasta])

  // ── Capa de fichajes (evidencia) ──────────────────────────────────────────
  // Mismo criterio de color que el Mapa CGO. El veredicto (dentro/fuera) lo
  // calculó el servidor al fichar: acá sólo se lee `gps_*_estado`.
  const marcadores = useMemo<MarkerCGO[]>(() => {
    if (rangoExcesivo) return []
    const quiereIngresos = capasActivas.has('ingresos')
    const quiereEgresos = capasActivas.has('egresos')
    if (!quiereIngresos && !quiereEgresos) return []

    const resultado: MarkerCGO[] = []

    for (const r of registros) {
      const turno = turnos.find(t => t.id === r.turno_id)
      const objetivoDelTurno = turno?.objetivo_id ?? null
      if (objetivoId && objetivoDelTurno !== objetivoId) continue
      if (vigiladorId && r.guardia_id !== vigiladorId) continue

      // La fecha operativa del fichaje es la del turno. Si un registro no tiene
      // turno ni fecha resoluble, queda fuera de una vista acotada por fechas:
      // mostrarlo siempre haría que el filtro mienta.
      const fechaBase = (turno as any)?.fecha ?? (r as any).created_at?.slice(0, 10) ?? ''
      if (!fechaBase || fechaBase < desde || fechaBase > hasta) continue

      const guardia = guardias.find(g => g.id === r.guardia_id)
      const empleado = guardia ? `${guardia.apellido}, ${guardia.nombre}` : '—'
      const objetivoNombre = (objetivoDelTurno && nombresObjetivo.get(objetivoDelTurno)) || '—'
      const esManual = ['presente_manual', 'ausencia', 'reemplazo'].includes((r as any).tipo_registro)

      const armar = (tipo: 'ingreso' | 'egreso') => {
        const gps = gpsRegistroAsistencia(r, tipo)
        if (!gps) return
        const precision = gps.precision
        const impreciso = precision !== null && precision > GPS_PRECISION_MAX_METROS
        const estadoServidor = tipo === 'ingreso' ? (r as any).gps_ingreso_estado : (r as any).gps_egreso_estado
        const color = esManual ? '#eab308'
          : impreciso ? '#f97316'
          : estadoServidor === 'fuera_radio' ? '#ef4444'
          : estadoServidor === 'dentro_radio' ? '#22c55e'
          : '#94a3b8'

        resultado.push({
          id: `${r.id}-${tipo}`,
          tipo,
          lat: gps.lat,
          lng: gps.lng,
          color,
          label: iniciales(empleado),
          empleado,
          objetivo: objetivoNombre,
          fecha: fechaBase || '—',
          hora: (tipo === 'ingreso' ? (r as any).hora_entrada_real : (r as any).hora_salida_real) || '—',
          distancia: metrosGpsTexto(
            tipo === 'ingreso' ? (r as any).distancia_ingreso_metros : (r as any).distancia_egreso_metros,
          ),
          precision: precision !== null ? `${Math.round(precision)} m` : '—',
          estado: estadoGpsTexto(r, tipo),
          tipoRegistro: (r as any).tipo_registro || '—',
          registroId: `${r.id}-${tipo}`,
          googleMapsUrl: `https://maps.google.com/?q=${gps.lat},${gps.lng}`,
        })
      }

      if (quiereIngresos) armar('ingreso')
      if (quiereEgresos) armar('egreso')
    }

    return resultado
  }, [registros, turnos, guardias, nombresObjetivo, objetivoId, vigiladorId, desde, hasta, capasActivas, rangoExcesivo])

  const marcadoresTruncados = marcadores.length > LIMITE_MARCADORES
  const marcadoresVisibles = useMemo(
    () => (marcadoresTruncados ? marcadores.slice(0, LIMITE_MARCADORES) : marcadores),
    [marcadores, marcadoresTruncados],
  )

  // ── Capa de objetivos (configuración, sólo lectura) ───────────────────────
  const objetivosCapa = useMemo<ObjetivoCGO[]>(() => objetivos
    .filter(o => typeof o.lat === 'number' && typeof o.lng === 'number')
    .filter(o => !objetivoId || o.id === objetivoId)
    .map(o => ({
      id: o.id,
      nombre: o.nombre,
      lat: o.lat as number,
      lng: o.lng as number,
      radio_metros: o.radio_metros,
    })), [objetivos, objetivoId])

  // ── Capa de supervisiones (evidencia) ─────────────────────────────────────
  const supervisionesCapa = useMemo<SupervisionCGO[]>(() => {
    if (!capasActivas.has('supervisiones') || rangoExcesivo) return []
    return (supervisiones ?? []).flatMap((s: any) => {
      const fecha = s.created_at?.slice(0, 10) ?? ''
      if (fecha && (fecha < desde || fecha > hasta)) return []
      if (objetivoId && s.objetivo_id !== objetivoId) return []

      const objetivo = objetivos.find(o => o.id === s.objetivo_id)
      const auditoria = auditoriaSupervisionGps(s, objetivo)
      if (auditoria.lat === null || auditoria.lng === null) return []

      const supervisor = s.supervisor
        ? `${s.supervisor.apellido || ''}, ${s.supervisor.nombre || ''}`.trim().replace(/^,\s*/, '')
        : '—'

      return [{
        id: s.id,
        lat: auditoria.lat,
        lng: auditoria.lng,
        supervisor,
        objetivo: s.objetivo?.nombre || objetivo?.nombre || '—',
        fecha: formatFechaHora(s.created_at),
        estado: s.estado || '—',
        distancia: metrosGpsTexto(auditoria.distancia_objetivo_metros),
        precision: auditoria.precision !== null ? `${Math.round(auditoria.precision)} m` : '—',
        dentroRadio: auditoria.dentro_radio,
        gpsImpreciso: auditoria.gpsImpreciso,
        googleMapsUrl: `https://maps.google.com/?q=${auditoria.lat},${auditoria.lng}`,
      }]
    })
  }, [supervisiones, objetivos, objetivoId, desde, hasta, capasActivas, rangoExcesivo])

  // ── Capa de puntos de ronda (configuración) ───────────────────────────────
  const puntosFiltrados = useMemo(() => puntos.filter(p => {
    switch (filtroPuntos) {
      case 'con_recomendacion': return proponeCambio(p.diagnosticoEstado)
      case 'fallas_repetidas':  return p.incumplimientosConsecutivos > 0
      case 'sin_datos':         return p.diagnosticoEstado === 'sin_datos' || p.diagnosticoEstado === null
      default:                  return true
    }
  }), [puntos, filtroPuntos])

  const puntosCapa = useMemo<PuntoRondaCGO[]>(() => puntosFiltrados.map(p => ({
    id: p.id,
    nombre: p.nombre,
    lat: p.latitud,
    lng: p.longitud,
    radioMetros: p.radioMetros,
    objetivo: p.objetivoNombre,
    ronda: p.rondaNombre,
    puesto: p.puestoNombre,
    gpsRequerido: p.gpsRequerido,
    diagnostico: etiquetaDiagnostico(p.diagnosticoEstado),
    conRecomendacion: proponeCambio(p.diagnosticoEstado),
    incumplimientosConsecutivos: p.incumplimientosConsecutivos,
  })), [puntosFiltrados])

  // Metros entre la ubicación guardada y la propuesta a mano. Se calcula con el
  // mismo Haversine que usa el resto del sistema.
  const metrosPropuestos = useMemo(() => {
    if (!objetivoPropuesto) return null
    const objetivo = objetivos.find(o => o.id === objetivoPropuesto.id)
    if (!objetivo || typeof objetivo.lat !== 'number' || typeof objetivo.lng !== 'number') return null
    return Math.round(distanciaMetrosCoordenadas(
      objetivo.lat, objetivo.lng, objetivoPropuesto.lat, objetivoPropuesto.lng,
    ))
  }, [objetivoPropuesto, objetivos])

  const marcacionesCapa = useMemo<MarcacionCGO[]>(() => marcaciones.map(m => ({
    id: m.id,
    lat: m.latitud,
    lng: m.longitud,
    fecha: m.registradoAt ? formatFechaHora(m.registradoAt) : '—',
    dentroRadio: m.dentroRadio,
    distancia: metrosGpsTexto(m.distanciaMetros),
    precision: m.precisionMetros !== null ? `${Math.round(m.precisionMetros)} m` : '—',
  })), [marcaciones])

  // ── Acciones ──────────────────────────────────────────────────────────────

  const limpiarAvisos = () => { setMensaje(''); setError('') }

  const seleccionarPunto = (puntoId: string) => {
    limpiarAvisos()
    setMarcaciones([])
    setRadioPreview(null)
    if (puntoPropuesto && puntoPropuesto.id !== puntoId) setPuntoPropuesto(null)
    setModoMoverPunto(false)
    const punto = puntos.find(p => p.id === puntoId)
    if (punto) setSeleccion({ tipo: 'punto', datos: punto })
  }

  // Metros entre la posición guardada del punto y la propuesta a mano.
  const metrosPuntoPropuesto = useMemo(() => {
    if (!puntoPropuesto) return null
    const punto = puntos.find(p => p.id === puntoPropuesto.id)
    if (!punto) return null
    return Math.round(distanciaMetrosCoordenadas(
      punto.latitud, punto.longitud, puntoPropuesto.lat, puntoPropuesto.lng,
    ))
  }, [puntoPropuesto, puntos])

  // Estable: el panel la deja fuera de las dependencias de su efecto.
  const previsualizarRadio = useCallback((metros: number | null) => {
    setRadioPreview(metros)
  }, [])

  const analizar = async (punto: PuntoRondaGps) => {
    limpiarAvisos()
    setAnalizando(true)
    const { error: errorRpc } = await diagnosticarGpsPunto(punto.id)
    if (errorRpc) {
      setError(errorRpc)
      setAnalizando(false)
      return
    }
    // Se relee desde la base, no se parchea el punto en memoria.
    const frescos = await cargarPuntos()
    const actualizado = frescos.find(p => p.id === punto.id)
    if (actualizado) setSeleccion({ tipo: 'punto', datos: actualizado })
    setAnalizando(false)
    setMensaje('Análisis actualizado.')
  }

  const aplicar = async (punto: PuntoRondaGps) => {
    limpiarAvisos()

    const detalle = [
      punto.latitudSugerida !== null ? 'la ubicación' : null,
      punto.radioSugerido !== null ? `el radio a ${punto.radioSugerido} m` : null,
    ].filter(Boolean).join(' y ')

    const confirmado = window.confirm(
      `Se va a corregir ${detalle} del punto "${punto.nombre}".\n\n` +
      'El cambio queda registrado en la auditoría del punto y se ve enseguida en Rondas.\n\n¿Confirmás?',
    )
    if (!confirmado) return

    setAplicando(true)

    // Se pide el diagnóstico a la fuente autoritativa en vez de reconstruirlo
    // acá: la firma que va a quedar en la auditoría tiene que ser la que el
    // servidor calculó, no una armada por el navegador. Si el análisis dejó de
    // recomendar el cambio, no se aplica nada.
    const { data: diagnostico, error: errorDiagnostico } = await diagnosticarGpsPunto(punto.id)
    if (errorDiagnostico || !diagnostico) {
      setError(errorDiagnostico || 'No se pudo obtener el diagnóstico del punto.')
      setAplicando(false)
      return
    }

    if (!proponeCambio(diagnostico.recomendacion)) {
      await cargarPuntos()
      setAplicando(false)
      setMensaje('El análisis ya no propone cambios para este punto. No se modificó nada.')
      return
    }

    const { error: errorAplicar } = await aplicarSugerenciaGps(diagnostico)

    if (errorAplicar) {
      setError(errorAplicar)
      setAplicando(false)
      return
    }

    const frescos = await cargarPuntos()
    const actualizado = frescos.find(p => p.id === punto.id)
    setSeleccion(actualizado ? { tipo: 'punto', datos: actualizado } : null)
    setMarcaciones([])
    setAplicando(false)
    setMensaje('Corrección aplicada y auditada.')
  }

  /**
   * Ajuste manual del radio.
   *
   * Va por `actualizarPunto()`, la misma ruta que el editor de Rondas. Sin
   * contexto de diagnóstico, así que la auditoría lo registra como cambio
   * manual, que es exactamente lo que es.
   */
  const guardarRadio = async (punto: PuntoRondaGps, metros: number) => {
    limpiarAvisos()

    if (!Number.isFinite(metros) || metros <= 0) {
      setError('El radio tiene que ser un número mayor que cero.')
      return
    }

    const anterior = punto.radioMetros !== null ? `${punto.radioMetros} m` : 'sin radio'
    const confirmado = window.confirm(
      `Se va a cambiar el radio del punto "${punto.nombre}" de ${anterior} a ${metros} m.\n\n` +
      'Es el radio con el que se juzga si el vigilador marcó dentro o fuera. ' +
      'El cambio queda registrado en la auditoría como modificación manual.\n\n¿Confirmás?',
    )
    if (!confirmado) return

    setGuardandoRadio(true)
    const { error: errorGuardar } = await actualizarPunto(punto.id, { radio_metros: metros })
    if (errorGuardar) {
      setError(errorGuardar)
      setGuardandoRadio(false)
      return
    }

    // Se relee de la base en vez de parchear el marcador.
    const frescos = await cargarPuntos()
    const actualizado = frescos.find(p => p.id === punto.id)
    if (actualizado) setSeleccion({ tipo: 'punto', datos: actualizado })
    setRadioPreview(null)
    setGuardandoRadio(false)
    setMensaje(`Radio actualizado a ${metros} m y auditado.`)
  }

  /**
   * Confirma la ubicación propuesta para un objetivo.
   *
   * Escribe por `actualizarUbicacionObjetivo()`, que ya existía y es la que usa
   * el legajo: no se agrega un quinto camino de escritura. Sin contexto de
   * diagnóstico, así que la auditoría lo registra como cambio manual.
   */
  const confirmarUbicacionObjetivo = async () => {
    if (!objetivoPropuesto) return
    limpiarAvisos()

    const objetivo = objetivos.find(o => o.id === objetivoPropuesto.id)
    if (!objetivo) return

    const radio = typeof objetivo.radio_metros === 'number' ? objetivo.radio_metros : 200
    const movido = Math.round(distanciaMetrosCoordenadas(
      objetivo.lat as number, objetivo.lng as number,
      objetivoPropuesto.lat, objetivoPropuesto.lng,
    ))

    const confirmado = window.confirm(
      `Se va a mover "${objetivo.nombre}" ${movido} m.\n\n` +
      `Nueva ubicación: ${objetivoPropuesto.lat.toFixed(6)}, ${objetivoPropuesto.lng.toFixed(6)}\n` +
      `Radio: ${radio} m (no cambia)\n\n` +
      'Es la zona donde el personal puede fichar: moverla cambia qué fichajes ' +
      'quedan dentro y cuáles fuera de radio, de acá en adelante. El cambio ' +
      'queda registrado en la auditoría del objetivo.\n\n¿Confirmás?',
    )
    if (!confirmado) return

    setGuardandoObjetivo(true)
    const { objetivo: actualizado, error: errorGuardar } = await actualizarUbicacionObjetivo(
      objetivo.id, objetivoPropuesto.lat, objetivoPropuesto.lng, radio,
      undefined,
      // Sólo un móvil puede declarar desde cuándo rige; el servidor lo ignora
      // en un objetivo fijo.
      vigenteDesde ? new Date(vigenteDesde).toISOString() : null,
    )
    setGuardandoObjetivo(false)

    if (errorGuardar) { setError(errorGuardar); return }

    setObjetivoPropuesto(null)
    setModoMover(false)
    setVigenteDesde('')
    const { historial } = await cargarHistorialUbicaciones(objetivo.id)
    setHistorialUbicaciones(historial)
    if (actualizado) {
      // El dueño de la lista de objetivos es el dashboard: se le avisa para que
      // el resto de las pantallas vea el valor nuevo sin recargar.
      onObjetivoActualizado?.(actualizado)
      setSeleccion({ tipo: 'objetivo', datos: actualizado })
    }
    setMensaje(`Objetivo movido ${movido} m y auditado.`)
  }

  const objetivoSeleccionadoId = seleccion?.tipo === 'objetivo' ? seleccion.datos.id : null

  // Al seleccionar un objetivo se trae su historial y cuántos puntos de ronda
  // cuelgan de él, que es lo que hace falta para advertir antes de moverlo.
  useEffect(() => {
    let vigente = true
    setHistorialUbicaciones([])
    setPuntosRondaObjetivo(0)
    setModoMover(false)
    setVigenteDesde('')
    if (!objetivoSeleccionadoId) return

    ;(async () => {
      const [{ historial }, cantidad] = await Promise.all([
        cargarHistorialUbicaciones(objetivoSeleccionadoId),
        contarPuntosRondaObjetivo(objetivoSeleccionadoId),
      ])
      if (!vigente) return
      setHistorialUbicaciones(historial)
      setPuntosRondaObjetivo(cantidad)
    })()

    return () => { vigente = false }
  }, [objetivoSeleccionadoId])

  const cambiarTipoUbicacion = async (tipo: 'fijo' | 'movil') => {
    if (!objetivoSeleccionadoId) return
    limpiarAvisos()
    setCambiandoTipo(true)
    const { error: errorTipo } = await establecerTipoUbicacion(objetivoSeleccionadoId, tipo)
    setCambiandoTipo(false)
    if (errorTipo) { setError(errorTipo); return }

    const actualizado = { ...seleccion?.datos, tipo_ubicacion: tipo }
    onObjetivoActualizado?.(actualizado)
    setSeleccion({ tipo: 'objetivo', datos: actualizado })
    // El diagnóstico depende del tipo: el anterior ya no vale.
    setDiagnosticoObjetivo(null)
    setMensaje(tipo === 'movil'
      ? 'Marcado como móvil. El diagnóstico va a mirar sólo los fichajes de la ubicación vigente.'
      : 'Marcado como fijo. El diagnóstico vuelve a mirar la ventana completa.')
  }

  /** Muestra en el mapa los puntos de ronda de este objetivo. */
  const verPuntosDelObjetivo = () => {
    if (!objetivoSeleccionadoId) return
    setObjetivoId(objetivoSeleccionadoId)
    setCapasActivas(previas => new Set(Array.from(previas).concat('puntos_ronda')))
    setMensaje('Filtrado por este objetivo, con la capa de puntos de ronda encendida.')
  }

  /** Pide el diagnóstico del objetivo al servidor. No modifica nada. */
  const analizarObjetivo = async (objetivoId: string) => {
    limpiarAvisos()
    setAnalizandoObjetivo(true)
    const { data, error: errorRpc } = await diagnosticarGpsObjetivo(objetivoId)
    setAnalizandoObjetivo(false)
    if (errorRpc || !data) { setError(errorRpc || 'No se pudo analizar el objetivo.'); return }
    setDiagnosticoObjetivo(data)
  }

  /**
   * Aplica la sugerencia. Vuelve a pedir el diagnóstico para que la firma que
   * queda en la auditoría sea la que calculó el servidor, no una de pantalla.
   */
  const aplicarObjetivo = async () => {
    if (!diagnosticoObjetivo) return
    limpiarAvisos()

    const objetivo = objetivos.find(o => o.id === diagnosticoObjetivo.objetivo_id)
    if (!objetivo) return

    setAplicandoObjetivo(true)
    const { data: fresco, error: errorDiag } = await diagnosticarGpsObjetivo(objetivo.id)
    if (errorDiag || !fresco) {
      setError(errorDiag || 'No se pudo obtener el diagnóstico.')
      setAplicandoObjetivo(false)
      return
    }

    if (!sugerenciaObjetivoAplicable(fresco)) {
      setDiagnosticoObjetivo(fresco)
      setAplicandoObjetivo(false)
      setMensaje('El análisis ya no propone un cambio aplicable. No se modificó nada.')
      return
    }

    const movido = fresco.desplazamiento_metros !== null ? Math.round(fresco.desplazamiento_metros) : null
    const confirmado = window.confirm(
      `Se va a aplicar la sugerencia al objetivo "${objetivo.nombre}".\n\n` +
      `Ubicación: ${objetivo.lat}, ${objetivo.lng}\n` +
      `        →  ${fresco.latitud_sugerida}, ${fresco.longitud_sugerida}\n` +
      (movido !== null ? `Desplazamiento: ${movido} m\n` : '') +
      `Radio: ${fresco.radio_actual ?? '—'} m → ${fresco.radio_sugerido} m\n\n` +
      `Evidencia: ${fresco.marcaciones} marcaciones de ${fresco.guardias_distintos} guardias ` +
      `en ${fresco.dias_distintos} días.\n\n` +
      'Cambia dónde puede fichar el personal. Queda auditado como diagnostico_gps.\n\n¿Confirmás?',
    )
    if (!confirmado) { setAplicandoObjetivo(false); return }

    const { objetivo: actualizado, error: errorAplicar } = await aplicarSugerenciaGpsObjetivo(fresco)
    setAplicandoObjetivo(false)
    if (errorAplicar) { setError(errorAplicar); return }

    if (actualizado) {
      onObjetivoActualizado?.(actualizado)
      setSeleccion({ tipo: 'objetivo', datos: actualizado })
    }
    setDiagnosticoObjetivo(null)
    setMensaje('Sugerencia aplicada y auditada como diagnostico_gps.')
  }

  /**
   * Confirma la nueva ubicación de un punto de ronda.
   *
   * Escribe por `actualizarPunto()`, la misma ruta que el editor de Rondas, sin
   * contexto de diagnóstico: la auditoría lo registra como cambio manual.
   * `origen_posicion: 'manual'` porque la posición la puso una persona sobre el
   * mapa, no una captura GPS — y con eso el servidor limpia la precisión, que
   * dejó de tener sentido.
   */
  const confirmarUbicacionPunto = async () => {
    if (!puntoPropuesto) return
    limpiarAvisos()

    const punto = puntos.find(p => p.id === puntoPropuesto.id)
    if (!punto) return

    const movido = Math.round(distanciaMetrosCoordenadas(
      punto.latitud, punto.longitud, puntoPropuesto.lat, puntoPropuesto.lng,
    ))

    const confirmado = window.confirm(
      `Se va a mover el punto "${punto.nombre}" ${movido} m.\n\n` +
      `Antes:    ${punto.latitud.toFixed(6)}, ${punto.longitud.toFixed(6)}\n` +
      `Después:  ${puntoPropuesto.lat.toFixed(6)}, ${puntoPropuesto.lng.toFixed(6)}\n` +
      `Radio: ${punto.radioMetros ?? '—'} m (no cambia)\n\n` +
      'Es el lugar donde el vigilador tiene que marcar. El cambio queda ' +
      'registrado en la auditoría del punto como modificación manual.\n\n¿Confirmás?',
    )
    if (!confirmado) return

    setGuardandoPunto(true)
    const { error: errorGuardar } = await actualizarPunto(punto.id, {
      latitud: puntoPropuesto.lat,
      longitud: puntoPropuesto.lng,
      origen_posicion: 'manual',
    })
    setGuardandoPunto(false)

    if (errorGuardar) { setError(errorGuardar); return }

    setPuntoPropuesto(null)
    setModoMoverPunto(false)
    const frescos = await cargarPuntos()
    const actualizado = frescos.find(p => p.id === punto.id)
    if (actualizado) setSeleccion({ tipo: 'punto', datos: actualizado })
    setMensaje(`Punto movido ${movido} m y auditado.`)
  }

  const verMarcaciones = async (punto: PuntoRondaGps) => {
    limpiarAvisos()
    setCargandoMarcaciones(true)
    const { marcaciones: filas, error: errorMarcaciones } = await cargarMarcacionesPunto(punto.id)
    if (errorMarcaciones) setError(errorMarcaciones)
    setMarcaciones(filas)
    setCargandoMarcaciones(false)
    if (filas.length === 0 && !errorMarcaciones) {
      setMensaje('Este punto todavía no tiene marcaciones registradas con GPS.')
    }
  }

  const alternarCapa = (capa: string) => {
    setCapasActivas(previas => {
      const siguiente = new Set(previas)
      if (siguiente.has(capa)) siguiente.delete(capa)
      else siguiente.add(capa)
      return siguiente
    })
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <span className={styles.title}>Página GPS</span>
        <span className={styles.subtitle}>Mapa Operativo · todas las ubicaciones del sistema en un solo lugar</span>
      </div>

      {/* ── Filtros ────────────────────────────────────────────────────── */}
      <div className={styles.card}>
        <div className={styles.filtros}>
          <div className={styles.campo}>
            <label className={styles.label} htmlFor="gps-desde">Desde</label>
            <input id="gps-desde" className={styles.input} type="date" value={desde} onChange={e => setDesde(e.target.value)} />
          </div>
          <div className={styles.campo}>
            <label className={styles.label} htmlFor="gps-hasta">Hasta</label>
            <input id="gps-hasta" className={styles.input} type="date" value={hasta} onChange={e => setHasta(e.target.value)} />
          </div>
          <div className={styles.campo}>
            <label className={styles.label} htmlFor="gps-objetivo">Objetivo</label>
            <select id="gps-objetivo" className={styles.input} value={objetivoId} onChange={e => setObjetivoId(e.target.value)}>
              <option value="">Todos</option>
              {objetivos.map(o => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          </div>
          <div className={styles.campo}>
            <label className={styles.label} htmlFor="gps-vigilador">Vigilador</label>
            <select id="gps-vigilador" className={styles.input} value={vigiladorId} onChange={e => setVigiladorId(e.target.value)}>
              <option value="">Todos</option>
              {guardias.map(g => <option key={g.id} value={g.id}>{g.apellido}, {g.nombre}</option>)}
            </select>
          </div>
          <div className={styles.campo}>
            <label className={styles.label} htmlFor="gps-filtro-puntos">Puntos de ronda</label>
            <select id="gps-filtro-puntos" className={styles.input} value={filtroPuntos} onChange={e => setFiltroPuntos(e.target.value as FiltroPuntos)}>
              <option value="todos">Todos</option>
              <option value="con_recomendacion">Con recomendación</option>
              <option value="fallas_repetidas">Fallas repetidas</option>
              <option value="sin_datos">Sin datos suficientes</option>
            </select>
          </div>
        </div>

        <div style={{ marginTop: 14 }} className={styles.capas}>
          {CAPAS.map(capa => (
            <button
              key={capa.id}
              type="button"
              className={`${styles.capa} ${capasActivas.has(capa.id) ? styles.capaActiva : ''}`}
              onClick={() => alternarCapa(capa.id)}
            >
              {capa.label}
            </button>
          ))}
        </div>
      </div>

      {rangoExcesivo && (
        <div className={styles.aviso}>
          El rango supera {MAX_DIAS_RANGO} días: las capas de fichajes y supervisiones
          quedan ocultas para no saturar el mapa. Acortá el período.
        </div>
      )}
      {marcadoresTruncados && !rangoExcesivo && (
        <div className={styles.aviso}>
          Se muestran los primeros {LIMITE_MARCADORES} fichajes de {marcadores.length}.
          Afiná el filtro por objetivo, vigilador o fechas para verlos todos.
        </div>
      )}
      {puntosTruncados && (
        <div className={styles.aviso}>
          Hay más de {puntos.length} puntos de ronda con posición: se muestran los primeros.
          Filtrá por objetivo para verlos completos.
        </div>
      )}
      {marcaciones.length >= LIMITE_MARCACIONES && (
        <div className={styles.aviso}>
          Se muestran las últimas {LIMITE_MARCACIONES} marcaciones del punto.
        </div>
      )}

      <div className={styles.workspace}>
        <div>
          <MapaOperativo
            markers={marcadoresVisibles}
            objetivos={objetivosCapa}
            supervisiones={supervisionesCapa}
            capasActivas={capasActivas}
            registroSeleccionado={null}
            onMarkerClick={(id: string) => {
              limpiarAvisos()
              const marcador = marcadoresVisibles.find(m => m.registroId === id)
              if (marcador) setSeleccion({ tipo: 'fichaje', datos: marcador })
            }}
            puntosRonda={puntosCapa}
            marcaciones={marcacionesCapa}
            puntoSeleccionadoId={seleccion?.tipo === 'punto' ? seleccion.datos.id : null}
            radioPreviewMetros={radioPreview}
            puntoArrastrableId={
              modoMoverPunto && seleccion?.tipo === 'punto' ? seleccion.datos.id : null
            }
            puntoPropuesto={puntoPropuesto}
            onPuntoArrastrado={(id, lat, lng) => {
              limpiarAvisos()
              setPuntoPropuesto({ id, lat, lng })
            }}
            onPuntoClick={seleccionarPunto}
            onObjetivoClick={(id: string) => {
              limpiarAvisos()
              if (objetivoPropuesto && objetivoPropuesto.id !== id) setObjetivoPropuesto(null)
              if (diagnosticoObjetivo && diagnosticoObjetivo.objetivo_id !== id) setDiagnosticoObjetivo(null)
              const objetivo = objetivos.find(o => o.id === id)
              if (objetivo) setSeleccion({ tipo: 'objetivo', datos: objetivo })
            }}
            objetivoSugerido={
              diagnosticoObjetivo
                && diagnosticoObjetivo.latitud_sugerida !== null
                && diagnosticoObjetivo.longitud_sugerida !== null
                && diagnosticoObjetivo.radio_sugerido !== null
                ? {
                    id: diagnosticoObjetivo.objetivo_id,
                    lat: diagnosticoObjetivo.latitud_sugerida,
                    lng: diagnosticoObjetivo.longitud_sugerida,
                    radioMetros: diagnosticoObjetivo.radio_sugerido,
                  }
                : null
            }
            objetivoArrastrableId={modoMover ? objetivoSeleccionadoId : null}
            objetivoPropuesto={objetivoPropuesto}
            onObjetivoArrastrado={(id, lat, lng) => {
              limpiarAvisos()
              setObjetivoPropuesto({ id, lat, lng })
            }}
            onSupervisionClick={(id: string) => {
              limpiarAvisos()
              const supervision = supervisionesCapa.find(s => s.id === id)
              if (supervision) setSeleccion({ tipo: 'supervision', datos: supervision })
            }}
            altura="min(66vh, 620px)"
            selectorFondo
          />

          <div className={styles.leyenda}>
            <span><span className={styles.punto} style={{ background: '#22c55e' }} />Fichaje dentro del radio</span>
            <span><span className={styles.punto} style={{ background: '#ef4444' }} />Fuera de radio</span>
            <span><span className={styles.punto} style={{ background: '#f97316' }} />GPS impreciso</span>
            <span><span className={styles.punto} style={{ background: '#eab308' }} />Registro manual</span>
            <span><span className={styles.punto} style={{ background: '#2563eb', borderRadius: 2 }} />Objetivo</span>
            <span><span className={styles.punto} style={{ background: '#a855f7' }} />Punto de ronda</span>
            <span><span className={styles.punto} style={{ background: '#f59e0b' }} />Punto con recomendación</span>
            <span><span className={styles.punto} style={{ background: '#38bdf8' }} />Supervisión</span>
          </div>

          <div className={styles.soloLectura}>
            {cargandoPuntos
              ? 'Cargando puntos de ronda…'
              : `${puntosFiltrados.length} puntos de ronda · ${marcadoresVisibles.length} fichajes · ${supervisionesCapa.length} supervisiones en pantalla.`}
          </div>
        </div>

        <PanelDetalle
          seleccion={seleccion}
          marcacionesVisibles={marcaciones.length > 0}
          cargandoMarcaciones={cargandoMarcaciones}
          analizando={analizando}
          aplicando={aplicando}
          guardandoRadio={guardandoRadio}
          mensaje={mensaje}
          error={error}
          onAnalizar={analizar}
          onAplicar={aplicar}
          onVerMarcaciones={verMarcaciones}
          onOcultarMarcaciones={() => setMarcaciones([])}
          onRadioPreview={previsualizarRadio}
          onGuardarRadio={guardarRadio}
          objetivoPropuesto={objetivoPropuesto}
          guardandoObjetivo={guardandoObjetivo}
          onConfirmarObjetivo={confirmarUbicacionObjetivo}
          onDescartarObjetivo={() => { setObjetivoPropuesto(null); limpiarAvisos() }}
          diagnosticoObjetivo={diagnosticoObjetivo}
          analizandoObjetivo={analizandoObjetivo}
          aplicandoObjetivo={aplicandoObjetivo}
          metrosPropuestos={metrosPropuestos}
          onAnalizarObjetivo={analizarObjetivo}
          onAplicarObjetivo={aplicarObjetivo}
          puntoCtl={{
            modoMover: modoMoverPunto,
            propuesto: puntoPropuesto,
            metrosPropuestos: metrosPuntoPropuesto,
            guardando: guardandoPunto,
            onIniciarMover: () => { limpiarAvisos(); setModoMoverPunto(true) },
            onCancelarMover: () => { setModoMoverPunto(false); setPuntoPropuesto(null) },
            onConfirmar: confirmarUbicacionPunto,
          }}
          objetivoCtl={{
            modoMover,
            tipoUbicacion: (seleccion?.tipo === 'objetivo' && seleccion.datos.tipo_ubicacion === 'movil')
              ? 'movil' : 'fijo',
            cambiandoTipo,
            historial: historialUbicaciones,
            puntosRonda: puntosRondaObjetivo,
            vigenteDesde,
            onIniciarMover: () => { limpiarAvisos(); setModoMover(true) },
            onCancelarMover: () => { setModoMover(false); setObjetivoPropuesto(null) },
            onCambiarTipo: cambiarTipoUbicacion,
            onVigenteDesdeChange: setVigenteDesde,
            onVerPuntosRonda: verPuntosDelObjetivo,
          }}
          onCerrar={() => {
            setSeleccion(null); setMarcaciones([]); setRadioPreview(null)
            setObjetivoPropuesto(null); setDiagnosticoObjetivo(null)
            setModoMover(false); setVigenteDesde('')
            setModoMoverPunto(false); setPuntoPropuesto(null); limpiarAvisos()
          }}
        />
      </div>
    </div>
  )
}
