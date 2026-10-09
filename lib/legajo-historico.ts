/**
 * lib/legajo-historico.ts
 *
 * Bandeja del archivo histórico (MEGA) e indicios de planillas viejas.
 * Las reglas viven en la base (supabase/migrations/20261009150000_legajo_historico.sql).
 */

import { supabase } from '@/lib/supabase'

export type EstadoPropuesta = 'pendiente' | 'conflicto' | 'aceptada' | 'descartada' | 'separada' | 'importada'

export interface PropuestaHistorica {
  id: string
  padre_id: string | null
  lote: string
  ruta_origen: string
  indexado: boolean
  bytes: number | null
  paginas: number | null
  pagina_desde: number | null
  pagina_hasta: number | null
  tipo_sugerido: string | null
  confianza: 'alta' | 'media' | 'baja'
  criterio: string | null
  senales: { revisar?: string[]; tipos?: string[]; tipos_por_pagina?: unknown } & Record<string, unknown>
  estado: EstadoPropuesta
  motivo_conflicto: string | null
  sugerido: { id: string; nombre: string; apellido: string; legajo: string | null; estado: string } | null
  empleado_id: string | null
  tipo: string | null
  motivo: string | null
}

export interface TipoBandeja {
  codigo: string
  nombre: string
  campo_fecha: 'obligatoria' | 'opcional' | 'no'
  campo_vencimiento: 'no' | 'calculado' | 'declarado'
  etiqueta_detalle: string | null
  multiple: boolean
}

export interface Bandeja {
  conteo: Partial<Record<EstadoPropuesta, number>>
  tipos: TipoBandeja[]
  propuestas: PropuestaHistorica[]
}

export interface PersonaBuscada { id: string; nombre: string; apellido: string; legajo: string | null; estado: string; dni_repetido: boolean }

export interface Indicio {
  tipo: string | null
  dato: string
  valor: string | null
  fecha: string | null
  fuente: string
}

export const ETIQUETA_FUENTE: Record<string, string> = {
  'planilla_documentacion_2024-09': 'planilla de documentación (set. 2024)',
  'planilla_documentacion_2025-11': 'planilla de documentación (nov. 2025)',
  'planilla_legajos_2024-08': 'planilla de legajos (ago. 2024)',
  planilla_requisitos: 'planilla de requisitos',
}

const mensaje = (e: { message?: string } | null, d: string) => (e?.message ?? '').trim() || d

/** Con texto (≥ 3 letras) busca por archivo o persona en todos los estados. */
export async function cargarBandeja(estado: EstadoPropuesta, texto = ''): Promise<{ datos: Bandeja | null; error: string | null }> {
  const buscando = texto.trim().length >= 3
  const { data, error } = await supabase.rpc('legajo_historico_bandeja', {
    p_estado: buscando ? null : estado, p_limite: 200, p_texto: buscando ? texto.trim() : null,
  })
  if (error) return { datos: null, error: mensaje(error, 'No se pudo cargar la bandeja') }
  return { datos: data as Bandeja, error: null }
}

export async function buscarPersona(texto: string): Promise<PersonaBuscada[]> {
  const { data } = await supabase.rpc('legajo_historico_buscar_persona', { p_texto: texto })
  return (data as PersonaBuscada[] | null) ?? []
}

export async function resolverPropuesta(id: string, decision: 'aceptar' | 'descartar' | 'separar' | 'reabrir', p: {
  empleadoId?: string | null; tipo?: string | null; fechaEmision?: string | null; venceEl?: string | null
  detalle?: string | null; motivo?: string | null; rangos?: { desde: number; hasta: number; tipo: string | null }[]
  confirmoDniDistinto?: boolean
} = {}): Promise<string | null> {
  const { error } = await supabase.rpc('legajo_historico_resolver', {
    p_id: id, p_decision: decision, p_empleado_id: p.empleadoId ?? null, p_tipo: p.tipo ?? null,
    p_fecha_emision: p.fechaEmision || null, p_vence_el: p.venceEl || null, p_detalle: p.detalle || null,
    p_motivo: p.motivo || null, p_rangos: p.rangos ?? null, p_confirmo_dni_distinto: !!p.confirmoDniDistinto,
  })
  return error ? mensaje(error, 'No se pudo guardar') : null
}

/**
 * "1-2 dni, 3 cuil, 4-6" → rangos. Devuelve el error si no se entiende.
 */
export function leerRangos(texto: string, paginas: number | null): { rangos: { desde: number; hasta: number; tipo: string | null }[]; error: string | null } {
  const rangos: { desde: number; hasta: number; tipo: string | null }[] = []
  for (const parte of texto.split(',').map(s => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?(?:\s+([a-z_0-9]+))?$/i.exec(parte)
    if (!m) return { rangos: [], error: `No se entiende “${parte}”. Ejemplo: 1-2 dni, 3 cuil` }
    const desde = Number(m[1]), hasta = Number(m[2] ?? m[1])
    if (desde < 1 || hasta < desde || (paginas && hasta > paginas)) return { rangos: [], error: `Rango inválido: ${parte}` }
    rangos.push({ desde, hasta, tipo: m[3]?.toLowerCase() ?? null })
  }
  if (!rangos.length) return { rangos, error: 'Indicá al menos un rango' }
  return { rangos, error: null }
}

/** Archivos de MEGA ya asociados a la persona por Administración (referencias, no copias). */
export interface ReferenciaHistorica {
  id: string
  tipo: string
  tipo_nombre: string
  ruta_origen: string
  hash_origen: string
  paginas: [number, number] | null
  fecha_emision: string | null
  vence_el: string | null
  detalle: string | null
  estado: 'aceptada' | 'importada'
  revisado_at: string | null
  revisado_por: string | null
  disponible: boolean
}

export async function cargarHistoricoDeEmpleado(empleadoId: string): Promise<ReferenciaHistorica[]> {
  const { data, error } = await supabase.rpc('legajo_historico_de_empleado', { p_empleado_id: empleadoId })
  return error ? [] : ((data as ReferenciaHistorica[] | null) ?? [])
}

export async function cargarIndicios(empleadoId: string): Promise<Indicio[]> {
  const { data, error } = await supabase.rpc('legajo_historico_indicios_de', { p_empleado_id: empleadoId })
  return error ? [] : ((data as Indicio[] | null) ?? [])
}

// ── Filtros de la bandeja y nivel de cada referencia ────────────────────────

/** '' = todas · '(sin)' = sin categoría · código = esa categoría (asignada o sugerida). */
export type FiltroHistorico = { categoria?: string; soloSinPersona?: boolean }

export const categoriaDe = (p: Pick<PropuestaHistorica, 'tipo' | 'tipo_sugerido'>) => p.tipo ?? p.tipo_sugerido ?? null
export const tienePersona = (p: Pick<PropuestaHistorica, 'empleado_id' | 'sugerido'>) => !!(p.empleado_id ?? p.sugerido)

export function filtrarHistorico<T extends Pick<PropuestaHistorica, 'tipo' | 'tipo_sugerido' | 'empleado_id' | 'sugerido'>>(lista: T[], f: FiltroHistorico): T[] {
  return lista.filter(p =>
    (!f.categoria || (f.categoria === '(sin)' ? categoriaDe(p) === null : categoriaDe(p) === f.categoria))
    && (!f.soloSinPersona || !tienePersona(p)))
}

/**
 * Qué es cada referencia para el legajo. Encontrarla en MEGA o asociarla a una
 * persona NO la vuelve documentación válida: eso sólo pasa con un documento del
 * legajo revisado y aprobado (sección Documentación).
 */
export function nivelHistorico(estado: EstadoPropuesta): { texto: string; color: string } {
  switch (estado) {
    case 'pendiente': return { texto: 'Localizado en MEGA · asociación por revisar', color: '#93c5fd' }
    case 'conflicto': return { texto: 'Localizado en MEGA · con conflicto, sin persona asociada', color: '#fbbf24' }
    case 'aceptada': return { texto: 'Asociado a la persona · referencia sin validar', color: '#86efac' }
    case 'importada': return { texto: 'Copiado al legajo · sigue la revisión de Documentación', color: '#86efac' }
    case 'descartada': return { texto: 'Descartado', color: '#94a3b8' }
    case 'separada': return { texto: 'Separado en partes', color: '#94a3b8' }
  }
}

export const EVENTO_HISTORICO: Record<string, string> = {
  cargada: 'Localizado en MEGA (carga de referencias)', aceptada: 'Asociación aceptada', descartada: 'Descartado',
  separada: 'Separado por páginas', reabierta: 'Reabierto', importada: 'Copiado al legajo',
}

export interface EventoHistorico { evento: string; at: string; quien: string | null; detalle: Record<string, unknown> | null }

/** Historial de intervenciones de una referencia (RLS: Administración/Gerencia). */
export async function cargarEventosHistorico(propuestaId: string): Promise<{ eventos: EventoHistorico[]; error: string | null }> {
  const { data, error } = await supabase.from('legajo_historico_eventos')
    .select('evento, at, usuario_id, detalle').eq('propuesta_id', propuestaId).order('at').limit(200)
  if (error) return { eventos: [], error: mensaje(error, 'No se pudo leer el historial') }
  const ids = Array.from(new Set((data ?? []).map(e => e.usuario_id).filter((x): x is string => !!x)))
  const nombres = new Map<string, string>()
  if (ids.length) {
    const { data: us } = await supabase.from('usuarios').select('id, nombre, apellido').in('id', ids)
    for (const u of us ?? []) nombres.set(u.id, `${u.nombre ?? ''} ${u.apellido ?? ''}`.trim())
  }
  return {
    eventos: (data ?? []).map(e => ({ evento: e.evento, at: e.at, quien: e.usuario_id ? nombres.get(e.usuario_id) ?? null : null, detalle: e.detalle as Record<string, unknown> | null })),
    error: null,
  }
}
