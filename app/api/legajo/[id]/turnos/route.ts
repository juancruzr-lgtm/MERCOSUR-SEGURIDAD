import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, getSupabaseAdmin } from '../../../_lib/employee-auth'
import { puedeVerLegajo } from '@/lib/legajo'

export const runtime = 'nodejs'

// Parámetros aceptados — todos validados explícitamente.
const ESTADOS_VALIDOS = new Set(['programado', 'cubierto', 'descubierto'])
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/
const RE_MES   = /^\d{4}-\d{2}$/
const RE_UUID  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Tipo de cobertura de un turno en el legajo de un empleado ─────────────
// 'programado'  — turnos.guardia_id === empleadoId (asignado ahora)
// 'reasignado'  — turnos.guardia_original_id === empleadoId, turno reasignado a otro
// 'reemplazo'   — empleado cubrió vía registros_asistencia sin estar en turnos
export type TipoCobertura = 'programado' | 'reasignado' | 'reemplazo'

function rangoMes(mes: string): { desde: string; hasta: string } {
  const [y, m] = mes.split('-').map(Number)
  const desde = `${mes}-01`
  const ultimo = new Date(y, m, 0).getDate()
  const hasta  = `${mes}-${String(ultimo).padStart(2, '0')}`
  return { desde, hasta }
}

function hoyArg(): string {
  const ARG_OFFSET_MS = -3 * 60 * 60 * 1000
  return new Date(Date.now() + ARG_OFFSET_MS).toISOString().slice(0, 10)
}

function mesSiguiente(mesStr: string): string {
  const [y, m] = mesStr.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const TURNO_SELECT = 'id, fecha, hora_inicio, hora_fin, estado, guardia_id, guardia_original_id, objetivo_id, puesto_id, objetivo:objetivos(nombre, es_prueba), puesto:puestos(nombre)'

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
    .from('usuarios')
    .select('id, rol')
    .eq('auth_user_id', authData.user.id)
    .single()

  if (!solicitante) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 403 })

  const empleadoId = params.id

  if (!puedeVerLegajo({ id: solicitante.id, rol: solicitante.rol }, empleadoId)) {
    return NextResponse.json({ error: 'Sin acceso a este legajo' }, { status: 403 })
  }

  const { data: empleado } = await admin.client
    .from('usuarios')
    .select('id')
    .eq('id', empleadoId)
    .single()

  if (!empleado) return NextResponse.json({ error: 'Empleado no encontrado' }, { status: 404 })

  // ── Parámetros de consulta ─────────────────────────────────────────────────
  const sp = req.nextUrl.searchParams
  const mesParam      = sp.get('mes')
  const desdeParam    = sp.get('desde')
  const hastaParam    = sp.get('hasta')
  const estadoParam   = sp.get('estado')
  const objetivoParam = sp.get('objetivo_id')

  if (mesParam && !RE_MES.test(mesParam)) {
    return NextResponse.json({ error: 'Parámetro mes inválido (esperado YYYY-MM)' }, { status: 400 })
  }
  if (desdeParam && !RE_FECHA.test(desdeParam)) {
    return NextResponse.json({ error: 'Parámetro desde inválido (esperado YYYY-MM-DD)' }, { status: 400 })
  }
  if (hastaParam && !RE_FECHA.test(hastaParam)) {
    return NextResponse.json({ error: 'Parámetro hasta inválido (esperado YYYY-MM-DD)' }, { status: 400 })
  }
  if (estadoParam && !ESTADOS_VALIDOS.has(estadoParam)) {
    return NextResponse.json({ error: `Estado inválido. Valores permitidos: ${[...ESTADOS_VALIDOS].join(', ')}` }, { status: 400 })
  }
  if (objetivoParam && !RE_UUID.test(objetivoParam)) {
    return NextResponse.json({ error: 'Parámetro objetivo_id inválido' }, { status: 400 })
  }

  const hoy = hoyArg()
  let desde: string
  let hasta: string

  if (desdeParam && hastaParam) {
    desde = desdeParam
    hasta = hastaParam
  } else if (mesParam) {
    const rango = rangoMes(mesParam)
    desde = rango.desde
    hasta = rangoMes(mesSiguiente(mesParam)).hasta
  } else {
    const mesActual = hoy.slice(0, 7)
    const rango = rangoMes(mesActual)
    desde = rango.desde
    hasta = rangoMes(mesSiguiente(mesActual)).hasta
  }

  const diasRango = (new Date(hasta).getTime() - new Date(desde).getTime()) / 86_400_000
  if (diasRango > 184) {
    return NextResponse.json({ error: 'El rango de fechas no puede superar 6 meses' }, { status: 400 })
  }

  // ── Fuente 1: turnos asignados al empleado ahora O en su origen ───────────
  // Incluye:
  //   a) turnos.guardia_id = empleadoId  → actualmente programado
  //   b) turnos.guardia_original_id = empleadoId  → estaba programado, luego reasignado a otro
  //
  // Nota: guardia_original_id existe en la DB y es escrito por AppClient cuando
  // un admin reasigna un turno. Siempre trae ambos campos para poder distinguirlos.
  const { data: turnosAsignados, error: turnosError } = await admin.client
    .from('turnos')
    .select(TURNO_SELECT)
    .or(`guardia_id.eq.${empleadoId},guardia_original_id.eq.${empleadoId}`)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: true })
    .order('hora_inicio', { ascending: true })

  if (turnosError) {
    return NextResponse.json({ error: 'Error al consultar turnos' }, { status: 500 })
  }

  // ── Fuente 2: turnos cubiertos vía registros_asistencia (reemplazos) ──────
  // El empleado puede haber fichado en un turno que no le estaba asignado, o el
  // admin puede haber corregido guardia_final_id a este empleado.
  // Fuente de verdad: coalesce(guardia_final_id, guardia_id) === empleadoId
  //
  // Solo para historial (fecha < hoy). Se hacen dos queries OR y luego se aplica
  // la lógica coalesce en memoria para evitar registros corregidos que excluyen
  // al empleado (ej: guardia_id=empleadoId pero guardia_final_id=otro).
  const { data: registrosEfectivos, error: registrosError } = await admin.client
    .from('registros_asistencia')
    .select(`
      id, turno_id, guardia_id, guardia_final_id,
      turno:turnos!inner(
        id, fecha, hora_inicio, hora_fin, estado,
        guardia_id, guardia_original_id,
        objetivo_id, puesto_id,
        objetivo:objetivos(nombre, es_prueba),
        puesto:puestos(nombre)
      )
    `)
    .or(`guardia_id.eq.${empleadoId},guardia_final_id.eq.${empleadoId}`)

  if (registrosError) {
    return NextResponse.json({ error: 'Error al consultar registros' }, { status: 500 })
  }

  // ── Construir mapa de turnos con tipo_cobertura ────────────────────────────
  // Mapa keyed by turno_id. Prioridad: programado > reasignado > reemplazo
  const turnosMap = new Map<string, { turno: any; tipo: TipoCobertura }>()

  for (const t of (turnosAsignados ?? [])) {
    // Ignorar objetivos de prueba
    if ((t.objetivo as any)?.es_prueba) continue

    const esProgramadoAhora = t.guardia_id === empleadoId
    const tipo: TipoCobertura = esProgramadoAhora ? 'programado' : 'reasignado'

    // Para 'reasignado': solo aplica al historial (ya pasaron, no son próximos)
    // Los próximos siempre son 'programado' (guardia_id = empleadoId, fecha >= hoy)
    turnosMap.set(t.id, { turno: t, tipo })
  }

  // Agregar turnos de reemplazo (no estaban en turnosAsignados)
  for (const r of (registrosEfectivos ?? [])) {
    const t = (r as any).turno
    if (!t) continue

    // Aplicar lógica coalesce: el empleado es el guardia final efectivo
    const guardiaEfectivo = (r as any).guardia_final_id ?? (r as any).guardia_id
    if (guardiaEfectivo !== empleadoId) continue

    // Solo historial (para próximos no hay registros aún)
    if (t.fecha >= hoy) continue

    // Ignorar objetivos de prueba
    if ((t.objetivo as any)?.es_prueba) continue

    // No sobreescribir si ya está en el mapa (fuente 1 tiene prioridad)
    if (turnosMap.has(t.id)) continue

    // El turno no estaba en los asignados — es un reemplazo puro
    turnosMap.set(t.id, { turno: t, tipo: 'reemplazo' })
  }

  // ── Aplicar filtros opcionales en memoria ─────────────────────────────────
  // (estado y objetivo_id — los mismos parámetros soportados por el endpoint)
  let merged = [...turnosMap.values()]

  if (estadoParam) {
    merged = merged.filter(({ turno }) => turno.estado === estadoParam)
  }
  if (objetivoParam) {
    merged = merged.filter(({ turno }) => turno.objetivo_id === objetivoParam)
  }

  // Ordenar por fecha + hora_inicio
  merged.sort((a, b) => {
    const fa = `${a.turno.fecha} ${a.turno.hora_inicio}`
    const fb = `${b.turno.fecha} ${b.turno.hora_inicio}`
    return fa.localeCompare(fb)
  })

  // ── Separar próximos / historial ───────────────────────────────────────────
  // Próximos: solo turnos donde el empleado está actualmente programado (guardia_id)
  // Reasignados y reemplazos son siempre historial por definición.
  const proximos  = merged.filter(({ turno, tipo }) => turno.fecha >= hoy && tipo === 'programado')
  const historial = merged.filter(({ turno })        => turno.fecha <  hoy)

  // ── Normalizar respuesta ───────────────────────────────────────────────────
  const normalizar = ({ turno: t, tipo }: { turno: any; tipo: TipoCobertura }) => ({
    id:              t.id,
    fecha:           t.fecha,
    hora_inicio:     t.hora_inicio,
    hora_fin:        t.hora_fin,
    estado:          t.estado,
    objetivo_id:     t.objetivo_id,
    objetivo_nombre: (t.objetivo as any)?.nombre ?? null,
    puesto_id:       t.puesto_id ?? null,
    puesto_nombre:   (t.puesto as any)?.nombre ?? null,
    tipo_cobertura:  tipo,
  })

  return NextResponse.json({
    proximos:  proximos.map(normalizar),
    historial: historial.map(normalizar),
    total:     merged.length,
    rango:     { desde, hasta },
  })
}
