/**
 * /api/push/entrenamiento-operativo — una instrucción concreta al vigilador.
 *
 * QUÉ MANDA
 * NO su puntaje. UNA instrucción sobre qué corregir y cómo, derivada de los
 * mismos hechos que ya calcula el Cumplimiento Operativo. El vigilador todavía
 * no ve su X/10; sí puede recibir "tu turno empieza a las 07:00, podés fichar
 * desde las 06:45".
 *
 * UNA SOLA, la más prioritaria. Alguien con cinco problemas no recibe cinco
 * mensajes: cinco avisos el mismo día no enseñan cinco cosas, enseñan a
 * silenciar las notificaciones.
 *
 * CUÁNDO
 * El día y la hora salen de `app_config` (`entrenamiento_dia_semana`,
 * `entrenamiento_hora_envio`), con default explícito. Nunca mientras la persona
 * está en turno: un aviso sobre la ronda del mes pasado, en mitad de una
 * guardia, es una distracción en un puesto de vigilancia.
 *
 * DEDUPLICACIÓN
 * Doble, y las dos hacen falta:
 *   · `entrenamiento_operativo` tiene unique (empleado, tipo, período), así que
 *     el mismo mensaje del mismo mes no sale dos veces ni compitiendo consigo
 *     mismo.
 *   · el cooldown por tipo evita repetir el mismo tema mes tras mes.
 * Además se registra en `notificaciones_enviadas`, que es donde se audita qué
 * salió del sistema.
 *
 * QUÉ NO TOCA
 * Nada. No escribe en turnos, ni en registros_asistencia, ni recalcula horas,
 * ni modifica el puntaje, ni cierra alertas. Escribe dos filas: la del
 * entrenamiento y la del envío.
 *
 * CÓMO SE LLAMA
 *   · pg_cron → Authorization: Bearer <push_cron_secret>. HOY NO ESTÁ AGENDADO:
 *     no existe ninguna entrada de pg_cron para esta ruta, a propósito.
 *   · Administración autenticada → sólo `?simular=1`, que no manda nada.
 *   · `?empleado=<uuid>` restringe el envío real a UNA persona, para poder
 *     probar contra un usuario controlado sin escribirle a nadie más.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import { requireAdminIA } from '../../ia/_lib/auth'
import { sendWebPush } from '../../_lib/web-push'
import type { PushPayload, PushSubscriptionRow } from '../../_lib/web-push'
import { cargarFilasBandeja } from '@/lib/bandeja-datos'
import { desempenoPorEmpleado } from '@/lib/desempeno-datos'
import { calcularCumplimiento } from '@/lib/cumplimiento'
import {
  cargarEvidenciasDelMes, cargarRondasDelMes, evidenciasPorEmpleado, fuentesDeEmpleado,
} from '@/lib/cumplimiento-fuentes'
import { ensenanzasDeEmpleado } from '@/lib/entrenador-datos'
import {
  CLAVE_DIA_ENVIO, CLAVE_HORA_ENVIO, ENVIO_POR_DEFECTO,
  correspondeNotificar, ensenanzaPrioritaria, esMomentoDeEnviar,
} from '@/lib/entrenador-operativo'
import type { Ensenanza, EnvioPrevio } from '@/lib/entrenador-operativo'
import { partirInstante } from '@/lib/cierre-datos'

export const runtime = 'nodejs'
export const maxDuration = 60

// Sin esto Next 14 cachea los GET de Supabase y la deduplicación deja de ver lo
// que ella misma acaba de escribir.
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

/**
 * La misma llave que el resto de las rutas que sólo avisan.
 *
 * En MINÚSCULAS porque así está cargada la variable en Vercel y en Linux
 * process.env distingue mayúsculas. Buscarla como CRON_SECRET devolvía
 * undefined, y la ruta le contestaba 401 a su propio cron.
 */
function cronAutorizado(req: NextRequest): boolean {
  const expected = process.env.push_cron_secret
  if (!expected) return false
  return (req.headers.get('authorization') || '') === `Bearer ${expected}`
}

async function accesoDenegado(
  req: NextRequest, simular: boolean, esCron: boolean,
): Promise<NextResponse | null> {
  if (esCron) return null
  if (!simular) return NextResponse.json({ error: 'Cron no autorizado' }, { status: 401 })
  const ctx = await requireAdminIA(req)
  if (ctx.ok) return null
  return (ctx as { respuesta: NextResponse }).respuesta
}

/** "2026-08" del mes anterior al de la fecha dada. */
function mesAnterior(fecha: string): string {
  const [y, m] = fecha.slice(0, 7).split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

const TITULO = 'Mercosur · Cómo mejorar'

/**
 * Por qué el sistema considera atribuible cada cosa.
 *
 * No es decorativo: antes de mandarle a una persona un mensaje sobre su trabajo
 * hay que poder decir en una línea de dónde salió el hecho y qué NO se está
 * afirmando. Esto es lo que se lee en la auditoría antes de autorizar un envío.
 */
function respaldoDe(
  r: ReturnType<typeof calcularCumplimiento>,
  m: ReturnType<typeof fuentesDeEmpleado>,
): Record<string, string> {
  const out: Record<string, string> = {}

  out.procedimiento_registro = r.base.observacionesValidas > 0
    ? `hecho determinístico: ${r.base.incidencias.sin_registro_propio} jornadas sin registro propio `
      + `y ${r.base.incidencias.entrada_sin_salida} entradas sin salida, sobre ${r.base.observacionesValidas} `
      + 'jornadas con evidencia. No es ausencia: la presencia está confirmada.'
    : 'sin jornadas evaluables'

  out.puntualidad = r.puntualidad.evaluadas > 0
    ? `hecho determinístico: ${r.puntualidad.impuntuales} de ${r.puntualidad.evaluadas} ingresos PROPIOS `
      + 'posteriores al inicio programado. Las jornadas sin fichaje propio no se juzgan.'
    : 'sin ingresos propios evaluables'

  out.asistencia = `${r.base.ausencias} ausencia(s) confirmada(s) por una persona`

  const rd = m.rondas
  out.rondas = rd.medicion.validos > 0
    ? `${rd.medicion.incidencias} de ${rd.medicion.validos} ventanas exigibles sin realizar. `
      + `Excluidas y NO atribuidas: ${rd.saneadas} saneadas, ${rd.pausaNoAtribuible} por causa técnica o `
      + `de configuración, ${rd.pausaCapacitacion} por capacitación, ${rd.pausaSinClasificar} sin causa registrada`
      + (rd.pausaSinClasificar > 0 ? ' — AMBIGUO, la dimensión queda en validación' : '')
    : 'sin ventanas exigibles atribuibles'

  const ev = (x: typeof m.uniforme, que: string) =>
    x.medicion.validos > 0
      ? `${x.confirmadas} confirmada(s) POR UNA PERSONA sobre ${x.medicion.validos} ${que} revisados. `
        + `${x.observadasPendientes} observación(es) de IA sin revisar NO cuentan`
        + (x.observadasPendientes > 0 ? ' — pendiente de validación humana' : '')
      : `sin ${que} evaluables`

  out.uniforme = ev(m.uniforme, 'registros de uniforme')
  out.libro_guardia = ev(m.libro, 'registros de libro')
  out.calidad_evidencias = m.calidad.total > 0
    ? `${m.calidad.noEvaluables} de ${m.calidad.total} fotos ilegibles. Es un hecho sobre la FOTO, `
      + 'no un juicio sobre lo que la foto muestra ni sobre la persona.'
    : 'sin evidencias'

  return out
}

export async function GET(req: NextRequest) {
  const simular = req.nextUrl.searchParams.get('simular') === '1'
  const esCron = cronAutorizado(req)

  const bloqueo = await accesoDenegado(req, simular, esCron)
  if (bloqueo) return bloqueo

  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })
  const client = admin.client

  const ahora = new Date()
  const local = partirInstante(ahora.toISOString())
  // El período por defecto es el mes en curso: el indicador sólo cuenta turnos
  // ya terminados, así que es evaluable desde el primer día.
  const periodo = req.nextUrl.searchParams.get('periodo') || local.fecha.slice(0, 7)
  const soloEmpleado = req.nextUrl.searchParams.get('empleado')
  // Sólo al simular: sirve para ver el cuadro sin esperar al día configurado.
  const ignorarMomento = req.nextUrl.searchParams.get('ignorar_momento') === '1' && simular

  const configR = await client.from('app_config').select('key, value')
    .in('key', [CLAVE_DIA_ENVIO, CLAVE_HORA_ENVIO])
  if (configR.error) return NextResponse.json({ error: configR.error.message }, { status: 500 })
  const config = new Map(((configR.data ?? []) as any[]).map(c => [c.key, c.value]))
  const diaConfigurado = Number(config.get(CLAVE_DIA_ENVIO) ?? ENVIO_POR_DEFECTO.dia)
  const horaConfigurada = String(config.get(CLAVE_HORA_ENVIO) ?? ENVIO_POR_DEFECTO.hora)

  // Alcance completo a propósito: esta ruta le escribe al vigilador, no a un
  // responsable de zona. El recorte por zona no aplica.
  const bandeja = await cargarFilasBandeja({ mes: periodo, esAdmin: true, usuarioId: null, client })
  if (bandeja.error) return NextResponse.json({ error: bandeja.error }, { status: 500 })

  const [rr, ee] = await Promise.all([
    cargarRondasDelMes(periodo, client, true),
    cargarEvidenciasDelMes(periodo, client),
  ])
  // Si estas dos fallan el aviso podría decirle a alguien que no completó
  // rondas que en realidad sí completó. Se corta.
  const fallo = [rr.error, ee.error].filter(Boolean).join(' · ')
  if (fallo) return NextResponse.json({ error: fallo }, { status: 500 })

  const porRondas = new Map(rr.datos.map(d => [d.guardiaId, d]))
  const porEvidencia = evidenciasPorEmpleado(ee.evidencias)

  const filas = soloEmpleado
    ? bandeja.filas.filter(f => f.empleadoId === soloEmpleado)
    : bandeja.filas

  /**
   * A quién se evalúa: quien tuvo jornadas Y quien subió evidencias.
   *
   * ── Por qué no alcanza con la bandeja ──────────────────────────────────────
   * La bandeja excluye los turnos de objetivos de prueba, para que los datos de
   * prueba no contaminen el indicador. Correcto. Pero la ruta armaba su lista
   * SÓLO desde ahí, así que alguien con evidencias reales y sin ninguna jornada
   * evaluable quedaba fuera por completo: no se lo evaluaba ni para decirle que
   * cuatro de sus siete fotos no se podían leer, que es un hecho suyo y no
   * depende de ningún turno.
   *
   * Sus dimensiones de jornada quedan en "sin datos" —no se inventa nada— y
   * sólo pueden producir instrucción las que salen de sus evidencias.
   *
   * Hoy esto alcanza a UNA persona en toda la base: el usuario de prueba. Se
   * midió antes de cambiarlo.
   */
  const lista: Array<{ empleadoId: string; empleado: string; cumplimiento: ReturnType<typeof calcularCumplimiento> }> =
    desempenoPorEmpleado(filas).map(d => ({
      empleadoId: d.empleadoId, empleado: d.empleado, cumplimiento: d.cumplimiento,
    }))

  const yaEstan = new Set(lista.map(d => d.empleadoId))
  const nombres = new Map<string, string>()
  for (const f of bandeja.filas) nombres.set(f.empleadoId, f.vigilador)

  // Quien no tiene filas de bandeja tampoco tiene nombre ahí, y la simulación
  // mostraba un UUID crudo justo en la pantalla que se usa para decidir si un
  // mensaje sale. Se completa desde usuarios.
  const faltanNombre = Array.from(porEvidencia.keys()).filter(id => !nombres.has(id))
  if (faltanNombre.length > 0) {
    const r = await client.from('usuarios').select('id, nombre, apellido').in('id', faltanNombre)
    for (const u of ((r.data ?? []) as any[])) nombres.set(u.id, `${u.apellido}, ${u.nombre}`)
  }

  porEvidencia.forEach((evidencias, empleadoId) => {
    if (yaEstan.has(empleadoId)) return
    if (soloEmpleado && empleadoId !== soloEmpleado) return
    const medido = fuentesDeEmpleado(porRondas.get(empleadoId) ?? null, evidencias)
    lista.push({
      empleadoId,
      empleado: nombres.get(empleadoId) ?? empleadoId,
      // Sin jornadas: Asistencia, Puntualidad y Procedimiento quedan sin datos.
      cumplimiento: calcularCumplimiento([], medido.fuentes),
    })
  })

  const [turnosHoyR, previosR, subsR] = await Promise.all([
    // Quién está trabajando ahora. No se le manda nada a quien está en turno.
    client.from('turnos').select('guardia_id, fecha, hora_inicio, hora_fin, estado')
      .eq('fecha', local.fecha).eq('estado', 'programado'),
    client.from('entrenamiento_operativo')
      .select('empleado_id, tipo, periodo, notificado_at')
      .not('notificado_at', 'is', null),
    client.from('push_subscriptions')
      .select('id, usuario_id, endpoint, p256dh, auth').eq('activo', true),
  ])
  for (const r of [turnosHoyR, previosR, subsR]) {
    if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
  }

  const enTurnoAhora = new Set<string>()
  for (const t of (turnosHoyR.data ?? []) as any[]) {
    const ini = String(t.hora_inicio ?? '').slice(0, 5)
    const fin = String(t.hora_fin ?? '').slice(0, 5)
    if (!ini || !fin || !t.guardia_id) continue
    const dentro = fin <= ini
      ? local.hora >= ini || local.hora < fin   // nocturno
      : local.hora >= ini && local.hora < fin
    if (dentro) enTurnoAhora.add(String(t.guardia_id))
  }

  const previosPorEmpleado = new Map<string, EnvioPrevio[]>()
  for (const p of (previosR.data ?? []) as any[]) {
    const id = String(p.empleado_id)
    const arr = previosPorEmpleado.get(id) ?? []
    arr.push({ clave: p.tipo, periodo: p.periodo, enviadoEn: p.notificado_at })
    previosPorEmpleado.set(id, arr)
  }

  const subs = (subsR.data ?? []) as PushSubscriptionRow[]
  const conSuscripcion = new Set(subs.map(s => s.usuario_id))

  const candidatos: Array<{
    empleadoId: string
    empleado: string
    ensenanzas: Ensenanza[]
    elegida: Ensenanza | null
    /** Qué respalda cada dimensión, para poder defender el mensaje. */
    respaldo: Record<string, string>
    momento: boolean
    trabajando: boolean
    suscripcion: boolean
    motivoNoEnvia: string | null
    payload: PushPayload | null
    metricaPrevia: number | null
  }> = []

  for (const d of lista) {
    const m = fuentesDeEmpleado(
      porRondas.get(d.empleadoId) ?? null,
      porEvidencia.get(d.empleadoId) ?? [],
    )
    const ensenanzas = ensenanzasDeEmpleado(periodo, d.cumplimiento, {
      rondas: m.rondas, uniforme: m.uniforme, libro: m.libro, calidad: m.calidad,
    })
    const previos = previosPorEmpleado.get(d.empleadoId) ?? []
    const elegida = ensenanzaPrioritaria(ensenanzas, previos, ahora)

    const trabajando = enTurnoAhora.has(d.empleadoId)
    const momento = ignorarMomento || esMomentoDeEnviar({
      diaSemana: new Date(`${local.fecha}T12:00:00Z`).getUTCDay(),
      horaLocal: local.hora,
      diaConfigurado,
      horaConfigurada,
      trabajando,
    })
    const suscripcion = conSuscripcion.has(d.empleadoId)

    const motivoNoEnvia =
      !elegida    ? 'nada que enseñar, o ya lo recibió'
      : trabajando ? 'está en turno ahora'
      : !momento   ? 'fuera de la ventana de envío configurada'
      : !suscripcion ? 'no tiene suscripción push'
      : null

    const dim = d.cumplimiento.dimensiones.find(x => elegida && x.clave === elegida.dimension)

    candidatos.push({
      empleadoId: d.empleadoId,
      empleado: d.empleado,
      ensenanzas,
      respaldo: respaldoDe(d.cumplimiento, m),
      elegida,
      momento,
      trabajando,
      suscripcion,
      motivoNoEnvia,
      metricaPrevia: dim?.nota ?? null,
      payload: elegida ? { title: TITULO, body: elegida.texto, url: '/' } : null,
    })
  }

  const aEnviar = candidatos.filter(c => c.motivoNoEnvia === null)

  if (simular) {
    // Agrupado por dimensión, con TODOS los candidatos de cada una —no sólo el
    // que se mandaría—. Autorizar un envío exige ver el cuadro completo, y el
    // que gana por prioridad puede no ser el más defendible.
    const porDimension: Record<string, any[]> = {}
    for (const c of candidatos) {
      const previos = previosPorEmpleado.get(c.empleadoId) ?? []
      for (const e of c.ensenanzas) {
        const mismoTipo = previos.filter(p => p.clave === e.clave)
        const enCooldown = e.notificar && !correspondeNotificar(e, previos, ahora)
        const fila = {
          vigilador: c.empleado,
          empleado_id: c.empleadoId,
          dimension: e.dimension,
          periodo: e.periodo,
          prioridad: e.prioridad,
          severidad: e.severidad,
          hecho: e.motivo,
          numerador: e.incidencias,
          denominador: e.requeridos,
          proporcion: e.requeridos > 0
            ? Math.round((1000 * e.incidencias) / e.requeridos) / 10 + ' %' : null,
          mensaje: e.texto,
          push_activo: c.suscripcion,
          en_turno_ahora: c.trabajando,
          entrenamientos_previos_mismo_tipo: mismoTipo.length,
          ultimo_previo: mismoTipo.map(x => x.periodo + ' (' + x.enviadoEn.slice(0, 10) + ')').join(', ') || null,
          en_cooldown: enCooldown,
          es_el_que_se_mandaria: c.elegida ? c.elegida.clave === e.clave : false,
          por_que_es_atribuible: c.respaldo[e.clave] ?? null,
        }
        if (!porDimension[e.clave]) porDimension[e.clave] = []
        porDimension[e.clave].push(fila)
      }
    }
    for (const k of Object.keys(porDimension)) {
      porDimension[k].sort((a, b) =>
        (b.numerador / Math.max(1, b.denominador)) - (a.numerador / Math.max(1, a.denominador)))
    }

    const resumen: Record<string, any> = {}
    for (const [k, v] of Object.entries(porDimension)) {
      resumen[k] = {
        candidatos: v.length,
        con_push: v.filter((x: any) => x.push_activo).length,
        patrones: v.filter((x: any) => x.severidad === 'patron').length,
        reincidencias: v.filter((x: any) => x.severidad === 'reincidencia').length,
        aisladas: v.filter((x: any) => x.severidad === 'aislada').length,
      }
    }

    const noSeEnvian: Record<string, number> = {}
    for (const c of candidatos) {
      if (!c.elegida || !c.motivoNoEnvia) continue
      noSeEnvian[c.motivoNoEnvia] = (noSeEnvian[c.motivoNoEnvia] ?? 0) + 1
    }

    return NextResponse.json({
      ok: true,
      simulado: true,
      periodo,
      periodo_anterior: mesAnterior(`${periodo}-01`),
      ahora_local: `${local.fecha} ${local.hora}`,
      ventana: { dia_semana: diaConfigurado, hora: horaConfigurada },
      evaluados: candidatos.length,
      con_ensenanza: candidatos.filter(c => c.elegida).length,
      se_enviarian: aEnviar.length,
      total_candidaturas: Object.values(porDimension).reduce((s, v) => s + v.length, 0),
      resumen_por_dimension: resumen,
      por_dimension: porDimension,
      no_se_envian: noSeEnvian,
    })
  }

  // ── Envío real ─────────────────────────────────────────────────────────────
  let sent = 0
  let skipped = 0
  let fallos = 0

  for (const c of aEnviar) {
    const e = c.elegida as Ensenanza
    const payload = c.payload as PushPayload
    const suyas = subs.filter(s => s.usuario_id === c.empleadoId)

    // Se registra ANTES de mandar, con el unique como candado: si dos corridas
    // se pisan, sólo una pasa de acá. Un duplicado de esta tabla es un mensaje
    // repetido en el teléfono de alguien.
    const registro = await client.from('entrenamiento_operativo').insert({
      empleado_id: c.empleadoId,
      dimension: e.dimension,
      tipo: e.clave,
      periodo: e.periodo,
      prioridad: e.prioridad,
      severidad: e.severidad,
      motivo: e.motivo,
      texto: e.texto,
      hechos: e.hechos,
      metrica_previa: c.metricaPrevia,
      incidencias_previas: e.incidencias,
      requeridos_previos: e.requeridos,
    }).select('id').single()

    let registroId: string | null = registro.data?.id ?? null

    if (registro.error) {
      if (!/duplicate key/i.test(registro.error.message)) {
        fallos += 1
        console.error('[entrenamiento] registro', c.empleadoId, registro.error.message)
        continue
      }

      // Ya existe una fila para (empleado, tipo, período). Hay dos casos muy
      // distintos y tratarlos igual rompía el reintento:
      //
      //   notificado_at con fecha  ya se le mandó. No se manda de nuevo.
      //   notificado_at en null    se registró y NO se llegó a entregar —el
      //                            endpoint estaba vencido, el servicio push
      //                            falló—. Hay que reintentar sobre ESA fila.
      //
      // Antes se salteaba en los dos casos, así que un intento fallido dejaba
      // la instrucción registrada y muerta: el unique bloqueaba para siempre
      // el reintento que el comentario prometía.
      const existente = await client.from('entrenamiento_operativo')
        .select('id, notificado_at')
        .eq('empleado_id', c.empleadoId).eq('tipo', e.clave).eq('periodo', e.periodo)
        .maybeSingle()

      if (existente.error || !existente.data) { skipped += 1; continue }
      if (existente.data.notificado_at) { skipped += 1; continue }
      registroId = existente.data.id
    }

    if (!registroId) { skipped += 1; continue }

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
        fallos += 1
        console.error('[entrenamiento] suscripción', s.id, err instanceof Error ? err.message : err)
      }
    }

    if (!entregado) {
      // Sin entrega no se marca como notificado: la fila queda como generada y
      // el vigilador no la ve —mis_instrucciones_operativas sólo devuelve las
      // notificadas—. La próxima corrida la reintenta.
      skipped += 1
      continue
    }

    await client.from('entrenamiento_operativo')
      .update({ notificado_at: new Date().toISOString(), canal: 'push' })
      .eq('id', registroId)

    await client.from('notificaciones_enviadas').insert({
      usuario_id: c.empleadoId,
      turno_id: null,
      objetivo_id: null,
      tipo: e.clavePush,
      titulo: payload.title,
      mensaje: payload.body,
    })

    sent += 1
  }

  return NextResponse.json({
    ok: true, periodo, evaluados: candidatos.length,
    con_ensenanza: candidatos.filter(c => c.elegida).length,
    sent, skipped, fallos,
    ...(soloEmpleado ? { prueba_controlada: soloEmpleado } : {}),
  })
}
