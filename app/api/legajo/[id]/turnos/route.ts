import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, getSupabaseAdmin } from '../../../_lib/employee-auth'
import { puedeVerLegajo } from '@/lib/legajo'

export const runtime = 'nodejs'

// Parámetros aceptados — todos validados explícitamente.
// No se acepta orden arbitrario, SQL ni campos libres del cliente.
const ESTADOS_VALIDOS = new Set(['programado', 'cubierto', 'descubierto'])
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/
const RE_MES   = /^\d{4}-\d{2}$/
const RE_UUID  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Devuelve el primer y último día de un mes YYYY-MM.
function rangoMes(mes: string): { desde: string; hasta: string } {
  const [y, m] = mes.split('-').map(Number)
  const desde = `${mes}-01`
  const ultimo = new Date(y, m, 0).getDate()
  const hasta  = `${mes}-${String(ultimo).padStart(2, '0')}`
  return { desde, hasta }
}

// Fecha actual en UTC-3 Argentina, formato YYYY-MM-DD.
function hoyArg(): string {
  const ARG_OFFSET_MS = -3 * 60 * 60 * 1000
  return new Date(Date.now() + ARG_OFFSET_MS).toISOString().slice(0, 10)
}

// Mes siguiente a un YYYY-MM dado.
function mesSiguiente(mesStr: string): string {
  const [y, m] = mesStr.split('-').map(Number)
  const d = new Date(y, m, 1) // 1º del mes siguiente
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

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

  // ── Validar que el empleado existe ─────────────────────────────────────────
  const { data: empleado } = await admin.client
    .from('usuarios')
    .select('id')
    .eq('id', empleadoId)
    .single()

  if (!empleado) return NextResponse.json({ error: 'Empleado no encontrado' }, { status: 404 })

  // ── Parámetros de consulta ─────────────────────────────────────────────────
  const sp = req.nextUrl.searchParams
  const mesParam      = sp.get('mes')       // YYYY-MM — define el período
  const desdeParam    = sp.get('desde')     // YYYY-MM-DD — alternativo explícito
  const hastaParam    = sp.get('hasta')     // YYYY-MM-DD — alternativo explícito
  const estadoParam   = sp.get('estado')    // programado | cubierto | descubierto
  const objetivoParam = sp.get('objetivo_id')

  // Validaciones estrictas
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

  // Rango de fechas
  const hoy = hoyArg()
  let desde: string
  let hasta: string

  if (desdeParam && hastaParam) {
    desde = desdeParam
    hasta = hastaParam
  } else if (mesParam) {
    // Mes seleccionado: incluir ese mes + el mes siguiente para capturar próximos
    const rango = rangoMes(mesParam)
    desde = rango.desde
    hasta = rangoMes(mesSiguiente(mesParam)).hasta
  } else {
    // Default: mes actual + mes siguiente
    const mesActual = hoy.slice(0, 7)
    const rango = rangoMes(mesActual)
    desde = rango.desde
    hasta = rangoMes(mesSiguiente(mesActual)).hasta
  }

  // Protección: no aceptar rangos mayores a 6 meses (~180 días)
  const diasRango = (new Date(hasta).getTime() - new Date(desde).getTime()) / 86_400_000
  if (diasRango > 184) {
    return NextResponse.json({ error: 'El rango de fechas no puede superar 6 meses' }, { status: 400 })
  }

  // ── Consulta de turnos ─────────────────────────────────────────────────────
  // Un único query con joins — sin N+1.
  // Incluye objetivo (para nombre y es_prueba) y puesto (para nombre).
  let query = admin.client
    .from('turnos')
    .select('id, fecha, hora_inicio, hora_fin, estado, objetivo_id, puesto_id, objetivo:objetivos(nombre, es_prueba), puesto:puestos(nombre)')
    .eq('guardia_id', empleadoId)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: true })
    .order('hora_inicio', { ascending: true })

  if (estadoParam) {
    query = query.eq('estado', estadoParam)
  }
  if (objetivoParam) {
    query = query.eq('objetivo_id', objetivoParam)
  }

  const { data: turnos, error: turnosError } = await query

  if (turnosError) {
    return NextResponse.json({ error: 'Error al consultar turnos' }, { status: 500 })
  }

  // ── Filtrar objetivos de prueba en memoria ─────────────────────────────────
  const turnosFiltrados = (turnos ?? []).filter((t: any) => {
    return !(t.objetivo as any)?.es_prueba
  })

  // ── Separar próximos / historial ───────────────────────────────────────────
  const proximos  = turnosFiltrados.filter((t: any) => t.fecha >= hoy)
  const historial = turnosFiltrados.filter((t: any) => t.fecha  < hoy)

  // ── Normalizar respuesta (ocultar es_prueba del cliente) ───────────────────
  const normalizar = (t: any) => ({
    id:              t.id,
    fecha:           t.fecha,
    hora_inicio:     t.hora_inicio,
    hora_fin:        t.hora_fin,
    estado:          t.estado,
    objetivo_id:     t.objetivo_id,
    objetivo_nombre: (t.objetivo as any)?.nombre ?? null,
    puesto_id:       t.puesto_id ?? null,
    puesto_nombre:   (t.puesto as any)?.nombre ?? null,
  })

  return NextResponse.json({
    proximos:  proximos.map(normalizar),
    historial: historial.map(normalizar),
    total:     turnosFiltrados.length,
    rango:     { desde, hasta },
  })
}
