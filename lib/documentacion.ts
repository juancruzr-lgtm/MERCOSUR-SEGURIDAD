/**
 * lib/documentacion.ts
 *
 * Documentación del legajo: reglas puras (sin Supabase), para que el legajo,
 * la bandeja y el control de Administración digan lo mismo.
 *
 * El catálogo vive en la base (documentacion_tipos). Ver
 * supabase/migrations/20261009140000_documentacion_legajo.sql.
 *
 * ── Presentado ≠ validado ────────────────────────────────────────────────────
 * VALIDADO: aprobado (lo subió la persona y Administración lo revisó) o
 * aceptado (lo cargó Administración y la persona dejó su constancia). Si el
 * tipo vence, además no tiene que estar vencido.
 * PRESENTADO: lo subió la persona y espera revisión. No cuenta como completo.
 * NO CORRESPONDE: lo marcó Administración, con motivo. No cuenta como faltante.
 */

export type Requisito = 'obligatorio' | 'opcional' | 'si_corresponde'
export type Sensibilidad = 'comun' | 'sensible' | 'reservado_gerencia'
export type Constancia = 'conformidad' | 'recepcion' | 'toma_conocimiento' | 'ninguna'

export interface TipoDocumento {
  codigo: string
  nombre: string
  ayuda: string | null
  orden: number
  requisito: Requisito
  etapa: 'ingreso' | 'permanencia' | 'egreso' | 'legal'
  caras: string[] | null
  multiple: boolean
  campo_fecha: 'obligatoria' | 'opcional' | 'no'
  etiqueta_fecha: string
  campo_vencimiento: 'no' | 'calculado' | 'declarado'
  vigencia_meses: number | null
  etiqueta_detalle: string | null
  sube_vigilador: boolean
  sensibilidad: Sensibilidad
  constancia: Constancia
  texto_constancia: string | null
  referencia: 'sindicato' | 'embargos' | 'suspensiones' | null
  activo?: boolean
}

export type EstadoDocumento =
  | 'subiendo' | 'pendiente_revision' | 'pendiente_aceptacion'
  | 'aprobado' | 'aceptado' | 'rechazado' | 'observado'
  | 'reemplazado' | 'anulado'

export type Respuesta = 'conformidad' | 'recepcion' | 'toma_conocimiento' | 'observacion'

export interface ArchivoDocumento {
  id: string
  orden: number
  cara: string | null
  mime: string
  bytes: number
}

export interface ConstanciaDocumento {
  tipo: 'lectura' | Respuesta
  texto: string | null
  comentario: string | null
  at: string
}

export interface DocumentoLegajo {
  id: string
  tipo: string
  detalle: string | null
  sensibilidad?: Sensibilidad
  fecha_emision: string | null
  vence_el: string | null
  origen: 'vigilador' | 'administracion' | 'historico'
  estado: EstadoDocumento
  creado_at?: string
  confirmado_at: string | null
  subido_por_nombre?: string | null
  revisado_at?: string | null
  revisado_por_nombre?: string | null
  motivo_rechazo?: string | null
  respondido_at?: string | null
  respuesta?: Respuesta | null
  respuesta_comentario?: string | null
  reemplazado_at?: string | null
  anulado_at?: string | null
  motivo_anulacion?: string | null
  leido?: boolean
  constancias?: ConstanciaDocumento[]
  archivos?: ArchivoDocumento[]
}

export interface SituacionMarcada {
  tipo: string
  situacion: 'no_corresponde' | 'solicitado'
  motivo: string | null
  at?: string
}

export interface ReferenciasSistema {
  sindicato: { desde: string; hasta: string | null }[]
  embargos: { origen: 'expediente' | 'concepto'; referencia: string | null; desde: string; hasta: string | null }[]
  suspensiones: { desde: string; hasta: string; observacion: string | null }[]
}

export interface AccesoArchivo {
  at: string
  modo: 'ver' | 'descargar'
  tipo: string
  orden: number
  quien: string | null
}

export interface DocumentacionEmpleado {
  empleado_id: string
  es_propio: boolean
  puede_gestionar: boolean
  es_gerencia?: boolean
  hoy: string
  tipos: TipoDocumento[]
  situaciones: SituacionMarcada[]
  documentos: DocumentoLegajo[]
  accesos: AccesoArchivo[] | null
  referencias: ReferenciasSistema
}

export const BUCKET_DOCUMENTOS = 'legajo-documentos'
export const MAX_BYTES = 15 * 1024 * 1024
export const MAX_ARCHIVOS = 10
export const MIMES_ADMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
/** "Por vencer" con este margen. */
export const DIAS_AVISO_VENCIMIENTO = 30

const VIGENTES: EstadoDocumento[] = ['aprobado', 'aceptado']
const PENDIENTES: EstadoDocumento[] = ['pendiente_aceptacion', 'observado', 'rechazado', 'pendiente_revision']
const HISTORIAL: EstadoDocumento[] = ['reemplazado', 'anulado']

/** Situación de un tipo para una persona. */
export type SituacionBase =
  | 'validado' | 'por_vencer' | 'vencido' | 'presentado' | 'falta' | 'no_cargado' | 'no_corresponde'

export interface SituacionTipo {
  base: SituacionBase
  /** Lo que está esperando a alguien (el más urgente), si hay. */
  pendiente: DocumentoLegajo | null
  vigentes: DocumentoLegajo[]
  pendientes: DocumentoLegajo[]
  historial: DocumentoLegajo[]
  /** Marca de Administración: no corresponde / solicitado. */
  marca: SituacionMarcada | null
}

export function sumarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const f = new Date(Date.UTC(y, m - 1, d + dias))
  return f.toISOString().slice(0, 10)
}

const masReciente = (a: DocumentoLegajo, b: DocumentoLegajo) =>
  (b.confirmado_at ?? b.creado_at ?? '').localeCompare(a.confirmado_at ?? a.creado_at ?? '')

export function situacionDeTipo(
  tipo: TipoDocumento, documentos: DocumentoLegajo[], hoy: string, situaciones: SituacionMarcada[] = [],
): SituacionTipo {
  const delTipo = documentos.filter(d => d.tipo === tipo.codigo && d.estado !== 'subiendo').sort(masReciente)
  const vigentes = delTipo.filter(d => VIGENTES.includes(d.estado))
  const pendientes = delTipo.filter(d => PENDIENTES.includes(d.estado))
  const historial = delTipo.filter(d => HISTORIAL.includes(d.estado))
  const marca = situaciones.find(s => s.tipo === tipo.codigo) ?? null

  let base: SituacionBase
  if (vigentes.length === 0) {
    if (marca?.situacion === 'no_corresponde') base = 'no_corresponde'
    else if (pendientes.some(d => d.estado === 'pendiente_revision')) base = 'presentado'
    else base = tipo.requisito === 'obligatorio' ? 'falta' : 'no_cargado'
  } else {
    const vence = tipo.multiple ? null : vigentes[0].vence_el
    if (vence && vence < hoy) base = 'vencido'
    else if (vence && vence <= sumarDias(hoy, DIAS_AVISO_VENCIMIENTO)) base = 'por_vencer'
    else base = 'validado'
  }

  // Lo que espera a la persona va primero: es lo que tiene que hacer.
  const orden = (d: DocumentoLegajo) => PENDIENTES.indexOf(d.estado)
  const pendiente = [...pendientes].sort((a, b) => orden(a) - orden(b) || masReciente(a, b))[0] ?? null

  return { base, pendiente, vigentes, pendientes, historial, marca }
}

export interface ResumenDocumentacion {
  /** Obligatorios que corresponden (sin los "no corresponde"). */
  obligatorios: number
  validados: number
  /** Subidos por la persona y sin revisar: presentados, NO validados. */
  presentados: number
  faltan: number
  vencidos: number
  porVencer: number
  paraAceptar: number
  paraRevisar: number
  observados: number
  rechazados: number
  solicitados: number
}

export function resumenDocumentacion(
  tipos: TipoDocumento[], documentos: DocumentoLegajo[], hoy: string, situaciones: SituacionMarcada[] = [],
): ResumenDocumentacion {
  const r: ResumenDocumentacion = {
    obligatorios: 0, validados: 0, presentados: 0, faltan: 0, vencidos: 0, porVencer: 0,
    paraAceptar: 0, paraRevisar: 0, observados: 0, rechazados: 0, solicitados: 0,
  }
  for (const t of tipos) {
    const s = situacionDeTipo(t, documentos, hoy, situaciones)
    if (t.requisito === 'obligatorio' && s.base !== 'no_corresponde') {
      r.obligatorios++
      if (s.base === 'validado' || s.base === 'por_vencer') r.validados++
      if (s.base === 'presentado') r.presentados++
      if (s.base === 'falta') r.faltan++
    }
    if (s.base === 'vencido') r.vencidos++
    if (s.base === 'por_vencer') r.porVencer++
    if (s.marca?.situacion === 'solicitado' && s.vigentes.length === 0 && s.pendientes.length === 0) r.solicitados++
  }
  const codigos = new Set(tipos.map(t => t.codigo))
  for (const d of documentos) {
    if (!codigos.has(d.tipo)) continue
    if (d.estado === 'pendiente_aceptacion') r.paraAceptar++
    if (d.estado === 'pendiente_revision') r.paraRevisar++
    if (d.estado === 'observado') r.observados++
    if (d.estado === 'rechazado') r.rechazados++
  }
  return r
}

/** Quién puede cargar este tipo. La regla que manda es la de la base. */
export function puedeSubir(tipo: TipoDocumento, esPropio: boolean, puedeGestionar: boolean, esGerencia = false): boolean {
  if (tipo.sensibilidad === 'reservado_gerencia') return esGerencia
  return puedeGestionar || (esPropio && tipo.sube_vigilador)
}

export function etiquetaRequisito(t: TipoDocumento): string {
  if (t.requisito === 'obligatorio') return 'Obligatorio'
  if (t.requisito === 'opcional') return t.ayuda ?? 'Si lo tenés'
  return t.ayuda ?? 'Si corresponde'
}

export const ETIQUETA_ESTADO: Record<EstadoDocumento, string> = {
  subiendo: 'Subiendo',
  pendiente_revision: 'Presentado · en revisión',
  pendiente_aceptacion: 'Para confirmar',
  aprobado: 'Validado',
  aceptado: 'Validado',
  rechazado: 'Rechazado',
  observado: 'Con observación',
  reemplazado: 'Reemplazado',
  anulado: 'Anulado',
}

export const ETIQUETA_BASE: Record<SituacionBase, string> = {
  validado: 'Validado',
  por_vencer: 'Por vencer',
  vencido: 'Vencido',
  presentado: 'Presentado · sin validar',
  falta: 'Pendiente',
  no_cargado: 'No cargado',
  no_corresponde: 'No corresponde',
}

/** El botón con el que la persona deja su constancia. */
export const BOTON_CONSTANCIA: Record<Exclude<Constancia, 'ninguna'>, string> = {
  conformidad: 'Confirmo',
  recepcion: 'Confirmo que lo recibí',
  toma_conocimiento: 'Tomé conocimiento',
}

export const ETIQUETA_CONSTANCIA: Record<ConstanciaDocumento['tipo'], string> = {
  lectura: 'Lo abrió',
  conformidad: 'Dio conformidad',
  recepcion: 'Confirmó la recepción',
  toma_conocimiento: 'Tomó conocimiento',
  observacion: 'Avisó un error',
}

export const ETIQUETA_ORIGEN: Record<DocumentoLegajo['origen'], string> = {
  vigilador: 'la persona',
  administracion: 'Administración',
  historico: 'el archivo histórico',
}

export type Tono = 'ok' | 'alerta' | 'error' | 'neutro' | 'accion'

export const TONO_ESTADO: Record<EstadoDocumento, Tono> = {
  subiendo: 'neutro', pendiente_revision: 'alerta', pendiente_aceptacion: 'accion',
  aprobado: 'ok', aceptado: 'ok', rechazado: 'error', observado: 'error',
  reemplazado: 'neutro', anulado: 'neutro',
}

export const TONO_BASE: Record<SituacionBase, Tono> = {
  validado: 'ok', por_vencer: 'alerta', vencido: 'error', presentado: 'alerta',
  falta: 'error', no_cargado: 'neutro', no_corresponde: 'neutro',
}

/** Insignia de la tarjeta del tipo. */
export function insigniaTipo(s: SituacionTipo): { texto: string; tono: Tono } {
  if (s.pendiente) return { texto: ETIQUETA_ESTADO[s.pendiente.estado], tono: TONO_ESTADO[s.pendiente.estado] }
  if (s.base === 'falta' && s.marca?.situacion === 'solicitado') return { texto: 'Solicitado', tono: 'accion' }
  return { texto: ETIQUETA_BASE[s.base], tono: TONO_BASE[s.base] }
}

export function fechaCorta(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

export function fechaHora(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit',
      year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso))
  } catch { return iso }
}

/**
 * Valida los archivos elegidos ANTES de subir (la base y el servidor vuelven
 * a validar). Devuelve el mensaje de error o null.
 */
export function validarArchivos(tipo: TipoDocumento, archivos: { type: string; size: number }[]): string | null {
  if (tipo.caras) {
    if (archivos.length !== tipo.caras.length) return `Faltan fotos: se necesitan ${tipo.caras.join(' y ')}.`
  } else if (archivos.length < 1) {
    return 'Elegí al menos una foto o un PDF.'
  }
  if (archivos.length > MAX_ARCHIVOS) return `Se pueden subir hasta ${MAX_ARCHIVOS} archivos.`
  for (const a of archivos) {
    if (!(MIMES_ADMITIDOS as readonly string[]).includes(a.type)) return 'Formato no admitido: subí una foto (JPG/PNG) o un PDF.'
    if (a.size > MAX_BYTES) return 'Cada archivo puede pesar hasta 15 MB.'
  }
  return null
}

/** Valida fechas del formulario (la base vuelve a validar). */
export function validarFechas(tipo: TipoDocumento, emision: string, vence: string, hoy: string): string | null {
  if (tipo.campo_fecha === 'obligatoria' && !emision) return `Falta la ${tipo.etiqueta_fecha.toLowerCase()}.`
  if (emision && emision > hoy) return 'La fecha no puede ser futura.'
  if (tipo.campo_vencimiento === 'declarado') {
    if (!vence) return 'Falta la fecha de vencimiento que figura en el documento.'
    if (emision && vence <= emision) return 'El vencimiento tiene que ser posterior a la emisión.'
  }
  return null
}

/** Persona del control de Administración. */
export interface PersonaControl {
  empleado_id: string
  nombre: string
  apellido: string
  legajo: string | null
  rol: string | null
  puesto: string | null
  situaciones: SituacionMarcada[]
  documentos: DocumentoLegajo[]
}

export interface ControlDocumentacionDatos {
  hoy: string
  tipos: TipoDocumento[]
  personas: PersonaControl[]
}

export function esVigilador(p: { rol: string | null; puesto: string | null }): boolean {
  return p.puesto === 'vigilador' || ((p.puesto === null || p.puesto === undefined) && (p.rol === 'guardia' || p.rol === 'vigilador'))
}
