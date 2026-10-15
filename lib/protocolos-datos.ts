/**
 * lib/protocolos-datos.ts
 *
 * Llamadas a la base de los protocolos por objetivo. La autorización NO se
 * decide acá: cada RPC toma la identidad de auth.uid() y valida turno, alcance
 * o puesto en el servidor. Todo viaja como un único jsonb (PostgREST corta en
 * 1000 filas sin avisar).
 */

import { supabase } from '@/lib/supabase'
import type { DocumentoVigilador, PanelObjetivo, ResumenObjetivo } from '@/lib/protocolos'

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

/** Resultado de guardar o hacer regir. */
export interface ResultadoVigencia {
  ok: boolean
  id: string
  numero?: number
  ya_vigente: boolean
  /** Controles activos (checklist, tareas) que salían de la versión reemplazada. */
  controles_version_anterior?: number
}

/**
 * Traduce los rechazos de la base a lo que la persona tiene que hacer.
 * `conflicto`: otra persona guardó antes; `confirmarObjetivo`: texto dudoso.
 */
function leerRechazo(error: string | null): { error: string | null; conflicto: boolean; confirmarObjetivo: boolean } {
  if (!error) return { error: null, conflicto: false, confirmarObjetivo: false }
  if (error.includes('conflicto_version')) {
    return { error: 'Otra persona guardó una versión más nueva mientras editabas. Copiá tu texto, actualizá y volvé a aplicar tus cambios.', conflicto: true, confirmarObjetivo: false }
  }
  if (error.includes('requiere_confirmar_objetivo')) {
    return { error: 'Falta confirmar que este protocolo corresponde a este objetivo.', conflicto: false, confirmarObjetivo: true }
  }
  return { error, conflicto: false, confirmarObjetivo: false }
}

/**
 * Guarda un texto como versión nueva y la deja vigente (la anterior queda en
 * el historial). `vigenteEsperada`: la vigente que había en pantalla al
 * empezar a editar; si otra persona guardó antes, la base lo rechaza.
 */
export async function guardarProtocolo(a: {
  objetivoId: string; puestoId: string | null; titulo: string; texto: string
  baseVersionId: string | null; vigenteEsperada: string | null; confirmarObjetivo?: boolean
}) {
  const r = await rpc<ResultadoVigencia>('protocolo_guardar', {
    p_objetivo_id: a.objetivoId, p_puesto_id: a.puestoId, p_titulo: a.titulo, p_texto: a.texto,
    p_base_version_id: a.baseVersionId, p_vigente_esperada: a.vigenteEsperada,
    p_confirmar_objetivo: a.confirmarObjetivo ?? false,
  })
  return { data: r.data, ...leerRechazo(r.error) }
}

/** Hace regir una versión que todavía es borrador. */
export async function hacerVigente(versionId: string, vigenteEsperada: string | null, confirmarObjetivo = false) {
  const r = await rpc<ResultadoVigencia>('protocolo_hacer_vigente', {
    p_version_id: versionId, p_vigente_esperada: vigenteEsperada, p_confirmar_objetivo: confirmarObjetivo,
  })
  return { data: r.data, ...leerRechazo(r.error) }
}
