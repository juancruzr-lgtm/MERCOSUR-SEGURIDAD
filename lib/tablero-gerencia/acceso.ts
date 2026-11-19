/**
 * lib/tablero-gerencia/acceso.ts
 *
 * Interruptores y permisos del Tablero de Gerencia. Todo nace APAGADO.
 *
 * - El tablero sólo se muestra si NEXT_PUBLIC_TABLERO_GERENCIA === '1'.
 * - El envío de mensajes desde el tablero no tiene interruptor por variable de
 *   entorno a propósito: queda en `false` en código hasta que Gerencia apruebe
 *   las plantillas en Meta y la migración de casos. Activarlo es un cambio de
 *   código revisable, no una variable que alguien pueda prender sin querer.
 * - Los datos económicos (facturación, costos, rentabilidad) exigen
 *   'ver_dashboard_gerencial' (lib/capacidades.ts); el server repite el control
 *   con fact_alcance_total_actual()/puede_acceder_gerencia_actual().
 */

import type { AlcanceOperativo } from '@/lib/capacidades'

// Lectura LITERAL de process.env.NEXT_PUBLIC_…: Next sólo la reemplaza en el
// bundle del navegador si aparece escrita así.
export function tableroGerenciaVisible(valor: string | undefined = process.env.NEXT_PUBLIC_TABLERO_GERENCIA): boolean {
  return valor === '1'
}

export const ENVIO_MENSAJES_GESTION_HABILITADO = false as const

/** Configuración guiada de objetivos (protocolo + ronda de 2 puntos): oculta salvo NEXT_PUBLIC_CONFIGURACION_GUIADA === '1'. */
export function configuracionGuiadaVisible(valor: string | undefined = process.env.NEXT_PUBLIC_CONFIGURACION_GUIADA): boolean {
  return valor === '1'
}

/** Tablero de Administración: oculto salvo NEXT_PUBLIC_GESTION_ADMINISTRACION === '1'. */
export function gestionAdministracionVisible(valor: string | undefined = process.env.NEXT_PUBLIC_GESTION_ADMINISTRACION): boolean {
  return valor === '1'
}

export interface PermisosTablero {
  verTablero: boolean
  verEconomico: boolean
  gestionarCasos: boolean
  autorizarEnvios: boolean
  aprobarReglas: boolean
  /** null = todos los objetivos; Set = sólo esos (fail-closed si está vacío). */
  objetivosPermitidos: ReadonlySet<string> | null
}

export function permisosTablero(p: {
  alcance: AlcanceOperativo
  objetivosEnAlcance: ReadonlySet<string> | null
  esGerencia: boolean
  verDashboardGerencial: boolean
}): PermisosTablero {
  const operativo = p.alcance === 'todas' || p.alcance === 'zonas_asignadas'
  return {
    verTablero: operativo,
    verEconomico: p.verDashboardGerencial,
    gestionarCasos: operativo,
    autorizarEnvios: p.esGerencia,
    aprobarReglas: p.esGerencia,
    objetivosPermitidos: p.alcance === 'todas' ? null : (p.objetivosEnAlcance ?? new Set()),
  }
}
