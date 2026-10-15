/**
 * lib/tareas-turno-datos.ts
 *
 * Llamadas a la base de las tareas del turno. Toda la autorización la hacen
 * las RPC (turnos propios para el vigilador; alcance de zona para supervisión;
 * Gerencia para activar) y la ruta de foto.
 */

import { supabase } from '@/lib/supabase'
import type { EstadoTarea, EvidenciaTarea, Momento, PanelTareas, TurnoConTareas } from '@/lib/tareas-turno'

type Res<T> = { data: T | null; error: string | null }

async function rpc<T>(nombre: string, args?: Record<string, unknown>): Promise<Res<T>> {
  const { data, error } = await supabase.rpc(nombre, args)
  if (error) return { data: null, error: error.message }
  return { data: data as T, error: null }
}

export async function cargarMisTareas(): Promise<Res<TurnoConTareas[]>> {
  const r = await rpc<{ ok: boolean; turnos: TurnoConTareas[] }>('tareas_turno_mias')
  return { data: r.data?.turnos ?? (r.error ? null : []), error: r.error }
}

export function registrarTarea(turnoId: string, definicionId: string, estado: EstadoTarea, comentario: string | null) {
  return rpc<{ ok: boolean; id: string; estado: EstadoTarea; pide_foto: boolean }>('tareas_turno_registrar', {
    p_turno_id: turnoId, p_definicion_id: definicionId, p_estado: estado, p_comentario: comentario,
  })
}

export function cargarPanelTareas(objetivoId: string, dias = 7) {
  return rpc<PanelTareas>('tareas_turno_panel', { p_objetivo_id: objetivoId, p_dias: dias })
}

export function activarTareas(objetivoId: string, items: { control_id: string; momento: Momento; evidencia: EvidenciaTarea }[]) {
  return rpc<{ ok: boolean; nuevas: number; reutilizadas: number }>('tareas_turno_activar', { p_objetivo_id: objetivoId, p_items: items })
}

export function desactivarTarea(definicionId: string, motivo: string) {
  return rpc<{ ok: boolean }>('tareas_turno_desactivar', { p_definicion_id: definicionId, p_motivo: motivo })
}

async function token(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}

/** Sube la foto de una tarea ya marcada como hecha. */
export async function subirFotoTarea(registroId: string, foto: Blob): Promise<{ error: string | null }> {
  const t = await token()
  if (!t) return { error: 'Sesión vencida: volvé a ingresar.' }
  const form = new FormData()
  form.append('registroId', registroId)
  form.append('foto', foto, 'tarea.jpg')
  try {
    const r = await fetch('/api/tareas-turno/foto', { method: 'POST', headers: { Authorization: `Bearer ${t}` }, body: form })
    if (!r.ok) return { error: (await r.json().catch(() => null))?.error ?? `No se pudo subir (${r.status})` }
    return { error: null }
  } catch {
    return { error: 'Sin conexión: probá de nuevo cuando vuelva la señal.' }
  }
}

/** Enlace firmado de 60 s para ver la foto (propia o de un objetivo del alcance). */
export async function urlFotoTarea(registroId: string): Promise<{ url: string | null; error: string | null }> {
  const t = await token()
  if (!t) return { url: null, error: 'Sesión vencida' }
  const r = await fetch(`/api/tareas-turno/foto?registro=${encodeURIComponent(registroId)}`, { headers: { Authorization: `Bearer ${t}` } })
  const d = await r.json().catch(() => null)
  if (!r.ok) return { url: null, error: d?.error ?? 'No se pudo abrir la foto' }
  return { url: d?.url ?? null, error: null }
}
