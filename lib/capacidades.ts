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

// Conjuntos reutilizables.
const OPERACION_SUPERVISOR: Capacidad[] = [
  'ver_operacion', 'supervisar_zona', 'revisar_planillas', 'revisar_operativa', 'ver_desempeno',
]
const OPERACION_GESTION: Capacidad[] = [
  'gestionar_turnos', 'gestionar_personal', 'gestionar_objetivos',
]
const GERENCIAL_ECONOMICO: Capacidad[] = [
  'ver_dashboard_gerencial', 'ver_liquidacion', 'editar_liquidacion',
  'exportar_visual', 'exportar_banco', 'ver_finanzas', 'gestionar_facturacion',
  'configurar_economico', 'gestionar_usuarios_roles',
]

/**
 * Mapa CANÓNICO puesto → capacidades. Borrador inicial de ROLES 1; el set fino
 * por módulo se termina de validar en ROLES 3/4. Reglas fijas ya decididas:
 *  · direccion_operativa: operación global + gestión + desempeño, SIN económico.
 *  · administracion: rama administrativa/operativa, SIN gerencial/económico.
 *  · gerencia: única con lo económico/sensible.
 */
const CAPACIDADES_POR_PUESTO: Record<PuestoOrganizacional, Capacidad[]> = {
  vigilador: [], // sólo su propia operación (se resuelve por alcance 'propio')
  supervisor: [...OPERACION_SUPERVISOR],
  jefe_supervisores: [...OPERACION_SUPERVISOR, 'supervisar_todas_zonas'],
  direccion_operativa: [...OPERACION_SUPERVISOR, ...OPERACION_GESTION, 'supervisar_todas_zonas', 'configurar_sistema'],
  administracion: ['ver_operacion', ...OPERACION_GESTION, 'revisar_planillas', 'revisar_operativa', 'configurar_sistema'],
  gerencia: [
    'ver_operacion', ...OPERACION_SUPERVISOR, ...OPERACION_GESTION, 'supervisar_todas_zonas',
    'configurar_sistema', ...GERENCIAL_ECONOMICO,
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
    // Hoy un admin ve/hace todo. Se conserva idéntico durante la transición.
    return [
      'ver_operacion', ...OPERACION_SUPERVISOR, ...OPERACION_GESTION, 'supervisar_todas_zonas',
      'configurar_sistema', ...GERENCIAL_ECONOMICO,
    ]
  }
  if (r === 'supervisor') return [...OPERACION_SUPERVISOR]
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
