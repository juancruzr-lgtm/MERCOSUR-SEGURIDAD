/**
 * lib/protocolos-datos.ts
 *
 * Llamadas a la base de los protocolos por objetivo. La autorización NO se
 * decide acá: cada RPC toma la identidad de auth.uid() y valida turno, alcance
 * o puesto en el servidor. Todo viaja como un único jsonb (PostgREST corta en
 * 1000 filas sin avisar).
 */

import { supabase } from '@/lib/supabase'
import type { DocumentoVigilador, PanelObjetivo, ResumenObjetivo, TipoDiferencia } from '@/lib/protocolos'

type Res<T> = { data: T | null; error: string | null }

async function rpc<T>(nombre: string, args?: Record<string, unknown>): Promise<Res<T>> {
  const { data, error } = await supabase.rpc(nombre, args)
  if (error) return { data: null, error: error.message }
  return { data: data as T, error: null }
}

// ── Vigilador ───────────────────────────────────────────────────────────────

export async function cargarMisDocumentos(): Promise<Res<DocumentoVigilador[]>> {
  const r = await rpc<{ ok: boolean; motivo?: string; documentos: DocumentoVigilador[] }>('protocolo_mis_documentos')
  if (r.error) return { data: null, error: r.error }
  if (!r.data?.ok) return { data: [], error: null }
  return { data: r.data.documentos ?? [], error: null }
}

/** Silenciosa: la persona tiene que poder leer aunque esto falle. */
export async function registrarApertura(versionId: string, turnoId: string | null, abiertoClienteAt: string | null): Promise<{
  ok: boolean; abiertoAt: string | null; red: boolean
}> {
  const { data, error } = await supabase.rpc('protocolo_registrar_apertura', {
    p_version_id: versionId, p_turno_id: turnoId, p_abierto_cliente_at: abiertoClienteAt,
  })
  if (error) return { ok: false, abiertoAt: null, red: true }
  const d = (data ?? {}) as { ok?: boolean; abierto_at?: string }
  return { ok: Boolean(d.ok), abiertoAt: d.abierto_at ?? null, red: false }
}

export async function confirmarLectura(versionId: string, turnoId: string | null): Promise<{
  ok: boolean; error: string | null; confirmadoAt: string | null
}> {
  const r = await rpc<{ ok: boolean; confirmado_at: string }>('protocolo_confirmar_lectura', {
    p_version_id: versionId, p_turno_id: turnoId,
  })
  if (r.error) return { ok: false, error: r.error, confirmadoAt: null }
  return { ok: Boolean(r.data?.ok), error: null, confirmadoAt: r.data?.confirmado_at ?? null }
}

// ── Administración ──────────────────────────────────────────────────────────

export async function cargarPanelObjetivo(objetivoId: string): Promise<Res<PanelObjetivo>> {
  return rpc<PanelObjetivo>('protocolo_panel_objetivo', { p_objetivo_id: objetivoId })
}

export async function cargarResumenGeneral(): Promise<Res<ResumenObjetivo[]>> {
  const r = await rpc<{ objetivos: ResumenObjetivo[] }>('protocolo_resumen_general')
  return { data: r.data?.objetivos ?? null, error: r.error }
}

export async function crearBorrador(a: {
  objetivoId: string; puestoId: string | null; titulo: string; texto: string
  fuenteTipo: 'documento' | 'manual'; fuenteDescripcion: string; notas: string | null
}): Promise<Res<{ id: string; numero: number }>> {
  return rpc('protocolo_crear_borrador', {
    p_objetivo_id: a.objetivoId, p_puesto_id: a.puestoId, p_titulo: a.titulo, p_texto: a.texto,
    p_fuente_tipo: a.fuenteTipo, p_fuente_descripcion: a.fuenteDescripcion, p_fuente_fecha: null, p_notas: a.notas,
  })
}

export async function editarBorrador(versionId: string, titulo: string, texto: string, notas: string | null) {
  return rpc('protocolo_editar_borrador', { p_version_id: versionId, p_titulo: titulo, p_texto: texto, p_notas: notas })
}
export async function enviarAprobacion(versionId: string) {
  return rpc('protocolo_enviar_aprobacion', { p_version_id: versionId })
}
export async function devolverBorrador(versionId: string, motivo: string) {
  return rpc('protocolo_devolver_borrador', { p_version_id: versionId, p_motivo: motivo })
}
export async function confirmarAsociacion(versionId: string, nota: string | null) {
  return rpc('protocolo_confirmar_asociacion', { p_version_id: versionId, p_nota: nota })
}
export async function publicarVersion(versionId: string) {
  return rpc('protocolo_publicar', { p_version_id: versionId })
}
export async function descartarVersion(versionId: string, motivo: string) {
  return rpc('protocolo_descartar', { p_version_id: versionId, p_motivo: motivo })
}

export async function registrarDiferencia(a: {
  objetivoId: string; versionId: string | null; tipo: TipoDiferencia; origen: string
  referenciaOriginal: string | null; descripcion: string; responsable: string | null
}) {
  return rpc('protocolo_registrar_diferencia', {
    p_objetivo_id: a.objetivoId, p_version_id: a.versionId, p_tipo: a.tipo, p_origen: a.origen,
    p_referencia_original: a.referenciaOriginal, p_descripcion: a.descripcion, p_responsable: a.responsable,
  })
}
export async function asignarResponsable(diferenciaId: string, responsable: string) {
  return rpc('protocolo_asignar_responsable', { p_diferencia_id: diferenciaId, p_responsable: responsable })
}
export async function resolverDiferencia(diferenciaId: string, resolucion: string) {
  return rpc('protocolo_resolver_diferencia', { p_diferencia_id: diferenciaId, p_resolucion: resolucion })
}
