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

  // ── DIAGNÓSTICO TEMPORAL — quitar antes de fusionar ──────────────────────
  //
  // La deduplicación reenvía siempre: notificationAlreadySent no encuentra
  // filas que sí existen, aunque el insert posterior choque contra la
  // restricción única. Escribe viéndolas y lee sin verlas.
  //
  // Esto no envía nada. Lee la fila más reciente y después intenta encontrarla
  // con la MISMA consulta que usa la deduplicación. Si no se encuentra a sí
  // misma, el defecto queda aislado sin depender de datos de prueba.
  if (req.nextUrl.searchParams.get('diagnostico') === '1') {
    const ultima = await admin.client
      .from('notificaciones_enviadas')
      .select('usuario_id, turno_id, tipo, created_at')
      .order('created_at', { ascending: false })
      .limit(1)

    const fila = ultima.data?.[0]
    if (!fila) {
      return NextResponse.json({ paso1_ultimaFila: null, error: ultima.error?.message ?? 'tabla vacía' })
    }

    // La consulta textual de notificationAlreadySent, sobre esa misma fila.
    const comoDedup = await admin.client
      .from('notificaciones_enviadas')
      .select('id')
      .eq('usuario_id', fila.usuario_id)
      .eq('turno_id', fila.turno_id)
      .eq('tipo', fila.tipo)
      .maybeSingle()

    // Igual pero sin maybeSingle, para separar el filtro del modificador.
    const sinMaybeSingle = await admin.client
      .from('notificaciones_enviadas')
      .select('id')
      .eq('usuario_id', fila.usuario_id)
      .eq('turno_id', fila.turno_id)
      .eq('tipo', fila.tipo)

    // Un solo filtro por vez, para ver cuál de los tres no matchea.
    const soloUsuario = await admin.client
      .from('notificaciones_enviadas').select('id').eq('usuario_id', fila.usuario_id)
    const soloTurno = await admin.client
      .from('notificaciones_enviadas').select('id').eq('turno_id', fila.turno_id)
    const soloTipo = await admin.client
      .from('notificaciones_enviadas').select('id').eq('tipo', fila.tipo)

    return NextResponse.json({
      paso1_filaLeida: {
        usuario_id: fila.usuario_id,
        turno_id: fila.turno_id,
        tipo: fila.tipo,
        turno_id_es_null: fila.turno_id === null,
        created_at: fila.created_at,
      },
      paso2_comoLoHaceDedup: { encontro: Boolean(comoDedup.data), error: comoDedup.error?.message ?? null },
      paso3_sinMaybeSingle: { filas: sinMaybeSingle.data?.length ?? 0, error: sinMaybeSingle.error?.message ?? null },
      paso4_filtroPorSeparado: {
        soloUsuario: { filas: soloUsuario.data?.length ?? 0, error: soloUsuario.error?.message ?? null },
        soloTurno: { filas: soloTurno.data?.length ?? 0, error: soloTurno.error?.message ?? null },
        soloTipo: { filas: soloTipo.data?.length ?? 0, error: soloTipo.error?.message ?? null },
      },
    })
  }

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
