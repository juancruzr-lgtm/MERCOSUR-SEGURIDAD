import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, getSupabaseAdmin } from '../../_lib/employee-auth'

export const runtime = 'nodejs'

type EstadoOperativo = 'FUTURO' | 'EN_CURSO' | 'FINALIZADO'

// Campos permitidos por estado operativo del turno
const CAMPOS_FUTURO    = new Set(['guardia_id', 'fecha', 'hora_inicio', 'hora_fin', 'estado', 'objetivo_id', 'puesto_id'])
const CAMPOS_EN_CURSO  = new Set(['hora_fin', 'estado'])
// FINALIZADO: ningún campo de horario puede cambiar

export async function POST(req: NextRequest) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const token = getBearerToken(req)
  if (!token) return NextResponse.json({ error: 'Sesión requerida' }, { status: 401 })

  const { data: authData, error: authError } = await admin.client.auth.getUser(token)
  if (authError || !authData.user) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })

  const { data: perfil, error: perfilError } = await admin.client
    .from('usuarios')
    .select('id, rol')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (perfilError) return NextResponse.json({ error: perfilError.message }, { status: 500 })
  if (!perfil || !['admin', 'supervisor'].includes(perfil.rol ?? '')) {
    return NextResponse.json({ error: 'Acceso restringido a: admin, supervisor' }, { status: 403 })
  }
  const usuarioId: string = perfil.id

  // ── Body ────────────────────────────────────────────────────────────────────
  let body: {
    turno_id: string
    cambios: Record<string, string | null>
    comentario?: string
    snapshot?: Record<string, string | null>
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const { turno_id, cambios, comentario, snapshot } = body

  if (!turno_id || typeof turno_id !== 'string') {
    return NextResponse.json({ error: 'turno_id requerido' }, { status: 400 })
  }
  if (!cambios || typeof cambios !== 'object' || Array.isArray(cambios)) {
    return NextResponse.json({ error: 'cambios requerido' }, { status: 400 })
  }

  // ── Leer turno actual ────────────────────────────────────────────────────────
  const { data: turno, error: turnoError } = await admin.client
    .from('turnos')
    .select('*')
    .eq('id', turno_id)
    .single()

  if (turnoError || !turno) {
    return NextResponse.json({ error: 'Turno no encontrado' }, { status: 404 })
  }

  // ── Detección de concurrencia ───────────────────────────────────────────────
  // Compara los valores originales que el cliente vio con el estado actual en DB.
  if (snapshot && typeof snapshot === 'object') {
    for (const [campo, valorOriginal] of Object.entries(snapshot)) {
      const valorActual = (turno as Record<string, unknown>)[campo] ?? null
      if (String(valorActual ?? '') !== String(valorOriginal ?? '')) {
        return NextResponse.json(
          {
            error: 'El turno fue modificado por otra persona. Recargá la página y volvé a intentar.',
            codigo: 'CONCURRENCIA',
          },
          { status: 409 },
        )
      }
    }
  }

  // ── Estado operativo ────────────────────────────────────────────────────────
  const { data: registros } = await admin.client
    .from('registros_asistencia')
    .select('id, hora_entrada_real, hora_salida_real, hora_entrada_final, tipo_registro')
    .eq('turno_id', turno_id)

  const tieneEntrada = (registros ?? []).some(r =>
    r.tipo_registro !== 'ausencia' && (r.hora_entrada_final || r.hora_entrada_real)
  )
  const tieneSalida  = (registros ?? []).some(r => r.hora_salida_real  != null)

  const estadoOperativo: EstadoOperativo = tieneSalida
    ? 'FINALIZADO'
    : tieneEntrada
      ? 'EN_CURSO'
      : 'FUTURO'

  // ── Validar campos permitidos ───────────────────────────────────────────────
  const camposPermitidos = estadoOperativo === 'FUTURO'   ? CAMPOS_FUTURO
    : estadoOperativo === 'EN_CURSO' ? CAMPOS_EN_CURSO
    : new Set<string>()

  const camposBloqueados = Object.keys(cambios).filter(c => !camposPermitidos.has(c))
  if (camposBloqueados.length > 0) {
    const etiqueta = estadoOperativo === 'EN_CURSO' ? 'en curso' : 'finalizado'
    return NextResponse.json(
      {
        error: `No se puede modificar ${camposBloqueados.join(', ')} en un turno ${etiqueta}.`,
        estadoOperativo,
        camposBloqueados,
      },
      { status: 422 },
    )
  }

  // ── Calcular cambios efectivos ──────────────────────────────────────────────
  const registroCambios: { campo: string; valor_anterior: string | null; valor_nuevo: string | null }[] = []
  const updatePayload: Record<string, unknown> = {}

  for (const [campo, valorNuevo] of Object.entries(cambios)) {
    const valorAnterior = (turno as Record<string, unknown>)[campo] ?? null
    const anteriorStr   = valorAnterior === null ? null : String(valorAnterior)
    const nuevoStr      = valorNuevo    === null ? null : String(valorNuevo)
    if (anteriorStr !== nuevoStr) {
      registroCambios.push({ campo, valor_anterior: anteriorStr, valor_nuevo: nuevoStr })
      updatePayload[campo] = valorNuevo
    }
  }

  if (registroCambios.length === 0) {
    return NextResponse.json({ ok: true, turno, sin_cambios: true })
  }

  // ── Actualizar turno ────────────────────────────────────────────────────────
  const { data: turnoActualizado, error: updateError } = await admin.client
    .from('turnos')
    .update(updatePayload)
    .eq('id', turno_id)
    .select()
    .single()

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  // ── Auditoría ───────────────────────────────────────────────────────────────
  const comentarioFinal = (comentario ?? '').trim() || 'Modificación de turno programado'

  const { error: auditoriaError } = await admin.client
    .from('turnos_auditoria')
    .insert(
      registroCambios.map(c => ({
        turno_id,
        modificado_por: usuarioId,
        campo: c.campo,
        valor_anterior: c.valor_anterior,
        valor_nuevo: c.valor_nuevo,
        comentario: comentarioFinal,
      })),
    )

  if (auditoriaError) {
    // El turno ya se actualizó. Se informa pero no se hace rollback.
    return NextResponse.json({
      ok: true,
      turno: turnoActualizado,
      estadoOperativo,
      advertencia: `Turno actualizado, pero no se pudo guardar la auditoría: ${auditoriaError.message}`,
    })
  }

  return NextResponse.json({ ok: true, turno: turnoActualizado, estadoOperativo })
}
