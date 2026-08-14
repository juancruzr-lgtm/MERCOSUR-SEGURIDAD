import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, getSupabaseAdmin } from '../../../_lib/employee-auth'
import { puedeVerLegajo } from '@/lib/legajo'
import { effectiveGuardia, selectRegistroPrincipal, resolverLineaLiquidacion } from '@/lib/liquidacion'
import { caracteristicaTurno } from '@/lib/caracteristica-turno'
import type { CaracteristicaTurno } from '@/lib/caracteristica-turno'
import type { EstadoPrimerControl } from '@/lib/primer-control'

export const runtime = 'nodejs'
// Respuesta por sesión y por estado del primer control: jamás cachear.
// Sin esto, Vercel sirve una copia estática y Mi Planilla no refleja
// aceptaciones/solicitudes recién creadas hasta un redeploy.
export const dynamic = 'force-dynamic'

const RE_MES = /^\d{4}-\d{2}$/

// ── Helpers de período ────────────────────────────────────────────────────────

function mesActualArg(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 7)
}

function mesAnteriorArg(mesActual: string): string {
  const [y, m] = mesActual.split('-').map(Number)
  const d = new Date(y, m - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function rangoMes(mes: string): { desde: string; hasta: string } {
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(y, m, 0).getDate()
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, '0')}` }
}

// ── Día de la semana en español ───────────────────────────────────────────────

const DIAS_ES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

function diaSemana(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return DIAS_ES[new Date(y, m - 1, d).getDay()]
}

// Fin del turno como instante (Argentina UTC-3); nocturnos terminan al día siguiente.
function turnoFinalizado(fecha: string, horaInicio: string, horaFin: string): boolean {
  const [y, m, d] = fecha.slice(0, 10).split('-').map(Number)
  const [hI, mI] = horaInicio.split(':').map(Number)
  const [hF, mF] = horaFin.split(':').map(Number)
  if (![y, m, d, hI, mI, hF, mF].every(Number.isFinite)) return false
  const diaExtra = (hF < hI || (hF === hI && mF <= mI)) ? 1 : 0
  const finMs = Date.UTC(y, m - 1, d + diaExtra, hF + 3, mF)
  return finMs < Date.now()
}

// ── Tipos de respuesta ────────────────────────────────────────────────────────

export interface FilaPlanilla {
  fecha: string
  dia_semana: string
  hora_entrada: string | null
  hora_salida: string | null
  horas: number
  objetivo_id: string | null
  objetivo_nombre: string | null
  origen_etiqueta: string
  estado: 'trabajado' | 'en_curso' | 'programado' | 'sin_programacion'
  caracteristica: CaracteristicaTurno | null
  turno_id: string | null
  puesto_nombre: string | null
  salida_automatica: boolean
  // Primer control del vigilador — null cuando la fila no es revisable
  estado_control: EstadoPrimerControl | null
  // false en turnos pasados sin fichaje: solo pueden solicitar modificación
  permite_aceptar: boolean
  // Resumen post-egreso (continuidad): horario tal como fue programado en el
  // turno, distinto de hora_entrada/hora_salida (que son lo efectivamente
  // registrado) — y el estado GPS de cada marca, para el resumen que el
  // vigilador ve al aceptar o solicitar modificación.
  hora_inicio_programada: string | null
  hora_fin_programada: string | null
  gps_ingreso_estado: string | null
  gps_egreso_estado: string | null
}

export interface RespuestaPlanilla {
  filas: FilaPlanilla[]
  total_horas: number
  mes: string
  desde: string
  hasta: string
  // true si quien consulta es el titular del legajo (habilita los botones)
  es_titular: boolean
  // Todo lo que espera respuesta del vigilador: aceptar O solicitar un cambio.
  pendientes_revision: number
  // El subconjunto que realmente se puede ACEPTAR. Un turno pasado sin fichaje
  // cuenta en el primero y no en el segundo: no hay asistencia que aceptar, y
  // aceptar_turno_planilla lo rechaza. Sin este número el cartel del legajo
  // prometía una acción que en la pantalla no existía.
  pendientes_aceptacion: number
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const token = getBearerToken(req)
  if (!token) return NextResponse.json({ error: 'Sesión requerida' }, { status: 401 })

  const { data: authData, error: authError } = await admin.client.auth.getUser(token)
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })
  }

  const { data: solicitante } = await admin.client
    .from('usuarios').select('id, rol').eq('auth_user_id', authData.user.id).single()
  if (!solicitante) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 403 })

  const empleadoId = params.id
  if (!puedeVerLegajo({ id: solicitante.id, rol: solicitante.rol }, empleadoId)) {
    return NextResponse.json({ error: 'Sin acceso a este legajo' }, { status: 403 })
  }

  // ── Parámetros ────────────────────────────────────────────────────────────
  const mesParam = req.nextUrl.searchParams.get('mes')
  const mesActual = mesActualArg()
  const mesAnterior = mesAnteriorArg(mesActual)

  let mes: string
  if (!mesParam) {
    mes = mesActual
  } else {
    if (!RE_MES.test(mesParam)) {
      return NextResponse.json({ error: 'Parámetro mes inválido (esperado YYYY-MM)' }, { status: 400 })
    }
    if (mesParam !== mesActual && mesParam !== mesAnterior) {
      return NextResponse.json({ error: 'Solo se permite consultar el mes en curso o el mes anterior' }, { status: 400 })
    }
    mes = mesParam
  }

  const { desde, hasta } = rangoMes(mes)

  // ── Consulta principal ────────────────────────────────────────────────────
  // Registros donde el guardia efectivo es el empleado, para turnos del período.
  // El OR trae ambos lados del coalesce; se filtra en memoria.
  const { data: registros, error: errReg } = await admin.client
    .from('registros_asistencia')
    .select(`
      id, turno_id, guardia_id, guardia_final_id,
      hora_entrada_real, hora_salida_real, horas_trabajadas,
      hora_entrada_final, hora_salida_final,
      objetivo_final_id, tipo_registro,
      horas_liquidables, origen_cobertura, cobertura_anulada_at, cierre_automatico,
      gps_ingreso_estado, gps_egreso_estado,
      turno:turnos!inner(
        id, fecha, hora_inicio, hora_fin, objetivo_id, tipo_evento, puesto_id,
        objetivo:objetivos(nombre, es_prueba),
        puesto:puestos(nombre)
      )
    `)
    .or(`guardia_id.eq.${empleadoId},guardia_final_id.eq.${empleadoId}`)
    .gte('turno.fecha', desde)
    .lte('turno.fecha', hasta)

  if (errReg) return NextResponse.json({ error: 'Error al consultar planilla' }, { status: 500 })

  // ── Filtro en memoria ─────────────────────────────────────────────────────
  // Incluye cualquier cobertura oficial válida:
  //   - guardia efectivo coincide con el empleado
  //   - no es ausencia
  //   - no es objetivo de prueba
  //   - tiene horas_liquidables > 0 O tiene hora de entrada efectiva
  //     (incluye coberturas manuales y saneamiento sin GPS)
  const conCobertura = (registros ?? []).filter((r: any) => {
    if (effectiveGuardia(r) !== empleadoId) return false
    if (r.tipo_registro === 'ausencia') return false
    const t = r.turno
    if (!t) return false
    if ((t.objetivo as any)?.es_prueba) return false
    const linea = resolverLineaLiquidacion(t, r)
    return linea.horasTrabajadasOficiales > 0 || linea.horaEntrada != null
  })

  // ── Resolver nombres para objetivo_final_id distintos al del turno ────────
  const objetivoFinalIds = [...new Set(
    conCobertura
      .filter((r: any) => r.objetivo_final_id)
      .map((r: any) => r.objetivo_final_id as string),
  )]

  const objetivoFinalMap = new Map<string, string>()
  if (objetivoFinalIds.length > 0) {
    const { data: objFinales } = await admin.client
      .from('objetivos')
      .select('id, nombre')
      .in('id', objetivoFinalIds)
    for (const o of (objFinales ?? [])) {
      objetivoFinalMap.set(o.id, o.nombre)
    }
  }

  // ── Deduplicar: un registro por turno (máximo score) ─────────────────────
  const porTurnoAgrupar = new Map<string, any[]>()
  for (const r of conCobertura) {
    const arr = porTurnoAgrupar.get(r.turno_id) ?? []
    arr.push(r)
    porTurnoAgrupar.set(r.turno_id, arr)
  }
  const seleccionados = [...porTurnoAgrupar.values()]
    .map(regs => selectRegistroPrincipal(regs, empleadoId))
    .filter(Boolean) as any[]

  // ── Construir filas ───────────────────────────────────────────────────────
  const filas: FilaPlanilla[] = []

  for (const r of seleccionados) {
    const t = r.turno
    const linea = resolverLineaLiquidacion(t, r)

    let objetivoNombre: string | null = null
    if (r.objetivo_final_id && objetivoFinalMap.has(r.objetivo_final_id)) {
      objetivoNombre = objetivoFinalMap.get(r.objetivo_final_id) ?? null
    } else {
      objetivoNombre = (t.objetivo as any)?.nombre ?? null
    }

    const tieneEntrada = linea.horaEntrada != null
    const tieneSalida = linea.horaSalida != null
    const estado = tieneEntrada && !tieneSalida ? 'en_curso' as const : 'trabajado' as const
    // Mismo corte que aplica aceptar_turno_planilla con `v_fin > now()`. Sin
    // esto la fila ofrecía "Aceptar" apenas había entrada y salida fichadas
    // —por ejemplo si el vigilador marcó la salida antes del fin programado—
    // y la RPC contestaba "El turno todavia no finalizo": botón visible que no
    // podía funcionar. La condición vive en un solo lado.
    const finalizado = turnoFinalizado(t.fecha, t.hora_inicio ?? '00:00', t.hora_fin ?? '00:00')
    const revisable = estado === 'trabajado' && finalizado

    filas.push({
      fecha:           t.fecha,
      dia_semana:      diaSemana(t.fecha),
      hora_entrada:    linea.horaEntrada ? linea.horaEntrada.slice(0, 5) : null,
      hora_salida:     linea.horaSalida  ? linea.horaSalida.slice(0, 5)  : null,
      horas:           linea.horasLiquidables,
      objetivo_id:     linea.objetivoEfectivoId,
      objetivo_nombre: objetivoNombre,
      origen_etiqueta: linea.origenEtiqueta,
      estado,
      caracteristica:  caracteristicaTurno(t.tipo_evento),
      turno_id:        t.id,
      puesto_nombre:   (t.puesto as any)?.nombre ?? null,
      salida_automatica: Boolean(r.cierre_automatico),
      estado_control:  revisable ? 'pendiente' : null,
      permite_aceptar: revisable,
      hora_inicio_programada: t.hora_inicio ? t.hora_inicio.slice(0, 5) : null,
      hora_fin_programada:    t.hora_fin    ? t.hora_fin.slice(0, 5)    : null,
      gps_ingreso_estado: r.gps_ingreso_estado ?? null,
      gps_egreso_estado:  r.gps_egreso_estado  ?? null,
    })
  }

  const fechasConRegistro = new Set(filas.map(f => f.fecha))

  // ── Turnos programados sin registro (incluye los futuros) ──────────────────
  // Son los turnos que el vigilador tiene por delante y todavía no fichó. Se
  // listan con horas 0, así que no alteran las horas del mes: esas salen de
  // conCobertura, que además excluye objetivos de prueba.
  //
  // El filtro por estado va por exclusión, no por lista blanca. Antes pedía
  // ('cubierto','pendiente'): 'pendiente' no es un estado real de turnos y
  // faltaba 'programado', que es con el que nacen TODOS los turnos que crea la
  // programación. Por eso ningún turno programado aparecía nunca en la
  // planilla. Se excluyen los estados sin obligación de cobertura, el mismo
  // criterio que usa el resto del sistema (ESTADOS_SIN_OBLIGACION).
  const { data: turnosProgramados } = await admin.client
    .from('turnos')
    .select('id, fecha, hora_inicio, hora_fin, objetivo_id, tipo_evento, puesto_id, objetivo:objetivos(nombre), puesto:puestos(nombre)')
    .eq('guardia_id', empleadoId)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .not('estado', 'in', '("reemplazado","anulado","cancelado")')

  for (const t of (turnosProgramados ?? [])) {
    if (fechasConRegistro.has(t.fecha)) continue
    fechasConRegistro.add(t.fecha)
    // Turno pasado sin fichaje: revisable solo mediante solicitud de
    // modificación (nunca Aceptar — no hay asistencia que aceptar).
    const yaFinalizado = turnoFinalizado(t.fecha, t.hora_inicio ?? '00:00', t.hora_fin ?? '00:00')
    filas.push({
      fecha: t.fecha,
      dia_semana: diaSemana(t.fecha),
      hora_entrada: t.hora_inicio?.slice(0, 5) ?? null,
      hora_salida: t.hora_fin?.slice(0, 5) ?? null,
      horas: 0,
      objetivo_id: t.objetivo_id,
      objetivo_nombre: (t.objetivo as any)?.nombre ?? null,
      origen_etiqueta: 'Turno programado',
      estado: 'programado',
      caracteristica: caracteristicaTurno((t as any).tipo_evento),
      turno_id: t.id,
      puesto_nombre: ((t as any).puesto)?.nombre ?? null,
      salida_automatica: false,
      estado_control: yaFinalizado ? 'pendiente' : null,
      permite_aceptar: false,
      hora_inicio_programada: t.hora_inicio?.slice(0, 5) ?? null,
      hora_fin_programada:    t.hora_fin?.slice(0, 5)    ?? null,
      gps_ingreso_estado: null,
      gps_egreso_estado:  null,
    })
  }

  // ── Días sin programación ──────────────────────────────────────────────────
  const [aY, aM] = mes.split('-').map(Number)
  const ultimoDia = new Date(aY, aM, 0).getDate()
  for (let d = 1; d <= ultimoDia; d++) {
    const fechaStr = `${mes}-${String(d).padStart(2, '0')}`
    if (fechasConRegistro.has(fechaStr)) continue
    filas.push({
      fecha: fechaStr,
      dia_semana: diaSemana(fechaStr),
      hora_entrada: null,
      hora_salida: null,
      horas: 0,
      objetivo_id: null,
      objetivo_nombre: null,
      origen_etiqueta: '',
      estado: 'sin_programacion',
      caracteristica: null,
      turno_id: null,
      puesto_nombre: null,
      salida_automatica: false,
      estado_control: null,
      permite_aceptar: false,
      hora_inicio_programada: null,
      hora_fin_programada: null,
      gps_ingreso_estado: null,
      gps_egreso_estado: null,
    })
  }

  // ── Primer control del vigilador: resolver estado por turno ───────────────
  // Solicitud pendiente > aceptado > pendiente de revisión.
  // Si las tablas del Bloque C aún no existen, las filas quedan 'pendiente'.
  const turnoIdsRevisables = filas
    .filter(f => f.estado_control !== null && f.turno_id)
    .map(f => f.turno_id as string)

  if (turnoIdsRevisables.length > 0) {
    const [acepts, solis] = await Promise.all([
      admin.client
        .from('aceptaciones_planilla')
        .select('turno_id')
        .eq('empleado_id', empleadoId)
        .in('turno_id', turnoIdsRevisables),
      admin.client
        .from('solicitudes_modificacion_planilla')
        .select('turno_id')
        .eq('empleado_id', empleadoId)
        .eq('estado', 'pendiente')
        .in('turno_id', turnoIdsRevisables),
    ])
    const aceptados = new Set((acepts.data ?? []).map((a: any) => a.turno_id))
    const solicitados = new Set((solis.data ?? []).map((s: any) => s.turno_id))
    for (const f of filas) {
      if (f.estado_control === null || !f.turno_id) continue
      if (solicitados.has(f.turno_id)) f.estado_control = 'modificacion_solicitada'
      else if (aceptados.has(f.turno_id)) f.estado_control = 'aceptado'
    }
  }

  // ── Ordenar por fecha y hora de entrada ───────────────────────────────────
  filas.sort((a, b) => {
    const fc = a.fecha.localeCompare(b.fecha)
    if (fc !== 0) return fc
    if (a.estado === 'sin_programacion') return 1
    if (b.estado === 'sin_programacion') return -1
    return (a.hora_entrada ?? '').localeCompare(b.hora_entrada ?? '')
  })

  const total_horas = Number(filas.reduce((s, f) => s + f.horas, 0).toFixed(2))
  const es_titular = solicitante.id === empleadoId
  const pendientes = filas.filter(f => f.estado_control === 'pendiente')
  const pendientes_revision = pendientes.length
  const pendientes_aceptacion = pendientes.filter(f => f.permite_aceptar).length

  return NextResponse.json({
    filas, total_horas, mes, desde, hasta, es_titular,
    pendientes_revision, pendientes_aceptacion,
  } satisfies RespuestaPlanilla)
}
