// POST /api/jwm/sync
// Sincroniza rondas JWM → rondas_jwm.
//
// Modos de uso:
// 1. Cron Vercel: GET con Authorization: Bearer <CRON_SECRET>
//    → usa token almacenado en DB o auto-login con env vars
// 2. Manual desde UI (admin): POST con session token de Supabase
//    → puede incluir { username, password, company_code } para login fresco
//    → puede incluir { token } para usar un JWT directo
//    → puede incluir { fecha_desde, fecha_hasta } para rango personalizado
//    → puede incluir { objetivo_id } para filtrar un solo objetivo

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin, requireRole } from '../../_lib/employee-auth'
import { fetchRondasJwm, tryJwmLogin, type JwmRawRecord } from '../_lib/jwm-client'

async function authorize(req: NextRequest, admin: ReturnType<typeof getSupabaseAdmin>) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const authHeader = req.headers.get('authorization')
    if (authHeader === `Bearer ${cronSecret}`) return null
  }
  if ('client' in admin) {
    return requireRole(req, admin.client, ['admin'], 'Se requiere admin o cron secret')
  }
  return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
}

async function getActiveToken(
  adminClient: ReturnType<typeof getSupabaseAdmin>,
  overrideToken?: string,
  credentials?: { username: string; password: string; companyCode: string },
): Promise<{ token: string | null; source: string; expired: boolean }> {
  if (!('client' in adminClient)) return { token: null, source: 'none', expired: true }
  const sb = adminClient.client

  // 1. Token explícito enviado por el usuario desde la UI
  if (overrideToken) {
    return { token: overrideToken, source: 'ui_token', expired: false }
  }

  // 2. Login con credenciales enviadas desde la UI
  if (credentials?.username && credentials?.password) {
    const newToken = await tryJwmLogin(credentials.companyCode, credentials.username, credentials.password)
    if (newToken) {
      const expiresAt = new Date(Date.now() + 23.5 * 60 * 60 * 1000).toISOString()
      await sb.from('jwm_tokens').insert({ token_value: newToken, expires_at: expiresAt, obtenido_por: 'auto' })
      return { token: newToken, source: 'login_ui', expired: false }
    }
    // Login falló (probablemente CAPTCHA)
    return { token: null, source: 'login_failed', expired: true }
  }

  // 3. Token vigente en DB
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

  // 4. Auto-login con env vars
  const username = process.env.JWM_USERNAME
  const password = process.env.JWM_PASSWORD
  const companyCode = process.env.JWM_COMPANY_CODE ?? 'mercosur'
  if (username && password) {
    const newToken = await tryJwmLogin(companyCode, username, password)
    if (newToken) {
      const expiresAt = new Date(Date.now() + 23.5 * 60 * 60 * 1000).toISOString()
      await sb.from('jwm_tokens').insert({ token_value: newToken, expires_at: expiresAt, obtenido_por: 'auto' })
      return { token: newToken, source: 'auto_login', expired: false }
    }
  }

  // 5. Fallback: token de env var
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

  // Credenciales opcionales desde UI
  const uiToken: string | undefined = body?.token
  const uiUsername: string | undefined = body?.username
  const uiPassword: string | undefined = body?.password
  const uiCompany: string = body?.company_code ?? process.env.JWM_COMPANY_CODE ?? 'mercosur'

  // Rango de fechas: personalizado o por defecto últimas 26h
  let beginTime: string
  let endTime: string
  if (body?.fecha_desde && body?.fecha_hasta) {
    beginTime = `${body.fecha_desde} 00:00:00`
    endTime   = `${body.fecha_hasta} 23:59:59`
  } else {
    const horasAtras = Number(body?.horas_atras ?? 26)
    beginTime = new Date(Date.now() - horasAtras * 60 * 60 * 1000)
      .toISOString().replace('T', ' ').slice(0, 19)
    endTime = new Date().toISOString().replace('T', ' ').slice(0, 19)
  }

  const credentials = uiUsername && uiPassword
    ? { username: uiUsername, password: uiPassword, companyCode: uiCompany }
    : undefined

  const { token, source, expired } = await getActiveToken(admin, uiToken, credentials)

  if (!token || expired) {
    // Login intentado pero falló → CAPTCHA probable
    if (source === 'login_failed') {
      return NextResponse.json({
        error: 'LOGIN_FAILED',
        message: 'No se pudo iniciar sesión en JWM (posible CAPTCHA). Ingresá el token manualmente.',
      }, { status: 401 })
    }
    return NextResponse.json({
      error: 'TOKEN_REQUERIDO',
      message: 'No hay token JWM activo. Usá el botón "Recopilar datos" e ingresá tus credenciales.',
    }, { status: 401 })
  }

  // Filtrar por objetivo_id si se especificó
  const objetivoId: string | undefined = body?.objetivo_id
  let query = admin.client.from('objetivo_jwm_map').select('*').eq('activo', true)
  if (objetivoId) query = query.eq('objetivo_id', objetivoId)
  const { data: mapeos, error: mapError } = await query
  if (mapError) return NextResponse.json({ error: mapError.message }, { status: 500 })
  if (!mapeos?.length) return NextResponse.json({ message: 'Sin mapeos activos para este objetivo', filas: 0 })

  const resultados = []

  for (const mapeo of mapeos) {
    const { data: logRow } = await admin.client
      .from('jwm_sync_log')
      .insert({ objetivo_jwm_id: mapeo.id, inicio: new Date().toISOString(), estado: 'en_progreso' })
      .select('id').single()

    const logId = logRow?.id
    let filasNuevas = 0
    let estadoLog = 'ok'
    let errorDetalle: string | null = null

    try {
      const readercodes: string[] = mapeo.reader_codes ?? []
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

// GET: cron de Vercel
export async function GET(req: NextRequest) {
  return POST(req)
}
