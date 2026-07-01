// POST /api/jwm/sync
// Sincroniza rondas JWM → rondas_jwm para todos los objetivos activos
// (o uno específico si se pasa objetivo_jwm_id en el body).
//
// Puede ser llamado:
// - manualmente desde el Centro Operativo (con Supabase session del usuario)
// - por el cron de Vercel (con CRON_SECRET en Authorization)
//
// El token JWM se obtiene de:
// 1. Tabla jwm_tokens (si existe uno vigente)
// 2. Variable JWM_BASE_TOKEN (fallback para bootstrap inicial)
// 3. Login automático con JWM_USERNAME / JWM_PASSWORD (si el token venció)

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin, requireRole } from '../../_lib/employee-auth'
import { fetchRondasJwm, tryJwmLogin, type JwmRawRecord } from '../_lib/jwm-client'

// Verifica que el request viene del cron de Vercel o de un admin autenticado.
async function authorize(req: NextRequest, admin: ReturnType<typeof getSupabaseAdmin>) {
  // Cron de Vercel incluye el header Authorization: Bearer <CRON_SECRET>
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = req.headers.get('authorization')
    if (authHeader === `Bearer ${cronSecret}`) return null  // autorizado
  }
  // Fallback: usuario admin autenticado
  if ('client' in admin) {
    return requireRole(req, admin.client, ['admin'], 'Se requiere admin o cron secret')
  }
  return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
}

async function getActiveToken(adminClient: ReturnType<typeof getSupabaseAdmin>): Promise<{
  token: string | null
  source: string
  expired: boolean
}> {
  if (!('client' in adminClient)) return { token: null, source: 'none', expired: true }
  const sb = adminClient.client

  // 1. Buscar token vigente en jwm_tokens
  const { data: tokenRow } = await sb
    .from('jwm_tokens')
    .select('token_value, expires_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (tokenRow) {
    const expired = new Date(tokenRow.expires_at) <= new Date()
    if (!expired) return { token: tokenRow.token_value, source: 'db', expired: false }
  }

  // 2. Intentar login automático con credenciales de env vars
  const username = process.env.JWM_USERNAME
  const password = process.env.JWM_PASSWORD
  const companyCode = process.env.JWM_COMPANY_CODE ?? 'mercosur'

  if (username && password) {
    const newToken = await tryJwmLogin(companyCode, username, password)
    if (newToken) {
      // Guardar token nuevo (expira en 24h)
      const expiresAt = new Date(Date.now() + 23.5 * 60 * 60 * 1000).toISOString()
      await sb.from('jwm_tokens').insert({
        token_value: newToken,
        expires_at: expiresAt,
        obtenido_por: 'auto',
      })
      return { token: newToken, source: 'auto_login', expired: false }
    }
  }

  // 3. Fallback: token de variable de entorno (para bootstrap inicial)
  const envToken = process.env.JWM_BASE_TOKEN
  if (envToken) return { token: envToken, source: 'env', expired: false }

  return { token: null, source: 'none', expired: true }
}

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if ('error' in admin) return NextResponse.json({ error: admin.error }, { status: 500 })

  const authError = await authorize(req, admin)
  if (authError) return authError

  const body = await req.json().catch(() => ({}))
  const objetivoJwmId: string | undefined = body?.objetivo_jwm_id
  // Rango de fechas: por defecto hoy + ayer (para no perder datos de tarde/noche)
  const horasAtras = Number(body?.horas_atras ?? 26)
  const beginTime = new Date(Date.now() - horasAtras * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19)
  const endTime = new Date().toISOString().replace('T', ' ').slice(0, 19)

  const { token, source, expired } = await getActiveToken(admin)

  if (!token || expired) {
    return NextResponse.json({
      error: 'TOKEN_REQUERIDO',
      message: 'El token JWM venció y no se pudo renovar automáticamente. Ingresá un token nuevo desde el Centro Operativo.',
      source,
    }, { status: 401 })
  }

  // Obtener mapeos activos
  let query = admin.client.from('objetivo_jwm_map').select('*').eq('activo', true)
  if (objetivoJwmId) query = query.eq('id', objetivoJwmId)
  const { data: mapeos, error: mapError } = await query
  if (mapError) return NextResponse.json({ error: mapError.message }, { status: 500 })
  if (!mapeos?.length) return NextResponse.json({ message: 'Sin mapeos activos', filas: 0 })

  const resultados = []

  for (const mapeo of mapeos) {
    // Insertar log de inicio
    const { data: logRow } = await admin.client
      .from('jwm_sync_log')
      .insert({ objetivo_jwm_id: mapeo.id, inicio: new Date().toISOString(), estado: 'en_progreso' })
      .select('id')
      .single()

    const logId = logRow?.id
    let filasNuevas = 0
    let estadoLog = 'ok'
    let errorDetalle: string | null = null

    try {
      const readercodes: string[] = mapeo.reader_codes ?? []
      // Si no hay reader_codes configurados, igual intentamos sin filtro
      const targets = readercodes.length > 0 ? readercodes : ['']

      const allRecords: JwmRawRecord[] = []
      for (const rc of targets) {
        const rows = await fetchRondasJwm(token, rc, beginTime, endTime)
        allRecords.push(...rows)
      }

      if (allRecords.length > 0) {
        const rowsToUpsert = allRecords.map(r => ({
          objetivo_id: mapeo.objetivo_id,
          dataid: r.rawdatasPK.dataid,
          fecha_hora: new Date(r.rawdatasPK.happentime.replace(' ', 'T') + '-03:00').toISOString(),
          checkpoint: r.eminfo || 'Sin nombre',
          checkpoint_code: r.emcode || null,
          dispositivo_id: r.readercode || null,
          estado: 'ok',
          raw_data: r,
        }))

        const { error: upsertError, count } = await admin.client
          .from('rondas_jwm')
          .upsert(rowsToUpsert, { onConflict: 'dataid', ignoreDuplicates: true, count: 'exact' })

        if (upsertError) throw new Error(upsertError.message)
        filasNuevas = count ?? 0
      }
    } catch (err: any) {
      estadoLog = err?.message?.includes('TOKEN_EXPIRED') ? 'error_token' : 'error_jwm'
      errorDetalle = err?.message ?? 'Error desconocido'
    }

    // Actualizar log con resultado
    if (logId) {
      await admin.client.from('jwm_sync_log').update({
        fin: new Date().toISOString(),
        filas_nuevas: filasNuevas,
        estado: estadoLog,
        error_detalle: errorDetalle,
      }).eq('id', logId)
    }

    resultados.push({
      empresa_jwm: mapeo.empresa_jwm,
      estado: estadoLog,
      filas_nuevas: filasNuevas,
      error: errorDetalle,
    })
  }

  return NextResponse.json({ ok: true, token_source: source, resultados })
}

// GET: usado por el cron de Vercel (Vercel crons llaman por GET con
// Authorization: Bearer <CRON_SECRET>).
export async function GET(req: NextRequest) {
  return POST(req)
}
