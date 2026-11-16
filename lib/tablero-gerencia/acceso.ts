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

export function tableroGerenciaVisible(env: Record<string, string | undefined> = process.env): boolean {
  return env.NEXT_PUBLIC_TABLERO_GERENCIA === '1'
}

export const ENVIO_MENSAJES_GESTION_HABILITADO = false as const

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
