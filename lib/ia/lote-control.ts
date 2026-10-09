// lib/ia/lote-control.ts
//
// Lote de control de la IA: ¿la compresión nueva cambia lo que ve el modelo?
//
// En Storage no hay originales sin comprimir de rondas ni libros: la app ya los
// achica (libro 1280 px de ancho / 0,75). El perfil nuevo (#280) nunca baja esa
// resolución (operativa 1600 px lado mayor / 0,75; libro 1800 / 0,78). La
// prueba honesta con lo que hay es, para cada foto de la muestra:
//
//   R1  la foto guardada, analizada HOY con el pedido de hoy (mide cuánto varía
//       el modelo solo, sin cambiar nada);
//   R2  la MISMA foto re-codificada con el perfil nuevo (doble compresión, el
//       peor caso), con exactamente el mismo pedido.
//
// Si R1 y R2 coinciden tanto como coinciden dos corridas de R1, la compresión
// no afecta. Todo se compara contra el pedido de hoy (memoria, referencias,
// prompt) para que la única diferencia sea la imagen.
//
// Este módulo NO escribe en la base: sólo lee y llama al proveedor cuando se lo
// ejecuta con autorización (ver scripts/ia-lote-control).

import { createHash } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { bloqueContextoVisual, derivarClasificacion, normalizarResultado, schemaRespuesta } from './contratos'
import type { ResultadoIA, Umbrales } from './contratos'
import { cargarMemoriaPunto, LIMITES_MEMORIA_DEFECTO } from './memoria'
import type { EjemploPedido } from './memoria'
import type { PedidoVision, ProveedorVision } from './proveedor'
import { leerCriterios } from './referencias'
import type { ElementoCriterio } from './referencias'

/** Perfiles de #280 (lib/comprimir-imagen.ts → PERFILES_FOTO). */
export const PERFIL_POR_TIPO: Record<string, { ladoMayor: number; quality: number }> = {
  libro_guardia: { ladoMayor: 1800, quality: 0.78 },
  punto_control: { ladoMayor: 1600, quality: 0.75 },
}

export interface PedidoControl {
  analisisId: string
  tipo: string
  pedido: PedidoVision
  criterios: ElementoCriterio[]
  umbrales: Umbrales
  original: { bytes: Buffer; mime: string; sha256: string }
  resultadoGuardado: unknown
  clasificacionGuardada: string | null
}

/**
 * Rearma el pedido de un análisis ya hecho, como lo arma procesarLote HOY:
 * misma configuración (prompt, modelo, schema), mismas referencias o memoria
 * del punto. Sólo lectura.
 */
export async function armarPedidoControl(client: SupabaseClient, analisisId: string, maxReferencias = 4): Promise<PedidoControl> {
  const { data: a, error } = await client
    .from('evidencia_analisis')
    .select('id, analisis_tipo, configuracion_id, ronda_punto_id, resultado_json, clasificacion_efectiva, evidencias(bucket, storage_path, content_type, contenido_sha256)')
    .eq('id', analisisId)
    .single()
  if (error || !a) throw new Error(`Análisis inexistente: ${analisisId}`)
  const ev = (Array.isArray(a.evidencias) ? a.evidencias[0] : a.evidencias) as { bucket: string; storage_path: string; content_type: string | null; contenido_sha256: string | null }
  const { data: conf } = await client.from('ia_configuraciones').select('id, modelo, prompt, criterios, umbrales').eq('id', a.configuracion_id).single()
  if (!conf?.prompt || !conf.modelo) throw new Error(`Configuración incompleta para ${analisisId}`)

  const { data: blob, error: errDesc } = await client.storage.from(ev.bucket).download(ev.storage_path)
  if (errDesc || !blob) throw new Error(`No se pudo descargar la evidencia de ${analisisId}`)
  const bytes = Buffer.from(await blob.arrayBuffer())
  const sha256 = createHash('sha256').update(bytes).digest('hex')

  const referencias: Array<{ bytes: Buffer; mime: string }> = []
  let ejemplos: EjemploPedido[] = []
  let prompt = conf.prompt as string
  if (a.ronda_punto_id) {
    const memoria = await cargarMemoriaPunto(client, a.ronda_punto_id, {
      limites: LIMITES_MEMORIA_DEFECTO, maxReferencias: 1, excluirSha256: ev.contenido_sha256 ?? sha256,
    })
    referencias.push(...memoria.referencias)
    ejemplos = memoria.ejemplos
    prompt = [conf.prompt, '', bloqueContextoVisual({
      referencias: referencias.length,
      positivos: ejemplos.filter(e => e.clase === 'positivo').length,
      negativos: ejemplos.filter(e => e.clase === 'negativo').length,
    })].join('\n')
  } else {
    const { data: imgs } = await client.from('ia_referencia_imagenes')
      .select('bucket, storage_path, content_type').eq('configuracion_id', conf.id).eq('activo', true).order('orden').limit(maxReferencias)
    for (const img of imgs ?? []) {
      const { data: r } = await client.storage.from(img.bucket).download(img.storage_path)
      if (r) referencias.push({ bytes: Buffer.from(await r.arrayBuffer()), mime: img.content_type ?? 'image/jpeg' })
    }
  }

  const mime = ev.content_type ?? 'image/jpeg'
  return {
    analisisId, tipo: a.analisis_tipo,
    pedido: { imagen: { bytes, mime }, referencias, ejemplos, prompt, schema: schemaRespuesta(), modelo: conf.modelo },
    criterios: leerCriterios(conf.criterios).elementos,
    umbrales: (conf.umbrales ?? {}) as Umbrales,
    original: { bytes, mime, sha256 },
    resultadoGuardado: a.resultado_json,
    clasificacionGuardada: a.clasificacion_efectiva,
  }
}

export interface Lectura {
  clasificacion: string
  resultado: ResultadoIA
  tokensEntrada: number | null
  tokensSalida: number | null
}

export async function analizar(proveedor: ProveedorVision, p: PedidoControl, imagen: { bytes: Buffer; mime: string }): Promise<Lectura> {
  const r = await proveedor.analizar({ ...p.pedido, imagen })
  const normalizado = normalizarResultado(r.json, p.criterios)
  if (!normalizado) throw new Error('Respuesta del modelo sin forma utilizable')
  return {
    clasificacion: derivarClasificacion(normalizado, p.criterios, p.umbrales),
    resultado: normalizado, tokensEntrada: r.tokensEntrada, tokensSalida: r.tokensSalida,
  }
}

export interface Diferencias {
  clasificacion: boolean
  /** Elementos (claves) cuyo valor cambió: PRESENTE/AUSENTE/NO_DETERMINABLE. */
  elementos: string[]
  /** Nitidez/iluminación/encuadre que cambiaron de nivel. */
  calidad: string[]
  /** Pasó de SIN_OBSERVACIONES a otra cosa o al revés: lo que le importa a una persona. */
  critica: boolean
}

export function compararLecturas(a: Lectura, b: Lectura): Diferencias {
  const valores = new Map(a.resultado.elementos.map(e => [e.clave, e.valor]))
  const elementos = b.resultado.elementos.filter(e => valores.has(e.clave) && valores.get(e.clave) !== e.valor).map(e => e.clave)
  const calidad = (['nitidez', 'iluminacion', 'encuadre'] as const).filter(k => a.resultado.calidad[k] !== b.resultado.calidad[k])
  const ok = (c: string) => c === 'SIN_OBSERVACIONES'
  return { clasificacion: a.clasificacion !== b.clasificacion, elementos, calidad, critica: ok(a.clasificacion) !== ok(b.clasificacion) }
}

export interface ItemLote {
  analisisId: string
  tipo: string
  bytesOriginal: number
  bytesNuevo: number
  /** R1 vs R2: efecto de la compresión. */
  compresion: Diferencias
  /** R1 vs R1': variación propia del modelo (sólo si se corrió dos veces). */
  estabilidad?: Diferencias
}

export interface ResumenLote {
  porTipo: Record<string, {
    fotos: number
    cambiosClasificacion: number
    cambiosCriticos: number
    cambiosElementos: number
    cambiosCalidad: number
    variacionPropiaClasificacion: number | null
    ahorroBytes: number
  }>
  /** ¿La compresión cambió más que la variación propia del modelo? */
  veredicto: 'sin_diferencias' | 'dentro_de_la_variacion_del_modelo' | 'revisar'
}

export function resumirLote(items: ItemLote[]): ResumenLote {
  const porTipo: ResumenLote['porTipo'] = {}
  for (const i of items) {
    const t = porTipo[i.tipo] ??= { fotos: 0, cambiosClasificacion: 0, cambiosCriticos: 0, cambiosElementos: 0, cambiosCalidad: 0, variacionPropiaClasificacion: null, ahorroBytes: 0 }
    t.fotos++
    if (i.compresion.clasificacion) t.cambiosClasificacion++
    if (i.compresion.critica) t.cambiosCriticos++
    if (i.compresion.elementos.length) t.cambiosElementos++
    if (i.compresion.calidad.length) t.cambiosCalidad++
    if (i.estabilidad) t.variacionPropiaClasificacion = (t.variacionPropiaClasificacion ?? 0) + (i.estabilidad.clasificacion ? 1 : 0)
    t.ahorroBytes += i.bytesOriginal - i.bytesNuevo
  }
  const tipos = Object.values(porTipo)
  let veredicto: ResumenLote['veredicto'] = 'sin_diferencias'
  if (tipos.some(t => t.cambiosClasificacion > 0)) {
    veredicto = tipos.every(t => t.cambiosCriticos === 0 && t.variacionPropiaClasificacion !== null && t.cambiosClasificacion <= t.variacionPropiaClasificacion)
      ? 'dentro_de_la_variacion_del_modelo' : 'revisar'
  }
  return { porTipo, veredicto }
}

/**
 * Costo estimado del lote con los tokens promedio REALES de producción.
 * llamadasPorFoto: 2 (R1 y R2) o 3 (agrega R1' para medir la variación propia).
 */
export function estimarLote(muestra: Record<string, { fotos: number; tokensEntrada: number; tokensSalida: number }>,
  llamadasPorFoto: number, precioPorMillon?: { entrada: number; salida: number }) {
  let entrada = 0, salida = 0, llamadas = 0
  for (const m of Object.values(muestra)) {
    llamadas += m.fotos * llamadasPorFoto
    entrada += m.fotos * llamadasPorFoto * m.tokensEntrada
    salida += m.fotos * llamadasPorFoto * m.tokensSalida
  }
  const usd = precioPorMillon ? (entrada * precioPorMillon.entrada + salida * precioPorMillon.salida) / 1e6 : null
  return { llamadas, tokensEntrada: entrada, tokensSalida: salida, usd }
}
