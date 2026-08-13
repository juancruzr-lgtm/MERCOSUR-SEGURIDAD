/**
 * /api/push/notificaciones — envío de notificaciones, y NADA MÁS.
 *
 * Este es el endpoint que dispara pg_cron cada 10 minutos vía pg_net.
 *
 * NO cierra turnos. NO modifica registros_asistencia. NO recalcula horas
 * liquidables. NO toca liquidación. NO llama a evaluar_ronda_alertas(), que ya
 * corre por su cuenta cada 10 minutos y es la única fuente de ronda_alertas.
 *
 * Lo único que escribe es notificaciones_enviadas —su propio registro de envío,
 * que es lo que evita mandar dos veces lo mismo— y da de baja suscripciones
 * cuando el servicio push responde 404 o 410.
 *
 * El cierre automático de turnos sigue viviendo en /api/push/cron, separado a
 * propósito: encender los avisos no debe tener efectos sobre asistencia ni
 * sobre horas.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import { enviarNotificaciones } from '../../_lib/push-notificaciones'

export const runtime = 'nodejs'

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

  // ?solo_usuario=<id> limita la corrida entera a ese destinatario: es la prueba
  // controlada previa a encender el cron. Se lee DESPUÉS de validar CRON_SECRET,
  // así que sin el token no hay forma de dirigir un envío a nadie.
  //
  // Sin el parámetro el comportamiento es el global de siempre: soloUsuarioId
  // queda en null y no se filtra nada.
  const soloUsuarioId = req.nextUrl.searchParams.get('solo_usuario')

  const resultado = await enviarNotificaciones(admin.client, { soloUsuarioId })
  return NextResponse.json(resultado, { status: resultado.ok === false ? 500 : 200 })
}
