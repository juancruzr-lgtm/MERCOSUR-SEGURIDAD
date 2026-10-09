/**
 * lib/legajo-habilitacion.ts
 *
 * Habilitación progresiva del Legajo Digital para el personal. Cada módulo
 * arranca CERRADO: lo usan Administración, Gerencia y las cuentas de prueba.
 * Abrirlo o cerrarlo lo decide sólo Gerencia (la base lo vuelve a controlar en
 * legajo_habilitar) y queda registrado quién y cuándo.
 */

import { supabase } from '@/lib/supabase'

export interface ModuloLegajo { modulo: string; empleados: boolean; actualizado_at: string; actualizado_por: string | null }

export const MODULOS_LEGAJO: Record<string, { nombre: string; que_ve: string }> = {
  datos_personales: {
    nombre: 'Datos personales',
    que_ve: 'Cada persona ve sus datos, propone cambios y confirma o corrige lo que vino de la planilla histórica.',
  },
  documentacion: {
    nombre: 'Documentación',
    que_ve: 'Cada persona sube su documentación, ve en qué estado está y deja constancia de lo que le entrega Administración.',
  },
}

export async function cargarHabilitacion(): Promise<{ modulos: ModuloLegajo[]; error: string | null }> {
  const { data, error } = await supabase.from('legajo_habilitacion').select('modulo, empleados, actualizado_at, actualizado_por').order('modulo')
  return { modulos: (data ?? []) as ModuloLegajo[], error: error ? error.message : null }
}

export async function cambiarHabilitacion(modulo: string, abrir: boolean): Promise<string | null> {
  const { error } = await supabase.rpc('legajo_habilitar', { p_modulo: modulo, p_empleados: abrir })
  return error ? (error.message || 'No se pudo cambiar la habilitación') : null
}

/** Sólo Gerencia (puesto) ve el control; la base acepta además una delegación de Gerencia vigente. */
export const controlaHabilitacion = (u: { puesto_organizacional?: string | null } | null | undefined) => u?.puesto_organizacional === 'gerencia'
