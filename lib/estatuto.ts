/**
 * lib/estatuto.ts
 *
 * Estatuto Interno: qué versión rige, si la persona ya la aceptó, cuándo se
 * habilita la declaración y qué dice exactamente. Lógica pura, sin Supabase:
 * la lectura y las RPC están en lib/estatuto-datos.ts.
 *
 * ── Tres hechos distintos, que no se mezclan ─────────────────────────────────
 *   abierto    la persona abrió el texto de esa versión (estatuto_aperturas)
 *   aceptado   declaró expresamente haberlo leído (estatuto_aceptaciones)
 *   pospuesto  cerró el cartel por esta sesión — NO es nada: no se registra
 *
 * Abrir o cerrar el cartel no es aceptar. Abrir el documento tampoco: sólo
 * habilita la casilla. La aceptación es un acto aparte, explícito, y queda una
 * por persona y versión.
 *
 * ── Qué no es ────────────────────────────────────────────────────────────────
 * No es la conformidad con cada cláusula ni reemplaza las constancias firmadas
 * en papel: acredita que la persona declaró haber tomado conocimiento de un
 * documento identificado por su hash. La UI lo aclara (ACLARACION_PAPEL).
 */

import contenidoV1 from '@/lib/estatuto/contenido-v1.json'

// ── Tipos ────────────────────────────────────────────────────────────────────

export type EstadoVersion = 'borrador' | 'publicado'

export interface VersionEstatuto {
  id: string
  /**
   * Número de versión ('1', '2', …). El documento NO se identifica por fecha:
   * por decisión de Gerencia (08/10) se llama "Estatuto Interno", sin fecha.
   */
  identificador: string
  titulo: string
  archivo_ruta: string
  archivo_nombre: string
  archivo_sha256: string
  archivo_bytes: number
  texto_sha256: string | null
  estado: EstadoVersion
  publicado_at: string | null
  publicado_por: string | null
}

export interface AceptacionEstatuto {
  id: string
  version_id: string
  empleado_id: string
  auth_user_id: string
  version_identificador: string
  archivo_sha256: string
  texto_sha256: string | null
  declaracion: string
  abierto_at: string
  aceptado_at: string
}

export interface AperturaEstatuto {
  version_id: string
  empleado_id: string
  abierto_at: string
}

export type ParrafoTipo = 'titulo' | 'seccion' | 'parrafo' | 'cierre'

export interface ParrafoEstatuto {
  /** Número de párrafo en el Word original (para rastrear la conversión). */
  parrafo_word: number
  /** Numeración AUTOMÁTICA de Word ("1)", "d)"). La manual va dentro del texto. */
  numero: string | null
  tipo: ParrafoTipo
  /** Texto del párrafo tal cual el original (sólo se recortan espacios de los bordes). */
  texto: string
  /** Fragmentos en negrita dentro del párrafo, en orden. */
  negritas?: string[]
}

export interface ContenidoEstatuto {
  version: string
  fuente: {
    archivo_original: string
    sha256_original: string
    bytes_original: number
    copia_pdf: string
    sha256_pdf: string
    conversion: string
  }
  conteos: { parrafos: number; numerados: number; secciones: number }
  texto_sha256: string
  parrafos: ParrafoEstatuto[]
}

// ── Textos fijos ─────────────────────────────────────────────────────────────

export const TITULO_CARTEL = 'ESTATUTO INTERNO — MERCOSUR SEGURIDAD SRL'

export const TEXTO_CARTEL =
  'El Estatuto Interno establece las obligaciones, normas de conducta y ' +
  'procedimientos que deben cumplir los integrantes de la empresa. Te ' +
  'solicitamos que leas el documento completo y confirmes que tomaste ' +
  'conocimiento de su contenido.'

/**
 * La aceptación digital no es la constancia en papel. La Gerencia pidió que
 * la pantalla no la presente como sustituto: la empresa puede seguir pidiendo
 * la firma en papel y esto no la reemplaza.
 */
export const ACLARACION_PAPEL =
  'Esta constancia digital registra que tomaste conocimiento del Estatuto ' +
  'desde la app. No reemplaza las constancias firmadas en papel que la ' +
  'empresa te solicite.'

// ── Versión y declaración ────────────────────────────────────────────────────

/**
 * "Versión 1". Sin fecha: Gerencia pidió (08/10) que el documento se llame
 * "Estatuto Interno" a secas. Las fechas que sí se muestran son las de la
 * constancia (publicación, apertura, aceptación), que no son del documento.
 */
export function etiquetaVersion(identificador: string | null | undefined): string {
  return `Versión ${identificador ?? '—'}`
}

/**
 * El texto de la declaración. Sin fecha ni número de versión: la constancia
 * guarda aparte qué versión y qué archivo (hash) se aceptó.
 *
 * Es el mismo texto que arma `estatuto_texto_declaracion()` en la base; el que
 * queda en la constancia es el del servidor.
 */
export const TEXTO_DECLARACION =
  'Declaro haber leído y tomado conocimiento del Estatuto Interno de Mercosur Seguridad SRL.'

/** Fecha y hora de Argentina para mostrar una constancia. */
export function fechaHoraArgentina(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}

// ── Versión vigente ──────────────────────────────────────────────────────────

/**
 * La publicada más reciente. Un borrador nunca es vigente, aunque sea más
 * nuevo: mientras Gerencia no publique, a nadie se le pide aceptar nada.
 *
 * Misma regla que `estatuto_version_vigente_id()` en la base.
 */
export function versionVigente(
  versiones: readonly VersionEstatuto[],
): VersionEstatuto | null {
  const publicadas = versiones.filter(v => v.estado === 'publicado' && v.publicado_at)
  if (publicadas.length === 0) return null
  return [...publicadas].sort((a, b) => {
    const t = Date.parse(b.publicado_at as string) - Date.parse(a.publicado_at as string)
    if (t !== 0) return t
    return Number(b.identificador) - Number(a.identificador)
  })[0]
}

// ── Estado de la persona ─────────────────────────────────────────────────────

export type EstadoAceptacion =
  /** No hay versión publicada: no se pide nada. */
  | 'sin_version'
  /** Hay vigente y la persona no la aceptó (aunque haya aceptado otra). */
  | 'pendiente'
  /** Aceptó la vigente. */
  | 'aceptado'

/**
 * Aceptar una versión anterior no cubre la vigente: publicar una versión nueva
 * vuelve a pedir la aceptación a todos. Las constancias anteriores se conservan
 * y se muestran, pero no cuentan para la vigente.
 */
export function estadoAceptacion(
  vigente: VersionEstatuto | null,
  aceptaciones: readonly AceptacionEstatuto[],
  empleadoId: string,
): EstadoAceptacion {
  if (!vigente) return 'sin_version'
  const ya = aceptaciones.some(a => a.version_id === vigente.id && a.empleado_id === empleadoId)
  return ya ? 'aceptado' : 'pendiente'
}

/** La constancia de la vigente, si existe. */
export function aceptacionDe(
  version: VersionEstatuto | null,
  aceptaciones: readonly AceptacionEstatuto[],
  empleadoId: string,
): AceptacionEstatuto | null {
  if (!version) return null
  return aceptaciones.find(a => a.version_id === version.id && a.empleado_id === empleadoId) ?? null
}

// ── Habilitación de la declaración ───────────────────────────────────────────

export interface SituacionDeclaracion {
  estado: EstadoAceptacion
  /** Abrió el texto en esta pantalla. */
  abiertoEnPantalla: boolean
  /** La base ya tiene registrada la apertura de esta versión. */
  aperturaRegistrada: boolean
  /** Hay una aceptación en curso (para no mandar dos). */
  enviando?: boolean
}

/**
 * La casilla se habilita recién después de abrir el documento. Alcanza con
 * que lo haya abierto ahora o que la base ya tenga su apertura (lo abrió ayer,
 * cerró la app y volvió). Mirar el cartel no cuenta.
 */
export function declaracionHabilitada(s: SituacionDeclaracion): boolean {
  if (s.estado !== 'pendiente') return false
  return s.abiertoEnPantalla || s.aperturaRegistrada
}

/**
 * El botón "Aceptar estatuto" necesita, además, la casilla marcada y la
 * apertura YA registrada en la base: la RPC la exige, y mandar la aceptación
 * antes de que la apertura quede guardada sólo produciría un error.
 */
export function puedeAceptar(s: SituacionDeclaracion & { casillaMarcada: boolean }): boolean {
  return declaracionHabilitada(s) && s.aperturaRegistrada && s.casillaMarcada && !s.enviando
}

// ── Cartel ───────────────────────────────────────────────────────────────────

export const CLAVE_SESION_CARTEL = 'mercosur_aviso_estatuto_pospuesto'

/**
 * El cartel aparece mientras esté pendiente. "Después" lo esconde sólo por la
 * sesión y sólo para ESA versión (si se publica otra, vuelve aunque se haya
 * pospuesto la anterior). No hay "no mostrar más".
 */
export function mostrarCartel(
  estado: EstadoAceptacion,
  vigenteId: string | null,
  pospuestoParaVersion: string | null,
): boolean {
  if (estado !== 'pendiente' || !vigenteId) return false
  return pospuestoParaVersion !== vigenteId
}

// ── Control de Administración / Gerencia ─────────────────────────────────────

export interface PersonaControl {
  empleado_id: string
  nombre: string | null
  apellido: string | null
  legajo: string | null
  cuil: string | null
  rol: string | null
  puesto: string | null
  abierto_at: string | null
  aceptado_at: string | null
  ultima_version_aceptada: string | null
  ultima_aceptacion_at: string | null
}

export interface ResumenControl {
  alcanzados: number
  aceptaron: number
  pendientes: number
  /** Pendientes que al menos abrieron el documento. */
  abrieronSinAceptar: number
  listaAceptaron: PersonaControl[]
  listaPendientes: PersonaControl[]
}

/**
 * Pendientes por diferencia sobre el universo, no contando filas ausentes:
 * quien no aceptó no tiene fila, y un count sobre aceptaciones diría cero
 * en vez de "no aceptó nadie" (mismo criterio que estadoDeEntrega).
 */
export function resumenControl(personas: readonly PersonaControl[]): ResumenControl {
  const porNombre = (a: PersonaControl, b: PersonaControl) =>
    `${a.apellido ?? ''} ${a.nombre ?? ''}`.localeCompare(`${b.apellido ?? ''} ${b.nombre ?? ''}`, 'es')
  const listaAceptaron = personas.filter(p => p.aceptado_at).sort(porNombre)
  const listaPendientes = personas.filter(p => !p.aceptado_at).sort(porNombre)
  return {
    alcanzados: personas.length,
    aceptaron: listaAceptaron.length,
    pendientes: listaPendientes.length,
    abrieronSinAceptar: listaPendientes.filter(p => p.abierto_at).length,
    listaAceptaron,
    listaPendientes,
  }
}

// ── Contenido empaquetado ────────────────────────────────────────────────────

/**
 * El texto que se muestra en pantalla, por versión. Es la conversión del
 * original verificada contra dos extractores independientes (ver
 * docs/contexto/ESTATUTO-INTERNO-2026-10-08.md). Una versión nueva agrega su
 * archivo acá y su fila en estatuto_versiones, con el mismo texto_sha256.
 */
const CONTENIDOS: Record<string, ContenidoEstatuto> = {
  '1': contenidoV1 as ContenidoEstatuto,
}

export function contenidoDeVersion(identificador: string | null | undefined): ContenidoEstatuto | null {
  if (!identificador) return null
  return CONTENIDOS[identificador] ?? null
}

/**
 * El texto canónico sobre el que se calcula `texto_sha256`: cada párrafo en una
 * línea, con su numeración automática adelante.
 */
export function textoCanonico(c: Pick<ContenidoEstatuto, 'parrafos'>): string {
  return c.parrafos.map(p => (p.numero ? p.numero + ' ' : '') + p.texto).join('\n')
}

/**
 * Parte un párrafo en tramos normales y en negrita, respetando el orden de
 * `negritas`. Si un fragmento no aparece (no debería), se ignora: el texto
 * nunca se altera por un problema de formato.
 */
export function tramosConNegrita(
  texto: string,
  negritas: readonly string[] | undefined,
): { texto: string; negrita: boolean }[] {
  if (!negritas || negritas.length === 0) return [{ texto, negrita: false }]
  const tramos: { texto: string; negrita: boolean }[] = []
  let desde = 0
  for (const n of negritas) {
    const i = texto.indexOf(n, desde)
    if (i < 0) continue
    if (i > desde) tramos.push({ texto: texto.slice(desde, i), negrita: false })
    tramos.push({ texto: n, negrita: true })
    desde = i + n.length
  }
  if (desde < texto.length) tramos.push({ texto: texto.slice(desde), negrita: false })
  return tramos
}
