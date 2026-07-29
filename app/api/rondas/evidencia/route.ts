import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, getSupabaseAdmin } from '../../_lib/employee-auth'

export const runtime = 'nodejs'

const BUCKET = 'ronda-evidencias'
const MAX_FOTO_BYTES = 5 * 1024 * 1024
const MIME_PERMITIDOS = new Set(['image/jpeg', 'image/png', 'image/webp'])
const POLITICAS_FOTO_VALIDAS = new Set(['obligatoria', 'opcional', 'solo_novedad'])
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function firmaImagenValida(buffer: Buffer, mime: string): boolean {
  if (mime === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  }
  if (mime === 'image/png') {
    return buffer.length >= 8
      && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }
  if (mime === 'image/webp') {
    return buffer.length >= 12
      && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  }
  return false
}

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const token = getBearerToken(req)
  if (!token) return NextResponse.json({ error: 'Sesión requerida' }, { status: 401 })

  const { data: authData, error: authError } = await admin.client.auth.getUser(token)
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })
  }

  const { data: usuario, error: usuarioError } = await admin.client
    .from('usuarios')
    .select('id, rol, estado')
    .eq('auth_user_id', authData.user.id)
    .maybeSingle()

  if (usuarioError) return NextResponse.json({ error: usuarioError.message }, { status: 500 })
  if (!usuario || !['guardia', 'vigilador'].includes(usuario.rol) || usuario.estado !== 'activo') {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json(
      { error: 'Body inválido (se espera multipart/form-data)' },
      { status: 400 },
    )
  }

  const ejecucionPuntoId = form.get('ejecucionPuntoId')
  const foto = form.get('foto')

  if (typeof ejecucionPuntoId !== 'string' || !UUID_RE.test(ejecucionPuntoId)) {
    return NextResponse.json({ error: 'Punto de ejecución inválido' }, { status: 400 })
  }
  if (!(foto instanceof Blob) || foto.size <= 0) {
    return NextResponse.json({ error: 'Foto requerida' }, { status: 400 })
  }
  if (foto.size > MAX_FOTO_BYTES) {
    return NextResponse.json({ error: 'La foto supera el límite de 5 MB' }, { status: 413 })
  }
  if (!MIME_PERMITIDOS.has(foto.type)) {
    return NextResponse.json({ error: 'Formato de imagen no permitido' }, { status: 415 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json({ error: 'Configuración de Supabase incompleta' }, { status: 500 })
  }

  // Ejecuta la misma definición autoritativa de turno vigente que usan las RPC.
  const usuarioClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data: turnosVigentes, error: turnoError } = await usuarioClient.rpc('rondas_turno_vigente')
  if (turnoError) return NextResponse.json({ error: turnoError.message }, { status: 500 })

  const turnoVigente = Array.isArray(turnosVigentes) ? turnosVigentes[0] : null
  if (!turnoVigente?.turno_id) {
    return NextResponse.json({ error: 'No tenés un turno vigente' }, { status: 409 })
  }

  const { data: punto, error: puntoError } = await admin.client
    .from('ronda_ejecucion_puntos')
    .select('id, ronda_ejecucion_id, estado, snap_politica_foto')
    .eq('id', ejecucionPuntoId)
    .maybeSingle()

  if (puntoError) return NextResponse.json({ error: puntoError.message }, { status: 500 })
  if (!punto) return NextResponse.json({ error: 'Punto no encontrado' }, { status: 404 })

  const { data: ejecucion, error: ejecucionError } = await admin.client
    .from('ronda_ejecuciones')
    .select('id, turno_id, guardia_id, objetivo_id, estado')
    .eq('id', punto.ronda_ejecucion_id)
    .maybeSingle()

  if (ejecucionError) return NextResponse.json({ error: ejecucionError.message }, { status: 500 })
  if (
    !ejecucion
    || ejecucion.guardia_id !== usuario.id
    || ejecucion.turno_id !== turnoVigente.turno_id
  ) {
    return NextResponse.json(
      { error: 'El punto no pertenece a tu ejecución vigente' },
      { status: 403 },
    )
  }
  if (ejecucion.estado !== 'en_curso' || punto.estado !== 'pendiente') {
    return NextResponse.json({ error: 'El punto ya no está pendiente' }, { status: 409 })
  }
  // Con la política de foto por punto ya no hay un caso donde la foto esté
  // prohibida: `opcional` y `solo_novedad` la aceptan igual, y esa evidencia se
  // registra. Quien decide si además BLOQUEA el avance es registrar_punto_ronda,
  // que evalúa la política del snapshot junto con la novedad declarada.
  if (!POLITICAS_FOTO_VALIDAS.has(punto.snap_politica_foto as string)) {
    return NextResponse.json({ error: 'La política de foto del punto no es válida' }, { status: 409 })
  }

  const { data: primerPendiente, error: secuenciaError } = await admin.client
    .from('ronda_ejecucion_puntos')
    .select('id')
    .eq('ronda_ejecucion_id', ejecucion.id)
    .eq('estado', 'pendiente')
    .order('orden', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (secuenciaError) return NextResponse.json({ error: secuenciaError.message }, { status: 500 })
  if (primerPendiente?.id !== punto.id) {
    return NextResponse.json(
      { error: 'Tenés que completar primero el punto actual' },
      { status: 409 },
    )
  }

  const storagePath = `${ejecucion.id}/${punto.id}/punto`
  const buffer = Buffer.from(await foto.arrayBuffer())
  if (!firmaImagenValida(buffer, foto.type)) {
    return NextResponse.json(
      { error: 'El contenido del archivo no coincide con una imagen válida' },
      { status: 415 },
    )
  }

  const { error: uploadError } = await admin.client.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      upsert: true,
      contentType: foto.type,
      cacheControl: '0',
    })

  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  // El trigger de base reemplaza turno/guardia/objetivo por los valores
  // autoritativos de la ejecución y verifica que el objeto exista en Storage.
  const { data: evidencia, error: evidenciaError } = await admin.client
    .from('evidencias')
    .upsert(
      {
        proceso_tipo: 'ronda',
        proceso_id: punto.id,
        turno_id: ejecucion.turno_id,
        guardia_id: usuario.id,
        objetivo_id: ejecucion.objetivo_id,
        tipo_evidencia: 'punto_control',
        bucket: BUCKET,
        storage_path: storagePath,
      },
      { onConflict: 'proceso_tipo,proceso_id,tipo_evidencia' },
    )
    .select('id, proceso_id, bucket, storage_path, created_at')
    .single()

  if (evidenciaError) {
    // El path es determinístico: un reintento vuelve a usar el mismo objeto y
    // puede reconciliar la fila sin generar archivos huérfanos adicionales.
    return NextResponse.json(
      { error: `La foto se subió pero no pudo registrarse: ${evidenciaError.message}` },
      { status: 500 },
    )
  }

  return NextResponse.json({ evidencia })
}
