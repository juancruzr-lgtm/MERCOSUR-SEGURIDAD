import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, getSupabaseAdmin } from '../_lib/employee-auth'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const token = getBearerToken(req)
  if (!token) return NextResponse.json({ error: 'Sesión requerida' }, { status: 401 })

  const { data: authData, error: authError } = await admin.client.auth.getUser(token)
  if (authError || !authData.user) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })

  const { data: usuario } = await admin.client
    .from('usuarios')
    .select('id, rol')
    .eq('auth_user_id', authData.user.id)
    .in('rol', ['guardia', 'vigilador'])
    .maybeSingle()

  if (!usuario) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  // ── Body ─────────────────────────────────────────────────────────────────────
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Body inválido (se espera multipart/form-data)' }, { status: 400 })
  }

  const libro      = form.get('libro')      as Blob | null
  const uniforme   = form.get('uniforme')   as Blob | null
  const registroId = form.get('registroId') as string | null
  const turnoId    = form.get('turnoId')    as string | null
  const objetivoId = form.get('objetivoId') as string | null

  if (!libro || !uniforme || !registroId || !turnoId || !objetivoId) {
    return NextResponse.json(
      { error: 'Faltan campos: libro, uniforme, registroId, turnoId, objetivoId' },
      { status: 400 },
    )
  }

  // ── Verificar que el registro pertenece al guardia autenticado ────────────────
  const { data: registro } = await admin.client
    .from('registros_asistencia')
    .select('id, guardia_id')
    .eq('id', registroId)
    .eq('guardia_id', usuario.id)
    .maybeSingle()

  if (!registro) {
    return NextResponse.json(
      { error: 'Registro no encontrado o no pertenece al guardia autenticado' },
      { status: 404 },
    )
  }

  // ── Subir fotos al bucket con service_role ────────────────────────────────────
  // Paths determinísticos: mismo registroId → mismo path → upsert idempotente
  const pathLibro    = `${registroId}/libro_guardia.jpg`
  const pathUniforme = `${registroId}/uniforme.jpg`

  const [bufLibro, bufUniforme] = await Promise.all([
    libro.arrayBuffer().then(ab => Buffer.from(ab)),
    uniforme.arrayBuffer().then(ab => Buffer.from(ab)),
  ])

  const [upLibro, upUniforme] = await Promise.all([
    admin.client.storage
      .from('ingreso-evidencias')
      .upload(pathLibro, bufLibro, { upsert: true, contentType: 'image/jpeg' }),
    admin.client.storage
      .from('ingreso-evidencias')
      .upload(pathUniforme, bufUniforme, { upsert: true, contentType: 'image/jpeg' }),
  ])

  if (upLibro.error)    return NextResponse.json({ error: upLibro.error.message },    { status: 500 })
  if (upUniforme.error) return NextResponse.json({ error: upUniforme.error.message }, { status: 500 })

  // ── Registrar evidencias con service_role — idempotente por unique key ─────────
  // guardia_id es server-authoritative: viene del token, no del cliente.
  const { error: evidError } = await admin.client
    .from('evidencias')
    .upsert(
      [
        {
          proceso_tipo:    'ingreso',
          proceso_id:      registroId,
          turno_id:        turnoId,
          guardia_id:      usuario.id,
          objetivo_id:     objetivoId,
          tipo_evidencia:  'libro_guardia',
          bucket:          'ingreso-evidencias',
          storage_path:    pathLibro,
        },
        {
          proceso_tipo:    'ingreso',
          proceso_id:      registroId,
          turno_id:        turnoId,
          guardia_id:      usuario.id,
          objetivo_id:     objetivoId,
          tipo_evidencia:  'uniforme',
          bucket:          'ingreso-evidencias',
          storage_path:    pathUniforme,
        },
      ],
      { onConflict: 'proceso_tipo,proceso_id,tipo_evidencia' },
    )

  if (evidError) {
    // Las fotos ya se subieron. Se informa pero no se hace rollback del storage.
    return NextResponse.json(
      {
        pathLibro,
        pathUniforme,
        advertencia: `Fotos subidas pero no se registraron como evidencias: ${evidError.message}`,
      },
    )
  }

  return NextResponse.json({ pathLibro, pathUniforme })
}
