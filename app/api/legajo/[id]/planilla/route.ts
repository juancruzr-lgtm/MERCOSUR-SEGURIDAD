import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, getSupabaseAdmin } from '../../../_lib/employee-auth'
import { puedeVerLegajo } from '@/lib/legajo'
import { effectiveGuardia, selectRegistroPrincipal, resolverLineaLiquidacion } from '@/lib/liquidacion'

export const runtime = 'nodejs'

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
}

export interface RespuestaPlanilla {
  filas: FilaPlanilla[]
  total_horas: number
  mes: string
  desde: string
  hasta: string
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
      turno:turnos!inner(
        id, fecha, hora_inicio, hora_fin, objetivo_id,
        objetivo:objetivos(nombre, es_prueba)
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
    })
  }

  const fechasConRegistro = new Set(filas.map(f => f.fecha))

  // ── Turnos programados sin registro ────────────────────────────────────────
  const { data: turnosProgramados } = await admin.client
    .from('turnos')
    .select('id, fecha, hora_inicio, hora_fin, objetivo_id, objetivo:objetivos(nombre)')
    .eq('guardia_id', empleadoId)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .in('estado', ['cubierto', 'pendiente'])

  for (const t of (turnosProgramados ?? [])) {
    if (fechasConRegistro.has(t.fecha)) continue
    fechasConRegistro.add(t.fecha)
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
    })
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

  return NextResponse.json({ filas, total_horas, mes, desde, hasta } satisfies RespuestaPlanilla)
}
