/**
 * /api/push/cierre-operativo — un aviso de resumen por responsable y por día.
 *
 * ESTA RUTA NO ESTÁ PROGRAMADA, igual que /api/push/cron. Encenderla es una
 * decisión aparte: hoy salen unos veinte avisos diarios y sumar uno más tiene
 * que ser algo que se decida a propósito, no un efecto de haberla creado.
 * Cuando se decida, se agenda con pg_cron al horario de relevo, como está
 * hecho en la migración 20260813180000.
 *
 * Qué manda: lo que le queda a cada responsable antes de cerrar la guardia —
 * pendientes de hoy y arrastre de días anteriores— en UN solo aviso.
 *
 * De dónde sale: exactamente de las mismas funciones que muestra la pantalla
 * (lib/cierre-datos + lib/cierre-operativo), con el cliente de servidor
 * inyectado. No hay una segunda definición de "qué está pendiente": si la
 * hubiera, el aviso y la pantalla dirían números distintos.
 *
 * A quién: a quien resuelve lib/responsables-operativos con la fecha y hora
 * DEL HECHO. Nunca por rol: un admin asignado a la guardia recibe igual, y un
 * supervisor sin asignación no recibe. Eso ya se eliminó una vez del ruteo de
 * push y volver a meterlo sería una regresión.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import { enviarResumenCierre } from '../../_lib/push-notificaciones'
import type { PushSubscriptionRow } from '../../_lib/web-push'
import { cargarItemsCierre, fechaOperativaHoy } from '@/lib/cierre-datos'
import { cierreDeResponsable, textoPushCierre } from '@/lib/cierre-operativo'

export const runtime = 'nodejs'

// El ciclo completo de envíos en serie no entra en los 10 segundos del default
// de Vercel. Misma razón que /api/push/notificaciones.
export const maxDuration = 60

// Sin esto Next 14 cachea los GET de Supabase y la deduplicación deja de ver lo
// que ella misma acaba de escribir.
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
  const client = admin.client

  // `simular=1` calcula y responde a quién le saldría qué, sin mandar nada.
  // Es la forma de mirar el aviso antes de encenderlo.
  const simular = req.nextUrl.searchParams.get('simular') === '1'
  const fecha = req.nextUrl.searchParams.get('fecha') || fechaOperativaHoy()
  const mes = fecha.slice(0, 7)

  // Alcance completo (esAdmin) a propósito: el recorte por responsable lo hace
  // después cierreDeResponsable, con la asignación de cada hecho. Recortar
  // antes por zona dejaría afuera lo que le toca a otro.
  const cierre = await cargarItemsCierre({
    mes, fechaOperativa: fecha, esAdmin: true, usuarioId: null, client,
  })
  if (cierre.error) return NextResponse.json({ error: cierre.error }, { status: 500 })

  const [usuariosR, guardiasR, zonasR, supZonasR, subsR] = await Promise.all([
    client.from('usuarios').select('id, nombre, apellido, rol, estado').eq('estado', 'activo'),
    client.from('supervisores_guardia')
      .select('supervisor_id, zona, fecha, hora_inicio, hora_fin, estado, tipo_evento, rol_operativo')
      .gte('fecha', `${mes}-01`).lte('fecha', `${mes}-31`),
    client.from('zonas_operativas').select('id, nombre'),
    client.from('supervisor_zonas').select('supervisor_id, zona_id'),
    client.from('push_subscriptions')
      .select('id, usuario_id, endpoint, p256dh, auth').eq('activo', true),
  ])

  const usuarios = (usuariosR.data ?? []) as any[]
  const catalogos = {
    guardias:        (guardiasR.data ?? []) as any[],
    supervisorZonas: (supZonasR.data ?? []) as any[],
    zonas:           (zonasR.data ?? []) as any[],
    usuarios,
  }

  // Un destinatario por persona con algo que decidir. Quien no tiene nada
  // pendiente no recibe: el aviso "estás al día" que nadie pidió es ruido.
  const destinatarios = usuarios
    .map(u => {
      const suyo = cierreDeResponsable(cierre.items, u.id, fecha, catalogos)
      return { usuarioId: u.id as string, cierre: suyo }
    })
    .filter(d => d.cierre.hoy.total + d.cierre.anteriores.total > 0)
    .map(d => {
      const { titulo, cuerpo } = textoPushCierre(d.cierre)
      return {
        usuarioId: d.usuarioId,
        payload: { title: titulo, body: cuerpo, url: '/dashboard' },
      }
    })

  if (simular) {
    return NextResponse.json({
      ok: true,
      simulado: true,
      fecha,
      items: cierre.items.length,
      destinatarios: destinatarios.map(d => ({
        usuario_id: d.usuarioId,
        titulo: d.payload.title,
        mensaje: d.payload.body,
      })),
    })
  }

  const resultado = await enviarResumenCierre(
    client,
    (subsR.data ?? []) as PushSubscriptionRow[],
    destinatarios,
    fecha,
  )

  return NextResponse.json({ ok: true, fecha, items: cierre.items.length, ...resultado })
}
