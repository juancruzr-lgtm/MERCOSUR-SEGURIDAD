import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, getSupabaseAdmin } from '../../_lib/employee-auth'
import { puedeVerLegajo } from '@/lib/legajo'
import { rangoTurno, esTurnoNocturno } from '@/lib/turnos'

export const runtime = 'nodejs'
// Datos por sesión: jamás cachear (ver planilla/route.ts).
export const dynamic = 'force-dynamic'

// Determina hoy, ayer y el instante actual en hora local Argentina (UTC-3).
// rangoTurno() en el servidor (Vercel UTC) interpreta hora_inicio/hora_fin como horas
// locales del proceso. Para que la comparación sea consistente, ahora también se
// desplaza al mismo marco: Argentina local "como si fuera" hora del proceso.
function fechasConsulta(): { hoy: string; ayer: string; ahora: Date } {
  const ARG_OFFSET_MS = -3 * 60 * 60 * 1000
  const ahoraMs = Date.now() + ARG_OFFSET_MS
  const ahoraArg = new Date(ahoraMs)
  const hoy = ahoraArg.toISOString().slice(0, 10)
  const ayerDate = new Date(ahoraMs - 86_400_000)
  const ayer = ayerDate.toISOString().slice(0, 10)
  return { hoy, ayer, ahora: ahoraArg }
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

  // ── Empleado ──────────────────────────────────────────────────────────────
  const { data: empleado, error: empleadoError } = await admin.client
    .from('usuarios')
    .select('id, nombre, apellido, legajo, cuil, dni, rol, estado, foto_url, email')
    .eq('id', empleadoId)
    .single()

  if (empleadoError || !empleado) {
    return NextResponse.json({ error: 'Empleado no encontrado' }, { status: 404 })
  }

  const { hoy, ayer, ahora } = fechasConsulta()

  // ── Turno actual (incluye nocturno del día anterior) ──────────────────────
  const { data: turnosHoyAyer } = await admin.client
    .from('turnos')
    .select('id, fecha, hora_inicio, hora_fin, guardia_id, objetivo_id, puesto_id, estado')
    .eq('guardia_id', empleadoId)
    .in('fecha', [ayer, hoy])
    .order('hora_inicio')

  const candidatos = (turnosHoyAyer ?? []).filter(t => {
    if (t.fecha === ayer) return esTurnoNocturno(t)
    return true
  })

  // Usa rangoTurno (lib/turnos.ts) para detectar cuál está activo ahora
  const turnoActivo = candidatos.find(t => {
    const rango = rangoTurno(t)
    if (!rango) return false
    const ts = ahora.getTime()
    return ts >= rango.inicio && ts <= rango.fin
  }) ?? null

  // Si no hay ninguno activo, mostrar el más reciente del día de hoy
  const turnoActual = turnoActivo ?? candidatos.find(t => t.fecha === hoy) ?? null

  // ── Objetivo y puesto del turno actual ────────────────────────────────────
  let objetivoNombre: string | null = null
  let puestoNombre: string | null = null

  if (turnoActual?.objetivo_id) {
    const { data: obj } = await admin.client
      .from('objetivos')
      .select('nombre')
      .eq('id', turnoActual.objetivo_id)
      .single()
    objetivoNombre = obj?.nombre ?? null
  }

  if (turnoActual?.puesto_id) {
    const { data: puesto } = await admin.client
      .from('puestos')
      .select('nombre')
      .eq('id', turnoActual.puesto_id)
      .single()
    puestoNombre = puesto?.nombre ?? null
  }

  // ── Registro de asistencia del turno actual ───────────────────────────────
  let registroActual: {
    hora_entrada_real: string | null
    hora_entrada_final: string | null
    tipo_registro: string | null
  } | null = null

  if (turnoActual) {
    const { data: registros } = await admin.client
      .from('registros_asistencia')
      .select('hora_entrada_real, hora_entrada_final, tipo_registro')
      .eq('turno_id', turnoActual.id)
      .eq('guardia_id', empleadoId)
      .order('created_at', { ascending: true })
      .limit(1)
    registroActual = registros?.[0] ?? null
  }

  // ── Próximo turno ─────────────────────────────────────────────────────────
  const { data: proximosTurnos } = await admin.client
    .from('turnos')
    .select('id, fecha, hora_inicio, hora_fin, objetivo_id')
    .eq('guardia_id', empleadoId)
    .gt('fecha', hoy)
    .order('fecha', { ascending: true })
    .order('hora_inicio', { ascending: true })
    .limit(1)

  let proximoTurno: {
    id: string
    fecha: string
    hora_inicio: string
    hora_fin: string
    objetivo_nombre: string | null
  } | null = null

  if (proximosTurnos?.[0]) {
    const pt = proximosTurnos[0]
    let ptObjetivoNombre: string | null = null
    if (pt.objetivo_id) {
      const { data: ptObj } = await admin.client
        .from('objetivos')
        .select('nombre')
        .eq('id', pt.objetivo_id)
        .single()
      ptObjetivoNombre = ptObj?.nombre ?? null
    }
    proximoTurno = {
      id: pt.id,
      fecha: pt.fecha,
      hora_inicio: pt.hora_inicio,
      hora_fin: pt.hora_fin,
      objetivo_nombre: ptObjetivoNombre,
    }
  }

  // ── Novedad laboral vigente hoy ───────────────────────────────────────────
  const { data: novedades } = await admin.client
    .from('novedades_laborales')
    .select('tipo, fecha_desde, fecha_hasta, observacion')
    .eq('empleado_id', empleadoId)
    .eq('estado', 'aprobada')
    .lte('fecha_desde', hoy)
    .gte('fecha_hasta', hoy)
    .order('created_at', { ascending: false })
    .limit(1)

  const novedadVigente = novedades?.[0] ?? null

  return NextResponse.json({
    empleado: {
      id: empleado.id,
      nombre: empleado.nombre,
      apellido: empleado.apellido,
      legajo: empleado.legajo,
      cuil: empleado.cuil ?? null,
      dni: solicitante.rol === 'admin' ? empleado.dni : undefined,
      email: solicitante.rol === 'admin' ? empleado.email : undefined,
      rol: empleado.rol,
      estado: empleado.estado,
      foto_url: empleado.foto_url,
    },
    turno_actual: turnoActual
      ? {
          id: turnoActual.id,
          fecha: turnoActual.fecha,
          hora_inicio: turnoActual.hora_inicio,
          hora_fin: turnoActual.hora_fin,
          objetivo_nombre: objetivoNombre,
          puesto_nombre: puestoNombre,
          es_activo_ahora: turnoActivo?.id === turnoActual.id,
        }
      : null,
    registro_actual: registroActual,
    proximo_turno: proximoTurno,
    novedad_vigente: novedadVigente,
  })
}
