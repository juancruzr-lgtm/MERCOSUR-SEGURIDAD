/**
 * /api/push/agenda-supervisores — aviso PREVENTIVO de programación incompleta.
 *
 * QUÉ HACE
 * Mira la programación de supervisores de guardia de MAÑANA y, si quedan
 * franjas horarias sin nadie, manda UN push por destinatario a la lista de
 * escalamiento (jefe de supervisores + dirección). No toca datos: sólo avisa.
 *
 * POR QUÉ EXISTE
 * Octubre 2026 arrancó con la programación a medias: el 03/10 no hubo guardia
 * diurna y las alertas de ronda no tuvieron a quién escalarse por WhatsApp
 * durante horas (hasta 18). El fallback a jefes tapa el agujero cuando ocurre;
 * este aviso busca que directamente no ocurra.
 *
 * CUÁNDO CORRE
 * Una vez por día a la tarde (pg_cron), con tiempo para completar la agenda
 * antes de la medianoche. Deduplicación por (usuario, agenda_supervisores:fecha):
 * aunque el cron corriera de nuevo, el aviso del día sale una sola vez.
 *
 * CÓMO SE LLAMA
 *   · pg_cron → Authorization: Bearer <push_cron_secret>, y manda de verdad.
 *   · una persona de Administración autenticada → sólo `?simular=1`, que
 *     devuelve las franjas y a quién avisaría sin mandar nada.
 *   · `?fecha=YYYY-MM-DD` (sólo con simular) revisa otro día que mañana.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import { requireAdminIA } from '../../ia/_lib/auth'
import { sendWebPush } from '../../_lib/web-push'
import type { PushPayload, PushSubscriptionRow } from '../../_lib/web-push'
import { franjasDescubiertas, textoFranjas } from '@/lib/agenda-supervisores'
import { sumarDiasFecha } from '@/lib/turnos'

export const runtime = 'nodejs'
export const maxDuration = 60

// Sin esto Next 14 cachea los GET de Supabase y la deduplicación deja de ver
// lo que ella misma acaba de escribir. Mismo arreglo que el resto de push.
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

/** Misma llave que el resto de los push de sólo-aviso (en minúsculas: Vercel). */
function cronAutorizado(req: NextRequest): boolean {
  const expected = process.env.push_cron_secret
  if (!expected) return false
  return (req.headers.get('authorization') || '') === `Bearer ${expected}`
}

function fechaLocalHoy(ahora: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ahora)
}

export async function GET(req: NextRequest) {
  const simular = req.nextUrl.searchParams.get('simular') === '1'
  const esCron = cronAutorizado(req)

  if (!esCron) {
    if (!simular) return NextResponse.json({ error: 'Cron no autorizado' }, { status: 401 })
    const ctx = await requireAdminIA(req)
    if (!ctx.ok) return (ctx as { respuesta: NextResponse }).respuesta
  }

  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })
  const client = admin.client

  const hoy = fechaLocalHoy(new Date())
  const fechaPedida = req.nextUrl.searchParams.get('fecha')
  const fecha = (simular && fechaPedida) ? fechaPedida : sumarDiasFecha(hoy, 1)
  const fechaAnterior = sumarDiasFecha(fecha, -1)

  const guardiasRes = await client.from('supervisores_guardia')
    .select('fecha, hora_inicio, hora_fin, estado')
    .in('fecha', [fechaAnterior, fecha])
  if (guardiasRes.error) {
    return NextResponse.json({ error: guardiasRes.error.message }, { status: 500 })
  }

  const franjas = franjasDescubiertas((guardiasRes.data ?? []) as any[], fecha, fechaAnterior)
  if (franjas.length === 0) {
    return NextResponse.json({ fecha, cubierto: true, enviados: 0 })
  }

  // A quién: la lista de escalamiento (jefe de supervisores + dirección), la
  // misma del +30. Nunca por rol suelto.
  const destRes = await client.from('escalamiento_destinatarios')
    .select('usuario_id, activo').eq('activo', true)
  if (destRes.error) return NextResponse.json({ error: destRes.error.message }, { status: 500 })
  const destinatarios = Array.from(new Set(
    ((destRes.data ?? []) as any[]).map(d => d.usuario_id).filter(Boolean),
  ))
  if (destinatarios.length === 0) {
    return NextResponse.json({ fecha, franjas, error: 'SIN_LISTA_DE_ESCALAMIENTO' }, { status: 200 })
  }

  const clave = `agenda_supervisores:${fecha}`
  const detalle = textoFranjas(franjas)
  const payload: PushPayload = {
    title: 'Guardia de supervisores incompleta',
    body: `El ${fecha} queda sin supervisor de guardia: ${detalle}. Completar la programación.`,
    url: '/dashboard',
    tag: clave,
  }

  // Deduplicación por usuario y día objetivo.
  const yaRes = await client.from('notificaciones_enviadas')
    .select('usuario_id').eq('tipo', clave).in('usuario_id', destinatarios)
  const yaAvisados = new Set(((yaRes.data ?? []) as any[]).map(n => n.usuario_id))
  const pendientes = destinatarios.filter(id => !yaAvisados.has(id))

  if (!esCron) {
    return NextResponse.json({
      modo: 'SIMULACION', fecha, franjas, detalle,
      avisaria_a: pendientes, ya_avisados: Array.from(yaAvisados),
    })
  }

  const subsRes = pendientes.length
    ? await client.from('push_subscriptions')
        .select('id, usuario_id, endpoint, p256dh, auth')
        .eq('activo', true).in('usuario_id', pendientes)
    : { data: [] as any[], error: null }
  if (subsRes.error) return NextResponse.json({ error: subsRes.error.message }, { status: 500 })
  const subscriptions = (subsRes.data ?? []) as PushSubscriptionRow[]

  let enviados = 0
  let sinSuscripcion = 0
  for (const usuarioId of pendientes) {
    const suyas = subscriptions.filter(s => s.usuario_id === usuarioId)
    if (suyas.length === 0) { sinSuscripcion += 1; continue }

    let entregado = false
    for (const subscription of suyas) {
      // Aislado por suscripción: un endpoint muerto no corta la corrida.
      try {
        const r = await sendWebPush(subscription, payload)
        if (r.status === 404 || r.status === 410) {
          await client.from('push_subscriptions').update({ activo: false }).eq('id', subscription.id)
        } else {
          entregado = true
        }
      } catch (e) {
        console.error('[agenda-supervisores] suscripción', subscription.id, e instanceof Error ? e.message : e)
      }
    }

    // Sin entrega no se marca: la próxima corrida reintenta.
    if (!entregado) { sinSuscripcion += 1; continue }

    const { error } = await client.from('notificaciones_enviadas').insert({
      usuario_id: usuarioId, turno_id: null, objetivo_id: null,
      tipo: clave, titulo: payload.title, mensaje: payload.body,
    })
    if (error && !/duplicate key/i.test(error.message)) {
      console.error('[agenda-supervisores] dedup', error.message)
    }
    enviados += 1
  }

  return NextResponse.json({
    modo: 'ENVIO_REAL', fecha, franjas, detalle,
    destinatarios: destinatarios.length, enviados, sinSuscripcion,
    yaAvisados: yaAvisados.size,
  })
}
