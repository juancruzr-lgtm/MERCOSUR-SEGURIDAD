/**
 * lib/capacidades.ts — ROLES 1 (infraestructura)
 *
 * Separa lo que hoy está fundido en `usuarios.rol`:
 *   1. PUESTO organizacional  → `usuarios.puesto_organizacional` (nullable en transición)
 *   2. CAPACIDADES            → qué puede hacer (mapa por puesto, acá)
 *   3. ALCANCE operativo      → sobre qué datos (propio / zonas_asignadas / todas)
 *
 * COMPATIBILIDAD (crítica): mientras `puesto_organizacional` sea null, gobierna
 * el `rol` viejo mediante un FALLBACK que reproduce EXACTAMENTE el comportamiento
 * actual. Como ROLES 1 no hace backfill y ningún módulo consume todavía estos
 * helpers, el comportamiento de producción NO cambia. La migración de
 * consumidores (reemplazar `rol === 'admin'` por `tieneCapacidad(...)`) empieza
 * en PRs posteriores, módulo por módulo.
 *
 * Estructura del negocio (Juan, 08/09/2026): Operación y Administración son
 * ramas FUNCIONALES distintas, no una única escalera.
 *   Operación:  vigilador → supervisor → jefe_supervisores → direccion_operativa
 *   Administración: rama aparte, con sus propias capacidades.
 *   Gerencia: capa empresarial por encima; única con acceso económico/sensible.
 */

export type PuestoOrganizacional =
  | 'vigilador'
  | 'supervisor'
  | 'jefe_supervisores'
  | 'direccion_operativa'
  | 'administracion'
  | 'gerencia'

export const PUESTOS: readonly PuestoOrganizacional[] = [
  'vigilador', 'supervisor', 'jefe_supervisores', 'direccion_operativa', 'administracion', 'gerencia',
] as const

export function esPuestoValido(v: unknown): v is PuestoOrganizacional {
  return typeof v === 'string' && (PUESTOS as readonly string[]).includes(v)
}

/**
 * Capacidades. Cada una nace de un check/módulo REAL de hoy o del roadmap
 * Liquidación ya aprobado (no se inventan capacidades sueltas).
 */
export type Capacidad =
  // Operación
  | 'ver_operacion'
  | 'gestionar_turnos'
  | 'gestionar_personal'
  | 'gestionar_objetivos'
  | 'supervisar_zona'
  | 'supervisar_todas_zonas'
  | 'revisar_planillas'
  | 'revisar_operativa'
  | 'ver_desempeno'
  | 'configurar_sistema'
  // Preparación de Liquidación (padrón, Excel, 000, expedientes, consolidar,
  // generar Visual). NO es económico/banco: Administración la tiene; el acceso
  // al banco/Finanzas queda bajo capacidades económicas separadas (Gerencia).
  | 'preparar_liquidacion'
  // Gerencial / económico (sensible)
  | 'ver_dashboard_gerencial'
  | 'ver_liquidacion'
  | 'editar_liquidacion'
  | 'exportar_visual'
  | 'exportar_banco'
  | 'ver_finanzas'
  | 'gestionar_facturacion'
  | 'configurar_economico'
  | 'gestionar_usuarios_roles'

export type AlcanceOperativo = 'propio' | 'zonas_asignadas' | 'todas'

// ── Clasificación EXPLÍCITA por rama (ROLES 4, aclaración de JC 08/09) ────────
// Regla: capacidades explícitas, SIN herencia por jerarquía. Estar arriba de
// alguien NO concede sus permisos. Administración PUEDE intervenir sobre objetos
// operativos (asimetría deliberada); Operaciones NO hereda lo administrativo;
// Dirección Operativa tiene alcance operativo global pero NO capacidades
// administrativas/económicas.

// OPERACIÓN — ver/supervisar/ejecutar la operación (rama Operaciones).
// `revisar_planillas` y `gestionar_turnos` también las tiene Administración
// (intervención administrativa sobre la operación): capacidad compartida, no herencia.
const OPERACION_SUPERVISOR: Capacidad[] = [
  'ver_operacion', 'supervisar_zona', 'revisar_planillas', 'revisar_operativa', 'ver_desempeno',
]
// ADMINISTRATIVO — gestión administrativa de objetos operativos (rama Administración).
const ADMINISTRATIVO: Capacidad[] = ['gestionar_personal', 'gestionar_objetivos']
// GERENCIAL/ECONÓMICO — sensible; SOLO gerencia (incl. gestión de usuarios/roles).
const GERENCIAL_ECONOMICO: Capacidad[] = [
  'ver_dashboard_gerencial', 'ver_liquidacion', 'editar_liquidacion',
  'exportar_visual', 'exportar_banco', 'ver_finanzas', 'gestionar_facturacion',
  'configurar_economico', 'gestionar_usuarios_roles',
]

/**
 * Mapa CANÓNICO puesto → capacidades (explícito, sin herencia por jerarquía).
 *  · supervisor/jefe: OPERACIÓN + programación de turnos de SU alcance (zona/todas
 *    lo acota `alcanceDe`; la capacidad dice QUÉ, el alcance dice DÓNDE).
 *  · direccion_operativa: OPERACIÓN con alcance global; dirige supervisión.
 *    NO administrativo (gestionar_personal/objetivos) ni económico.
 *  · administracion: rama administrativa; interviene sobre la operación
 *    (personal, objetivos, turnos, planillas) pero NO supervisa zonas ni tiene económico.
 *  · gerencia: transversal + económico/sensible.
 * configurar_sistema (obs/IA/técnico): provisional en dir_op+administracion+gerencia
 *   para preservar el acceso actual; pendiente de confirmar si debe angostarse.
 */
const CAPACIDADES_POR_PUESTO: Record<PuestoOrganizacional, Capacidad[]> = {
  vigilador: [], // sólo su propia operación (se resuelve por alcance 'propio')
  supervisor: [...OPERACION_SUPERVISOR, 'gestionar_turnos'],
  jefe_supervisores: [...OPERACION_SUPERVISOR, 'gestionar_turnos', 'supervisar_todas_zonas'],
  // Dir. Operativa dirige la OPERACIÓN global: turnos + objetivos en su dimensión
  // operativa + supervisión. NO gestiona personal (administrativo) ni económico.
  direccion_operativa: [...OPERACION_SUPERVISOR, 'gestionar_turnos', 'gestionar_objetivos', 'supervisar_todas_zonas', 'configurar_sistema'],
  administracion: ['ver_operacion', 'revisar_operativa', 'revisar_planillas', 'gestionar_turnos', ...ADMINISTRATIVO, 'configurar_sistema', 'preparar_liquidacion'],
  gerencia: [
    'ver_operacion', ...OPERACION_SUPERVISOR, 'gestionar_turnos', ...ADMINISTRATIVO, 'supervisar_todas_zonas',
    'configurar_sistema', 'preparar_liquidacion', ...GERENCIAL_ECONOMICO,
  ],
}

const ALCANCE_POR_PUESTO: Record<PuestoOrganizacional, AlcanceOperativo> = {
  vigilador: 'propio',
  supervisor: 'zonas_asignadas',
  jefe_supervisores: 'todas',
  direccion_operativa: 'todas',
  administracion: 'todas',
  gerencia: 'todas',
}

/**
 * FALLBACK por rol viejo (SOLO mientras puesto_organizacional sea null).
 * Reproduce el comportamiento ACTUAL: admin = todo (como hoy), supervisor = sus
 * zonas, guardia/vigilador = lo propio. NO afirma un puesto (no es "admin →
 * administracion"): sólo mantiene el acceso vigente hasta el backfill aprobado.
 */
function capacidadesLegadasPorRol(rol?: string | null): Capacidad[] {
  const r = String(rol ?? '').trim().toLowerCase()
  if (r === 'admin') {
    // Hoy un admin ve/hace todo. Se conserva idéntico durante la transición
    // (sólo aplica a cuentas sin puesto seteado, p.ej. es_prueba).
    return [
      'ver_operacion', ...OPERACION_SUPERVISOR, 'gestionar_turnos', ...ADMINISTRATIVO,
      'supervisar_todas_zonas', 'configurar_sistema', 'preparar_liquidacion', ...GERENCIAL_ECONOMICO,
    ]
  }
  if (r === 'supervisor') return [...OPERACION_SUPERVISOR, 'gestionar_turnos']
  return [] // guardia / vigilador
}

function alcanceLegadoPorRol(rol?: string | null): AlcanceOperativo {
  const r = String(rol ?? '').trim().toLowerCase()
  if (r === 'admin') return 'todas'
  if (r === 'supervisor') return 'zonas_asignadas'
  return 'propio'
}

/** Sujeto mínimo para resolver capacidades: identidad heredada + puesto nuevo. */
export interface SujetoAcceso {
  rol?: string | null
  puesto_organizacional?: string | null
  /**
   * Acceso EXPLÍCITO a la interfaz de Administración (config por usuario), aparte
   * del puesto. Abre la VISTA admin; NO concede capacidades: cada módulo sigue
   * gateado por capability + RLS (ver `shellDeUsuario` y `esAdminPleno`).
   */
  acceso_interfaz_admin?: boolean | null
}

/** Puesto canónico si está seteado y es válido; null durante la transición. */
export function puestoDe(u: SujetoAcceso | null | undefined): PuestoOrganizacional | null {
  return u && esPuestoValido(u.puesto_organizacional) ? u.puesto_organizacional : null
}

/**
 * Capacidades efectivas. Con puesto seteado manda el mapa canónico; sin puesto
 * (transición) manda el fallback por rol viejo. NUNCA mezcla las dos fuentes.
 */
export function capacidadesDe(u: SujetoAcceso | null | undefined): Set<Capacidad> {
  const puesto = puestoDe(u)
  return new Set(puesto ? CAPACIDADES_POR_PUESTO[puesto] : capacidadesLegadasPorRol(u?.rol))
}

export function tieneCapacidad(u: SujetoAcceso | null | undefined, cap: Capacidad): boolean {
  return capacidadesDe(u).has(cap)
}

/** Alcance operativo canónico (o legado por rol durante la transición). */
export function alcanceDe(u: SujetoAcceso | null | undefined): AlcanceOperativo {
  const puesto = puestoDe(u)
  return puesto ? ALCANCE_POR_PUESTO[puesto] : alcanceLegadoPorRol(u?.rol)
}

/** Helpers de lectura para los consumidores (evitan comparar strings sueltos). */
export const CAPACIDADES_POR_PUESTO_LECTURA = CAPACIDADES_POR_PUESTO
export const ALCANCE_POR_PUESTO_LECTURA = ALCANCE_POR_PUESTO

/**
 * Shell de la app por PUESTO (política de navegación). Fail-closed: puesto/rol
 * desconocido NO cae al shell admin, devuelve 'denegado'.
 *   vigilador → guardia; supervisor → supervisor (incluye a Sergio: admin de
 *   identidad, supervisor de puesto ⇒ su alcance queda zonificado en ese shell);
 *   jefe_supervisores/direccion_operativa/administracion/gerencia → admin
 *   (todos con alcance 'todas'). Con puesto null (transición, sólo es_prueba) se
 *   cae al rol viejo; un rol desconocido queda 'denegado'.
 */
export type ShellApp = 'guardia' | 'supervisor' | 'admin' | 'denegado'
export function shellDeUsuario(u: SujetoAcceso | null | undefined): ShellApp {
  if (!u) return 'denegado'
  // Acceso explícito a la interfaz admin (config por usuario). Sólo cambia el
  // SHELL; capacidades y alcance siguen siendo los del puesto (p.ej. Sergio:
  // supervisor, Rosario). La vista queda LIMITADA por `esAdminPleno`.
  if (u.acceso_interfaz_admin === true) return 'admin'
  const puesto = puestoDe(u)
  if (puesto) {
    if (puesto === 'vigilador') return 'guardia'
    if (puesto === 'supervisor') return 'supervisor'
    return 'admin'
  }
  const rol = String(u.rol ?? '').trim().toLowerCase()
  if (rol === 'guardia' || rol === 'vigilador') return 'guardia'
  if (rol === 'supervisor') return 'supervisor'
  if (rol === 'admin') return 'admin'
  return 'denegado'
}

/**
 * ADMIN PLENO: puestos que legítimamente ven TODA la interfaz administrativa
 * (incluida Configuración/Sistema). Un usuario que llega al shell admin sólo por
 * `acceso_interfaz_admin` (p.ej. un supervisor) NO es admin pleno: su vista se
 * limita a lo operativo y las secciones sensibles quedan ocultas. Preserva
 * exactamente a jefe/dirección operativa/administración/gerencia (y al admin
 * legado sin puesto), que ya veían todo.
 */
export function esAdminPleno(u: SujetoAcceso | null | undefined): boolean {
  const puesto = puestoDe(u)
  if (puesto) return puesto === 'jefe_supervisores' || puesto === 'direccion_operativa' || puesto === 'administracion' || puesto === 'gerencia'
  return String(u?.rol ?? '').trim().toLowerCase() === 'admin'
}
