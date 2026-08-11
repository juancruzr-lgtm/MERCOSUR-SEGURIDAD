// lib/ia/memoria.ts
//
// Memoria visual de un punto de ronda.
//
// El problema: una sola foto de referencia no alcanza para saber cómo se ve
// realmente un lugar. El mismo portón de noche, con lluvia, con una camioneta
// adelante o con el pasto crecido son cuatro imágenes muy distintas del MISMO
// punto. Comparar contra una única foto produce falsos "no coincide".
//
// La solución no es entrenar un modelo: es mostrarle al modelo cómo se ve ese
// punto en la práctica, usando fotos reales que UNA PERSONA ya confirmó.
//
// REGLA QUE NO SE NEGOCIA: sólo una decisión humana incorpora una foto acá.
// Una predicción de la IA jamás se auto-confirma. Si el sistema aprendiera de
// sus propias salidas, un error se volvería norma en pocas semanas — es la
// deriva clásica, y es irreversible sin revisar todo a mano.
//
// La unidad de aprendizaje es `ronda_punto_id`, no el objetivo: dos puntos del
// mismo predio pueden ser un portón y un pasillo interno. Mezclarlos enseñaría
// exactamente lo contrario de lo que queremos.
//
// Lógica de selección pura y determinista: los mismos candidatos producen
// siempre la misma selección. Sin azar, sin "representatividad" difusa.

import type { SupabaseClient } from '@supabase/supabase-js'

export type ClaseEjemplo = 'positivo' | 'negativo'

/** Una foto ya revisada por una persona, candidata a ser ejemplo. */
export type CandidatoEjemplo = {
  analisis_id: string
  clase: ClaseEjemplo
  bucket: string
  storage_path: string
  content_type: string | null
  contenido_sha256: string | null
  /** Momento de la decisión humana. Puede faltar en filas viejas. */
  revisado_at: string | null
}

export type LimitesMemoria = {
  /** Ejemplos CORRECTOS confirmados que se envían junto a la evidencia. */
  maxPositivos: number
  /** Ejemplos INCORRECTOS. Se mandan pocos: enseñan el borde, no la norma. */
  maxNegativos: number
  /** Cuántos positivos hacen falta para considerar que hay historial propio. */
  minimoParaHistorial: number
}

// Techo de cuota, no de calidad. Cada imagen extra es otro bloque de tokens en
// cada análisis, todos los días. Cuatro imágenes de contexto ya dan al modelo
// el rango de variación de un lugar; la quinta agrega costo, no criterio.
export const LIMITES_MEMORIA_DEFECTO: LimitesMemoria = {
  maxPositivos: 3,
  maxNegativos: 1,
  minimoParaHistorial: 1,
}

/** Cuántos candidatos se traen de la base antes de seleccionar. */
export const MAX_CANDIDATOS = 24

export type SeleccionMemoria = {
  positivos: CandidatoEjemplo[]
  negativos: CandidatoEjemplo[]
  /** Positivos disponibles en total, no sólo los enviados. Sirve para métricas. */
  positivosDisponibles: number
  negativosDisponibles: number
}

/**
 * Elige qué ejemplos se envían.
 *
 * Criterio: los más recientes. Un punto cambia con el tiempo — se repinta, se
 * agrega un cartel, crece un árbol — y lo que importa es cómo se ve HOY. Una
 * foto confirmada hace ocho meses puede describir un lugar que ya no existe.
 *
 * El desempate por `analisis_id` no es decorativo: sin él, dos fotos revisadas
 * en el mismo segundo podrían alternar el orden entre corridas y hacer que el
 * mismo análisis mande imágenes distintas. Con él, la selección es reproducible
 * y un resultado se puede auditar después.
 */
export function seleccionarEjemplos(
  candidatos: CandidatoEjemplo[],
  limites: LimitesMemoria = LIMITES_MEMORIA_DEFECTO,
  excluir: { sha256?: Array<string | null>, analisisId?: string } = {},
): SeleccionMemoria {
  const shaExcluidos = new Set(
    (excluir.sha256 ?? []).filter((s): s is string => typeof s === 'string' && s.length > 0),
  )

  const vistos = new Set<string>()
  const utiles = candidatos.filter(c => {
    if (!c.bucket || !c.storage_path) return false
    if (excluir.analisisId && c.analisis_id === excluir.analisisId) return false

    // La foto que se está analizando no puede ser su propio ejemplo, y una foto
    // ya promovida a referencia formal no se manda dos veces: sería pagar dos
    // veces por la misma imagen en el mismo pedido.
    if (c.contenido_sha256 && shaExcluidos.has(c.contenido_sha256)) return false

    // Dedup dentro del propio conjunto: el mismo archivo puede haber sido
    // analizado más de una vez (reintentos, otra versión de configuración).
    const huella = c.contenido_sha256 ?? `${c.bucket}/${c.storage_path}`
    if (vistos.has(huella)) return false
    vistos.add(huella)
    return true
  })

  const orden = (a: CandidatoEjemplo, b: CandidatoEjemplo) => {
    const fa = a.revisado_at ?? ''
    const fb = b.revisado_at ?? ''
    if (fa !== fb) return fb.localeCompare(fa)
    return a.analisis_id.localeCompare(b.analisis_id)
  }

  const positivos = utiles.filter(c => c.clase === 'positivo').sort(orden)
  const negativos = utiles.filter(c => c.clase === 'negativo').sort(orden)

  return {
    positivos: positivos.slice(0, Math.max(0, limites.maxPositivos)),
    negativos: negativos.slice(0, Math.max(0, limites.maxNegativos)),
    positivosDisponibles: positivos.length,
    negativosDisponibles: negativos.length,
  }
}

/** ¿Hay con qué comparar? Referencia formal o historial humano propio. */
export function hayBaseDeComparacion(
  referenciasFormales: number,
  positivosDisponibles: number,
  limites: LimitesMemoria = LIMITES_MEMORIA_DEFECTO,
): boolean {
  return referenciasFormales > 0 || positivosDisponibles >= limites.minimoParaHistorial
}

// ── Acceso a datos ──────────────────────────────────────────────────────────

export type ImagenPedido = { bytes: Buffer, mime: string }
export type EjemploPedido = ImagenPedido & { clase: ClaseEjemplo }

export type MemoriaPunto = {
  referencias: ImagenPedido[]
  ejemplos: EjemploPedido[]
  positivosDisponibles: number
  negativosDisponibles: number
  referenciasFormales: number
}

/**
 * Trae los candidatos revisados por humanos para un punto.
 *
 * Depende de `evidencia_analisis.ronda_punto_id`, que se completa al analizar.
 * Sin esa columna habría que recorrer ejecuciones → evidencias → análisis en
 * cada foto, dentro del presupuesto de 45 s: caro y frágil.
 */
export async function candidatosDelPunto(
  client: SupabaseClient,
  rondaPuntoId: string,
): Promise<CandidatoEjemplo[]> {
  const { data, error } = await client
    .from('evidencia_analisis')
    .select('id, revision_estado, revisado_at, evidencias!inner(bucket, storage_path, content_type, contenido_sha256)')
    .eq('ronda_punto_id', rondaPuntoId)
    .eq('analisis_tipo', 'punto_control')
    .in('revision_estado', ['CORRECTO', 'INCORRECTO'])
    .order('revisado_at', { ascending: false })
    .limit(MAX_CANDIDATOS)

  if (error || !data) return []

  return data.map((fila: any) => {
    const ev = Array.isArray(fila.evidencias) ? fila.evidencias[0] : fila.evidencias
    return {
      analisis_id: String(fila.id),
      clase: fila.revision_estado === 'CORRECTO' ? 'positivo' : 'negativo',
      bucket: ev?.bucket ?? '',
      storage_path: ev?.storage_path ?? '',
      content_type: ev?.content_type ?? null,
      contenido_sha256: ev?.contenido_sha256 ?? null,
      revisado_at: fila.revisado_at ?? null,
    } as CandidatoEjemplo
  })
}

/**
 * Arma el paquete visual completo de un punto: referencia formal primero,
 * después los ejemplos humanos.
 *
 * Una descarga que falla no rompe el análisis: se sigue con lo que haya. Perder
 * un ejemplo de contexto degrada el juicio; abortar la foto lo pierde entero.
 */
export async function cargarMemoriaPunto(
  client: SupabaseClient,
  rondaPuntoId: string,
  opciones: {
    limites?: LimitesMemoria
    maxReferencias?: number
    excluirSha256?: string | null
  } = {},
): Promise<MemoriaPunto> {
  const limites = opciones.limites ?? LIMITES_MEMORIA_DEFECTO
  const maxReferencias = opciones.maxReferencias ?? 1

  const { data: refs } = await client
    .from('ronda_punto_referencias')
    .select('bucket, storage_path, content_type, contenido_sha256')
    .eq('ronda_punto_id', rondaPuntoId)
    .eq('activo', true)
    .order('vigente_desde', { ascending: false })
    .limit(maxReferencias)

  const referencias: ImagenPedido[] = []
  const shaReferencias: Array<string | null> = []

  for (const ref of refs ?? []) {
    shaReferencias.push(ref.contenido_sha256 ?? null)
    const img = await descargar(client, ref.bucket, ref.storage_path, ref.content_type)
    if (img) referencias.push(img)
  }

  const candidatos = await candidatosDelPunto(client, rondaPuntoId)
  const seleccion = seleccionarEjemplos(candidatos, limites, {
    sha256: [...shaReferencias, opciones.excluirSha256 ?? null],
  })

  const ejemplos: EjemploPedido[] = []
  for (const c of [...seleccion.positivos, ...seleccion.negativos]) {
    const img = await descargar(client, c.bucket, c.storage_path, c.content_type)
    if (img) ejemplos.push({ ...img, clase: c.clase })
  }

  return {
    referencias,
    ejemplos,
    positivosDisponibles: seleccion.positivosDisponibles,
    negativosDisponibles: seleccion.negativosDisponibles,
    referenciasFormales: (refs ?? []).length,
  }
}

async function descargar(
  client: SupabaseClient,
  bucket: string,
  path: string,
  mime: string | null,
): Promise<ImagenPedido | null> {
  if (!bucket || !path) return null
  try {
    const { data } = await client.storage.from(bucket).download(path)
    if (!data) return null
    return { bytes: Buffer.from(await data.arrayBuffer()), mime: mime ?? 'image/jpeg' }
  } catch {
    return null
  }
}
