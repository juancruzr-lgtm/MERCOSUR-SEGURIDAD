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
  /** DNI leído del documento o de su ruta (normalizado). */
  dni_sugerido?: string | null
  sugerido: { id: string; nombre: string; apellido: string; legajo: string | null; estado: string } | null
  empleado_id: string | null
  tipo: string | null
  motivo: string | null
  revisado_at?: string | null
  documento_id?: string | null
  /** Estado del documento del legajo, si ya se copió (importada). */
  documento_estado?: string | null
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
  /** Total del filtro (estado o búsqueda), para paginar. */
  total?: number
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

export const TAMAÑO_PAGINA_HISTORICO = 200

/** Con texto (≥ 3 letras) busca por archivo, persona, legajo o DNI en todos los estados. */
export async function cargarBandeja(estado: EstadoPropuesta, texto = '', desde = 0): Promise<{ datos: Bandeja | null; error: string | null }> {
  const buscando = texto.trim().length >= 3
  const { data, error } = await supabase.rpc('legajo_historico_bandeja', {
    p_estado: buscando ? null : estado, p_limite: TAMAÑO_PAGINA_HISTORICO, p_texto: buscando ? texto.trim() : null, p_desde: desde,
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

/**
 * '' = todas · '(sin)' = sin categoría · '(fuera)' = categoría que hoy no está en el
 * catálogo vigente (hay que elegir otra o descartar) · código = esa categoría.
 */
export type FiltroHistorico = {
  categoria?: string; soloSinPersona?: boolean; activas?: string[]
  nivel?: NivelIdentificacion | ''; soloConflictos?: boolean; estadoVisual?: EstadoVisual | ''
}

export const categoriaDe = (p: Pick<PropuestaHistorica, 'tipo' | 'tipo_sugerido'>) => p.tipo ?? p.tipo_sugerido ?? null
export const tienePersona = (p: Pick<PropuestaHistorica, 'empleado_id' | 'sugerido'>) => !!(p.empleado_id ?? p.sugerido)

type ParaFiltrar = Pick<PropuestaHistorica, 'tipo' | 'tipo_sugerido' | 'empleado_id' | 'sugerido'>
  & Partial<Pick<PropuestaHistorica, 'estado' | 'senales' | 'dni_sugerido' | 'documento_estado'>>

export function filtrarHistorico<T extends ParaFiltrar>(lista: T[], f: FiltroHistorico): T[] {
  return lista.filter(p =>
    (!f.categoria
      || (f.categoria === '(sin)' ? categoriaDe(p) === null
        : f.categoria === '(fuera)' ? categoriaDe(p) !== null && !(f.activas ?? []).includes(categoriaDe(p) as string)
        : categoriaDe(p) === f.categoria))
    && (!f.soloSinPersona || !tienePersona(p))
    && (!f.soloConflictos || p.estado === 'conflicto')
    && (!f.nivel || nivelIdentificacion(p) === f.nivel)
    && (!f.estadoVisual || (!!p.estado && estadoVisual({ ...p, estado: p.estado }).clave === f.estadoVisual)))
}

// ── Nivel de identificación y estado visual ─────────────────────────────────

export type NivelIdentificacion = 'inequivoca' | 'probable' | 'dudosa' | 'sin_identificar'

export const NIVELES_IDENTIFICACION: [NivelIdentificacion, string][] = [
  ['inequivoca', 'Inequívoca'], ['probable', 'Probable'], ['dudosa', 'Dudosa'], ['sin_identificar', 'Sin identificar'],
]

/**
 * Qué tan verificable es la persona propuesta. Las cargadas desde el índice
 * traen el nivel en las señales; las de la carga MEGA se asociaron sólo por un
 * DNI que figura en UNA persona (inequívoca); con conflicto, el DNI no alcanzó.
 */
export function nivelIdentificacion(p: Partial<Pick<PropuestaHistorica, 'senales' | 'sugerido' | 'empleado_id' | 'dni_sugerido' | 'estado'>>): NivelIdentificacion {
  const n = p.senales?.nivel
  if (n === 'inequivoca' || n === 'probable' || n === 'dudosa' || n === 'sin_identificar') return n
  if (p.sugerido) return 'inequivoca'
  if (p.estado === 'conflicto' && p.dni_sugerido) return 'dudosa'
  return 'sin_identificar'
}

export type EstadoVisual =
  | 'localizado' | 'identificacion_propuesta' | 'asociacion_confirmada' | 'pendiente_validacion'
  | 'documento_validado' | 'conflicto' | 'descartado' | 'separado'

export const ESTADOS_VISUALES: [EstadoVisual, string][] = [
  ['localizado', 'Localizado'], ['identificacion_propuesta', 'Identificación propuesta'],
  ['asociacion_confirmada', 'Asociación confirmada'], ['pendiente_validacion', 'Pendiente de validación documental'],
  ['documento_validado', 'Documento validado'], ['conflicto', 'Conflicto'], ['descartado', 'Descartado'],
]

/**
 * Los 7 estados que ve Administración, armados con los estados de la base
 * (propuesta + documento del legajo). Sólo «Documento validado» viene de una
 * revisión en Documentación; nada anterior lo vuelve válido.
 */
export function estadoVisual(p: Pick<PropuestaHistorica, 'estado' | 'empleado_id' | 'sugerido'> & { documento_estado?: string | null }): { clave: EstadoVisual; texto: string; color: string } {
  switch (p.estado) {
    case 'pendiente': return tienePersona(p)
      ? { clave: 'identificacion_propuesta', texto: 'Identificación propuesta · falta confirmar', color: '#93c5fd' }
      : { clave: 'localizado', texto: 'Localizado en MEGA · sin persona', color: '#94a3b8' }
    case 'conflicto': return { clave: 'conflicto', texto: 'Conflicto · sin persona asociada', color: '#fbbf24' }
    case 'aceptada': return { clave: 'asociacion_confirmada', texto: 'Asociación confirmada · referencia sin validar', color: '#86efac' }
    case 'importada': return p.documento_estado === 'aprobado' || p.documento_estado === 'aceptado'
      ? { clave: 'documento_validado', texto: 'Documento validado en Documentación', color: '#22c55e' }
      : { clave: 'pendiente_validacion', texto: 'Copiado al legajo · pendiente de validación documental', color: '#86efac' }
    case 'descartada': return { clave: 'descartado', texto: 'Descartado', color: '#94a3b8' }
    case 'separada': return { clave: 'separado', texto: 'Separado en partes (se revisa cada parte)', color: '#94a3b8' }
  }
}

// ── Confirmación en lote ────────────────────────────────────────────────────

/**
 * Sólo entran al lote las propuestas que no necesitan ningún dato de una
 * persona: identificación inequívoca, categoría vigente con confianza alta,
 * sin fecha obligatoria, sin vencimiento escrito ni detalle exigido, sin
 * señales de revisión y con el archivo en el índice. Los conflictos nunca.
 * Confirmar asocia; no valida el documento.
 */
export function motivoFueraDeLote(p: PropuestaHistorica, tipos: TipoBandeja[]): string | null {
  if (p.estado !== 'pendiente') return p.estado === 'conflicto' ? 'tiene conflicto' : 'ya resuelta'
  if (p.motivo_conflicto) return 'tiene conflicto'
  if (!p.sugerido) return 'sin persona'
  if (nivelIdentificacion(p) !== 'inequivoca') return 'identificación no inequívoca'
  if (!p.indexado) return 'no está en el índice'
  if (p.confianza !== 'alta') return `categoría con confianza ${p.confianza}`
  const t = tipos.find(x => x.codigo === p.tipo_sugerido)
  if (!t) return p.tipo_sugerido ? 'categoría que hoy no se exige' : 'sin categoría'
  if (t.campo_fecha === 'obligatoria') return 'pide fecha'
  if (t.campo_vencimiento === 'declarado') return 'pide vencimiento'
  if (t.etiqueta_detalle && t.multiple) return `pide ${t.etiqueta_detalle.toLowerCase()}`
  if ((p.senales?.revisar ?? []).length) return 'tiene señales para revisar'
  return null
}

export const MOTIVO_LOTE = 'Confirmación en lote: identificación inequívoca y categoría sugerida'

/** Una por una, con el mismo control de la base que la confirmación manual. */
export async function confirmarEnLote(lista: PropuestaHistorica[], alAvanzar?: (hechas: number) => void): Promise<{ ok: string[]; errores: { id: string; error: string }[] }> {
  const ok: string[] = [], errores: { id: string; error: string }[] = []
  for (const p of lista) {
    const e = await resolverPropuesta(p.id, 'aceptar', { empleadoId: p.sugerido?.id, tipo: p.tipo_sugerido, motivo: MOTIVO_LOTE })
    if (e) errores.push({ id: p.id, error: e }); else ok.push(p.id)
    alAvanzar?.(ok.length + errores.length)
  }
  return { ok, errores }
}

// ── Pista para la matriz documental ─────────────────────────────────────────

export type NivelPista = 'localizada' | 'asociacion_pendiente' | 'confirmada'
export interface PistaHistorica { empleado_id: string; tipo: string; nivel: NivelPista; referencias: number }

export const TEXTO_PISTA: Record<NivelPista, { corto: string; texto: string }> = {
  localizada: { corto: 'H?', texto: 'referencia histórica localizada (con conflicto)' },
  asociacion_pendiente: { corto: 'H', texto: 'referencia histórica con asociación pendiente' },
  confirmada: { corto: 'H✓', texto: 'referencia histórica asociada (sin validar)' },
}

/** Mapa empleado|tipo → pista. Sólo informa: no cambia estados ni indicadores. */
export async function cargarPistasMatriz(): Promise<Map<string, PistaHistorica>> {
  const { data, error } = await supabase.rpc('legajo_historico_matriz')
  const m = new Map<string, PistaHistorica>()
  if (error) return m
  for (const r of (data as PistaHistorica[] | null) ?? []) m.set(`${r.empleado_id}|${r.tipo}`, r)
  return m
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
