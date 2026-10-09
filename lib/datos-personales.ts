/**
 * lib/datos-personales.ts
 *
 * Datos personales del legajo (Etapa 1 del Legajo Digital). La autorización la
 * decide la base: las RPC toman la identidad de auth.uid() y rechazan a quien
 * no es la persona ni Administración/Gerencia. Ver la migración
 * 20261009130000_legajo_datos_personales.sql.
 */

import { supabase } from '@/lib/supabase'

export interface CampoLegajo {
  campo: string
  etiqueta: string
  grupo: 'personales' | 'domicilio' | 'emergencia' | 'laborales'
  tipo: 'texto' | 'fecha'
  orden: number
  vigilador_propone: boolean
  requiere_validacion: boolean
}

export type EstadoCambio = 'pendiente_confirmacion' | 'pendiente' | 'aprobado' | 'rechazado' | 'aplicado' | 'descartado'

export interface CambioDato {
  id: string
  campo: string
  valor_anterior: string | null
  valor_nuevo: string | null
  origen: 'vigilador' | 'administracion' | 'planilla_legajos_2024-08'
  estado: EstadoCambio
  motivo: string | null
  motivo_rechazo: string | null
  creado_at: string
  revisado_at: string | null
  creado_por_nombre?: string
  revisado_por_nombre?: string | null
}

export interface DatosLegajo {
  empleado_id: string
  es_propio: boolean
  puede_gestionar: boolean
  telefono: string | null
  campos: CampoLegajo[]
  datos: Record<string, string | null> | null
  cambios: CambioDato[]
}

export interface CambioPendiente {
  id: string
  empleado_id: string
  nombre: string
  apellido: string
  legajo: string | null
  campo: string
  etiqueta: string
  valor_anterior: string | null
  valor_nuevo: string | null
  origen: CambioDato['origen']
  estado: EstadoCambio
  motivo: string | null
  creado_at: string
}

export const GRUPOS: Record<CampoLegajo['grupo'], string> = {
  personales: 'Datos personales',
  domicilio: 'Domicilio',
  emergencia: 'Teléfono y contacto de emergencia',
  laborales: 'Datos laborales',
}

export const ETIQUETA_ORIGEN: Record<CambioDato['origen'], string> = {
  vigilador: 'la persona',
  administracion: 'Administración',
  'planilla_legajos_2024-08': 'planilla histórica (ago-2024)',
}

const msj = (e: { message?: string } | null, d: string) => (e?.message ?? '').trim() || d

export async function cargarDatosLegajo(empleadoId: string): Promise<{ datos: DatosLegajo | null; error: string | null }> {
  const { data, error } = await supabase.rpc('legajo_datos_de_empleado', { p_empleado_id: empleadoId })
  return error ? { datos: null, error: msj(error, 'No se pudieron cargar los datos') } : { datos: data as DatosLegajo, error: null }
}

export async function proponerCambio(empleadoId: string, campo: string, valor: string, motivo?: string): Promise<{ estado: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('legajo_proponer_cambio', { p_empleado_id: empleadoId, p_campo: campo, p_valor: valor, p_motivo: motivo ?? null })
  return error ? { estado: null, error: msj(error, 'No se pudo guardar') } : { estado: (data as { estado: string }).estado, error: null }
}

export async function resolverCambio(id: string, decision: 'aprobar' | 'rechazar', motivo?: string): Promise<string | null> {
  const { error } = await supabase.rpc('legajo_resolver_cambio', { p_cambio_id: id, p_decision: decision, p_motivo: motivo ?? null })
  return error ? msj(error, 'No se pudo guardar') : null
}

export async function confirmarDatoPlanilla(id: string, decision: 'confirmar' | 'corregir' | 'no_corresponde', valor?: string): Promise<string | null> {
  const { error } = await supabase.rpc('legajo_confirmar_planilla', { p_cambio_id: id, p_decision: decision, p_valor: valor ?? null })
  return error ? msj(error, 'No se pudo guardar') : null
}

export async function cargarCambiosPendientes(): Promise<{ filas: CambioPendiente[]; error: string | null }> {
  const { data, error } = await supabase.rpc('legajo_cambios_pendientes')
  return error ? { filas: [], error: msj(error, 'No se pudo cargar la bandeja') } : { filas: (data ?? []) as CambioPendiente[], error: null }
}

/** Cambio de teléfono: el circuito de siempre (/api/perfil/telefono), sólo el propio. */
export async function cambiarTelefonoPropio(telefono: string): Promise<string | null> {
  const { data: s } = await supabase.auth.getSession()
  const token = s?.session?.access_token
  if (!token) return 'Sesión requerida'
  const r = await fetch('/api/perfil/telefono', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ telefono }) })
  if (r.ok) return null
  const j = await r.json().catch(() => ({}))
  return j?.error ?? 'No se pudo guardar el teléfono'
}

/** Último cambio que espera a alguien para un campo (para mostrarlo junto al dato). */
export function pendienteDe(cambios: CambioDato[], campo: string): CambioDato | null {
  return cambios.find(c => c.campo === campo && (c.estado === 'pendiente' || c.estado === 'pendiente_confirmacion')) ?? null
}

export function mostrarValor(c: CampoLegajo, v: string | null | undefined): string {
  if (!v) return '—'
  if (c.tipo === 'fecha') { const [y, m, d] = v.slice(0, 10).split('-'); return `${d}/${m}/${y}` }
  return v
}
