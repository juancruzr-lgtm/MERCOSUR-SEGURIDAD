/**
 * app/api/_lib/validar-foto.ts
 *
 * Control común, en el servidor, de las fotos operativas que suben las rutas
 * de fichaje, rondas y supervisión.
 *
 * ── Por qué ──────────────────────────────────────────────────────────────────
 * La compresión ocurre en el celular (lib/comprimir-imagen). El servidor no
 * re-codifica —no hay librería de imágenes en el proyecto y agregarla en
 * Vercel suma peso y arranque—, pero tiene que impedir que entre cualquier cosa:
 *   * un HEIC o un archivo que no es imagen (antes la supervisión lo guardaba);
 *   * una foto sin comprimir de varios MB (el celular viejo o un fallo de canvas);
 * y tiene que dejar registrada la HUELLA del archivo: `evidencias.contenido_sha256`
 * existe desde agosto (FASE C del análisis IA) pero ninguna ruta la cargaba, así
 * que todos los análisis quedaban como `integridad = sin_hash`.
 */

import { createHash } from 'crypto'

export type MimeFoto = 'image/jpeg' | 'image/png' | 'image/webp'

/** Tipo real por los primeros bytes (no por lo que declara el navegador). */
export function detectarMimeFoto(buffer: Buffer): MimeFoto | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}

/** Compatibilidad con la validación que ya hacía la ruta de rondas. */
export function firmaImagenValida(buffer: Buffer, mime: string): boolean {
  return detectarMimeFoto(buffer) === mime
}

/**
 * Tope de bytes de una foto operativa ya comprimida. Con los perfiles de
 * lib/comprimir-imagen una foto queda en 150-700 KB; 4 MB deja margen para el
 * caso en que el celular no pudo comprimir y subió un JPG original chico.
 */
export const MAX_BYTES_FOTO_OPERATIVA = 4 * 1024 * 1024

// Sin unión discriminada: el proyecto compila sin strictNullChecks y ahí TS no
// angosta por `ok`. Todos los campos existen; los que no aplican quedan undefined.
export interface ResultadoValidacionFoto {
  ok: boolean
  mime?: MimeFoto
  bytes?: number
  sha256?: string
  status?: 400 | 413 | 415
  error?: string
}

export function validarFotoOperativa(buffer: Buffer, maxBytes = MAX_BYTES_FOTO_OPERATIVA): ResultadoValidacionFoto {
  if (!buffer.length) return { ok: false, status: 400, error: 'Foto vacía' }
  if (buffer.length > maxBytes) {
    return { ok: false, status: 413, error: `La foto supera el límite de ${Math.round(maxBytes / 1024 / 1024)} MB. Volvé a sacarla desde la app.` }
  }
  const mime = detectarMimeFoto(buffer)
  if (!mime) return { ok: false, status: 415, error: 'El archivo no es una foto JPG, PNG o WEBP' }
  return { ok: true, mime, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') }
}
