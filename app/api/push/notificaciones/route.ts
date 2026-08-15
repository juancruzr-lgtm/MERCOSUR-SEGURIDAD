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

/**
 * Sin esto la corrida se corta a los 10 segundos y el 500 queda con cuerpo
 * vacío en pg_net (net._http_response): es EXACTAMENTE lo que venía pasando —
 * todos los ticks entre el 14/08 18:40 y el 15/08 00:30 (hora local) dieron
 * 500 sin body. La función manda de arriba hacia abajo (supervisiones →
 * rondas → turnos), así que con el default de Vercel los avisos al VIGILADOR,
 * que están al final, eran los primeros en morir cuando había backlog. Los
 * envíos se hacen en serie a propósito (dedup consultada por destinatario);
 * 60 segundos alcanzan con margen para un ciclo completo.
 */
export const maxDuration = 60

/**
 * Sin esto la deduplicación no funciona.
 *
 * Next 14 cachea las peticiones `fetch` por defecto, y el cliente de Supabase
 * usa `fetch` por debajo. Un `.select()` es un GET —cacheable— y un `.insert()`
 * es un POST —nunca cacheado—. Resultado: la corrida leía notificaciones_enviadas
 * del caché de Next, no veía lo que ella misma acababa de escribir, y volvía a
 * mandar el mismo aviso en cada ciclo. El insert siguiente sí llegaba a la base
 * y chocaba contra la restricción única, pero ese error se descarta a propósito,
 * así que no quedaba rastro.
 *
 * Verificado el 13/08/2026: tres llamadas seguidas dentro de la misma ventana
 * enviaron el mismo aviso tres veces y escribieron una sola fila.
 *
 * NOTA: getSupabaseAdmin() no desactiva este caché, así que cualquier otra ruta
 * que lea por ese cliente tiene el mismo problema. Corregirlo ahí es más amplio
 * que este bloque y va aparte.
 */
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

/**
 * Secreto propio, distinto del de /api/push/cron.
 *
 * No hay respaldo a CRON_SECRET a propósito: si este endpoint aceptara aquel
 * token, quien lo tuviera podría igualmente disparar esta ruta y la separación
 * no serviría de nada. Son dos llaves para dos puertas, y esta puerta no abre
 * con la otra llave.
 *
 * El nombre va en minúsculas porque así está cargada la variable en Vercel, y
 * en Linux process.env distingue mayúsculas: buscarla como PUSH_CRON_SECRET
 * daría undefined y la ruta respondería 500 sin que el problema tenga nada que
 * ver con las notificaciones. Es la única variable del proyecto en minúsculas;
 * si algún día se renombra en Vercel, hay que cambiarla también acá.
 */
function authOk(req: NextRequest) {
  const expected = process.env.push_cron_secret
  if (!expected) return { ok: false, error: 'Falta push_cron_secret' }
  const header = req.headers.get('authorization') || ''
  return header === `Bearer ${expected}`
    ? { ok: true }
    : { ok: false, error: 'No autorizado' }
}

export async function GET(req: NextRequest) {
  const auth = authOk(req)
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      { status: auth.error === 'Falta push_cron_secret' ? 500 : 401 },
    )
  }

  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  // ?solo_usuario=<id> limita la corrida entera a ese destinatario: es la prueba
  // controlada previa a encender el cron. Se lee DESPUÉS de validar el secreto,
  // así que sin el token no hay forma de dirigir un envío a nadie.
  //
  // Sin el parámetro el comportamiento es el global de siempre: soloUsuarioId
  // queda en null y no se filtra nada.
  const soloUsuarioId = req.nextUrl.searchParams.get('solo_usuario')

  const resultado = await enviarNotificaciones(admin.client, { soloUsuarioId })
  return NextResponse.json(resultado, { status: resultado.ok === false ? 500 : 200 })
}
