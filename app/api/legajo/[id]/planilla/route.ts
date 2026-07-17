import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, getSupabaseAdmin } from '../../../_lib/employee-auth'
import { puedeVerLegajo } from '@/lib/legajo'
import { effectiveGuardia, effectiveEntrada, selectRegistroPrincipal, resolverLineaLiquidacion } from '@/lib/liquidacion'

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
  hora_entrada: string
  hora_salida: string | null
  horas: number
  objetivo_id: string | null
  objetivo_nombre: string | null
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
  // Solo registros donde el guardia efectivo coincide, no son ausencias,
  // tienen entrada confirmada y no corresponden a objetivos de prueba.
  const conEntrada = (registros ?? []).filter((r: any) => {
    if (effectiveGuardia(r) !== empleadoId) return false
    if (r.tipo_registro === 'ausencia') return false
    if (!effectiveEntrada(r)) return false
    const t = r.turno
    if (!t) return false
    if ((t.objetivo as any)?.es_prueba) return false
    return true
  })

  // ── Resolver nombres para objetivo_final_id distintos al del turno ────────
  const objetivoFinalIds = [...new Set(
    conEntrada
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
  for (const r of conEntrada) {
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

    filas.push({
      fecha:           t.fecha,
      dia_semana:      diaSemana(t.fecha),
      hora_entrada:    (linea.horaEntrada ?? '').slice(0, 5),
      hora_salida:     linea.horaSalida ? linea.horaSalida.slice(0, 5) : null,
      horas:           linea.horasLiquidables,
      objetivo_id:     linea.objetivoEfectivoId,
      objetivo_nombre: objetivoNombre,
    })
  }

  // ── Ordenar por fecha y hora de entrada ───────────────────────────────────
  filas.sort((a, b) => {
    const fc = a.fecha.localeCompare(b.fecha)
    return fc !== 0 ? fc : a.hora_entrada.localeCompare(b.hora_entrada)
  })

  const total_horas = Number(filas.reduce((s, f) => s + f.horas, 0).toFixed(2))

  return NextResponse.json({ filas, total_horas, mes, desde, hasta } satisfies RespuestaPlanilla)
}
