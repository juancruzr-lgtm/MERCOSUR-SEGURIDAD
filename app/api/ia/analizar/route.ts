// app/api/ia/analizar/route.ts
//
// Worker de análisis. Toma evidencias reales, las manda al proveedor y guarda
// el resultado. Invocación MANUAL desde Administración (todavía no hay cron).
//
// DESACOPLADO DEL FICHAJE: esta ruta lee `evidencias` que ya existen. El
// vigilador terminó su ingreso hace rato y nunca espera por acá.
//
// Sólo escribe en `evidencia_analisis` y `ia_lotes`. No toca evidencias,
// asistencia, turnos, horas, GPS, rondas ni alertas.

import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminIA } from '../_lib/auth'
import { leerCriterios } from '@/lib/ia/referencias'
import { derivarClasificacion, normalizarResultado, schemaRespuesta, type Umbrales } from '@/lib/ia/contratos'
import { GeminiVision } from '@/lib/ia/gemini'
import { ErrorProveedor } from '@/lib/ia/proveedor'

export const runtime = 'nodejs'
export const maxDuration = 300

const TIPOS_SOPORTADOS = ['uniforme', 'libro_guardia'] as const
const LIMITE_DURO = 25

type Cuerpo = {
  evidencia_ids?: string[]
  filtros?: { desde?: string, hasta?: string, objetivo_id?: string, guardia_id?: string, tipos?: string[] }
  limite?: number
  modo?: 'prueba' | 'produccion'
  lote_nombre?: string
}

export async function POST(req: NextRequest) {
  const ctx = await requireAdminIA(req)
  if (!ctx.ok) return ctx.respuesta

  let body: Cuerpo
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Body inválido' }, { status: 400 }) }

  // ── Interruptor general ───────────────────────────────────────────────────
  const { data: config } = await ctx.client.from('app_config').select('key, value').like('key', 'ia\\_%')
  const cfg = new Map((config ?? []).map(c => [c.key as string, c.value as string]))
  if (cfg.get('ia_analisis_enabled') !== 'true') {
    return NextResponse.json(
      { error: 'El análisis IA está apagado. Activá ia_analisis_enabled en app_config para habilitarlo.' },
      { status: 409 },
    )
  }

  const modo = body.modo === 'produccion' ? 'produccion' : 'prueba'
  const limite = Math.min(Math.max(1, body.limite ?? Number(cfg.get('ia_lote_max') ?? 10)), LIMITE_DURO)

  // ── Seleccionar evidencias ────────────────────────────────────────────────
  let q = ctx.client
    .from('evidencias')
    .select('id, tipo_evidencia, bucket, storage_path, contenido_sha256, objetivo_id, guardia_id, turno_id, created_at')
    .in('tipo_evidencia', body.filtros?.tipos?.length
      ? body.filtros.tipos.filter(t => (TIPOS_SOPORTADOS as readonly string[]).includes(t))
      : [...TIPOS_SOPORTADOS])
    .order('created_at', { ascending: false })
    .limit(limite)

  if (body.evidencia_ids?.length) q = q.in('id', body.evidencia_ids.slice(0, LIMITE_DURO))
  if (body.filtros?.desde) q = q.gte('created_at', body.filtros.desde)
  if (body.filtros?.hasta) q = q.lte('created_at', body.filtros.hasta)
  if (body.filtros?.objetivo_id) q = q.eq('objetivo_id', body.filtros.objetivo_id)
  if (body.filtros?.guardia_id) q = q.eq('guardia_id', body.filtros.guardia_id)

  const { data: evidencias, error: errorEvidencias } = await q
  if (errorEvidencias) return NextResponse.json({ error: errorEvidencias.message }, { status: 500 })
  if (!evidencias?.length) return NextResponse.json({ analizadas: 0, resultados: [], mensaje: 'Sin evidencias que cumplan el filtro' })

  // ── Configuraciones activas por tipo ──────────────────────────────────────
  const { data: configs } = await ctx.client
    .from('ia_configuraciones')
    .select('*')
    .in('analisis_tipo', [...TIPOS_SOPORTADOS])
    .eq('activo', true)

  const configPorTipo = new Map((configs ?? []).map(c => [c.analisis_tipo as string, c]))

  // ── Lote (sólo en modo prueba) ────────────────────────────────────────────
  let loteId: string | null = null
  if (modo === 'prueba') {
    const { data: lote } = await ctx.client
      .from('ia_lotes')
      .insert({
        nombre: body.lote_nombre?.trim() || `Lote manual ${new Date().toISOString().slice(0, 16)}`,
        modo: 'prueba',
        filtros: { ...(body.filtros ?? {}), limite, evidencia_ids: body.evidencia_ids ?? null },
        total_solicitado: evidencias.length,
        created_by: ctx.usuario.id,
      })
      .select('id')
      .single()
    loteId = lote?.id ?? null
  }

  let proveedor: GeminiVision
  try {
    proveedor = new GeminiVision()
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? 'Proveedor no configurado' }, { status: 500 })
  }

  const schema = schemaRespuesta()
  const resultados: any[] = []
  let encolados = 0

  for (const ev of evidencias) {
    const conf = configPorTipo.get(ev.tipo_evidencia)

    if (!conf) {
      resultados.push({ evidencia_id: ev.id, estado: 'omitida', motivo: `Sin configuración activa para ${ev.tipo_evidencia}` })
      continue
    }
    if (!conf.modelo || !conf.prompt) {
      resultados.push({ evidencia_id: ev.id, estado: 'omitida', motivo: `La configuración ${conf.version} está en borrador: falta prepararla para análisis` })
      continue
    }
    if (!ev.objetivo_id) {
      resultados.push({ evidencia_id: ev.id, estado: 'omitida', motivo: 'Evidencia sin objetivo' })
      continue
    }

    // ── Reclamo idempotente ───────────────────────────────────────────────
    // El índice único de FASE A hace el trabajo: si ya existe, no inserta.
    const { data: fila, error: errorClaim } = await ctx.client
      .from('evidencia_analisis')
      .insert({
        evidencia_id: ev.id,
        analisis_tipo: ev.tipo_evidencia,
        configuracion_id: conf.id,
        configuracion_version: conf.version,
        modo,
        lote_id: loteId,
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
        motivo: errorClaim?.code === '23505'
          ? `Ya analizada con ${conf.version}`
          : (errorClaim?.message ?? 'No se pudo encolar'),
      })
      continue
    }
    encolados++

    const criterios = leerCriterios(conf.criterios).elementos
    const umbrales = (conf.umbrales ?? {}) as Umbrales

    try {
      // ── Descargar bytes ─────────────────────────────────────────────────
      const { data: blob, error: errorDescarga } = await ctx.client.storage
        .from(ev.bucket)
        .download(ev.storage_path)

      if (errorDescarga || !blob) throw new ErrorProveedor('El objeto no existe en Storage', 'permanente')

      const bytes = Buffer.from(await blob.arrayBuffer())
      const sha = createHash('sha256').update(bytes).digest('hex')
      const integridad = !ev.contenido_sha256 ? 'sin_hash' : (sha === ev.contenido_sha256 ? 'coincide' : 'divergente')

      // ── Evidencia alterada: no se llama al proveedor ────────────────────
      if (integridad === 'divergente') {
        await ctx.client.from('evidencia_analisis').update({
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

        resultados.push({ evidencia_id: ev.id, analisis_id: fila.id, estado: 'completado', clasificacion: 'REVISAR', motivo: 'EVIDENCIA_ALTERADA' })
        continue
      }

      // ── Referencias activas ─────────────────────────────────────────────
      const { data: imgs } = await ctx.client
        .from('ia_referencia_imagenes')
        .select('bucket, storage_path, content_type')
        .eq('configuracion_id', conf.id)
        .eq('activo', true)
        .order('orden')
        .limit(3)

      const referencias: Array<{ bytes: Buffer, mime: string }> = []
      for (const img of imgs ?? []) {
        const { data: refBlob } = await ctx.client.storage.from(img.bucket).download(img.storage_path)
        if (refBlob) referencias.push({ bytes: Buffer.from(await refBlob.arrayBuffer()), mime: img.content_type ?? 'image/jpeg' })
      }

      // ── Proveedor ───────────────────────────────────────────────────────
      // Sólo salen los bytes y el prompt. Ni nombre, ni legajo, ni objetivo,
      // ni GPS, ni fecha exacta.
      const respuesta = await proveedor.analizar({
        imagen: { bytes, mime: ev.bucket === 'ronda-evidencias' ? 'image/jpeg' : 'image/jpeg' },
        referencias,
        prompt: conf.prompt,
        schema,
        modelo: conf.modelo,
      })

      const normalizado = normalizarResultado(respuesta.json, criterios)
      if (!normalizado) throw new ErrorProveedor('Respuesta del modelo sin forma utilizable', 'transitorio')

      const efectiva = derivarClasificacion(normalizado, criterios, umbrales)

      await ctx.client.from('evidencia_analisis').update({
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
        evidencia_id: ev.id,
        analisis_id: fila.id,
        estado: 'completado',
        clasificacion_ia: normalizado.clasificacion,
        clasificacion_efectiva: efectiva,
        motivos: normalizado.motivos,
        resumen: normalizado.resumen,
      })
    } catch (e: any) {
      const clase = e instanceof ErrorProveedor ? e.clase : 'transitorio'
      const maxIntentos = Number(cfg.get('ia_max_intentos') ?? 5)

      await ctx.client.from('evidencia_analisis').update({
        estado: clase === 'permanente' ? 'error_definitivo' : 'error',
        error_clase: clase,
        ultimo_error: String(e?.message ?? e).slice(0, 500),
        proximo_intento_at: clase === 'transitorio' ? new Date(Date.now() + 60_000).toISOString() : null,
      }).eq('id', fila.id)

      resultados.push({ evidencia_id: ev.id, analisis_id: fila.id, estado: 'error', clase, error: String(e?.message ?? e).slice(0, 300) })
    }
  }

  if (loteId) {
    await ctx.client.from('ia_lotes').update({ total_encolado: encolados, cerrado_at: new Date().toISOString() }).eq('id', loteId)
  }

  return NextResponse.json({
    lote_id: loteId,
    modo,
    analizadas: resultados.filter(r => r.estado === 'completado').length,
    errores: resultados.filter(r => r.estado === 'error').length,
    omitidas: resultados.filter(r => r.estado === 'omitida').length,
    resultados,
  })
}
