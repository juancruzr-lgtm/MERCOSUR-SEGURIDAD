/**
 * /api/push/cron — cierre automático de turnos + notificaciones.
 *
 * Se conserva tal como funcionaba, con dos diferencias:
 *
 *   · el envío de notificaciones ya no vive acá: se movió entero a
 *     app/api/_lib/push-notificaciones, que es el único lugar donde está
 *     implementada esa selección y su deduplicación. Esta ruta lo llama;
 *
 *   · se quitó la llamada a evaluar_ronda_alertas(). Esa función ya corre cada
 *     10 minutos por pg_cron (migración 20260810180000) y es la fuente
 *     autoritativa de ronda_alertas. Llamarla también desde acá era generar las
 *     alertas dos veces.
 *
 * ESTA RUTA NO ESTÁ PROGRAMADA. Sigue sin dispararse sola, a propósito:
 * cerrar_turnos_abiertos() modifica registros_asistencia y recalcula horas
 * liquidables, y encender eso es una decisión aparte de encender los avisos.
 *
 * Para las notificaciones periódicas existe /api/push/notificaciones, que no
 * toca asistencia ni horas y es la que dispara pg_cron.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import { enviarNotificaciones } from '../../_lib/push-notificaciones'

export const runtime = 'nodejs'

// Misma razón que en /api/push/notificaciones: el ciclo completo de envíos en
// serie no entra en los 10 segundos del default de Vercel.
export const maxDuration = 60

// Misma razón que en /api/push/notificaciones: sin esto, Next 14 cachea los GET
// de Supabase y la deduplicación deja de ver lo que ella misma acaba de escribir.
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

function authOk(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) return { ok: false, error: 'Falta CRON_SECRET' }
  const header = req.headers.get('authorization') || ''
  return header === `Bearer ${expected}`
    ? { ok: true }
    : { ok: false, error: 'Cron no autorizado' }
}

export async function GET(req: NextRequest) {
  const auth = authOk(req)
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.error === 'Falta CRON_SECRET' ? 500 : 401 },
    )
  }

  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  // Cierra los turnos que terminaron sin salida registrada y les calcula las
  // horas. Es lo que distingue a esta ruta de /api/push/notificaciones.
  let cierreAutomatico: { registros_cerrados: number; detalle: string } | null = null
  try {
    const { data, error } = await admin.client.rpc('cerrar_turnos_abiertos')
    if (error) {
      console.error('[cron] cerrar_turnos_abiertos error:', error.message)
    } else if (data && (data as any[]).length > 0) {
      cierreAutomatico = (data as any[])[0]
      if (cierreAutomatico && cierreAutomatico.registros_cerrados > 0) {
        console.log('[cron] cierre automático:', cierreAutomatico.detalle)
      }
    }
  } catch (e) {
    console.error('[cron] cerrar_turnos_abiertos excepción:', e)
  }

  const resultado = await enviarNotificaciones(admin.client)
  return NextResponse.json(
    { ...resultado, cierreAutomatico },
    { status: resultado.ok === false ? 500 : 200 },
  )
}
