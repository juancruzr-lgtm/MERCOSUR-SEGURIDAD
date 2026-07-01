// POST /api/jwm/sync
// Importa rondas JWM para un objetivo y rango de fechas dado.
//
// El token JWM lo pega el usuario desde el sistema externo.
// No se guarda. No se renueva. Se usa solo para esta request.
//
// Body: { token, fecha_desde, fecha_hasta, objetivo_id }
// Requiere sesión de usuario admin.

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin, requireRole } from '../../_lib/employee-auth'
import { fetchRondasJwm, type JwmRawRecord } from '../_lib/jwm-client'

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if ('error' in admin) return NextResponse.json({ error: admin.error }, { status: 500 })

  const authError = await requireRole(req, admin.client, ['admin'])
  if (authError) return authError

  const body = await req.json().catch(() => ({}))
  const token: string | undefined = body?.token
  const fechaDesde: string | undefined = body?.fecha_desde
  const fechaHasta: string | undefined = body?.fecha_hasta
  const objetivoId: string | undefined = body?.objetivo_id

  if (!token) {
    return NextResponse.json({
      error: 'TOKEN_REQUERIDO',
      message: 'Pegá el token de JWM para importar los datos.',
    }, { status: 401 })
  }

  if (!fechaDesde || !fechaHasta) {
    return NextResponse.json({ error: 'Fechas requeridas (fecha_desde, fecha_hasta).' }, { status: 400 })
  }

  const beginTime = `${fechaDesde} 00:00:00`
  const endTime   = `${fechaHasta} 23:59:59`

  // Obtener mapeos activos para este objetivo
  let query = admin.client.from('objetivo_jwm_map').select('*').eq('activo', true)
  if (objetivoId) query = query.eq('objetivo_id', objetivoId)
  const { data: mapeos, error: mapError } = await query
  if (mapError) return NextResponse.json({ error: mapError.message }, { status: 500 })
  if (!mapeos?.length) return NextResponse.json({ message: 'Sin mapeos activos para este objetivo', filas: 0 })

  let totalNuevos = 0
  const resultados = []

  for (const mapeo of mapeos) {
    let filasNuevas = 0
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
        totalNuevos += filasNuevas
      }
    } catch (err: any) {
      errorDetalle = err?.message ?? 'Error desconocido'
    }

    resultados.push({
      empresa_jwm: mapeo.empresa_jwm,
      filas_nuevas: filasNuevas,
      error: errorDetalle,
    })
  }

  return NextResponse.json({ ok: true, filas_nuevas: totalNuevos, resultados })
}
