/**
 * lib/habilitacion.ts
 *
 * Control de credenciales y habilitaciones de vigiladores. La situación de cada
 * persona (qué tiene, qué falta, quién lo hace) la decide la base
 * (habilitacion_resumen, migración 20261015120000): acá sólo se muestra, se
 * agrupa y se filtra. Documentación completa NO es credencial: sólo una
 * credencial registrada cuenta como «tiene credencial».
 */

import { supabase } from '@/lib/supabase'

export type CodigoHabilitacion =
  | 'vigente' | 'por_vencer' | 'vencida' | 'sin_verificar'
  | 'presentado' | 'lista_para_presentar' | 'pendiente_firma' | 'tramite_incompleto'
  | 'sin_tramite' | 'desconocida'

export type RolResponsable = 'empleado' | 'administracion' | 'gerencia' | 'presentacion' | 'medicina_laboral'
export type EtapaHabilitacion = 'documentacion' | 'medicos' | 'medicina_legal' | 'presentacion'
export type EstadoPaso = 'pendiente' | 'en_curso' | 'hecho' | 'no_corresponde' | 'recibido' | 'vencido'
export type EstadoRegistrable = 'pendiente' | 'en_curso' | 'hecho' | 'no_corresponde'

export interface PasoHabilitacion {
  codigo: string
  nombre: string
  etapa: EtapaHabilitacion
  orden: number
  responsable_rol: RolResponsable
  ayuda: string | null
  tipo_documento: string | null
  estado: EstadoPaso
  resuelto: boolean
  registrado: EstadoRegistrable | null
  fecha: string | null
  observacion: string | null
  responsable_usuario: string | null
  responsable_nombre: string | null
  documento: { id: string; estado: 'validado' | 'sin_validar'; vence_el: string | null; fecha: string | null } | null
  por_documento: boolean
  mega_referencias: number
  actualizado_at: string | null
}

export interface CredencialRegistrada {
  id: string
  numero: string | null
  fecha_emision: string | null
  vence_el: string
  estado: 'vigente' | 'por_vencer' | 'vencida'
  dias: number
  verificada: boolean
  documento_id: string | null
  registrada_at: string
}

export interface TramiteHabilitacion {
  id: string
  tipo: 'primera' | 'renovacion'
  estado: 'en_curso' | 'presentado'
  abierto_at: string
  presentado_at: string | null
  ultimo_movimiento_at: string
  dias_sin_movimiento: number
  demorado: boolean
  pendientes: number
  pasos: PasoHabilitacion[]
}

export interface ResumenHabilitacion {
  empleado_id: string
  codigo: CodigoHabilitacion
  titulo: string
  detalle: string
  responsable_rol: RolResponsable | null
  responsable_nombre: string | null
  urgencia: number
  credencial: CredencialRegistrada | null
  tramite: TramiteHabilitacion | null
  ingreso: string | null
  seis_meses: string | null
  dias_para_6_meses: number | null
  antiguedad_dias: number | null
  verificacion: { resultado: string; observacion: string | null; at: string } | null
  planilla_vencimiento: string | null
}

export interface Persona { id: string; nombre: string; puesto: string }

export interface HabilitacionEmpleado extends ResumenHabilitacion {
  es_gerencia: boolean
  primer_turno: string | null
  credenciales: { id: string; numero: string | null; fecha_emision: string | null; vence_el: string; verificada: boolean; anulada_at: string | null; motivo_anulacion: string | null; registrada_at: string }[]
  documentos_credencial: { id: string; estado: string; vence_el: string | null; fecha_emision: string | null }[]
  historial: { evento: string; detalle: Record<string, unknown> | null; at: string; quien: string | null }[]
  personas: Persona[]
}

export interface FilaTablero extends ResumenHabilitacion {
  nombre: string
  apellido: string
  legajo: string | null
  cuil: string | null
  objetivo: string | null
  primer_turno: string | null
}

export interface Tablero {
  filas: FilaTablero[]
  catalogo: { codigo: string; nombre: string; etapa: EtapaHabilitacion; responsable_rol: RolResponsable; responsable_usuario: string | null }[]
  personas: Persona[]
  parametros: { dias_por_vencer: number; dias_aviso_6_meses: number; dias_sin_movimiento: number; dias_presentado: number }
}

/** Tipos de documento del legajo que respaldan la credencial (igual que documentacion_tipos.para_habilitacion). */
export const TIPOS_HABILITACION = ['dni', 'alta_arca', 'antecedentes_rnr', 'antecedentes_provincia', 'estudios_medicos', 'credencial', 'acta_credencial'] as const

export const RESPONSABLE: Record<RolResponsable, string> = {
  empleado: 'Empleado',
  administracion: 'Administración',
  gerencia: 'Gerencia',
  presentacion: 'Facundo, un supervisor o el empleado',
  medicina_laboral: 'Medicina Laboral',
}

export const ETAPA: Record<EtapaHabilitacion, string> = {
  documentacion: 'Documentación inicial',
  medicos: 'Estudios médicos',
  medicina_legal: 'Medicina Legal',
  presentacion: 'Firma y presentación',
}

export const ESTADO_PASO: Record<EstadoPaso, { texto: string; color: string }> = {
  hecho: { texto: 'Hecho', color: '#22c55e' },
  no_corresponde: { texto: 'No corresponde', color: '#94a3b8' },
  recibido: { texto: 'Recibido, falta verificar', color: '#fbbf24' },
  vencido: { texto: 'Vencido', color: '#f87171' },
  en_curso: { texto: 'En curso', color: '#93c5fd' },
  pendiente: { texto: 'Pendiente', color: '#64748b' },
}

/** Color e ícono de cada situación (verde = tiene credencial vigente). */
export const SITUACION: Record<CodigoHabilitacion, { color: string; fondo: string; icono: string }> = {
  vigente: { color: '#22c55e', fondo: 'rgba(34,197,94,.10)', icono: '✓' },
  por_vencer: { color: '#f59e0b', fondo: 'rgba(245,158,11,.10)', icono: '⏳' },
  vencida: { color: '#ef4444', fondo: 'rgba(239,68,68,.10)', icono: '✕' },
  sin_verificar: { color: '#f59e0b', fondo: 'rgba(245,158,11,.10)', icono: '?' },
  presentado: { color: '#60a5fa', fondo: 'rgba(59,130,246,.10)', icono: '📨' },
  lista_para_presentar: { color: '#60a5fa', fondo: 'rgba(59,130,246,.10)', icono: '📁' },
  pendiente_firma: { color: '#60a5fa', fondo: 'rgba(59,130,246,.10)', icono: '✍' },
  tramite_incompleto: { color: '#fb923c', fondo: 'rgba(251,146,60,.10)', icono: '…' },
  sin_tramite: { color: '#ef4444', fondo: 'rgba(239,68,68,.10)', icono: '!' },
  desconocida: { color: '#94a3b8', fondo: 'rgba(148,163,184,.10)', icono: '?' },
}

/** ¿Tiene una credencial (registrada y verificada), aunque esté vencida? */
export const tieneCredencial = (r: Pick<ResumenHabilitacion, 'credencial'>) => !!r.credencial && r.credencial.verificada

// ── Grupos del tablero ──────────────────────────────────────────────────────

export type GrupoTablero =
  | 'todos' | 'urgentes' | 'vigentes' | 'por_vencer' | 'vencidas' | 'sin_credencial'
  | 'en_tramite' | 'demorados' | 'sin_verificar' | 'sin_ingreso'

export const GRUPOS: [GrupoTablero, string][] = [
  ['urgentes', 'Urgentes'], ['vigentes', 'Vigentes'], ['por_vencer', 'Próximas a vencer'], ['vencidas', 'Vencidas'],
  ['sin_credencial', 'Sin credencial'], ['en_tramite', 'Trámites en curso'], ['demorados', 'Demorados'],
  ['sin_verificar', 'Sin verificar'], ['sin_ingreso', 'Sin fecha de ingreso'], ['todos', 'Todos'],
]

/** Urgencia desde la que un caso va a «Urgentes» (la calcula la base). */
export const URGENCIA_ALTA = 75

export function enGrupo(f: ResumenHabilitacion, g: GrupoTablero): boolean {
  const cred = f.credencial
  switch (g) {
    case 'todos': return true
    case 'urgentes': return f.urgencia >= URGENCIA_ALTA
    case 'vigentes': return !!cred && cred.verificada && cred.estado === 'vigente'
    case 'por_vencer': return !!cred && cred.verificada && cred.estado === 'por_vencer'
    case 'vencidas': return !!cred && cred.verificada && cred.estado === 'vencida'
    case 'sin_credencial': return !cred && f.codigo !== 'desconocida'
    case 'en_tramite': return !!f.tramite
    case 'demorados': return !!f.tramite?.demorado
    case 'sin_verificar': return f.codigo === 'desconocida' || f.codigo === 'sin_verificar'
    case 'sin_ingreso': return !f.ingreso
  }
}

export function contarGrupos(filas: ResumenHabilitacion[]): Record<GrupoTablero, number> {
  const c = Object.fromEntries(GRUPOS.map(([k]) => [k, 0])) as Record<GrupoTablero, number>
  for (const f of filas) for (const [k] of GRUPOS) if (enGrupo(f, k)) c[k]++
  return c
}

/** Etapa de la próxima gestión (para filtrar), o la situación si no hay trámite. */
export function etapaActual(f: ResumenHabilitacion): EtapaHabilitacion | null {
  const p = f.tramite?.pasos.find(x => !x.resuelto)
  return p ? p.etapa : null
}

export type OrdenTablero = 'urgencia' | 'seis_meses' | 'vencimiento' | 'apellido'

export function ordenar<T extends FilaTablero>(filas: T[], o: OrdenTablero): T[] {
  const lejos = Number.MAX_SAFE_INTEGER
  const cmp: Record<OrdenTablero, (a: T, b: T) => number> = {
    urgencia: (a, b) => b.urgencia - a.urgencia || a.apellido.localeCompare(b.apellido, 'es'),
    seis_meses: (a, b) => (a.dias_para_6_meses ?? lejos) - (b.dias_para_6_meses ?? lejos),
    vencimiento: (a, b) => (a.credencial?.dias ?? lejos) - (b.credencial?.dias ?? lejos),
    apellido: (a, b) => a.apellido.localeCompare(b.apellido, 'es') || a.nombre.localeCompare(b.nombre, 'es'),
  }
  return [...filas].sort(cmp[o])
}

// ── Textos ──────────────────────────────────────────────────────────────────

export const fechaCorta = (iso: string | null | undefined) => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

/** «1 año y 3 meses», «4 meses», «12 días». */
export function antiguedadTexto(dias: number | null): string {
  if (dias === null) return 'sin fecha de ingreso'
  if (dias < 0) return 'ingresa más adelante'
  if (dias < 31) return `${dias} día${dias === 1 ? '' : 's'}`
  const meses = Math.floor(dias / 30.4375)
  const anios = Math.floor(meses / 12), resto = meses % 12
  if (!anios) return `${meses} mes${meses === 1 ? '' : 'es'}`
  return `${anios} año${anios === 1 ? '' : 's'}${resto ? ` y ${resto} mes${resto === 1 ? '' : 'es'}` : ''}`
}

/** Sólo importa mientras no tenga credencial: cuánto falta (o cuánto pasó) de los 6 meses. */
export function seisMesesTexto(r: Pick<ResumenHabilitacion, 'dias_para_6_meses' | 'credencial'>): { texto: string; color: string } | null {
  if (r.dias_para_6_meses === null || (r.credencial && r.credencial.verificada)) return null
  const d = r.dias_para_6_meses
  // Referencia del período de prueba: sólo para ingresos recientes (hasta un año).
  if (d < -183) return null
  if (d < 0) return { texto: `6 meses cumplidos hace ${-d} día${d === -1 ? '' : 's'}`, color: '#ef4444' }
  if (d <= 30) return { texto: `faltan ${d} día${d === 1 ? '' : 's'} para los 6 meses`, color: '#f87171' }
  if (d <= 60) return { texto: `faltan ${d} días para los 6 meses`, color: '#fbbf24' }
  return { texto: `faltan ${d} días para los 6 meses`, color: '#94a3b8' }
}

export function responsableTexto(r: Pick<ResumenHabilitacion, 'responsable_rol' | 'responsable_nombre'>): string | null {
  if (!r.responsable_rol) return null
  return r.responsable_nombre && r.responsable_rol !== 'empleado'
    ? `${r.responsable_nombre} (${RESPONSABLE[r.responsable_rol]})`
    : RESPONSABLE[r.responsable_rol]
}

export const EVENTO: Record<string, string> = {
  tramite_iniciado: 'Inició el trámite', gestion: 'Actualizó una gestión', credencial_registrada: 'Registró una credencial',
  credencial_anulada: 'Anuló una credencial', tramite_cancelado: 'Cerró el trámite sin credencial', verificacion: 'Registró una verificación',
  responsable_habitual: 'Cambió un responsable habitual',
}

// ── RPC ─────────────────────────────────────────────────────────────────────

const mensaje = (e: { message?: string } | null, d: string) => (e?.message ?? '').trim() || d

export async function cargarHabilitacion(empleadoId: string): Promise<{ datos: HabilitacionEmpleado | null; error: string | null }> {
  const { data, error } = await supabase.rpc('habilitacion_de_empleado', { p_empleado_id: empleadoId })
  return error ? { datos: null, error: mensaje(error, 'No se pudo cargar la habilitación') } : { datos: data as HabilitacionEmpleado, error: null }
}

export async function cargarTablero(): Promise<{ datos: Tablero | null; error: string | null }> {
  const { data, error } = await supabase.rpc('habilitacion_tablero')
  return error ? { datos: null, error: mensaje(error, 'No se pudo cargar el tablero') } : { datos: data as Tablero, error: null }
}

const llamar = async (fn: string, args: Record<string, unknown>, d: string): Promise<string | null> => {
  const { error } = await supabase.rpc(fn, args)
  return error ? mensaje(error, d) : null
}

export const iniciarTramite = (empleadoId: string, tipo: 'primera' | 'renovacion') =>
  llamar('habilitacion_iniciar_tramite', { p_empleado_id: empleadoId, p_tipo: tipo }, 'No se pudo iniciar el trámite')

export const actualizarPaso = (tramiteId: string, paso: string, v: { estado: EstadoRegistrable; fecha?: string | null; responsable?: string | null; observacion?: string | null; documentoId?: string | null }) =>
  llamar('habilitacion_actualizar_paso', {
    p_tramite_id: tramiteId, p_paso: paso, p_estado: v.estado, p_fecha: v.fecha || null, p_responsable: v.responsable || null,
    p_observacion: v.observacion || null, p_documento_id: v.documentoId || null,
  }, 'No se pudo guardar la gestión')

export const registrarCredencial = (empleadoId: string, v: { numero?: string; emision?: string | null; vence?: string | null; documentoId?: string | null; verificada: boolean; observacion?: string }) =>
  llamar('habilitacion_registrar_credencial', {
    p_empleado_id: empleadoId, p_numero: v.numero || null, p_fecha_emision: v.emision || null, p_vence_el: v.vence || null,
    p_documento_id: v.documentoId || null, p_verificada: v.verificada, p_observacion: v.observacion || null,
  }, 'No se pudo registrar la credencial')

export const anularCredencial = (id: string, motivo: string) => llamar('habilitacion_anular_credencial', { p_id: id, p_motivo: motivo }, 'No se pudo anular')
export const cerrarTramite = (id: string, motivo: string) => llamar('habilitacion_cerrar_tramite', { p_tramite_id: id, p_motivo: motivo }, 'No se pudo cerrar el trámite')
export const verificar = (empleadoId: string, resultado: 'sin_credencial' | 'consulta_agencias', observacion?: string) =>
  llamar('habilitacion_verificar', { p_empleado_id: empleadoId, p_resultado: resultado, p_observacion: observacion || null }, 'No se pudo registrar')
export const responsableHabitual = (paso: string, usuario: string | null) =>
  llamar('habilitacion_responsable_habitual', { p_paso: paso, p_usuario: usuario }, 'No se pudo guardar el responsable')

/** La fecha de ingreso vive en los datos personales (circuito existente: Administración la aplica directo y queda registrada). */
export const cargarFechaIngreso = (empleadoId: string, fecha: string) =>
  llamar('legajo_proponer_cambio', { p_empleado_id: empleadoId, p_campo: 'fecha_ingreso', p_valor: fecha, p_motivo: 'Cargada desde Credencial y Habilitación' }, 'No se pudo guardar la fecha de ingreso')

/** Enlace a la Revisión de MEGA filtrada por la persona y el tipo de documento. */
export const enlaceMega = (empleadoId: string, tipo: string) =>
  `/dashboard?page=legajo_historico&empleado=${encodeURIComponent(empleadoId)}&ver=pendientes&tipo=${encodeURIComponent(tipo)}`
