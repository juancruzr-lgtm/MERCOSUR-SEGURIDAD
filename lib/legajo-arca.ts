/**
 * lib/legajo-arca.ts
 *
 * Corroboración ARCA (Padrón A13) dentro del Legajo Digital. Se muestra la
 * ÚLTIMA consulta guardada (no se consulta al abrir) y Administración puede
 * pedir una nueva. ARCA corrobora: nunca cambia los datos del legajo, y un
 * estado fiscal distinto de ACTIVO no es una baja laboral.
 */

import { supabase } from '@/lib/supabase'

export interface ArcaDeEmpleado {
  registrado: { cuil: string | null; nombre: string | null; apellido: string | null }
  arca: {
    cuil: string | null; existe: boolean; estado: string | null; tipo_persona: string | null
    nombre: string | null; apellido: string | null; direccion: string | null; localidad: string | null
    cod_postal: string | null; provincia: string | null; novedades: string[]; error: string | null; consultado_at: string
  } | null
  consultas: { at: string; ok: boolean | null; origen: string | null; quien: string | null }[]
}

export type ResultadoArca = 'coincide' | 'diferencias' | 'sin_corroborar'

export const TEXTO_RESULTADO: Record<ResultadoArca, { texto: string; color: string }> = {
  coincide: { texto: 'Coincide', color: '#86efac' },
  diferencias: { texto: 'Diferencias', color: '#fbbf24' },
  sin_corroborar: { texto: 'Sin corroborar', color: '#94a3b8' },
}

export const TEXTO_NOVEDAD: Record<string, string> = {
  sin_cuil: 'CUIL faltante o inválido en MERCOSUR',
  cuil_inexistente: 'ARCA no encontró el CUIL',
  estado_no_activo: 'Estado fiscal distinto de ACTIVO (dato fiscal, no laboral)',
  apellido_difiere: 'El apellido difiere',
  nombre_difiere: 'El nombre difiere',
}

const soloDigitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

/**
 * Coincide sólo si ARCA encontró a la persona con el CUIL registrado y no hay
 * diferencias. Sin consulta, o con una consulta fallida, es «sin corroborar».
 */
export function resultadoArca(d: Pick<ArcaDeEmpleado, 'registrado' | 'arca'>): ResultadoArca {
  const a = d.arca
  if (!a) return 'sin_corroborar'
  if (!a.existe) return a.novedades.includes('cuil_inexistente') ? 'diferencias' : 'sin_corroborar'
  if (a.novedades.length) return 'diferencias'
  if (soloDigitos(a.cuil) !== soloDigitos(d.registrado.cuil)) return 'diferencias'
  return 'coincide'
}

/** El CUIL registrado cambió después de la última consulta: hay que volver a corroborar. */
export function cuilCambio(d: Pick<ArcaDeEmpleado, 'registrado' | 'arca'>): boolean {
  return !!d.arca && soloDigitos(d.arca.cuil) !== soloDigitos(d.registrado.cuil)
}

export function domicilioFiscal(a: ArcaDeEmpleado['arca']): string | null {
  if (!a) return null
  const partes = [a.direccion, a.localidad, a.cod_postal ? `CP ${a.cod_postal}` : null, a.provincia].filter(Boolean)
  return partes.length ? partes.join(', ') : null
}

export async function cargarArca(empleadoId: string): Promise<{ datos: ArcaDeEmpleado | null; denegado: boolean; error: string | null }> {
  const { data, error } = await supabase.rpc('legajo_arca_de_empleado', { p_empleado_id: empleadoId })
  if (error) {
    const denegado = error.code === '42501' || /Sólo Administración/.test(error.message ?? '')
    return { datos: null, denegado, error: denegado ? null : (error.message || 'No se pudo leer la corroboración') }
  }
  return { datos: data as ArcaDeEmpleado, denegado: false, error: null }
}

export async function corroborarDesdeLegajo(empleadoId: string): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return 'Sesión vencida: volvé a ingresar'
  try {
    const res = await fetch(`/api/legajo/${empleadoId}/arca`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    const j = await res.json().catch(() => ({}))
    if (!res.ok || j.ok === false) return j.error || 'La consulta a ARCA falló'
    return null
  } catch {
    return 'No hay conexión'
  }
}
