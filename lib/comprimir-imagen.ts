// Achicar una foto de celular antes de subirla.
//
// ── Por qué hace falta ──────────────────────────────────────────────────────
// Una foto de un celular actual pesa entre 3 y 8 MB. Las funciones de Vercel
// aceptan un body de ~4,5 MB, así que subir el archivo original falla por
// tamaño en cuanto la cámara es medianamente buena — y falla de la peor manera,
// porque el usuario ve que sacó la foto y el sistema le dice que no la pudo
// cargar sin explicar por qué.
//
// El fichaje ya comprimía; la supervisión no, y por eso a los supervisores no
// les entraban las fotos. Esta función es la que usaba el fichaje, movida acá
// para que haya UNA sola y nadie vuelva a subir sin comprimir.
//
// ── Perfiles (octubre 2026) ─────────────────────────────────────────────────
// Hasta ahora había tres copias de esta lógica (supervisión, fichaje y rondas)
// y todas limitaban sólo el ANCHO a 1280 px: una foto vertical quedaba en
// 1280×1707 y una apaisada en 1280×960, y el libro de guardia —que es
// manuscrito y tiene que leerse— salía igual que una foto de uniforme. Ahora
// hay UNA función con perfiles por uso, que limitan el LADO MAYOR:
//
//   operativa       1600 px, q 0,75  rondas, supervisión, uniforme
//   libro_guardia   1800 px, q 0,78  manuscrito: algo más de resolución
//                                    (vertical 1350×1800 contra 1280×1707 de hoy;
//                                    prueba local oct-2026: legible a 1280 y 1600,
//                                    2000 px sumaba ~50% de peso sin ganar lectura)
//   referencia_ia   1600 px, q 0,82  imágenes contra las que compara la IA
//
// 1600 px de lado mayor deja una vertical en 1200×1600 (≈ los mismos píxeles
// que hoy) y una apaisada en 1600×1200 (más que hoy). El modelo de IA (Gemini)
// trabaja internamente a menor resolución, así que más píxeles no mejoran el
// análisis y sí engordan el almacenamiento.

export interface OpcionesCompresion {
  /** Límite del ANCHO (comportamiento histórico). Se ignora si se pasa `ladoMayor`. */
  maxWidth?: number
  /** Límite del lado mayor (alto o ancho). */
  ladoMayor?: number
  quality?: number
  /** Si la compresión tarda más que esto, se falla en vez de colgar la pantalla. */
  timeoutMs?: number
}

export type ErrorCompresion =
  | 'compresion_timeout'
  | 'canvas_no_disponible'
  | 'compresion_blob_fallo'
  | 'imagen_carga_fallo'

export type PerfilFoto = 'operativa' | 'libro_guardia' | 'referencia_ia'

export const PERFILES_FOTO: Record<PerfilFoto, Required<Pick<OpcionesCompresion, 'ladoMayor' | 'quality' | 'timeoutMs'>>> = {
  operativa: { ladoMayor: 1600, quality: 0.75, timeoutMs: 10_000 },
  libro_guardia: { ladoMayor: 1800, quality: 0.78, timeoutMs: 15_000 },
  referencia_ia: { ladoMayor: 1600, quality: 0.82, timeoutMs: 15_000 },
}

/** Tipos que se pueden subir sin comprimir si la compresión falla (nunca HEIC). */
export const TIPOS_ORIGINAL_ACEPTABLE = ['image/jpeg', 'image/png', 'image/webp'] as const

/**
 * Dimensiones de salida. Sólo achica: una foto chica no se agranda.
 * Pura (sin DOM) para poder probarla.
 */
export function dimensionesDestino(
  ancho: number,
  alto: number,
  opciones: Pick<OpcionesCompresion, 'maxWidth' | 'ladoMayor'>,
): { ancho: number; alto: number } {
  const escala = opciones.ladoMayor
    ? Math.min(1, opciones.ladoMayor / Math.max(ancho, alto))
    : Math.min(1, (opciones.maxWidth ?? 1280) / ancho)
  return {
    ancho: Math.max(1, Math.round(ancho * escala)),
    alto: Math.max(1, Math.round(alto * escala)),
  }
}

/**
 * Devuelve un JPEG más liviano, conservando el nombre original.
 *
 * Rechaza con un `Error` cuyo `message` es uno de `ErrorCompresion`: el
 * llamador decide si aborta o sube el original. Nunca resuelve con la imagen
 * sin tocar, porque eso escondería el problema hasta el momento de subir.
 */
export function comprimirImagen(file: File, opciones: OpcionesCompresion = {}): Promise<File> {
  const { quality = 0.75, timeoutMs = 8000 } = opciones

  return new Promise((resolve, reject) => {
    let urlRevoked = false
    const url = URL.createObjectURL(file)
    const revokeUrl = () => { if (!urlRevoked) { urlRevoked = true; URL.revokeObjectURL(url) } }
    // Sin esto, una imagen que no termina de decodificar deja el botón
    // "Guardar" girando para siempre y el supervisor no sabe qué pasó.
    const timer = setTimeout(() => { revokeUrl(); reject(new Error('compresion_timeout')) }, timeoutMs)

    const img = new Image()
    img.onload = () => {
      revokeUrl()
      // El navegador ya aplica la orientación EXIF al decodificar (Chrome 81+,
      // Safari 13.1+): naturalWidth/Height vienen "derechos".
      const { ancho, alto } = dimensionesDestino(img.naturalWidth || img.width, img.naturalHeight || img.height, opciones)
      const canvas = document.createElement('canvas')
      canvas.width = ancho
      canvas.height = alto
      const ctx = canvas.getContext('2d')
      if (!ctx) { clearTimeout(timer); return reject(new Error('canvas_no_disponible')) }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(blob => {
        clearTimeout(timer)
        if (!blob) return reject(new Error('compresion_blob_fallo'))
        resolve(new File([blob], file.name.replace(/\.(heic|heif|png|webp)$/i, '.jpg'), { type: 'image/jpeg' }))
      }, 'image/jpeg', quality)
    }
    img.onerror = () => { clearTimeout(timer); revokeUrl(); reject(new Error('imagen_carga_fallo')) }
    img.src = url
  })
}

/** Comprime con el perfil del uso. Es LA función para fotos operativas. */
export function comprimirFotoOperativa(file: File, perfil: PerfilFoto): Promise<File> {
  return comprimirImagen(file, PERFILES_FOTO[perfil])
}

/**
 * Si la compresión falló, ¿se puede subir el original? Sólo si es un formato
 * que el servidor y la IA aceptan y entra en el límite. Un HEIC (iPhone por
 * galería en Android/Chrome) NO: hoy la supervisión lo subía tal cual.
 */
export function originalSubible(file: { type: string; size: number }): boolean {
  return (TIPOS_ORIGINAL_ACEPTABLE as readonly string[]).includes(file.type) && !superaElLimite(file)
}

/** Un archivo que supera esto no entra en una función de Vercel. */
export const LIMITE_SUBIDA_BYTES = 4 * 1024 * 1024

export function superaElLimite(file: { size: number }): boolean {
  return file.size > LIMITE_SUBIDA_BYTES
}
