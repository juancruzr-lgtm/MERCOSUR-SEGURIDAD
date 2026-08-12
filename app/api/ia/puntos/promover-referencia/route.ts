// app/api/ia/puntos/promover-referencia/route.ts
//
// Convierte una foto de ronda confirmada como CORRECTA en la referencia visual
// de ese punto.
//
// La idea: si un punto no tiene referencia, la IA no puede comparar nada. Pero
// en cuanto una persona mira una foto de ese punto y dice "está bien", esa foto
// ES la mejor referencia disponible — la validó un humano. A partir de ahí el
// punto queda calibrado solo.
//
// Qué pisa y qué no, según el `origen` de la referencia vigente:
//   · sin referencia activa      → la crea
//   · origen 'revision_humana'   → la reemplaza y cierra la vigencia anterior
//   · origen 'manual'            → no la toca nunca; la cargó Administración
//   · origen desconocido         → no la toca; ante la duda, no se pisa
//
// Antes bastaba con que existiera una referencia activa para bloquear todo, y
// una foto auto-promovida hace meses quedaba tan protegida como una decisión
// de Administración: el punto se congelaba con una imagen que ya no lo describe.
//
// Nada de esto ocurre sin una persona: `revision_estado` lo escribe únicamente
// ia_registrar_revision(). Una predicción de Gemini nunca llega sola hasta acá,
// y un INCORRECTO nunca cambia una referencia.

import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { alcanzaObjetivo, objetivoDePunto, requireOperadorIA } from '../../_lib/auth'
import {
  BUCKET_REFERENCIAS, MAX_BYTES_REFERENCIA, decidirPromocionReferencia, pathReferenciaPunto,
} from '@/lib/ia/referencias'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const ctx = await requireOperadorIA(req)
  if (!ctx.ok) return ctx.respuesta

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Body inválido' }, { status: 400 }) }

  const analisisId = typeof body?.analisis_id === 'string' ? body.analisis_id : ''
  if (!analisisId) return NextResponse.json({ error: 'analisis_id requerido' }, { status: 400 })

  const { data: cfg } = await ctx.client
    .from('app_config').select('value').eq('key', 'ia_ronda_referencia_automatica').maybeSingle()

  const { data: analisis } = await ctx.client
    .from('evidencia_analisis')
    .select('id, analisis_tipo, revision_estado, objetivo_id, evidencias!inner(id, proceso_id, bucket, storage_path, content_type)')
    .eq('id', analisisId)
    .maybeSingle()

  if (!analisis) return NextResponse.json({ error: 'Análisis inexistente' }, { status: 404 })

  const ev: any = Array.isArray(analisis.evidencias) ? analisis.evidencias[0] : analisis.evidencias
  if (!ev?.storage_path) return NextResponse.json({ error: 'Evidencia sin archivo' }, { status: 404 })

  // ── El punto de la ejecución ──────────────────────────────────────────────
  const { data: ejec } = await ctx.client
    .from('ronda_ejecucion_puntos')
    .select('ronda_punto_id')
    .eq('id', ev.proceso_id)
    .maybeSingle()

  if (!ejec?.ronda_punto_id) {
    return NextResponse.json({ promovida: false, motivo: 'No se pudo resolver el punto' })
  }

  const objetivoId = await objetivoDePunto(ctx.client, ejec.ronda_punto_id)
  if (!objetivoId || !(await alcanzaObjetivo(ctx.client, ctx.usuario, objetivoId))) {
    return NextResponse.json({ error: 'Sin alcance sobre el objetivo de este punto' }, { status: 403 })
  }

  // ── ¿Crear, reemplazar o no tocar nada? ───────────────────────────────────
  // La decisión es lógica pura y vive en lib/ia/referencias.ts: una referencia
  // equivocada envenena todos los análisis siguientes de ese punto, así que la
  // regla se prueba exhaustivamente en tests y no se reparte por acá.
  const { data: activa } = await ctx.client
    .from('ronda_punto_referencias')
    .select('id, origen')
    .eq('ronda_punto_id', ejec.ronda_punto_id)
    .eq('activo', true)
    .maybeSingle()

  const decision = decidirPromocionReferencia({
    analisisTipo: analisis.analisis_tipo,
    revisionEstado: analisis.revision_estado,
    referenciaActiva: activa ?? null,
    automatizacionActiva: cfg?.value !== 'false',
  })

  if (decision.accion === 'omitir') {
    return NextResponse.json({ promovida: false, motivo: decision.motivo })
  }

  // ── Copiar los bytes al bucket de referencias ─────────────────────────────
  // Se COPIA, no se enlaza: la evidencia y la referencia tienen ciclos de vida
  // distintos y viven en buckets distintos. Una referencia tiene que seguir
  // siendo válida aunque la evidencia original cambie.
  const { data: blob, error: errorDescarga } = await ctx.client.storage
    .from(ev.bucket).download(ev.storage_path)

  if (errorDescarga || !blob) {
    return NextResponse.json({ error: 'No se pudo leer la evidencia' }, { status: 500 })
  }

  const bytes = Buffer.from(await blob.arrayBuffer())
  if (bytes.length > MAX_BYTES_REFERENCIA) {
    return NextResponse.json({ promovida: false, motivo: 'La foto supera el límite de 5 MB' })
  }

  const mime = ev.content_type ?? 'image/jpeg'
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const path = pathReferenciaPunto(ejec.ronda_punto_id, sha256.slice(0, 16), mime)

  const { error: errorUpload } = await ctx.client.storage
    .from(BUCKET_REFERENCIAS)
    .upload(path, bytes, { contentType: mime, upsert: false })

  // Si el objeto ya existe es la misma imagen (el path deriva del hash): se sigue.
  if (errorUpload && !/exists/i.test(errorUpload.message)) {
    return NextResponse.json({ error: errorUpload.message }, { status: 500 })
  }

  const ahora = new Date().toISOString()

  // Reemplazo con historia: la anterior NO se borra, se le cierra la vigencia.
  // Se cierra ANTES de insertar la nueva para que no queden dos activas ni por
  // un instante — mismo orden que usa la carga manual. Si el insert siguiente
  // falla, el punto queda sin referencia activa pero con todo el histórico
  // intacto: se recupera reactivándola desde el editor, y nada se pierde.
  if (decision.accion === 'reemplazar') {
    const { error: errorCierre } = await ctx.client
      .from('ronda_punto_referencias')
      .update({ activo: false, vigente_hasta: ahora })
      .eq('id', decision.referenciaAnteriorId)
      .eq('activo', true)

    if (errorCierre) {
      return NextResponse.json(
        { error: `No se pudo cerrar la referencia anterior: ${errorCierre.message}` },
        { status: 500 },
      )
    }
  }

  const { data: fila, error: errorInsert } = await ctx.client
    .from('ronda_punto_referencias')
    .insert({
      ronda_punto_id: ejec.ronda_punto_id,
      bucket: BUCKET_REFERENCIAS,
      storage_path: path,
      contenido_sha256: sha256,
      bytes: bytes.length,
      content_type: mime,
      descripcion: 'Tomada de una foto real confirmada como correcta en la revisión.',
      origen: 'revision_humana',
      activo: true,
      vigente_desde: ahora,
      created_by: ctx.usuario.id,
    })
    .select('id')
    .single()

  if (errorInsert) {
    return NextResponse.json({ error: errorInsert.message }, { status: 500 })
  }

  return NextResponse.json({ promovida: true, referencia_id: fila.id, ronda_punto_id: ejec.ronda_punto_id })
}
