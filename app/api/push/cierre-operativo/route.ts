/**
 * /api/push/cierre-operativo — un aviso de resumen por responsable y por día.
 *
 * CUÁNDO SALE
 * Cuando la guardia de cada responsable está por terminar, no a una hora fija.
 * Un horario fijo le llegaría a destiempo a todo el que no cierre justo a esa
 * hora, y como la deduplicación es por (usuario, día), ese aviso a destiempo le
 * consumiría el del final de SU guardia. Por eso el cron corre seguido y
 * `responsablesQueCierran` decide en cada corrida quién está cerrando, leyendo
 * `supervisores_guardia`: la programación real, sin nombres ni horarios acá.
 *
 * LIMITACIÓN CONOCIDA, dicha en voz alta en la respuesta
 * Un responsable de zona SIN guardia horaria —las zonas con un único asignado—
 * no tiene fin de guardia en ninguna tabla. El cron no puede saber cuándo
 * avisarle, así que no le avisa, y la respuesta lo informa en
 * `zonas_sin_guardia_hoy`. Inventarle un horario sería peor que no mandarle
 * nada.
 *
 * QUÉ MANDA
 * Lo que le queda antes de cerrar la guardia —pendientes de hoy y arrastre— en
 * UN solo aviso. Nunca a quien tiene cero: el "estás al día" que nadie pidió es
 * ruido.
 *
 * DE DÓNDE SALE
 * De las mismas funciones que muestra la pantalla (lib/cierre-datos +
 * lib/cierre-operativo), con el cliente de servidor inyectado. No hay una
 * segunda definición de "qué está pendiente".
 *
 * A QUIÉN
 * A quien resuelve lib/responsables-operativos con la fecha y hora DEL HECHO.
 * Nunca por rol: un admin asignado a la guardia recibe igual, y un supervisor
 * sin asignación no. Eso ya se eliminó una vez del ruteo de push.
 *
 * CÓMO SE LLAMA
 *   · pg_cron  → Authorization: Bearer <push_cron_secret>, y manda de verdad.
 *   · una persona de Administración autenticada → sólo `?simular=1`. Existe
 *     para poder VERIFICAR la ruta sin tener el secreto a mano y sin mandarle
 *     nada a nadie.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import { requireAdminIA } from '../../ia/_lib/auth'
import { enviarResumenCierre } from '../../_lib/push-notificaciones'
import type { PushSubscriptionRow } from '../../_lib/web-push'
import {
  cargarItemsCierre, diaAnterior, fechaOperativaHoy, partirInstante,
} from '@/lib/cierre-datos'
import { cierreDeResponsable, detalleCierre, textoPushCierre } from '@/lib/cierre-operativo'
import { responsablesQueCierran, zonasConGuardiaCargada } from '@/lib/cierre-aviso'

export const runtime = 'nodejs'

// El ciclo completo de envíos en serie no entra en los 10 segundos del default
// de Vercel. Misma razón que /api/push/notificaciones.
export const maxDuration = 60

// Sin esto Next 14 cachea los GET de Supabase y la deduplicación deja de ver lo
// que ella misma acaba de escribir.
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

/** Tolerancia hacia atrás: el intervalo del cron. Ver `responsablesQueCierran`. */
const TOLERANCIA_CRON_MIN = 15

/**
 * La MISMA llave que /api/push/notificaciones, y por eso el mismo nombre.
 *
 * La separacion que importa es contra /api/push/cron, que modifica asistencia
 * y recalcula horas: esa puerta tiene su propia llave y no abre con esta. El
 * cierre solo avisa, igual que las notificaciones, asi que comparte llave con
 * ellas —que ademas es la que pg_cron ya saca del vault como push_cron_secret.
 *
 * El nombre va en MINUSCULAS porque asi esta cargada la variable en Vercel y en
 * Linux process.env distingue mayusculas. Buscarla como CRON_SECRET devolvia
 * undefined, y la ruta le contestaba 401 a su propio cron.
 */
function cronAutorizado(req: NextRequest): boolean {
  const expected = process.env.push_cron_secret
  if (!expected) return false
  return (req.headers.get('authorization') || '') === `Bearer ${expected}`
}

/** null = puede seguir. Devuelve la respuesta de rechazo si no. */
async function accesoDenegado(
  req: NextRequest, simular: boolean, esCron: boolean,
): Promise<NextResponse | null> {
  if (esCron) return null
  if (!simular) return NextResponse.json({ error: 'Cron no autorizado' }, { status: 401 })
  const ctx = await requireAdminIA(req)
  if (ctx.ok) return null
  // ContextoIA es una union discriminada, pero con `strict: false` el narrowing
  // no la separa acá. Se lee explícito en vez de dejar un error nuevo.
  return (ctx as { respuesta: NextResponse }).respuesta
}

export async function GET(req: NextRequest) {
  const simular = req.nextUrl.searchParams.get('simular') === '1'
  const esCron = cronAutorizado(req)

  // Sin el secreto sólo se admite simular, y sólo a Administración. Nadie puede
  // disparar envíos reales con una sesión de navegador.
  const bloqueo = await accesoDenegado(req, simular, esCron)
  if (bloqueo) return bloqueo

  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })
  const client = admin.client

  const ahora = new Date()
  const local = partirInstante(ahora.toISOString())
  const fecha = req.nextUrl.searchParams.get('fecha') || fechaOperativaHoy(ahora)
  const mes = fecha.slice(0, 7)
  // `?todos=1` ignora el filtro por fin de guardia. Sólo para simular: sirve
  // para ver el cuadro completo sin esperar a que alguien esté cerrando.
  const todos = req.nextUrl.searchParams.get('todos') === '1' && simular

  // Primero lo barato: ¿hay alguien cerrando ahora?
  //
  // Cargar el mes entero son unas veinte consultas paginadas. El cron corre
  // cada quince minutos y la enorme mayoría de las corridas no tiene a nadie
  // terminando guardia: hacer todo ese trabajo para descubrirlo sería pagar
  // noventa y seis veces por día algo que se responde con una sola consulta.
  const guardiasPrevias = await client.from('supervisores_guardia')
    .select('supervisor_id, zona, fecha, hora_inicio, hora_fin, estado, tipo_evento, rol_operativo')
    .gte('fecha', diaAnterior(local.fecha)).lte('fecha', local.fecha)
  if (guardiasPrevias.error) {
    return NextResponse.json({ error: guardiasPrevias.error.message }, { status: 500 })
  }
  const cerrandoAhora = responsablesQueCierran((guardiasPrevias.data ?? []) as any[], {
    fecha: local.fecha, hora: local.hora, tolerancia: TOLERANCIA_CRON_MIN,
  })
  if (cerrandoAhora.length === 0 && !todos) {
    return NextResponse.json({
      ok: true, simulado: simular, fecha,
      ahora_local: `${local.fecha} ${local.hora}`,
      cerrando_ahora: 0, sent: 0, skipped: 0, fallos: 0,
      nota: 'Nadie termina guardia en esta ventana; no se cargo nada mas.',
    })
  }

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
  const guardias = (guardiasR.data ?? []) as any[]
  const catalogos = {
    guardias,
    supervisorZonas: (supZonasR.data ?? []) as any[],
    zonas:           (zonasR.data ?? []) as any[],
    usuarios,
  }

  // Quiénes están cerrando ahora. Sale de la guardia real, no de una lista.
  const cerrando = responsablesQueCierran(guardias, {
    fecha: local.fecha, hora: local.hora, tolerancia: TOLERANCIA_CRON_MIN,
  })
  const leToca = new Set(cerrando)

  const subs = (subsR.data ?? []) as PushSubscriptionRow[]
  const conSuscripcion = new Set(subs.map(s => s.usuario_id))

  const candidatos = usuarios
    .map(u => ({ usuarioId: u.id as string, cierre: cierreDeResponsable(cierre.items, u.id, fecha, catalogos) }))
    .filter(d => d.cierre.hoy.total + d.cierre.anteriores.total > 0)
    .map(d => {
      const { titulo, cuerpo } = textoPushCierre(d.cierre)
      const u = usuarios.find(x => x.id === d.usuarioId)
      return {
        usuarioId: d.usuarioId,
        nombre: u ? `${u.apellido}, ${u.nombre}` : d.usuarioId,
        rol: u?.rol ?? null,
        hoy: d.cierre.hoy.total,
        anteriores: d.cierre.anteriores.total,
        detalle_hoy: detalleCierre(d.cierre.hoy),
        detalle_anteriores: detalleCierre(d.cierre.anteriores),
        por_categoria_hoy: d.cierre.hoy.porCategoria,
        por_categoria_anteriores: d.cierre.anteriores.porCategoria,
        cierra_ahora: leToca.has(d.usuarioId),
        suscripcion_push: conSuscripcion.has(d.usuarioId),
        payload: { title: titulo, body: cuerpo, url: '/dashboard' },
      }
    })

  const destinatarios = todos ? candidatos : candidatos.filter(c => c.cierra_ahora)

  if (simular) {
    // Las zonas que hoy NO tienen ninguna guardia cargada: a sus responsables
    // de zona el cron no les puede avisar, porque no hay fin de guardia.
    const conGuardia = new Set(zonasConGuardiaCargada(guardias, local.fecha))
    const zonasSinGuardia = ((zonasR.data ?? []) as any[])
      .map(z => z.nombre)
      .filter(n => !conGuardia.has(String(n ?? '').trim().toLowerCase()))

    return NextResponse.json({
      ok: true,
      simulado: true,
      fecha,
      ahora_local: `${local.fecha} ${local.hora}`,
      items: cierre.items.length,
      cerrando_ahora: cerrando.length,
      zonas_sin_guardia_hoy: zonasSinGuardia,
      // Sin `todos=1` esto es exactamente lo que se mandaría en esta corrida.
      destinatarios,
    })
  }

  const resultado = await enviarResumenCierre(
    client, subs,
    destinatarios.map(d => ({ usuarioId: d.usuarioId, payload: d.payload })),
    fecha,
  )

  return NextResponse.json({
    ok: true, fecha, items: cierre.items.length,
    cerrando_ahora: cerrando.length, ...resultado,
  })
}
