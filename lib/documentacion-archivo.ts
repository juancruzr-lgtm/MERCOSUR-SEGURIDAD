/**
 * lib/documentacion-archivo.ts
 *
 * Reconocer el tipo REAL de un archivo del legajo por sus primeros bytes (no
 * por la extensión ni por lo que dice el navegador). Sin dependencias: lo usa
 * el servidor al verificar una subida y las pruebas.
 */

export type MimeDocumento = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'

const empieza = (b: Uint8Array, firma: number[], desde = 0) =>
  b.length >= desde + firma.length && firma.every((x, i) => b[desde + i] === x)

export function detectarMimeDocumento(bytes: Uint8Array): MimeDocumento | null {
  if (empieza(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (empieza(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  // RIFF....WEBP
  if (empieza(bytes, [0x52, 0x49, 0x46, 0x46]) && empieza(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  // %PDF- (algunos generadores dejan basura antes: se acepta dentro del primer KB)
  const cabecera = bytes.subarray(0, 1024)
  for (let i = 0; i + 4 < cabecera.length; i++) {
    if (cabecera[i] === 0x25 && cabecera[i + 1] === 0x50 && cabecera[i + 2] === 0x44 && cabecera[i + 3] === 0x46 && cabecera[i + 4] === 0x2d) return 'application/pdf'
  }
  return null
}

const EXTENSION: Record<MimeDocumento, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf',
}

/** Nombre de descarga sin datos personales: tipo y página. */
export function nombreDescarga(tipo: string, orden: number, mime: string): string {
  const ext = EXTENSION[mime as MimeDocumento] ?? 'bin'
  const limpio = tipo.replace(/[^a-z0-9_]/gi, '').slice(0, 40) || 'documento'
  return `${limpio}-${orden}.${ext}`
}

/** IP del pedido tal como llega (Vercel completa x-forwarded-for). */
export function ipDelPedido(h: { get(n: string): string | null }): string | null {
  return (h.get('x-forwarded-for') ?? h.get('x-real-ip'))?.slice(0, 200) ?? null
}
