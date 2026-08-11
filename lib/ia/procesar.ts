// lib/ia/procesar.ts
//
// Núcleo del análisis. Lo usan las dos vías:
//   - /api/ia/analizar  → manual, desde Administración, modo prueba
//   - /api/ia/cron      → automático, pg_cron cada 5 min, modo produccion
//
// Server-side únicamente: recibe un cliente con service_role ya construido.

import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { leerCriterios } from './referencias'
import { derivarClasificacion, normalizarResultado, schemaRespuesta, type Umbrales } from './contratos'
import { GeminiVision } from './gemini'
import { ErrorProveedor } from './proveedor'

export const TIPOS_SOPORTADOS = ['uniforme', 'libro_guardia'] as const
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
}

export async function procesarLote(op: OpcionesProceso): Promise<{ resultados: ResultadoItem[], encolados: number }> {
  const { client, modo, limite, filtros, loteId, presupuestoMs, cuotaMuestra = 0 } = op
  const inicio = Date.now()
  const RESERVA_MS = 8_000

  const tipos = filtros?.tipos?.length
    ? filtros.tipos.filter(t => (TIPOS_SOPORTADOS as readonly string[]).includes(t))
    : [...TIPOS_SOPORTADOS]

  let q = client
    .from('evidencias')
    .select('id, tipo_evidencia, bucket, storage_path, content_type, contenido_sha256, objetivo_id, guardia_id, turno_id, created_at')
    .in('tipo_evidencia', tipos)
    .order('created_at', { ascending: false })
    .limit(Math.min(limite, LIMITE_DURO))

  if (filtros?.evidencia_ids?.length) q = q.in('id', filtros.evidencia_ids.slice(0, LIMITE_DURO))
  if (filtros?.desde) q = q.gte('created_at', filtros.desde)
  if (filtros?.hasta) q = q.lte('created_at', filtros.hasta)
  if (filtros?.objetivo_id) q = q.eq('objetivo_id', filtros.objetivo_id)
  if (filtros?.guardia_id) q = q.eq('guardia_id', filtros.guardia_id)

  const { data: evidencias, error } = await q
  if (error) throw new Error(error.message)
  if (!evidencias?.length) return { resultados: [], encolados: 0 }

  const { data: configs } = await client
    .from('ia_configuraciones')
    .select('*')
    .in('analisis_tipo', tipos)
    .eq('activo', true)

  const configPorTipo = new Map((configs ?? []).map(c => [c.analisis_tipo as string, c]))

  const proveedor = new GeminiVision()
  const schema = schemaRespuesta()
  const resultados: ResultadoItem[] = []
  let encolados = 0

  for (const ev of evidencias) {
    // Corte por presupuesto ANTES de reclamar la fila: lo que no llegamos a
    // analizar queda sin encolar, no colgado en 'procesando'.
    if (Date.now() - inicio > presupuestoMs - RESERVA_MS) {
      resultados.push({ evidencia_id: ev.id, estado: 'omitida', motivo: 'Sin tiempo en este lote' })
      continue
    }

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
        evidencia_created_at: ev.created_at,
        sha256_esperado: ev.contenido_sha256,
        estado: 'procesando',
        intentos: 1,
        proveedor: 'gemini',
        modelo: conf.modelo,
      })
      .select('id')
      .single()

    if (errorClaim || !fila) {
      resultados.push({
        evidencia_id: ev.id,
        estado: 'omitida',
        motivo: errorClaim?.code === '23505' ? `Ya analizada con ${conf.version}` : (errorClaim?.message ?? 'No se pudo encolar'),
      })
      continue
    }
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
        }).eq('id', fila.id)

        resultados.push({ evidencia_id: ev.id, analisis_id: fila.id, estado: 'completado', clasificacion_efectiva: 'REVISAR', motivos: ['EVIDENCIA_ALTERADA'] })
        continue
      }

      const { data: imgs } = await client
        .from('ia_referencia_imagenes')
        .select('bucket, storage_path, content_type')
        .eq('configuracion_id', conf.id)
        .eq('activo', true)
        .order('orden')
        .limit(2)

      const referencias: Array<{ bytes: Buffer, mime: string }> = []
      for (const img of imgs ?? []) {
        const { data: refBlob } = await client.storage.from(img.bucket).download(img.storage_path)
        if (refBlob) referencias.push({ bytes: Buffer.from(await refBlob.arrayBuffer()), mime: img.content_type ?? 'image/jpeg' })
      }

      const respuesta = await proveedor.analizar({
        imagen: { bytes, mime: ev.content_type ?? 'image/jpeg' },
        referencias,
        prompt: conf.prompt,
        schema,
        modelo: conf.modelo,
      })

      const normalizado = normalizarResultado(respuesta.json, criterios)
      if (!normalizado) throw new ErrorProveedor('Respuesta del modelo sin forma utilizable', 'transitorio')

      const efectiva = derivarClasificacion(normalizado, criterios, umbrales)

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
        motivos: normalizado.motivos,
        resumen: normalizado.resumen,
        tokens_entrada: respuesta.tokensEntrada,
        tokens_salida: respuesta.tokensSalida,
        costo_estimado_usd: 0,
      }).eq('id', fila.id)

      resultados.push({
        evidencia_id: ev.id, analisis_id: fila.id, estado: 'completado',
        clasificacion_ia: normalizado.clasificacion,
        clasificacion_efectiva: efectiva,
        motivos: normalizado.motivos,
        resumen: normalizado.resumen,
      })
    } catch (e: any) {
      const clase = e instanceof ErrorProveedor ? e.clase : 'transitorio'
      await client.from('evidencia_analisis').update({
        estado: clase === 'permanente' ? 'error_definitivo' : 'error',
        error_clase: clase,
        ultimo_error: String(e?.message ?? e).slice(0, 500),
        proximo_intento_at: clase === 'transitorio' ? new Date(Date.now() + 60_000).toISOString() : null,
      }).eq('id', fila.id)

      resultados.push({ evidencia_id: ev.id, analisis_id: fila.id, estado: 'error', error: String(e?.message ?? e).slice(0, 300) })
    }
  }

  return { resultados, encolados }
}
