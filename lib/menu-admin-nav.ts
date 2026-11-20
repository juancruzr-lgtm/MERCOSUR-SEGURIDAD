// Contenido del menú lateral del shell de Administración / Gerencia: qué
// secciones hay, en qué grupo va cada una y quién la ve.
//
// Antes los grupos eran GENERAL / OPERACIONES / ADMINISTRACIÓN / GESTIÓN
// ECONÓMICA / CONFIGURACIÓN / SISTEMA, y ADMINISTRACIÓN juntaba de todo
// (revisión, supervisión, personal, reportes). Ahora se agrupa por tarea:
// Operaciones, Personal, Supervisión, Administración, Finanzas, Gerencia y
// Configuración.
//
// Lo que NO cambia: los `id` (viven en `?page=` y en enlaces de WhatsApp) y la
// regla de visibilidad de cada ítem (tests/menu-admin-nav.test.ts la compara
// con la del menú anterior para todas las combinaciones de permisos). Un grupo
// sin ítems visibles para el perfil no se muestra.
//
// Puro (sin React ni Supabase): AppClient calcula los permisos y llama a
// `construirNavAdmin`. El menú del vigilador (esGuardia) sigue aparte.

import type { SeccionMenuAdmin } from '@/components/ui/MenuAdmin'

export type GrupoMenuAdmin =
  | 'Operaciones'
  | 'Personal'
  | 'Supervisión'
  | 'Administración'
  | 'Finanzas'
  | 'Gerencia'
  | 'Configuración'

export const ORDEN_GRUPOS_MENU_ADMIN: readonly GrupoMenuAdmin[] = [
  'Operaciones', 'Personal', 'Supervisión', 'Administración', 'Finanzas', 'Gerencia', 'Configuración',
]

/** Permisos e interruptores que deciden la visibilidad. Los calcula AppClient. */
export type PermisosMenuAdmin = {
  supervisarZona: boolean
  supervisarTodasZonas: boolean
  verDashboardGerencial: boolean
  gestionarPersonal: boolean
  prepararLiquidacion: boolean
  gestionarFacturacion: boolean
  /** Puesto Administración o Gerencia (lib/legajo gestionaDatosSensibles). */
  gestionaDatosSensibles: boolean
  /** Admin pleno (lib/capacidades esAdminPleno): Configuración y Observación. */
  esAdminPleno: boolean
  /** Autorización individual de la base (useAccesoLegajoSupervisores). */
  veLegajoSupervisores: boolean
  tableroGerenciaVisible: boolean
  configuracionGuiadaVisible: boolean
  gestionAdministracionVisible: boolean
}

export type ItemNavAdmin = {
  id: string
  icon: string
  label: string
  grupo: GrupoMenuAdmin
  visible: (p: PermisosMenuAdmin) => boolean
}

const siempre = () => true

/**
 * Ítems en el orden en que se muestran dentro de su grupo. Las reglas de
 * `visible` son las mismas del menú anterior (ver los comentarios de origen).
 */
export const ITEMS_MENU_ADMIN: readonly ItemNavAdmin[] = [
  // ── Operaciones ───────────────────────────────────────────────────────────
  { id: 'dashboard', icon: '📊', label: 'Panel Principal', grupo: 'Operaciones', visible: siempre },
  { id: 'objetivos', icon: '🏢', label: 'Objetivos', grupo: 'Operaciones', visible: siempre },
  { id: 'turnos', icon: '📅', label: 'Turnos', grupo: 'Operaciones', visible: siempre },
  { id: 'asistencia', icon: '✅', label: 'Asistencia', grupo: 'Operaciones', visible: siempre },
  { id: 'rondas', icon: '🔁', label: 'Rondas', grupo: 'Operaciones', visible: siempre },
  { id: 'pagina_gps', icon: '📍', label: 'Página GPS', grupo: 'Operaciones', visible: siempre },
  { id: 'cierre_operativo', icon: '🌙', label: 'Cierre Operativo', grupo: 'Operaciones', visible: siempre },

  // ── Personal ──────────────────────────────────────────────────────────────
  { id: 'guardias', icon: '👮', label: 'Guardias', grupo: 'Personal', visible: siempre },
  // Novedades del Personal: novedades laborales por rango/cantidad
  // (Administración/Gerencia). No es «Novedades» operativas.
  { id: 'novedades_personal', icon: '🧑‍💼', label: 'Novedades del Personal', grupo: 'Personal', visible: p => p.gestionarPersonal },
  // Legajo Digital: sólo puesto Administración o Gerencia (sin overrides).
  { id: 'legajo_digital', icon: '🗂️', label: 'Legajo Digital', grupo: 'Personal', visible: p => p.gestionaDatosSensibles },
  // Estatuto Interno: documentación laboral → gestionar_personal.
  { id: 'estatuto_interno', icon: '📜', label: 'Estatuto Interno', grupo: 'Personal', visible: p => p.gestionarPersonal },
  { id: 'solicitudes_admin', icon: '📝', label: 'Solicitudes Admin', grupo: 'Personal', visible: siempre },

  // ── Supervisión ───────────────────────────────────────────────────────────
  { id: 'revision_operativa', icon: '🛂', label: 'Revisión Operativa', grupo: 'Supervisión', visible: siempre },
  { id: 'revision_planillas', icon: '📑', label: 'Revisión de planillas', grupo: 'Supervisión', visible: siempre },
  { id: 'revision_fotos_ia', icon: '🤖', label: 'Revisión de fotos IA', grupo: 'Supervisión', visible: siempre },
  { id: 'supervisiones', icon: '☑️', label: 'Supervisiones', grupo: 'Supervisión', visible: siempre },
  // Salidas anticipadas: la resuelve Supervisión (su zona) o un superior.
  { id: 'salidas_anticipadas', icon: '🚪', label: 'Salidas anticipadas', grupo: 'Supervisión', visible: p => p.supervisarZona || p.supervisarTodasZonas },
  { id: 'supervisores_guardia', icon: '🔔', label: 'Supervisores de Guardia', grupo: 'Supervisión', visible: siempre },
  // Evaluación de supervisores: lista de autorizaciones individuales de la base.
  { id: 'evaluacion_supervisores', icon: '🎯', label: 'Evaluación de supervisores', grupo: 'Supervisión', visible: p => p.veLegajoSupervisores },
  // Protocolos: Administración/Gerencia y jefatura operativa.
  { id: 'protocolos', icon: '📋', label: 'Protocolos', grupo: 'Supervisión', visible: p => p.gestionarPersonal || p.supervisarTodasZonas },

  // ── Administración ────────────────────────────────────────────────────────
  { id: 'gestion_administracion', icon: '📋', label: 'Administración', grupo: 'Administración', visible: p => p.gestionAdministracionVisible && p.gestionaDatosSensibles },
  { id: 'reportes', icon: '📈', label: 'Reportes', grupo: 'Administración', visible: siempre },

  // ── Finanzas ──────────────────────────────────────────────────────────────
  // Liquidación: preparar_liquidacion (no abre banco/Finanzas económicas).
  { id: 'liquidacion', icon: '💵', label: 'Liquidación', grupo: 'Finanzas', visible: p => p.prepararLiquidacion },
  { id: 'facturacion', icon: '🧾', label: 'Facturación', grupo: 'Finanzas', visible: p => p.gestionarFacturacion },

  // ── Gerencia ──────────────────────────────────────────────────────────────
  // Tablero de Gerencia (vista previa): interruptor + alcance operativo.
  {
    id: 'tablero_gerencia', icon: '🧭', label: 'Tablero de Gerencia', grupo: 'Gerencia',
    visible: p => p.tableroGerenciaVisible && (p.supervisarZona || p.supervisarTodasZonas || p.verDashboardGerencial),
  },

  // ── Configuración ─────────────────────────────────────────────────────────
  // Sólo ADMIN PLENO, salvo «Configurar objetivos» (interruptor + alcance).
  { id: 'servicios_objetivo', icon: '📅', label: 'Servicios por objetivo', grupo: 'Configuración', visible: p => p.esAdminPleno },
  { id: 'turnos_base', icon: '⏰', label: 'Horarios tipo (turnos base)', grupo: 'Configuración', visible: p => p.esAdminPleno },
  {
    id: 'configuracion_guiada', icon: '🧩', label: 'Configurar objetivos', grupo: 'Configuración',
    visible: p => p.configuracionGuiadaVisible && (p.gestionarPersonal || p.supervisarTodasZonas || p.supervisarZona),
  },
  { id: 'checklists', icon: '☑️', label: 'Checklists', grupo: 'Configuración', visible: p => p.esAdminPleno },
  { id: 'zonas_operativas', icon: '🗺️', label: 'Zonas operativas', grupo: 'Configuración', visible: p => p.esAdminPleno },
  { id: 'referencias_ia', icon: '🖼️', label: 'Referencias IA', grupo: 'Configuración', visible: p => p.esAdminPleno },
  { id: 'observacion', icon: '🔭', label: 'Observación del Sistema', grupo: 'Configuración', visible: p => p.esAdminPleno },
]

/** Secciones del menú para estos permisos: grupos en orden, sin grupos vacíos. */
export function construirNavAdmin(p: PermisosMenuAdmin): SeccionMenuAdmin[] {
  return ORDEN_GRUPOS_MENU_ADMIN
    .map(grupo => ({
      section: grupo,
      items: ITEMS_MENU_ADMIN
        .filter(i => i.grupo === grupo && i.visible(p))
        .map(({ id, icon, label }) => ({ id, icon, label })),
    }))
    .filter(s => s.items.length > 0)
}
