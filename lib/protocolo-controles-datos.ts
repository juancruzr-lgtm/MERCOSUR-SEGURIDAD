/**
 * lib/protocolo-controles-datos.ts
 *
 * Llamadas a la base (y a la ruta de IA) de las instrucciones y controles
 * propuestos del protocolo. La autorización NO se decide acá: cada RPC toma la
 * identidad de auth.uid() y valida puesto y alcance en el servidor.
 */

import { supabase } from '@/lib/supabase'
import type { Clasificacion, Destino, PanelControles } from '@/lib/protocolo-controles'

type Res<T> = { data: T | null; error: string | null }

async function rpc<T>(nombre: string, args?: Record<string, unknown>): Promise<Res<T>> {
  const { data, error } = await supabase.rpc(nombre, args)
  if (error) return { data: null, error: error.message }
  return { data: data as T, error: null }
}

export function cargarPanelControles(objetivoId: string) {
  return rpc<PanelControles>('protocolo_controles_panel', { p_objetivo_id: objetivoId })
}

export function dividirInstrucciones(versionId: string) {
  return rpc<{ ok: boolean; creadas: number; obsoletas: number; total: number }>(
    'protocolo_instrucciones_segmentar', { p_version_id: versionId })
}

export function validarInstruccion(instruccionId: string, clasificacion: Clasificacion, quien: string | null, cuando: string | null) {
  return rpc<{ ok: boolean }>('protocolo_instruccion_validar', {
    p_instruccion_id: instruccionId, p_clasificacion: clasificacion, p_quien: quien, p_cuando: cuando,
  })
}

export function proponerControl(instruccionId: string, destino: Destino, texto: string, criticidad: 'normal' | 'alta', foto: boolean) {
  return rpc<{ ok: boolean; id: string }>('protocolo_control_proponer', {
    p_instruccion_id: instruccionId, p_destino: destino, p_texto_item: texto,
    p_criticidad: criticidad, p_foto_obligatoria: foto,
  })
}

export function editarControl(controlId: string, destino: Destino, texto: string, criticidad: 'normal' | 'alta', foto: boolean) {
  return rpc<{ ok: boolean }>('protocolo_control_editar', {
    p_control_id: controlId, p_destino: destino, p_texto_item: texto,
    p_criticidad: criticidad, p_foto_obligatoria: foto,
  })
}

export function aprobarControl(controlId: string) {
  return rpc<{ ok: boolean }>('protocolo_control_aprobar', { p_control_id: controlId })
}

export function rechazarControl(controlId: string, motivo: string) {
  return rpc<{ ok: boolean }>('protocolo_control_rechazar', { p_control_id: controlId, p_motivo: motivo })
}

export function activarControles(objetivoId: string, controlIds: string[]) {
  return rpc<{ ok: boolean; plantilla_creada: boolean; items_nuevos: number; items_reutilizados: number }>(
    'protocolo_controles_activar', { p_objetivo_id: objetivoId, p_control_ids: controlIds })
}

/** Pide a la IA clasificar y proponer. La ruta divide primero si hace falta. */
export async function proponerConIA(versionId: string): Promise<Res<{ creadas: number; omitidas: number; enviadas: number; mensaje?: string }>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return { data: null, error: 'Sesión requerida' }
  try {
    const r = await fetch('/api/protocolos/controles/proponer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ version_id: versionId }),
    })
    const cuerpo = await r.json().catch(() => ({}))
    if (!r.ok) return { data: null, error: cuerpo?.error ?? `Error ${r.status}` }
    return { data: cuerpo, error: null }
  } catch {
    return { data: null, error: 'Sin conexión con el servidor' }
  }
}
