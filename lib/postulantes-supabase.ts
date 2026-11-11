/**
 * lib/postulantes-supabase.ts — implementación real de ApiPostulantes.
 * Datos: RPC postulacion_* con la sesión del usuario (la base decide permisos).
 * Archivos y alta: rutas /api (necesitan la clave de servicio para Storage/Auth,
 * pero cada una primero pide la autorización a la base con la sesión del usuario).
 */
import { supabase, headersSesion } from '@/lib/supabase'
import type { ApiPostulantes, ArchivoPostulacion, Duplicado, Postulacion, ResultadoAlta } from '@/lib/postulantes'
import type { LecturaPropuesta } from '@/components/postulantes/FichaPostulante'

const lanzar = (error: { message?: string } | null) => { if (error) throw new Error(error.message || 'Error de base de datos') }

async function json<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || `Error ${res.status}`)
  return data as T
}

export const apiPostulantesSupabase: ApiPostulantes = {
  async listar() {
    const { data, error } = await supabase.from('postulaciones').select('*').order('creado_at', { ascending: false }).limit(500)
    lanzar(error)
    return (data ?? []) as Postulacion[]
  },
  async crear(datos) {
    const { data, error } = await supabase.rpc('postulacion_crear', { p_datos: datos })
    lanzar(error)
    return data as string
  },
  async guardar(id, datos) {
    const { error } = await supabase.rpc('postulacion_guardar', { p_id: id, p_datos: datos })
    lanzar(error)
  },
  async marcarRevisada(id) {
    const { error } = await supabase.rpc('postulacion_marcar_revisada', { p_id: id })
    lanzar(error)
  },
  async aprobar(id, fechaIngreso, legajo) {
    const { error } = await supabase.rpc('postulacion_aprobar', { p_id: id, p_fecha_ingreso: fechaIngreso, p_legajo: legajo })
    lanzar(error)
  },
  async descartar(id, motivo) {
    const { error } = await supabase.rpc('postulacion_descartar', { p_id: id, p_motivo: motivo })
    lanzar(error)
  },
  async darAlta(id) {
    const res = await fetch(`/api/postulaciones/${id}/alta`, { method: 'POST', headers: await headersSesion() })
    return json<ResultadoAlta>(res)
  },
  async duplicados(p) {
    const { data, error } = await supabase.rpc('postulacion_duplicados', {
      p_dni: p.dni ?? null, p_cuil: p.cuil ?? null, p_email: p.email ?? null, p_telefono: p.telefono ?? null, p_excluir: p.id,
    })
    lanzar(error)
    return (data ?? []) as Duplicado[]
  },
  async archivos(id) {
    const { data, error } = await supabase.from('postulacion_archivos')
      .select('id, orden, mime, bytes, subido_at').eq('postulacion_id', id).order('orden')
    lanzar(error)
    return (data ?? []) as ArchivoPostulacion[]
  },
  async subirArchivo(id, archivo, orden) {
    const h = await headersSesion()
    const form = new FormData()
    form.append('postulacion_id', id)
    form.append('orden', String(orden))
    form.append('archivo', archivo)
    // Con mala señal la subida puede quedar colgada sin error: se corta a los 90 s
    // para que la pantalla no quede en "Subiendo…" para siempre.
    const corte = new AbortController()
    const timer = setTimeout(() => corte.abort(), 90_000)
    let res: Response
    try {
      res = await fetch('/api/postulaciones/archivo', { method: 'POST', headers: { Authorization: h.Authorization }, body: form, signal: corte.signal })
    } catch {
      throw new Error(corte.signal.aborted
        ? 'La foto tardó demasiado en subir. Revisá la señal (o conectate al wifi) y probá de nuevo.'
        : 'No se pudo enviar la foto. Revisá la conexión y probá de nuevo.')
    } finally {
      clearTimeout(timer)
    }
    if (res.status === 413) throw new Error('La foto es demasiado pesada. Sacala de nuevo con la cámara.')
    await json(res)
  },
  async urlArchivo(archivoId) {
    const res = await fetch(`/api/postulaciones/archivo?id=${encodeURIComponent(archivoId)}`, { headers: await headersSesion() })
    return (await json<{ url: string }>(res)).url
  },
  async misDatos() {
    const { data } = await supabase.auth.getUser()
    const u = data.user
    if (!u) return { email: null, telefono: null }
    const { data: fila } = await supabase.from('usuarios').select('email, telefono').eq('auth_user_id', u.id).maybeSingle()
    return { email: (fila?.email ?? u.email ?? null)?.toLowerCase() ?? null, telefono: fila?.telefono ?? null }
  },
  async permisos() {
    const [g, c] = await Promise.all([supabase.rpc('postulacion_gestiona'), supabase.rpc('postulacion_carga_habilitada')])
    return { gestiona: g.data === true, carga: c.data === true }
  },
}

/**
 * Lectura de la solicitud con IA (/api/postulaciones/<id>/leer). Devuelve una
 * PROPUESTA: la ficha la muestra y la persona confirma y guarda.
 * Se ofrece sólo si NEXT_PUBLIC_IA_SOLICITUDES_HABILITADA=1 (y el servidor
 * vuelve a controlar IA_SOLICITUDES_HABILITADA).
 */
export const lecturaIaVisible = process.env.NEXT_PUBLIC_IA_SOLICITUDES_HABILITADA === '1'

export async function leerSolicitudIA(postulacionId: string): Promise<LecturaPropuesta> {
  const res = await fetch(`/api/postulaciones/${postulacionId}/leer`, { method: 'POST', headers: await headersSesion() })
  return json<LecturaPropuesta>(res)
}

export type { ArchivoPostulacion, Duplicado }
