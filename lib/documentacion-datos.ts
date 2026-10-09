/**
 * lib/documentacion-datos.ts
 *
 * Lecturas, subida y RPC de la documentación del legajo. La autorización NO
 * se decide acá: las RPC toman la identidad de auth.uid(), Storage sólo deja
 * subir a rutas reservadas y nadie lee el bucket directo.
 *
 * ── Subida ───────────────────────────────────────────────────────────────────
 * 1. Las fotos se achican en el celular (el DNI se sigue leyendo). Los PDF van
 *    como están, hasta 15 MB.
 * 2. Se calcula el SHA-256 de cada archivo final.
 * 3. `documentacion_preparar` reserva el documento (rechaza huellas repetidas)
 *    y devuelve una ruta por archivo.
 * 4. Cada archivo sube DIRECTO a Storage (no pasa por Vercel, que corta en
 *    4,5 MB).
 * 5. /api/documentacion/confirmar: el servidor descarga lo guardado, reconoce
 *    el tipo real, recalcula la huella y recién ahí el documento existe.
 *
 * ── Ver ──────────────────────────────────────────────────────────────────────
 * /api/documentacion/archivo devuelve un enlace de 60 s y registra el acceso.
 */

import { supabase } from '@/lib/supabase'
import { comprimirImagen } from '@/lib/comprimir-imagen'
import { BUCKET_DOCUMENTOS, MAX_BYTES, validarArchivos } from '@/lib/documentacion'
import type {
  ControlDocumentacionDatos, DocumentacionEmpleado, EstadoDocumento, Respuesta, TipoDocumento,
} from '@/lib/documentacion'

const mensaje = (e: { message?: string } | null | undefined, porDefecto: string) =>
  (e?.message ?? '').trim() || porDefecto

async function encabezadoSesion(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function cargarDocumentacion(empleadoId: string): Promise<{ datos: DocumentacionEmpleado | null; error: string | null }> {
  const { data, error } = await supabase.rpc('documentacion_de_empleado', { p_empleado_id: empleadoId })
  if (error) return { datos: null, error: mensaje(error, 'No se pudo cargar la documentación') }
  return { datos: data as DocumentacionEmpleado, error: null }
}

export async function cargarControlDocumentacion(): Promise<{ datos: ControlDocumentacionDatos | null; error: string | null }> {
  const { data, error } = await supabase.rpc('documentacion_control')
  if (error) return { datos: null, error: mensaje(error, 'No se pudo cargar el control') }
  return { datos: data as ControlDocumentacionDatos, error: null }
}

/** SHA-256 en hexadecimal (la misma huella que recalcula el servidor). */
export async function huellaSha256(f: Blob): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', await f.arrayBuffer())
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Deja el archivo listo: las fotos se achican a JPEG; un PDF va como está.
 * Si una foto no se puede leer (p. ej. HEIC en un navegador que no lo abre) y
 * ya es JPG/PNG/WEBP, se sube la original.
 */
export async function prepararArchivo(f: File): Promise<File> {
  if (f.type === 'application/pdf') return f
  if (f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name)) {
    try {
      const c = await comprimirImagen(f, { maxWidth: 2000, quality: 0.82, timeoutMs: 15000 })
      // Si comprimir agrandó (foto ya chica) y la original es admitida, queda la original.
      return c.size < f.size || !['image/jpeg', 'image/png', 'image/webp'].includes(f.type) ? c : f
    } catch {
      if (['image/jpeg', 'image/png', 'image/webp'].includes(f.type) && f.size <= MAX_BYTES) return f
      throw new Error('No pudimos leer esa foto. Probá sacarla de nuevo con la cámara (o elegí una en JPG).')
    }
  }
  throw new Error('Formato no admitido: subí una foto (JPG/PNG) o un PDF.')
}

export async function subirDocumento(p: {
  empleadoId: string
  tipo: TipoDocumento
  fechaEmision: string | null
  venceEl: string | null
  detalle: string | null
  archivos: File[]
  onProgreso?: (texto: string) => void
}): Promise<{ estado: EstadoDocumento | null; error: string | null }> {
  try {
    p.onProgreso?.('Preparando…')
    const listos: File[] = []
    for (const f of p.archivos) listos.push(await prepararArchivo(f))
    const invalido = validarArchivos(p.tipo, listos)
    if (invalido) return { estado: null, error: invalido }
    const huellas = await Promise.all(listos.map(huellaSha256))

    const { data: reserva, error: errPrep } = await supabase.rpc('documentacion_preparar', {
      p_empleado_id: p.empleadoId,
      p_tipo: p.tipo.codigo,
      p_fecha_emision: p.fechaEmision || null,
      p_vence_el: p.venceEl || null,
      p_detalle: p.detalle || null,
      p_archivos: listos.map((f, i) => ({ mime: f.type, bytes: f.size, sha256: huellas[i] })),
    })
    if (errPrep || !reserva) return { estado: null, error: mensaje(errPrep, 'No se pudo preparar la subida') }

    const r = reserva as { documento_id: string; archivos: { orden: number; ruta: string }[] }
    for (let i = 0; i < r.archivos.length; i++) {
      p.onProgreso?.(r.archivos.length > 1 ? `Subiendo ${i + 1} de ${r.archivos.length}…` : 'Subiendo…')
      const { error: errSubida } = await supabase.storage
        .from(BUCKET_DOCUMENTOS)
        .upload(r.archivos[i].ruta, listos[i], { contentType: listos[i].type, upsert: false })
      if (errSubida) return { estado: null, error: 'No se pudo subir el archivo. Revisá la conexión y probá de nuevo.' }
    }

    p.onProgreso?.('Verificando…')
    const resp = await fetch('/api/documentacion/confirmar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await encabezadoSesion()) },
      body: JSON.stringify({ documento_id: r.documento_id }),
    })
    const cuerpo = await resp.json().catch(() => ({})) as { estado?: EstadoDocumento; error?: string }
    if (!resp.ok) return { estado: null, error: cuerpo.error || 'No se pudo guardar el documento' }
    return { estado: cuerpo.estado ?? null, error: null }
  } catch (e) {
    return { estado: null, error: e instanceof Error ? e.message : 'No se pudo subir el documento' }
  }
}

/** Enlace temporal (60 s) a un archivo; queda registrado quién lo abrió. */
export async function abrirArchivo(archivoId: string, modo: 'ver' | 'descargar' = 'ver'): Promise<{ url: string | null; error: string | null }> {
  try {
    const resp = await fetch(`/api/documentacion/archivo?id=${encodeURIComponent(archivoId)}&modo=${modo}`, {
      headers: await encabezadoSesion(), cache: 'no-store',
    })
    const cuerpo = await resp.json().catch(() => ({})) as { url?: string; error?: string }
    if (!resp.ok || !cuerpo.url) return { url: null, error: cuerpo.error || 'No se pudo abrir el archivo' }
    return { url: cuerpo.url, error: null }
  } catch {
    return { url: null, error: 'No se pudo abrir el archivo. Revisá la conexión.' }
  }
}

export async function revisarDocumento(id: string, decision: 'aprobar' | 'rechazar', motivo?: string): Promise<string | null> {
  const { error } = await supabase.rpc('documentacion_revisar', {
    p_documento_id: id, p_decision: decision, p_motivo: motivo ?? null,
  })
  return error ? mensaje(error, 'No se pudo guardar la revisión') : null
}

export async function responderDocumento(id: string, decision: Respuesta, comentario?: string): Promise<string | null> {
  const { error } = await supabase.rpc('documentacion_responder', {
    p_documento_id: id, p_decision: decision, p_comentario: comentario ?? null,
  })
  return error ? mensaje(error, 'No se pudo guardar la respuesta') : null
}

export async function anularDocumento(id: string, motivo: string): Promise<string | null> {
  const { error } = await supabase.rpc('documentacion_anular', { p_documento_id: id, p_motivo: motivo })
  return error ? mensaje(error, 'No se pudo anular') : null
}

export async function marcarSituacion(
  empleadoId: string, tipo: string, situacion: 'no_corresponde' | 'solicitado' | 'sin_efecto', motivo?: string,
): Promise<string | null> {
  const { error } = await supabase.rpc('documentacion_marcar_situacion', {
    p_empleado_id: empleadoId, p_tipo: tipo, p_situacion: situacion, p_motivo: motivo ?? null,
  })
  return error ? mensaje(error, 'No se pudo guardar') : null
}
