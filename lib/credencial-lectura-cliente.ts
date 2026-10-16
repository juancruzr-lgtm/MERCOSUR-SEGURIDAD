/**
 * lib/credencial-lectura-cliente.ts
 *
 * En el celular: comprime la foto, le pide a la IA que la lea (/api/credencial/leer)
 * y recorta y endereza la tarjeta con lo que respondió. Si algo falla devuelve la
 * foto comprimida sin recortar y sin lectura: nunca impide subirla.
 */

import { supabase } from '@/lib/supabase'
import { comprimirImagen } from '@/lib/comprimir-imagen'
import { esPdf, pdfAFoto } from '@/lib/pdf-imagen'
import { giroParaEnderezar, rectRecorte } from '@/lib/credencial-lectura'
import type { LecturaCredencial } from '@/lib/credencial-lectura'

const aBase64 = (f: Blob) => new Promise<string>((ok, mal) => {
  const r = new FileReader()
  r.onload = () => ok(String(r.result).replace(/^data:[^,]+,/, ''))
  r.onerror = () => mal(r.error)
  r.readAsDataURL(f)
})

const cargarImagen = (f: Blob) => new Promise<HTMLImageElement>((ok, mal) => {
  const url = URL.createObjectURL(f)
  const img = new Image()
  img.onload = () => { URL.revokeObjectURL(url); ok(img) }
  img.onerror = () => { URL.revokeObjectURL(url); mal(new Error('imagen')) }
  img.src = url
})

/** Recorta la tarjeta (con margen) y la gira para que el texto quede derecho. */
export async function recortarCredencial(foto: File, l: LecturaCredencial): Promise<File> {
  const img = await cargarImagen(foto)
  const r = rectRecorte(l.caja, img.naturalWidth, img.naturalHeight)
  const { x, y, w, h } = r ?? { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }
  const giro = giroParaEnderezar({ w, h }, l.rotacion)
  if (!r && !giro) return foto
  const girada = giro === 90 || giro === 270
  const c = document.createElement('canvas')
  c.width = girada ? h : w
  c.height = girada ? w : h
  const ctx = c.getContext('2d')
  if (!ctx) return foto
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((giro * Math.PI) / 180)
  ctx.drawImage(img, x, y, w, h, -w / 2, -h / 2, w, h)
  const blob = await new Promise<Blob | null>(ok => c.toBlob(ok, 'image/jpeg', 0.9))
  return blob ? new File([blob], foto.name.replace(/\.\w+$/, '') + '-recortada.jpg', { type: 'image/jpeg' }) : foto
}

/**
 * Lee la credencial con IA y devuelve la foto lista para subir (recortada si se
 * pudo) y la lectura. Sin conexión, sin IA o con error: la foto comprimida y null.
 * Un PDF (escaneo de Administración) se convierte antes en foto (primera página).
 * `empleadoId`: Administración carga para otra persona; el DNI se compara con el de ella.
 */
export async function leerYRecortar(original: File, empleadoId?: string): Promise<{ foto: File; lectura: LecturaCredencial | null }> {
  if (esPdf(original)) {
    try { original = await pdfAFoto(original) } catch { return { foto: original, lectura: null } }
  }
  let foto = original
  try { foto = await comprimirImagen(original, { maxWidth: 1800, quality: 0.85, timeoutMs: 15000 }) } catch { /* se usa la original */ }
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return { foto, lectura: null }
    const res = await fetch('/api/credencial/leer', {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ imagen: await aBase64(foto), empleado_id: empleadoId ?? null }),
    })
    if (!res.ok) return { foto, lectura: null }
    const { lectura } = await res.json() as { lectura?: LecturaCredencial }
    if (!lectura) return { foto, lectura: null }
    if (!lectura.es_credencial) return { foto, lectura }
    return { foto: await recortarCredencial(foto, lectura).catch(() => foto), lectura }
  } catch {
    return { foto, lectura: null }
  }
}

/** Gira la foto un cuarto de vuelta en sentido horario (botón «Girar»). */
export async function girarFoto(foto: File): Promise<File> {
  const img = await cargarImagen(foto)
  const c = document.createElement('canvas')
  c.width = img.naturalHeight
  c.height = img.naturalWidth
  const ctx = c.getContext('2d')
  if (!ctx) return foto
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate(Math.PI / 2)
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  const blob = await new Promise<Blob | null>(ok => c.toBlob(ok, 'image/jpeg', 0.9))
  return blob ? new File([blob], foto.name, { type: 'image/jpeg' }) : foto
}
