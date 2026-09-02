/**
 * /api/push/evaluacion-publicada — avisar que la evaluación del mes está disponible.
 *
 * QUÉ MANDA
 * Que su evaluación está publicada y dónde verla. **Nunca la nota.** Una nota en
 * la pantalla de bloqueo del teléfono la puede leer cualquiera que pase al lado,
 * y una calificación es un dato entre la empresa y la persona.
 *
 * A QUIÉN
 * Sólo usuarios ACTIVOS con evaluación PUBLICADA de ese período. Un inactivo no
 * recupera acceso por recibir un aviso: la RLS no lo dejaría abrirla, así que
 * mandarle el mensaje sería mandarlo a una puerta cerrada.
 *
 * DEDUPLICACIÓN
 * `notificaciones_enviadas` con tipo `evaluacion_publicada:<período>`. Se
 * consulta antes de mandar: correr la ruta dos veces no vuelve a escribirle a
 * quien ya recibió el aviso de ese mes.
 *
 * POR QUÉ NO ES UNA RUTA DE CRON
 * Las otras rutas de push exigen el secreto de cron para el envío real y sólo
 * dejan simular a Administración: son procesos periódicos, y un disparo humano
 * accidental sería un mensaje repetido a todos. Ésta es al revés —un anuncio que
 * se manda una vez, cuando una persona decide publicar el mes—, así que la
 * autoriza Administración y exige `?enviar=1` explícito. Sin ese parámetro
 * simula: cuenta a quién le llegaría y no manda nada.
 *
 * QUÉ NO TOCA
 * Ni notas, ni snapshot, ni el estado de la evaluación. Escribe una fila por
 * envío en `notificaciones_enviadas`, y desactiva las suscripciones que el
 * servicio push reporta como vencidas.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import { requireAdminIA } from '../../ia/_lib/auth'
import { sendWebPush } from '../../_lib/web-push'
import type { PushPayload, PushSubscriptionRow } from '../../_lib/web-push'

export const dynamic = 'force-dynamic'

const TITULO = 'Mercosur · Tu evaluación'

const cuerpoDelAviso = (periodoLegible: string) =>
  `Tu evaluación de ${periodoLegible} ya está disponible. Entrá a Mi Legajo → `
  + 'Mi Desempeño para consultar tu calificación y las recomendaciones del '
  + 'Entrenador Operativo.'

const MES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function periodoLegible(periodo: string): string {
  const [a, m] = periodo.split('-')
  return MES[Number(m) - 1] ? `${MES[Number(m) - 1]} de ${a}` : periodo
}

function cronAutorizado(req: NextRequest): boolean {
  const expected = process.env.push_cron_secret
  if (!expected) return false
  return (req.headers.get('authorization') || '') === `Bearer ${expected}`
}

export async function GET(req: NextRequest) {
  const enviar = req.nextUrl.searchParams.get('enviar') === '1'
  const periodo = req.nextUrl.searchParams.get('periodo') || ''
  const soloEmpleado = req.nextUrl.searchParams.get('empleado')

  if (!/^\d{4}-\d{2}$/.test(periodo)) {
    return NextResponse.json({ error: 'Falta ?periodo=YYYY-MM' }, { status: 400 })
  }

  // Administración o cron. A diferencia de las rutas periódicas, acá el envío
  // real lo puede disparar Administración: es un anuncio, no un proceso.
  if (!cronAutorizado(req)) {
    const ctx = await requireAdminIA(req)
    if (!ctx.ok) return (ctx as { respuesta: NextResponse }).respuesta
  }

  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })
  const client = admin.client

  // ── Destinatarios ─────────────────────────────────────────────────────────
  const evalR = await client
    .from('evaluaciones_mensuales')
    .select('id, empleado_id')
    .eq('periodo', periodo)
    .eq('estado', 'publicada')
  if (evalR.error) return NextResponse.json({ error: evalR.error.message }, { status: 500 })

  const publicadas = (evalR.data ?? []) as { id: string; empleado_id: string }[]
  const ids = publicadas.map(e => e.empleado_id)
  if (ids.length === 0) {
    return NextResponse.json({ periodo, publicadas: 0, activos: 0, enviadas: 0 })
  }

  const [usuariosR, subsR, previosR, lecturasR] = await Promise.all([
    client.from('usuarios').select('id, nombre, apellido, estado, auth_user_id').in('id', ids),
    client.from('push_subscriptions').select('id, usuario_id, endpoint, p256dh, auth')
      .eq('activo', true).in('usuario_id', ids),
    client.from('notificaciones_enviadas').select('usuario_id')
      .eq('tipo', `evaluacion_publicada:${periodo}`),
    client.from('lecturas_evaluacion').select('empleado_id').eq('periodo', periodo),
  ])
  for (const r of [usuariosR, subsR, previosR, lecturasR]) {
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
  }

  // Un inactivo no puede abrir su evaluación —la RLS lo corta— así que avisarle
  // sería mandarlo a una puerta cerrada.
  const activos = new Map<string, string>()
  for (const u of (usuariosR.data ?? []) as any[]) {
    if (u.estado !== 'activo' || !u.auth_user_id) continue
    activos.set(String(u.id), `${u.apellido ?? ''}, ${u.nombre ?? ''}`.replace(/^, |, $/, ''))
  }

  const subs = (subsR.data ?? []) as PushSubscriptionRow[]
  const conSuscripcion = new Set(subs.map(s => s.usuario_id))
  const yaAvisados = new Set((previosR.data ?? []).map((p: any) => String(p.usuario_id)))
  const vistasAntes = new Set((lecturasR.data ?? []).map((l: any) => String(l.empleado_id)))

  const candidatos = publicadas
    .filter(e => activos.has(e.empleado_id))
    .filter(e => !soloEmpleado || e.empleado_id === soloEmpleado)

  const resumen = {
    periodo,
    publicadas: publicadas.length,
    activosConPublicada: candidatos.length,
    conPushValida: candidatos.filter(e => conSuscripcion.has(e.empleado_id)).length,
    sinSuscripcion: candidatos.filter(e => !conSuscripcion.has(e.empleado_id)).length,
    yaAvisados: candidatos.filter(e => yaAvisados.has(e.empleado_id)).length,
    vistasAntes: vistasAntes.size,
    enviadas: 0,
    fallidas: 0,
    simulado: !enviar,
    // Los que no van a recibir nada por push: el aviso dentro de la app es lo
    // único que les llega.
    nombresSinSuscripcion: candidatos
      .filter(e => !conSuscripcion.has(e.empleado_id))
      .map(e => activos.get(e.empleado_id) ?? e.empleado_id)
      .sort(),
  }

  if (!enviar) return NextResponse.json(resumen)

  // ── Envío ─────────────────────────────────────────────────────────────────
  const body = cuerpoDelAviso(periodoLegible(periodo))

  for (const e of candidatos) {
    if (yaAvisados.has(e.empleado_id)) continue
    const suyas = subs.filter(s => s.usuario_id === e.empleado_id)
    if (suyas.length === 0) continue

    // Tocar la notificación abre directamente su Mi Desempeño.
    const payload: PushPayload = {
      title: TITULO,
      body,
      url: `/guardias/${e.empleado_id}?seccion=desempeno`,
      tag: `evaluacion_publicada:${periodo}`,
    }

    let entregado = false
    for (const s of suyas) {
      try {
        const res = await sendWebPush(s, payload)
        if (res.status === 404 || res.status === 410) {
          await client.from('push_subscriptions').update({ activo: false }).eq('id', s.id)
        } else {
          entregado = true
        }
      } catch (err) {
        console.error('[evaluacion-publicada] suscripción', s.id,
          err instanceof Error ? err.message : err)
      }
    }

    if (!entregado) { resumen.fallidas += 1; continue }

    // Se registra DESPUÉS de entregar: si no llegó, la próxima corrida lo
    // reintenta en vez de darlo por avisado.
    await client.from('notificaciones_enviadas').insert({
      usuario_id: e.empleado_id,
      turno_id: null,
      objetivo_id: null,
      tipo: `evaluacion_publicada:${periodo}`,
      titulo: TITULO,
      mensaje: body,
    })
    resumen.enviadas += 1
  }

  const despues = await client.from('lecturas_evaluacion')
    .select('empleado_id').eq('periodo', periodo)

  return NextResponse.json({
    ...resumen,
    vistasDespues: new Set((despues.data ?? []).map((l: any) => String(l.empleado_id))).size,
  })
}
