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
// ── Los valores por defecto ─────────────────────────────────────────────────
// 1280 px de ancho y calidad 0,75 dejan la foto en torno a 200-400 KB, que
// entra con holgura y sigue siendo legible para ver un uniforme, un libro de
// actas o el estado de un puesto. No es una foto de archivo: es evidencia
// operativa.

export interface OpcionesCompresion {
  maxWidth?: number
  quality?: number
  /** Si la compresión tarda más que esto, se falla en vez de colgar la pantalla. */
  timeoutMs?: number
}

export type ErrorCompresion =
  | 'compresion_timeout'
  | 'canvas_no_disponible'
  | 'compresion_blob_fallo'
  | 'imagen_carga_fallo'

/**
 * Devuelve un JPEG más liviano, conservando el nombre original.
 *
 * Rechaza con un `Error` cuyo `message` es uno de `ErrorCompresion`: el
 * llamador decide si aborta o sube el original. Nunca resuelve con la imagen
 * sin tocar, porque eso escondería el problema hasta el momento de subir.
 */
export function comprimirImagen(file: File, opciones: OpcionesCompresion = {}): Promise<File> {
  const { maxWidth = 1280, quality = 0.75, timeoutMs = 8000 } = opciones

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
      // Sólo se achica: una foto que ya es chica no se agranda.
      const scale = Math.min(1, maxWidth / img.width)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) { clearTimeout(timer); return reject(new Error('canvas_no_disponible')) }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(blob => {
        clearTimeout(timer)
        if (!blob) return reject(new Error('compresion_blob_fallo'))
        resolve(new File([blob], file.name, { type: 'image/jpeg' }))
      }, 'image/jpeg', quality)
    }
    img.onerror = () => { clearTimeout(timer); revokeUrl(); reject(new Error('imagen_carga_fallo')) }
    img.src = url
  })
}

/** Un archivo que supera esto no entra en una función de Vercel. */
export const LIMITE_SUBIDA_BYTES = 4 * 1024 * 1024

export function superaElLimite(file: { size: number }): boolean {
  return file.size > LIMITE_SUBIDA_BYTES
}
