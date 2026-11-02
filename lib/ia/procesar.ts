// lib/ia/procesar.ts
//
// Núcleo del análisis. Lo usan las dos vías:
//   - /api/ia/analizar  → manual, desde Administración, modo prueba
//   - /api/ia/cron      → automático, pg_cron cada 5 min, modo produccion
//
// Server-side únicamente: recibe un cliente con service_role ya construido.

import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { catalogoInicial, leerCriterios } from './referencias'
import { bloqueContextoVisual, construirPrompt, derivarClasificacion, normalizarResultado, schemaRespuesta, type Umbrales } from './contratos'
import { GeminiVision, MODELO_GEMINI_DEFECTO } from './gemini'
import { cargarMemoriaPunto, LIMITES_MEMORIA_DEFECTO, type EjemploPedido, type LimitesMemoria } from './memoria'
import { gpsExcedeMargenDeError } from './rondas'
import { ErrorProveedor } from './proveedor'
import { decidirReclamo, esFuncionAusente, ordenarSegunCola } from './cola'

export const TIPOS_SOPORTADOS = ['uniforme', 'libro_guardia', 'punto_control'] as const
export const LIMITE_DURO = 6

export type FiltrosLote = {
  desde?: string
  hasta?: string
  objetivo_id?: string
  guardia_id?: string
  tipos?: string[]
  evidencia_ids?: string[]
}

export type OpcionesProceso = {
  client: SupabaseClient
  modo: 'prueba' | 'produccion'
  limite: number
  filtros?: FiltrosLote
  loteId?: string | null
  /** Milisegundos disponibles antes de que la función sea cortada. */
  presupuestoMs: number
  maxIntentos: number
  /** Cuántas SIN_OBSERVACIONES por día entran igual a revisión humana.
   *  0 desactiva la muestra. Sólo aplica en modo produccion. */
  cuotaMuestra?: number
  /** Tope de fotos de referencia a enviar junto con la evidencia. */
  maxReferencias?: number
  /** Cuántos ejemplos humanos confirmados acompañan a una foto de ronda. */
  limitesMemoria?: LimitesMemoria
  /** Kill-switch: si es true, sólo analiza fotos de ronda cuyo GPS quedó fuera
   *  del radio. Por defecto false — toda foto de punto se analiza, porque GPS y
   *  foto controlan cosas distintas. */
  soloGpsFueraRadio?: boolean
  /**
   * Cola con prioridad (ia_evidencias_por_analizar, migración 20261120130000):
   * más viejas primero, nunca lo ya analizado, fotos de punto sin GPS/QR válido
   * antes que todo. Si la función todavía no existe en la base se usa la
   * consulta anterior. Sólo la usa el cron (modo produccion).
   */
  usarCola?: boolean
  /** Antigüedad máxima, en días, de lo que entra a la cola. */
  colaMaxDias?: number
  /** Fotos de puntos ya validados por GPS/QR que se analizan por día. */
  muestraValidadasDia?: number
}

export type ResultadoItem = {
  evidencia_id: string
  analisis_id?: string
  estado: 'completado' | 'error' | 'omitida'
  clasificacion_ia?: string
  clasificacion_efectiva?: string
  motivos?: string[]
  resumen?: string
  motivo?: string
  error?: string
  /** Resultado de reevaluar_punto_ronda tras analizar una foto de punto. */
  reevaluacion?: string
}

/**
 * Después de un veredicto sobre la foto de un punto, el punto se re-juzga con
 * la regla aprobada (una evidencia válida alcanza). Idempotente del lado SQL:
 * si nada cambió, no escribe. Un fallo acá no invalida el análisis: el barrido
 * reevaluar_puntos_ronda_pendientes del cron lo recupera.
 */
export async function reevaluarPuntoRonda(client: SupabaseClient, ejecucionPuntoId: string): Promise<string> {
  const { data, error } = await client.rpc('reevaluar_punto_ronda', { p_ejecucion_punto_id: ejecucionPuntoId })
  if (error) return esFuncionAusente(error) ? 'sin_funcion' : `error: ${String(error.message).slice(0, 120)}`
  const r = (data ?? {}) as { contexto?: string, estado?: string }
  return r.contexto === 'actualizado' ? `actualizado: ${r.estado}` : (r.contexto ?? 'sin_respuesta')
}

export async function procesarLote(op: OpcionesProceso): Promise<{ resultados: ResultadoItem[], encolados: number }> {
  const {
    client, modo, limite, filtros, loteId, presupuestoMs, maxIntentos = 5,
    cuotaMuestra = 0, maxReferencias = 4, soloGpsFueraRadio = false,
    limitesMemoria = LIMITES_MEMORIA_DEFECTO,
    usarCola = false, colaMaxDias = 7, muestraValidadasDia = 20,
  } = op
  const inicio = Date.now()
  const RESERVA_MS = 5_000
  // Peor caso observado: una imagen con 4 referencias tarda ~20 s.
  const ESTIMADO_INICIAL_MS = 22_000
  const duraciones: number[] = []

  const tipos = filtros?.tipos?.length
    ? filtros.tipos.filter(t => (TIPOS_SOPORTADOS as readonly string[]).includes(t))
    : [...TIPOS_SOPORTADOS]

  const COLUMNAS_EVIDENCIA = 'id, tipo_evidencia, proceso_id, bucket, storage_path, content_type, contenido_sha256, objetivo_id, guardia_id, turno_id, created_at'

  // ── Cola con prioridad ──────────────────────────────────────────────────
  // Antes se pedían las N evidencias MÁS NUEVAS, sin excluir las ya
  // analizadas: con más de N fotos en 5 minutos, las de atrás no volvían a
  // ser elegidas nunca (1.497 fotos de punto sin análisis en octubre 2026).
  // La cola devuelve sólo lo pendiente, de la más vieja a la más nueva, y
  // primero las fotos de las que depende si un punto se cumple.
  let ordenCola: string[] | null = null
  if (usarCola && modo === 'produccion' && !filtros?.evidencia_ids?.length) {
    const { data: cola, error: errorCola } = await client.rpc('ia_evidencias_por_analizar', {
      p_desde: filtros?.desde ?? new Date(0).toISOString(),
      p_tipos: tipos,
      p_limite: Math.min(limite, LIMITE_DURO),
      p_antiguedad_max: `${Math.max(1, Math.floor(colaMaxDias))} days`,
      p_muestra_validadas_dia: Math.max(0, Math.floor(muestraValidadasDia)),
    })
    if (errorCola && !esFuncionAusente(errorCola)) throw new Error(errorCola.message)
    if (!errorCola) {
      ordenCola = ((cola ?? []) as Array<{ evidencia_id: string }>).map(c => c.evidencia_id)
      if (ordenCola.length === 0) return { resultados: [], encolados: 0 }
    }
  }

  let evidencias: any[] | null
  if (ordenCola) {
    const { data, error } = await client.from('evidencias').select(COLUMNAS_EVIDENCIA).in('id', ordenCola)
    if (error) throw new Error(error.message)
    evidencias = ordenarSegunCola((data ?? []) as any[], ordenCola)
  } else {
    // Consulta anterior: manual (modo prueba) o base sin la migración de la cola.
    let q = client
      .from('evidencias')
      .select(COLUMNAS_EVIDENCIA)
      .in('tipo_evidencia', tipos)
      .order('created_at', { ascending: false })
      .limit(Math.min(limite, LIMITE_DURO))

    if (filtros?.evidencia_ids?.length) q = q.in('id', filtros.evidencia_ids.slice(0, LIMITE_DURO))
    if (filtros?.desde) q = q.gte('created_at', filtros.desde)
    if (filtros?.hasta) q = q.lte('created_at', filtros.hasta)
    if (filtros?.objetivo_id) q = q.eq('objetivo_id', filtros.objetivo_id)
    if (filtros?.guardia_id) q = q.eq('guardia_id', filtros.guardia_id)

    const { data, error } = await q
    if (error) throw new Error(error.message)
    evidencias = data
  }
  if (!evidencias?.length) return { resultados: [], encolados: 0 }

  const { data: configs } = await client
    .from('ia_configuraciones')
    .select('*')
    .in('analisis_tipo', tipos)
    .eq('activo', true)

  const configPorTipo = new Map((configs ?? []).map(c => [c.analisis_tipo as string, c]))

  // ── Auto-provisión de la configuración técnica ────────────────────────────
  // El prompt y el modelo son detalle de implementación, no una decisión que la
  // operación tenga que tomar antes de poder usar el sistema. Si falta la
  // configuración de un tipo, se crea sola con el catálogo por defecto y queda
  // activa. Administración puede después ajustar los criterios desde la pantalla,
  // pero nunca está obligada a pasar por ahí para empezar.
  for (const tipo of tipos) {
    if (configPorTipo.has(tipo)) continue

    const criteriosBase = catalogoInicial(tipo as any)
    if (criteriosBase.length === 0) continue

    const prompt = construirPrompt(tipo, criteriosBase)
    const { data: creada } = await client
      .from('ia_configuraciones')
      .insert({
        analisis_tipo: tipo,
        version: 'v1',
        nombre: `${tipo} — criterios por defecto`,
        descripcion: 'Creada automáticamente al primer análisis. Editable desde Referencias IA.',
        criterios: { elementos: criteriosBase },
        proveedor: 'gemini',
        modelo: MODELO_GEMINI_DEFECTO,
        prompt,
        prompt_sha256: createHash('sha256').update(prompt).digest('hex'),
        schema_json: schemaRespuesta() as any,
        activo: true,
      })
      .select('*')
      .single()

    if (creada) configPorTipo.set(tipo, creada)
  }

  // ── Objetivos móviles ───────────────────────────────────────────────────
  // Un objetivo móvil es una máquina que se traslada todos los días: no hay
  // garita, y sin garita no hay libro de guardia. La foto que sube el vigilador
  // en ese campo es del puesto o del equipo, no de un libro — el modelo la
  // evaluaba con los criterios "cargado" y "sin tachaduras", respondía que no
  // hay libro, y cada ingreso terminaba en la bandeja como si fuera una falta.
  //
  // Se resuelve sin columna nueva: en esta operación "se traslada" y "no tiene
  // libro" son el mismo hecho, y la ausencia de garita es la causa de ambos.
  // Si algún día aparece un móvil que sí lleva libro, ahí sí hace falta separar
  // los dos conceptos en una columna propia.
  const objetivoIds = [...new Set(evidencias.map(e => e.objetivo_id).filter(Boolean))]
  const { data: objetivos } = await client
    .from('objetivos')
    .select('id, tipo_ubicacion')
    .in('id', objetivoIds)

  const objetivoEsMovil = new Set(
    (objetivos ?? []).filter(o => o.tipo_ubicacion === 'movil').map(o => o.id as string),
  )

  const proveedor = new GeminiVision()
  const schema = schemaRespuesta()
  const resultados: ResultadoItem[] = []
  let encolados = 0

  for (const ev of evidencias) {
    // Corte por presupuesto ANTES de reclamar la fila: lo que no llegamos a
    // analizar queda sin encolar, no colgado en 'procesando'.
    //
    // No alcanza con mirar el tiempo transcurrido: hay que estimar si la
    // PRÓXIMA foto entra. Antes se chequeaba sólo lo ya gastado, así que una
    // foto que arrancaba cerca del límite igual se lanzaba y hacía morir la
    // función por timeout — Vercel devolvía su página de error en texto plano
    // y el lote entero se perdía. Se usa la duración observada; para la primera
    // se asume el peor caso conocido.
    const estimado = duraciones.length > 0
      ? duraciones.reduce((a, b) => a + b, 0) / duraciones.length
      : ESTIMADO_INICIAL_MS
    if (Date.now() - inicio + estimado > presupuestoMs - RESERVA_MS) {
      resultados.push({ evidencia_id: ev.id, estado: 'omitida', motivo: 'Sin tiempo en este lote — volvé a ejecutar' })
      continue
    }
    const arranque = Date.now()

    const conf = configPorTipo.get(ev.tipo_evidencia)
    if (!conf) {
      resultados.push({ evidencia_id: ev.id, estado: 'omitida', motivo: `Sin configuración activa para ${ev.tipo_evidencia}` })
      continue
    }
    if (!conf.modelo || !conf.prompt) {
      resultados.push({ evidencia_id: ev.id, estado: 'omitida', motivo: `La configuración ${conf.version} está en borrador` })
      continue
    }
    if (!ev.objetivo_id) {
      resultados.push({ evidencia_id: ev.id, estado: 'omitida', motivo: 'Evidencia sin objetivo' })
      continue
    }

    // Se omite ANTES de reclamar la fila y antes de llamar a Gemini: no gasta
    // cuota, no crea análisis, no llega a la bandeja y no cuenta como error.
    // La evidencia se sigue guardando; simplemente no se juzga contra un
    // criterio que en ese objetivo no aplica.
    if (ev.tipo_evidencia === 'libro_guardia' && objetivoEsMovil.has(ev.objetivo_id)) {
      resultados.push({
        evidencia_id: ev.id,
        estado: 'omitida',
        motivo: 'Objetivo móvil: sin garita no hay libro de guardia',
      })
      continue
    }

    // ── Rondas ────────────────────────────────────────────────────────────
    // GPS y foto controlan cosas distintas: el GPS dice DÓNDE estuvo, la foto
    // dice QUÉ evidencia presentó. Por eso toda foto de punto se analiza, haya
    // marcado el GPS bien o mal. La ausencia de foto no se analiza porque
    // simplemente no existe la evidencia.
    //
    // dentro_radio no decide si se analiza: agrega contexto al resultado.
    let rondaPuntoId: string | null = null
    let gpsFueraRadio = false
    let gpsDesvioReal = false
    let distanciaMetros: number | null = null
    let precisionMetros: number | null = null
    let radioMetros: number | null = null

    if (ev.tipo_evidencia === 'punto_control') {
      const { data: ejec } = await client
        .from('ronda_ejecucion_puntos')
        .select('ronda_punto_id, dentro_radio, distancia_metros, precision_metros, snap_radio_metros')
        .eq('id', ev.proceso_id)
        .maybeSingle()

      if (!ejec) {
        // Las 8 evidencias huérfanas del 28-29/07 caen acá. No bloquean el lote.
        resultados.push({ evidencia_id: ev.id, estado: 'omitida', motivo: 'Punto de ejecución inexistente' })
        continue
      }

      // Kill-switch temporal. Por defecto está apagado: se analiza todo.
      if (soloGpsFueraRadio && ejec.dentro_radio !== false) {
        resultados.push({
          evidencia_id: ev.id,
          estado: 'omitida',
          motivo: ejec.dentro_radio === true ? 'GPS dentro del radio' : 'GPS sin dato',
        })
        continue
      }

      rondaPuntoId = ejec.ronda_punto_id
      gpsFueraRadio = ejec.dentro_radio === false
      distanciaMetros = ejec.distancia_metros ?? null
      precisionMetros = ejec.precision_metros ?? null
      // El radio congelado al momento de la ejecución, no el actual: si alguien
      // corrige el radio hoy, esta medición se sigue juzgando con el que regía.
      radioMetros = ejec.snap_radio_metros ?? null

      gpsDesvioReal = gpsFueraRadio && gpsExcedeMargenDeError({
        distanciaMetros,
        radioMetros,
        precisionMetros,
      })
    }

    const { data: fila, error: errorClaim } = await client
      .from('evidencia_analisis')
      .insert({
        evidencia_id: ev.id,
        analisis_tipo: ev.tipo_evidencia,
        configuracion_id: conf.id,
        configuracion_version: conf.version,
        modo,
        lote_id: loteId ?? null,
        objetivo_id: ev.objetivo_id,
        guardia_id: ev.guardia_id,
        turno_id: ev.turno_id,
        // Denormalizado a propósito: sin esto, juntar la memoria visual de un
        // punto obligaría a recorrer ejecuciones → evidencias → análisis en cada
        // foto, dentro del presupuesto de 45 s. También es lo que hace posible
        // medir aciertos por punto sin recalcular el join.
        ronda_punto_id: rondaPuntoId,
        evidencia_created_at: ev.created_at,
        sha256_esperado: ev.contenido_sha256,
        estado: 'procesando',
        intentos: 1,
        proveedor: 'gemini',
        modelo: conf.modelo,
      })
      .select('id')
      .single()

    // ── Reintento de un análisis fallido ──────────────────────────────────
    // El índice único rechaza el insert si ya hay una fila para esta evidencia
    // y versión. Eso es correcto para lo ya completado, pero dejaba huérfano lo
    // que falló: un 429 de cuota o un timeout quedaban en 'error' para siempre,
    // porque el reclamo siguiente los leía como "ya analizada". Se recupera la
    // fila existente y, si es reintentable, se reusa.
    let filaId = fila?.id ?? null

    if (errorClaim?.code === '23505') {
      const { data: previa } = await client
        .from('evidencia_analisis')
        .select('id, estado, intentos, proximo_intento_at, updated_at')
        .eq('evidencia_id', ev.id)
        .eq('analisis_tipo', ev.tipo_evidencia)
        .eq('configuracion_version', conf.version)
        .eq('modo', modo)
        .maybeSingle()

      const decision = decidirReclamo(previa, maxIntentos)

      if (decision.accion === 'reintentar' || decision.accion === 'recuperar') {
        // Re-reclamo condicionado a lo que se leyó: si otra corrida la tomó en
        // el medio, el UPDATE no encuentra la fila y ésta se omite. Así nunca
        // hay dos análisis de la misma foto en paralelo.
        const { data: reclamada } = await client.from('evidencia_analisis')
          .update({
            estado: 'procesando',
            intentos: (previa!.intentos ?? 0) + 1,
            ultimo_error: null,
            ronda_punto_id: rondaPuntoId,
          })
          .eq('id', previa!.id)
          .eq('estado', previa!.estado)
          .eq('intentos', previa!.intentos ?? 0)
          .select('id')
        if (!reclamada?.length) {
          resultados.push({ evidencia_id: ev.id, estado: 'omitida', motivo: 'Otra corrida la reclamó' })
          continue
        }
        filaId = previa!.id
      } else if (decision.accion === 'agotar') {
        // Sin intentos: sale de la cola para no ocupar el lugar de otras fotos.
        // La foto de un punto sin otra evidencia queda «pendiente de
        // validación» hasta que una persona la mire (no se condena al
        // vigilador por una falla técnica nuestra).
        await client.from('evidencia_analisis')
          .update({ estado: 'error_definitivo', error_clase: 'transitorio', proximo_intento_at: null })
          .eq('id', previa!.id)
          .eq('estado', previa!.estado)
        resultados.push({
          evidencia_id: ev.id,
          analisis_id: previa!.id,
          estado: 'omitida',
          motivo: `Intentos agotados (${previa!.intentos ?? 0} de ${maxIntentos}): error definitivo`,
        })
        continue
      } else {
        resultados.push({
          evidencia_id: ev.id,
          estado: 'omitida',
          motivo: decision.motivo === 'Ya analizada' ? `Ya analizada con ${conf.version}` : decision.motivo,
        })
        continue
      }
    } else if (errorClaim || !fila) {
      resultados.push({
        evidencia_id: ev.id,
        estado: 'omitida',
        motivo: errorClaim?.message ?? 'No se pudo encolar',
      })
      continue
    }

    if (!filaId) continue
    const filaActual = { id: filaId }
    encolados++

    const criterios = leerCriterios(conf.criterios).elementos
    const umbrales = (conf.umbrales ?? {}) as Umbrales

    try {
      const { data: blob, error: errorDescarga } = await client.storage.from(ev.bucket).download(ev.storage_path)
      if (errorDescarga || !blob) throw new ErrorProveedor('El objeto no existe en Storage', 'permanente')

      const bytes = Buffer.from(await blob.arrayBuffer())
      const sha = createHash('sha256').update(bytes).digest('hex')
      const integridad = !ev.contenido_sha256 ? 'sin_hash' : (sha === ev.contenido_sha256 ? 'coincide' : 'divergente')

      if (integridad === 'divergente') {
        await client.from('evidencia_analisis').update({
          estado: 'completado',
          analizado_at: new Date().toISOString(),
          sha256_analizado: sha,
          integridad,
          clasificacion_ia: 'REVISAR',
          clasificacion_efectiva: 'REVISAR',
          evaluable: false,
          confianza: 1,
          motivos: ['EVIDENCIA_ALTERADA'],
          resumen: 'Los bytes almacenados no coinciden con el hash registrado al subir la evidencia.',
        }).eq('id', filaActual.id)

        resultados.push({
          evidencia_id: ev.id, analisis_id: filaActual.id, estado: 'completado', clasificacion_efectiva: 'REVISAR', motivos: ['EVIDENCIA_ALTERADA'],
          reevaluacion: ev.tipo_evidencia === 'punto_control' ? await reevaluarPuntoRonda(client, ev.proceso_id) : undefined,
        })
        continue
      }

      // Cada imagen es otro bloque de tokens y otros segundos de reloj. Los
      // topes son configurables para poder ajustarlos si la cuota del free tier
      // o el límite de 60 s aprietan.
      //
      // Uniforme y libro comparan contra las referencias de la configuración:
      // el uniforme reglamentario es uno solo para toda la empresa.
      //
      // Un punto de ronda no: no existe un "portón correcto" genérico. Compara
      // contra SU referencia formal y contra su propia memoria visual — fotos
      // reales de ESE punto que una persona ya confirmó. Ver lib/ia/memoria.ts.
      const referencias: Array<{ bytes: Buffer, mime: string }> = []
      let ejemplos: EjemploPedido[] = []
      let positivosDisponibles = 0

      if (rondaPuntoId) {
        const memoria = await cargarMemoriaPunto(client, rondaPuntoId, {
          limites: limitesMemoria,
          maxReferencias: 1,
          excluirSha256: ev.contenido_sha256 ?? sha,
        })
        referencias.push(...memoria.referencias)
        ejemplos = memoria.ejemplos
        positivosDisponibles = memoria.positivosDisponibles
      } else {
        const { data: imgs } = await client
          .from('ia_referencia_imagenes')
          .select('bucket, storage_path, content_type')
          .eq('configuracion_id', conf.id)
          .eq('activo', true)
          .order('orden')
          .limit(maxReferencias)

        for (const img of imgs ?? []) {
          const { data: refBlob } = await client.storage.from(img.bucket).download(img.storage_path)
          if (refBlob) referencias.push({ bytes: Buffer.from(await refBlob.arrayBuffer()), mime: img.content_type ?? 'image/jpeg' })
        }
      }

      // El prompt guardado en la configuración es estable y su sha256 permite
      // reconstruir un análisis viejo. Lo que cambia foto a foto —cuántas
      // imágenes de comparación fueron— se agrega acá, sin tocar ese hash.
      const promptFinal = rondaPuntoId
        ? [
            conf.prompt,
            '',
            bloqueContextoVisual({
              referencias: referencias.length,
              positivos: ejemplos.filter(e => e.clase === 'positivo').length,
              negativos: ejemplos.filter(e => e.clase === 'negativo').length,
            }),
          ].join('\n')
        : conf.prompt

      const respuesta = await proveedor.analizar({
        imagen: { bytes, mime: ev.content_type ?? 'image/jpeg' },
        referencias,
        ejemplos,
        prompt: promptFinal,
        schema,
        modelo: conf.modelo,
      })

      const normalizado = normalizarResultado(respuesta.json, criterios)
      if (!normalizado) throw new ErrorProveedor('Respuesta del modelo sin forma utilizable', 'transitorio')

      let efectiva = derivarClasificacion(normalizado, criterios, umbrales)
      let motivosFinales = normalizado.motivos

      // ── Sin con qué comparar ────────────────────────────────────────────
      // Que un punto no tenga referencia ni historial NO es una falta del
      // vigilador: es una configuración incompleta. Se deja el motivo visible
      // para que se pueda corregir, pero no eleva la clasificación — culpar a
      // alguien por una carencia nuestra sería exactamente el error a evitar.
      if (rondaPuntoId && referencias.length === 0 && positivosDisponibles === 0) {
        if (!motivosFinales.includes('SIN_BASE_DE_COMPARACION')) {
          motivosFinales = ['SIN_BASE_DE_COMPARACION', ...motivosFinales]
        }
      }

      // ── Contexto de GPS ─────────────────────────────────────────────────
      // No sustituye al GPS ni lo reinterpreta: agrega el dato al caso para que
      // quien revisa vea las dos señales juntas.
      //
      // El motivo se registra SIEMPRE que la lectura cayó fuera del radio: es un
      // hecho, queda guardado, se puede filtrar y contar, y se ve en la tarjeta.
      //
      // Lo que NO hace es mandar la foto a revisión. Si la imagen está bien, no
      // hay nada que una persona pueda decidir mirándola: ya se sabe que la foto
      // corresponde al punto. Antes cualquier "fuera de radio" elevaba una foto
      // impecable a REVISAR, y con radios de 10 m contra equipos que miden con
      // 30 m de error la bandeja se llenaba de casos sin decisión posible. Un
      // revisor que abre veinte fotos perfectas por día aprende a apretar
      // CORRECTO sin mirar, y ahí se pierde el control entero.
      //
      // El GPS no queda sin control: se sigue viendo por punto en el detalle de
      // la ronda y en los tableros de fuera de radio, que es donde se interpreta
      // junto al resto del recorrido y no foto por foto.
      if (gpsFueraRadio) {
        motivosFinales = ['GPS_FUERA_DE_RADIO', ...motivosFinales]
      }

      // ── Muestra de control ────────────────────────────────────────────
      // Una foto SIN_OBSERVACIONES no va a la bandeja: sería ruido. Pero si
      // NINGUNA se revisa nunca, un falso negativo -la IA dice "normal" sobre
      // una foto que está mal- es indetectable, y es el error más caro.
      // Por eso una cuota diaria de normales entra igual a revisión.
      let enMuestra = false
      if (efectiva === 'SIN_OBSERVACIONES' && modo === 'produccion') {
        const cuota = Number(cuotaMuestra)
        if (cuota > 0) {
          const desdeHoy = new Date(); desdeHoy.setHours(0, 0, 0, 0)
          const { count } = await client
            .from('evidencia_analisis')
            .select('id', { count: 'exact', head: true })
            .eq('en_muestra_control', true)
            .gte('analizado_at', desdeHoy.toISOString())
          enMuestra = (count ?? 0) < cuota
        }
      }

      await client.from('evidencia_analisis').update({
        en_muestra_control: enMuestra,
        estado: 'completado',
        analizado_at: new Date().toISOString(),
        sha256_analizado: sha,
        integridad,
        modelo: respuesta.modelo,
        resultado_json: normalizado as any,
        clasificacion_ia: normalizado.clasificacion,
        clasificacion_efectiva: efectiva,
        evaluable: normalizado.evaluable,
        confianza: normalizado.confianza,
        motivos: motivosFinales,
        // Cuando el desvío entra en el error de medición del propio equipo se
        // dice explícito. Sin esa aclaración, "GPS a 16 m del punto" se lee como
        // un dato acusatorio cuando en realidad el teléfono no puede distinguir
        // esos 16 m de cero.
        resumen: gpsFueraRadio && distanciaMetros != null
          ? `GPS a ${Math.round(distanciaMetros)} m del punto${
              gpsDesvioReal ? '' : ' (dentro del margen de error del equipo)'
            }. ${normalizado.resumen}`.slice(0, 240)
          : normalizado.resumen,
        tokens_entrada: respuesta.tokensEntrada,
        tokens_salida: respuesta.tokensSalida,
        costo_estimado_usd: 0,
      }).eq('id', filaActual.id)

      duraciones.push(Date.now() - arranque)
      resultados.push({
        evidencia_id: ev.id, analisis_id: filaActual.id, estado: 'completado',
        clasificacion_ia: normalizado.clasificacion,
        clasificacion_efectiva: efectiva,
        motivos: motivosFinales,
        resumen: normalizado.resumen,
        // Regla aprobada: la foto aceptada valida el punto; la rechazada lo
        // resuelve como incumplido si no hay GPS ni QR válidos.
        reevaluacion: ev.tipo_evidencia === 'punto_control' ? await reevaluarPuntoRonda(client, ev.proceso_id) : undefined,
      })
    } catch (e: any) {
      const clase = e instanceof ErrorProveedor ? e.clase : 'transitorio'
      await client.from('evidencia_analisis').update({
        estado: clase === 'permanente' ? 'error_definitivo' : 'error',
        error_clase: clase,
        ultimo_error: String(e?.message ?? e).slice(0, 500),
        proximo_intento_at: clase === 'transitorio' ? new Date(Date.now() + 60_000).toISOString() : null,
      }).eq('id', filaActual.id)

      resultados.push({ evidencia_id: ev.id, analisis_id: filaActual.id, estado: 'error', error: String(e?.message ?? e).slice(0, 300) })
    }
  }

  return { resultados, encolados }
}
