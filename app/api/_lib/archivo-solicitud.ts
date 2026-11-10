/**
 * Validación del archivo de una solicitud de empleo (foto o PDF) antes de
 * guardarlo: tipo REAL por los primeros bytes (no por el nombre ni por lo que
 * declara el navegador), tamaño y huella SHA-256 (evita cargar dos veces la
 * misma imagen).
 */
import { createHash } from 'node:crypto'

export const MAX_BYTES_SOLICITUD = 10 * 1024 * 1024

export type TipoArchivoSolicitud = { mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'; ext: 'jpg' | 'png' | 'webp' | 'pdf' }

export function tipoPorFirma(b: Uint8Array): TipoArchivoSolicitud | null {
  if (b.length < 12) return null
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: 'image/png', ext: 'png' }
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: 'image/webp', ext: 'webp' }
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return { mime: 'application/pdf', ext: 'pdf' }
  return null
}

export type ValidacionSolicitud =
  | { ok: true; tipo: TipoArchivoSolicitud; bytes: number; sha256: string }
  | { ok: false; status: number; error: string }

export function validarArchivoSolicitud(buf: Buffer): ValidacionSolicitud {
  if (buf.length === 0) return { ok: false, status: 400, error: 'El archivo está vacío' }
  if (buf.length > MAX_BYTES_SOLICITUD) return { ok: false, status: 413, error: 'El archivo supera los 10 MB' }
  const tipo = tipoPorFirma(new Uint8Array(buf.subarray(0, 16)))
  if (!tipo) return { ok: false, status: 415, error: 'Formato no admitido: subí una foto (JPG, PNG, WebP) o un PDF' }
  return { ok: true, tipo, bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') }
}
