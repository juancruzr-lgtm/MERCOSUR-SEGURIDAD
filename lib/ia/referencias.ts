// lib/ia/referencias.ts
//
// Lógica pura de las Referencias IA: catálogos, validación y vigencia.
// Sin Supabase, sin red, sin proveedor de IA. Todo lo de acá es testeable.
//
// FASE B: esto define QUÉ se espera revisar. El cómo (prompt, modelo, llamada)
// es FASE C y no vive en este archivo.

export type TipoReferenciaIA = 'uniforme' | 'libro_guardia' | 'punto_control'

/**
 * Los tres valores que el modelo podrá devolver por elemento/campo.
 *
 * NO_DETERMINABLE es el valor central de todo el diseño: que algo no se vea en
 * la foto NO significa que falte. Una foto de medio cuerpo no prueba que el
 * vigilador esté descalzo.
 */
export const VALORES_VERIFICACION = ['PRESENTE', 'AUSENTE', 'NO_DETERMINABLE'] as const
export type ValorVerificacion = typeof VALORES_VERIFICACION[number]

export const VALOR_INDETERMINADO: ValorVerificacion = 'NO_DETERMINABLE'

export type ElementoCriterio = {
  clave: string
  etiqueta: string
  requerido: boolean
  nota: string
}

export type CriteriosIA = {
  elementos: ElementoCriterio[]
}

// ── Catálogos iniciales ─────────────────────────────────────────────────────
// Son PUNTOS DE PARTIDA para el alta, no una lista cerrada: Administración
// puede agregar, quitar y renombrar elementos desde la pantalla. Por eso
// `clave` es texto libre normalizado y no un enum de base.

export const ELEMENTOS_UNIFORME: ElementoCriterio[] = [
  { clave: 'camisa',     etiqueta: 'Camisa / chomba',  requerido: true,  nota: '' },
  { clave: 'pantalon',   etiqueta: 'Pantalón',         requerido: true,  nota: '' },
  { clave: 'calzado',    etiqueta: 'Calzado',          requerido: true,  nota: 'Suele quedar fuera de cuadro en fotos de medio cuerpo.' },
  { clave: 'credencial', etiqueta: 'Credencial',       requerido: true,  nota: '' },
  { clave: 'abrigo',     etiqueta: 'Abrigo',           requerido: false, nota: 'Según temporada.' },
  { clave: 'gorra',      etiqueta: 'Gorra',            requerido: false, nota: 'Sólo si el objetivo lo exige.' },
  { clave: 'logo',       etiqueta: 'Logo institucional', requerido: false, nota: '' },
  { clave: 'otros',      etiqueta: 'Otros elementos',  requerido: false, nota: '' },
]

export const CAMPOS_LIBRO: ElementoCriterio[] = [
  { clave: 'fecha',            etiqueta: 'Fecha',                       requerido: true,  nota: '' },
  { clave: 'hora',             etiqueta: 'Hora',                        requerido: true,  nota: '' },
  { clave: 'firma',            etiqueta: 'Firma',                       requerido: true,  nota: '' },
  { clave: 'novedades',        etiqueta: 'Novedades',                   requerido: true,  nota: 'Sólo presencia de escritura. No se transcribe el contenido.' },
  { clave: 'legibilidad',      etiqueta: 'Legibilidad',                 requerido: true,  nota: 'Si no alcanza para determinar, el resultado es EVIDENCIA_INSUFICIENTE.' },
  { clave: 'pagina_visible',   etiqueta: 'Página suficientemente visible', requerido: true, nota: '' },
]

export const CAMPOS_PUNTO_CONTROL: ElementoCriterio[] = [
  { clave: 'coincide_con_referencia', etiqueta: 'Coincide con la foto de referencia', requerido: true,  nota: 'Sólo si el punto tiene referencia cargada. Sin referencia va NO_DETERMINABLE.' },
  { clave: 'escena_interpretable',    etiqueta: 'Escena interpretable',               requerido: true,  nota: 'Se distinguen elementos, no es una superficie uniforme ni una imagen vacía.' },
  { clave: 'sin_obstruccion',         etiqueta: 'Sin obstrucción',                    requerido: true,  nota: 'La cámara no está tapada por dedo, tela ni superficie pegada.' },
  { clave: 'iluminacion_suficiente',  etiqueta: 'Iluminación suficiente',             requerido: false, nota: 'Las rondas nocturnas son legítimamente oscuras.' },
]

export function catalogoInicial(tipo: TipoReferenciaIA): ElementoCriterio[] {
  if (tipo === 'uniforme') return ELEMENTOS_UNIFORME.map(e => ({ ...e }))
  if (tipo === 'libro_guardia') return CAMPOS_LIBRO.map(e => ({ ...e }))
  if (tipo === 'punto_control') return CAMPOS_PUNTO_CONTROL.map(e => ({ ...e }))
  return []
}

export const ETIQUETA_TIPO: Record<TipoReferenciaIA, string> = {
  uniforme: 'Uniforme',
  libro_guardia: 'Libro de guardia',
  punto_control: 'Punto de ronda',
}

// ── Límites de subida ───────────────────────────────────────────────────────
// Coinciden con el bucket `ia-referencias` creado en 20260811100000. Se validan
// también del lado del servidor: el bucket es la última línea, no la única.

export const BUCKET_REFERENCIAS = 'ia-referencias'
export const MAX_BYTES_REFERENCIA = 5 * 1024 * 1024
export const MIME_REFERENCIA_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp'] as const

export function mimePermitido(mime: string | null | undefined): boolean {
  if (!mime) return false
  return (MIME_REFERENCIA_PERMITIDOS as readonly string[]).includes(mime)
}

export function extensionDeMime(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  return 'jpg'
}

/**
 * Verifica que los bytes empiecen con la firma del formato declarado.
 * Mismo control que `firmaImagenValida` en app/api/rondas/evidencia: un
 * Content-Type es una afirmación del cliente, los magic bytes no.
 */
export function firmaImagenValida(buffer: Buffer, mime: string): boolean {
  if (mime === 'image/jpeg') {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  }
  if (mime === 'image/png') {
    return buffer.length >= 8
      && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  }
  if (mime === 'image/webp') {
    return buffer.length >= 12
      && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
      && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  }
  return false
}

// ── Normalización y validación de criterios ─────────────────────────────────

export function normalizarClave(valor: string): string {
  return valor
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

export type ResultadoValidacion =
  | { ok: true, criterios: CriteriosIA }
  | { ok: false, error: string }

/**
 * Valida y normaliza los criterios que llegan del formulario.
 *
 * Rechaza: lista vacía, claves duplicadas, etiquetas vacías, más de 40
 * elementos. Recorta notas largas en vez de rechazar, porque perder el alta
 * entera por una nota de más es peor que truncarla.
 */
export function validarCriterios(entrada: unknown): ResultadoValidacion {
  if (!entrada || typeof entrada !== 'object') {
    return { ok: false, error: 'Criterios inválidos' }
  }
  const bruto = (entrada as { elementos?: unknown }).elementos
  if (!Array.isArray(bruto)) {
    return { ok: false, error: 'Se espera una lista de elementos' }
  }
  if (bruto.length === 0) {
    return { ok: false, error: 'Hay que definir al menos un elemento a revisar' }
  }
  if (bruto.length > 40) {
    return { ok: false, error: 'Máximo 40 elementos por configuración' }
  }

  const vistos = new Set<string>()
  const elementos: ElementoCriterio[] = []

  for (const item of bruto) {
    if (!item || typeof item !== 'object') {
      return { ok: false, error: 'Elemento inválido en la lista' }
    }
    const e = item as Record<string, unknown>
    const etiqueta = typeof e.etiqueta === 'string' ? e.etiqueta.trim() : ''
    if (!etiqueta) {
      return { ok: false, error: 'Todos los elementos necesitan una etiqueta' }
    }
    const clave = normalizarClave(typeof e.clave === 'string' && e.clave.trim() ? e.clave : etiqueta)
    if (!clave) {
      return { ok: false, error: `No se pudo derivar una clave para "${etiqueta}"` }
    }
    if (vistos.has(clave)) {
      return { ok: false, error: `Elemento duplicado: "${etiqueta}"` }
    }
    vistos.add(clave)

    elementos.push({
      clave,
      etiqueta: etiqueta.slice(0, 80),
      requerido: e.requerido === true,
      nota: typeof e.nota === 'string' ? e.nota.trim().slice(0, 240) : '',
    })
  }

  return { ok: true, criterios: { elementos } }
}

export function leerCriterios(valor: unknown): CriteriosIA {
  const r = validarCriterios(valor)
  return r.ok ? r.criterios : { elementos: [] }
}

// ── Vigencia ────────────────────────────────────────────────────────────────

export type ItemVigencia = {
  activo: boolean
  vigente_desde: string
  vigente_hasta?: string | null
}

/**
 * ¿Estaba vigente este item en el momento dado?
 *
 * Rango semiabierto [desde, hasta): el instante exacto de `vigente_hasta` ya
 * pertenece a la referencia siguiente. Evita que dos referencias se solapen por
 * un milisegundo en el borde del reemplazo.
 */
export function estabaVigente(item: ItemVigencia, momento: Date): boolean {
  const desde = new Date(item.vigente_desde).getTime()
  if (Number.isNaN(desde) || momento.getTime() < desde) return false
  if (item.vigente_hasta) {
    const hasta = new Date(item.vigente_hasta).getTime()
    if (!Number.isNaN(hasta) && momento.getTime() >= hasta) return false
  }
  return true
}

/** Vigente ahora = activo + dentro del rango. `activo` solo no alcanza. */
export function estaVigenteAhora(item: ItemVigencia, ahora: Date = new Date()): boolean {
  return item.activo && estabaVigente(item, ahora)
}

/**
 * De un conjunto, cuál regía en un momento dado.
 *
 * Ignora `activo` a propósito: para saber contra qué referencia se analizó una
 * foto de agosto, lo que importa es qué estaba vigente en agosto, no qué está
 * activo hoy. Ésa es toda la razón de ser del versionado (§15 y §7 del pedido).
 * Ante empate gana la de `vigente_desde` más reciente.
 */
export function vigenteEn<T extends ItemVigencia>(items: T[], momento: Date): T | null {
  const candidatos = items.filter(i => estabaVigente(i, momento))
  if (candidatos.length === 0) return null
  return candidatos.reduce((mejor, actual) =>
    new Date(actual.vigente_desde).getTime() > new Date(mejor.vigente_desde).getTime() ? actual : mejor
  )
}

// ── Versiones ───────────────────────────────────────────────────────────────

/**
 * Siguiente versión disponible: v1, v2, v3…
 * Ignora versiones con formato distinto en vez de romper, para que una versión
 * cargada a mano no bloquee el alta siguiente.
 */
export function siguienteVersion(existentes: string[]): string {
  let maximo = 0
  for (const v of existentes) {
    const m = /^v(\d+)$/i.exec(v.trim())
    if (m) {
      const n = Number(m[1])
      if (Number.isFinite(n) && n > maximo) maximo = n
    }
  }
  return `v${maximo + 1}`
}

/** Una configuración sin modelo/prompt es un borrador de FASE B. */
export function esBorrador(config: { modelo?: string | null, prompt?: string | null }): boolean {
  return !config.modelo?.trim() || !config.prompt?.trim()
}

export function etiquetaEstadoConfig(
  config: { activo: boolean, modelo?: string | null, prompt?: string | null } & ItemVigencia,
  ahora: Date = new Date()
): string {
  if (!estaVigenteAhora(config, ahora)) return 'Inactiva'
  if (esBorrador(config)) return 'Activa (borrador)'
  return 'Activa'
}

// ── Paths de Storage ────────────────────────────────────────────────────────
// Deterministas por prefijo y únicos por sufijo aleatorio: dos subidas nunca
// colisionan, así que la subida usa upsert:false y no puede pisar nada.

export function pathReferenciaConfig(configuracionId: string, sufijo: string, mime: string): string {
  return `configuraciones/${configuracionId}/${sufijo}.${extensionDeMime(mime)}`
}

export function pathReferenciaPunto(rondaPuntoId: string, sufijo: string, mime: string): string {
  return `puntos/${rondaPuntoId}/${sufijo}.${extensionDeMime(mime)}`
}
