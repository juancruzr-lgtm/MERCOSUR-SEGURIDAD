/**
 * lib/estatuto-datos.ts
 *
 * Lecturas y RPC del Estatuto Interno. La autorización NO se decide acá: RLS
 * recorta lo que cada uno lee (lo propio; Administración/Gerencia todo) y las
 * RPC toman la identidad de auth.uid(). Pasar otro empleadoId no le da a nadie
 * la constancia ajena.
 *
 * Todas las lecturas están acotadas (por empleado o por versión): el control
 * nominal viaja como un único jsonb desde `estatuto_control`, porque PostgREST
 * corta en 1000 filas sin avisar.
 */

import { supabase } from '@/lib/supabase'
import type {
  AceptacionEstatuto, AperturaEstatuto, PersonaControl, VersionEstatuto,
} from '@/lib/estatuto'

const COLUMNAS_VERSION =
  'id, identificador, titulo, fecha_documento, archivo_ruta, archivo_nombre, ' +
  'archivo_sha256, archivo_bytes, texto_sha256, estado, publicado_at, publicado_por'

/**
 * Versiones visibles para quien llama. Un vigilador sólo ve las publicadas;
 * Administración y Gerencia también los borradores. Son pocas (una por
 * documento), pero igual se acota.
 */
export async function cargarVersiones(): Promise<{ versiones: VersionEstatuto[]; error: string | null }> {
  const { data, error } = await supabase
    .from('estatuto_versiones')
    .select(COLUMNAS_VERSION)
    .order('fecha_documento', { ascending: false })
    .limit(200)
  return { versiones: (data ?? []) as unknown as VersionEstatuto[], error: error ? error.message : null }
}

/** Constancias y aperturas de una persona (todas sus versiones). */
export async function cargarDeEmpleado(empleadoId: string): Promise<{
  aceptaciones: AceptacionEstatuto[]
  aperturas: AperturaEstatuto[]
  error: string | null
}> {
  const [ac, ap] = await Promise.all([
    supabase.from('estatuto_aceptaciones').select('*')
      .eq('empleado_id', empleadoId).order('aceptado_at', { ascending: false }).limit(200),
    supabase.from('estatuto_aperturas').select('version_id, empleado_id, abierto_at')
      .eq('empleado_id', empleadoId).limit(200),
  ])
  const error = ac.error?.message ?? ap.error?.message ?? null
  return {
    aceptaciones: (ac.data ?? []) as AceptacionEstatuto[],
    aperturas: (ap.data ?? []) as AperturaEstatuto[],
    error,
  }
}

/**
 * Registra la apertura del texto. Silenciosa: la persona tiene que poder leer
 * aunque esto falle (mismo criterio que registrarLectura de la evaluación).
 * Devuelve true si la base confirmó la apertura.
 */
export async function registrarApertura(versionId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('estatuto_registrar_apertura', { p_version_id: versionId })
  if (error || !data) return false
  return Boolean((data as any).ok)
}

export async function aceptarEstatuto(versionId: string): Promise<{
  ok: boolean
  error: string | null
  aceptadoAt: string | null
  declaracion: string | null
}> {
  const { data, error } = await supabase.rpc('estatuto_aceptar', { p_version_id: versionId })
  if (error) return { ok: false, error: error.message, aceptadoAt: null, declaracion: null }
  const d = (data ?? {}) as any
  return { ok: Boolean(d.ok), error: null, aceptadoAt: d.aceptado_at ?? null, declaracion: d.declaracion ?? null }
}

export async function cargarControl(versionId: string | null): Promise<{
  personas: PersonaControl[]
  error: string | null
}> {
  const { data, error } = await supabase.rpc('estatuto_control', { p_version_id: versionId })
  if (error) return { personas: [], error: error.message }
  return { personas: ((data as any)?.personas ?? []) as PersonaControl[], error: null }
}

/** Sólo Gerencia; la RPC lo valida. */
export async function publicarVersion(versionId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('estatuto_publicar_version', { p_version_id: versionId })
  return { error: error ? error.message : null }
}
