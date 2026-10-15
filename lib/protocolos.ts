/**
 * lib/protocolos.ts
 *
 * Protocolos operativos por objetivo (Etapa 1): tipos y reglas puras.
 *
 * ── Qué decide este archivo ─────────────────────────────────────────────────
 *  · Qué guarda el teléfono para leer sin señal, de quién, y cuándo se borra.
 *  · Qué aperturas hechas sin señal quedan en cola para registrar después.
 *  · Cuándo aparece el aviso después del fichaje de ingreso.
 *  · Rótulos de estados y tipos de diferencia.
 *
 * ── Qué NO decide ────────────────────────────────────────────────────────────
 * Quién puede leer qué lo decide la base (protocolo_mis_documentos y RLS). El
 * teléfono sólo guarda lo que el servidor ya le entregó a ESA sesión.
 *
 * ── Sin conexión: la regla ───────────────────────────────────────────────────
 * Hay objetivos sin señal en el puesto (PNC, CIRSE, la garita de Baigorria,
 * ACA con señal inestable). Para que el vigilador pueda leer igual:
 *  1. Se guarda UNA sola copia, la de la última respuesta del servidor para la
 *     sesión actual (auth user id). Nada de acumular protocolos viejos: cada
 *     respuesta reemplaza la copia entera, así lo que dejó de corresponderle
 *     (otro objetivo, una versión reemplazada) desaparece en la próxima carga.
 *  2. La copia vence a las 36 h aunque no haya red (los turnos habilitados son
 *     ayer, hoy y mañana: más tiempo no le sirve a nadie).
 *  3. Si en el teléfono entra otra persona (dispositivo compartido), la copia
 *     de la anterior se borra antes de mostrar nada. Al cerrar sesión, se borra.
 *  4. Las aperturas sin señal quedan en cola, de esa misma sesión, y se
 *     registran al volver la conexión (el servidor vuelve a validar el turno).
 *     La CONFIRMACIÓN de lectura exige conexión: es una constancia y la arma
 *     el servidor.
 */

// ── Tipos ───────────────────────────────────────────────────────────────────

export type EstadoVersion = 'borrador' | 'pendiente_aprobacion' | 'vigente' | 'reemplazado' | 'descartado'
export type Asociacion = 'confirmada' | 'pendiente_validacion'
export type TipoDiferencia =
  | 'version_documental' | 'asociacion_objetivo' | 'frecuencia_ronda' | 'ronda_faltante'
  | 'horario' | 'asignacion_puesto' | 'redaccion' | 'excepcion_operativa' | 'otro'

/** Lo que recibe el vigilador: sólo vigentes de sus turnos habilitados. */
export interface DocumentoVigilador {
  version_id: string
  objetivo_id: string
  objetivo_nombre: string | null
  puesto_id: string | null
  puesto_nombre: string | null
  numero: number
  titulo: string
  texto: string
  texto_sha256: string
  aprobado_at: string | null
  turnos: string[]
  abierto_at: string | null
  confirmado_at: string | null
  /** Confirmó una versión anterior de este protocolo y la vigente es otra. */
  cambio?: boolean
}

export interface VersionProtocolo {
  id: string
  objetivo_id: string
  puesto_id: string | null
  puesto_nombre: string | null
  numero: number
  titulo: string
  texto: string
  texto_sha256: string
  fuente_tipo: 'whatsapp' | 'documento' | 'manual'
  fuente_descripcion: string
  fuente_fecha: string | null
  fuente_archivo: string | null
  fuente_archivo_sha256: string | null
  asociacion: Asociacion
  asociacion_nota: string | null
  asociacion_confirmada_at: string | null
  estado: EstadoVersion
  creado_at: string
  enviado_aprobacion_at: string | null
  aprobado_at: string | null
  aprobado_por_nombre: string | null
  reemplazado_at: string | null
  descartado_at: string | null
  motivo_descarte: string | null
  devuelto_motivo: string | null
  notas: string | null
  aperturas: number
  confirmaciones: number
}

export interface LecturaProtocolo {
  version_id: string
  empleado_id: string
  nombre: string | null
  apellido: string | null
  legajo: string | null
  ultimo_turno: string | null
  abierto_at: string | null
  confirmado_at: string | null
}

export interface DiferenciaProtocolo {
  id: string
  version_id: string | null
  tipo: TipoDiferencia
  origen: string
  referencia_original: string | null
  descripcion: string
  estado: 'pendiente' | 'resuelta'
  responsable: string | null
  resolucion: string | null
  resuelta_at: string | null
  resuelta_por_nombre: string | null
  registro_origen: string
  creado_at: string
}

export interface PanelObjetivo {
  objetivo_id: string
  permisos: { ver: boolean; preparar: boolean; publicar: boolean; registrar_diferencias: boolean }
  versiones: VersionProtocolo[]
  lecturas: LecturaProtocolo[]
  diferencias: DiferenciaProtocolo[]
}

export interface ResumenObjetivo {
  objetivo_id: string
  objetivo_nombre: string
  vigentes: number
  borradores: number
  pendientes_aprobacion: number
  asociacion_pendiente: number
  diferencias_pendientes: number
  vigiladores_esperados: number
  vigiladores_confirmaron: number
}

// ── Rótulos ─────────────────────────────────────────────────────────────────

export const ETIQUETA_ESTADO: Record<EstadoVersion, string> = {
  borrador: 'Borrador',
  pendiente_aprobacion: 'Pendiente de aprobación',
  vigente: 'Vigente',
  reemplazado: 'Reemplazada',
  descartado: 'Descartada',
}

export const COLOR_ESTADO: Record<EstadoVersion, string> = {
  borrador: '#94a3b8',
  pendiente_aprobacion: '#f59e0b',
  vigente: '#10b981',
  reemplazado: '#64748b',
  descartado: '#ef4444',
}

export const ETIQUETA_TIPO_DIFERENCIA: Record<TipoDiferencia, string> = {
  version_documental: 'Versión del documento',
  asociacion_objetivo: 'Coincidencia con el objetivo',
  frecuencia_ronda: 'Frecuencia de ronda',
  ronda_faltante: 'Ronda faltante',
  horario: 'Horario',
  asignacion_puesto: 'Asignación por puesto',
  redaccion: 'Redacción',
  excepcion_operativa: 'Excepción operativa',
  otro: 'Otro',
}

export const TIPOS_DIFERENCIA = Object.keys(ETIQUETA_TIPO_DIFERENCIA) as TipoDiferencia[]

/** Texto que muestra la pantalla antes de confirmar (el que queda en la
 *  constancia lo arma el servidor: protocolo_texto_declaracion). */
export const TEXTO_DECLARACION =
  'Declaro haber leído el protocolo de funciones y procedimientos del objetivo. ' +
  'Esta confirmación registra la lectura; no acredita el cumplimiento.'

export function fechaHoraAR(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// ── Copia local (sin conexión) ──────────────────────────────────────────────

export const CLAVE_CACHE = 'mercosur.protocolos.v1'
export const CLAVE_PENDIENTES = 'mercosur.protocolos.aperturas.v1'
export const CLAVE_SESION_AVISO = 'mercosur.protocolos.aviso_pospuesto'
export const VIGENCIA_CACHE_MS = 36 * 60 * 60 * 1000

export interface CacheProtocolos {
  authUserId: string
  guardadoAt: number
  documentos: DocumentoVigilador[]
}

/** La copia que corresponde guardar después de una respuesta del servidor.
 *  Reemplaza la anterior entera (no acumula). */
export function armarCache(authUserId: string, documentos: DocumentoVigilador[], ahora: number): CacheProtocolos {
  return { authUserId, guardadoAt: ahora, documentos }
}

/**
 * Lee la copia guardada. Devuelve los documentos sólo si son de ESTA sesión y
 * no vencieron; si no, indica que hay que borrarla.
 */
export function leerCache(raw: string | null, authUserId: string | null, ahora: number): {
  documentos: DocumentoVigilador[] | null
  guardadoAt: number | null
  borrar: boolean
} {
  if (!raw) return { documentos: null, guardadoAt: null, borrar: false }
  let c: CacheProtocolos | null = null
  try { c = JSON.parse(raw) } catch { return { documentos: null, guardadoAt: null, borrar: true } }
  if (!c || typeof c !== 'object' || !Array.isArray(c.documentos) || typeof c.guardadoAt !== 'number') {
    return { documentos: null, guardadoAt: null, borrar: true }
  }
  if (!authUserId || c.authUserId !== authUserId) return { documentos: null, guardadoAt: null, borrar: true }
  if (ahora - c.guardadoAt > VIGENCIA_CACHE_MS || c.guardadoAt > ahora + 5 * 60 * 1000) {
    return { documentos: null, guardadoAt: null, borrar: true }
  }
  return { documentos: c.documentos, guardadoAt: c.guardadoAt, borrar: false }
}

export interface AperturaPendiente {
  version_id: string
  turno_id: string | null
  abierto_cliente_at: string
}
export interface ColaAperturas {
  authUserId: string
  items: AperturaPendiente[]
}

/** Agrega una apertura a la cola de la sesión (una por versión: la primera). */
export function encolarApertura(raw: string | null, authUserId: string, item: AperturaPendiente): ColaAperturas {
  const actual = leerCola(raw, authUserId)
  if (actual.some(i => i.version_id === item.version_id)) return { authUserId, items: actual }
  return { authUserId, items: [...actual, item].slice(-50) }
}

/** La cola de ESTA sesión (la de otra persona se descarta). */
export function leerCola(raw: string | null, authUserId: string | null): AperturaPendiente[] {
  if (!raw || !authUserId) return []
  try {
    const c = JSON.parse(raw) as ColaAperturas
    if (!c || c.authUserId !== authUserId || !Array.isArray(c.items)) return []
    return c.items.filter(i => i && typeof i.version_id === 'string')
  } catch { return [] }
}

/** Marca como abiertos (en la copia local) los documentos con apertura en cola,
 *  para que la pantalla no pida abrir de nuevo lo que ya se leyó sin señal. */
export function aplicarAperturasLocales(docs: DocumentoVigilador[], cola: AperturaPendiente[]): DocumentoVigilador[] {
  if (cola.length === 0) return docs
  const porVersion = new Map(cola.map(i => [i.version_id, i.abierto_cliente_at]))
  return docs.map(d => (d.abierto_at || !porVersion.has(d.version_id)) ? d : { ...d, abierto_at: porVersion.get(d.version_id)! })
}

// ── Selección ───────────────────────────────────────────────────────────────

/** Los protocolos que corresponden a un turno (general del objetivo + el del
 *  puesto, si hay). El servidor ya filtró; esto sólo agrupa por turno. */
export function documentosDeTurno(docs: DocumentoVigilador[], turnoId: string): DocumentoVigilador[] {
  return docs
    .filter(d => d.turnos.includes(turnoId))
    .sort((a, b) => (a.puesto_id ? 1 : 0) - (b.puesto_id ? 1 : 0))
}

/**
 * ¿Mostrar el aviso después del ingreso? Sólo si el turno tiene un protocolo
 * vigente sin confirmar y la persona no lo pospuso en esta sesión. Devuelve el
 * primero a mostrar, o null.
 */
export function documentoParaAviso(
  docs: DocumentoVigilador[], turnoId: string, pospuestos: string[],
): DocumentoVigilador | null {
  return documentosDeTurno(docs, turnoId).find(d => !d.confirmado_at && !pospuestos.includes(d.version_id)) ?? null
}

/**
 * El protocolo cambió desde la última lectura confirmada: se avisa al abrir la
 * app (sin esperar al ingreso), una vez por versión y por sesión.
 */
export function documentoCambiado(docs: DocumentoVigilador[], pospuestos: string[]): DocumentoVigilador | null {
  return docs.find(d => d.cambio && !d.confirmado_at && d.turnos.length > 0 && !pospuestos.includes(d.version_id)) ?? null
}

export function leerPospuestos(raw: string | null): string[] {
  if (!raw) return []
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a.filter(x => typeof x === 'string') : [] } catch { return [] }
}

// ── Administración ──────────────────────────────────────────────────────────

/** Lecturas de una versión, separadas en confirmadas y pendientes. */
export function separarLecturas(lecturas: LecturaProtocolo[], versionId: string): {
  confirmaron: LecturaProtocolo[]
  abrieronSinConfirmar: LecturaProtocolo[]
  sinAbrir: LecturaProtocolo[]
} {
  const deVersion = lecturas.filter(l => l.version_id === versionId)
  return {
    confirmaron: deVersion.filter(l => l.confirmado_at),
    abrieronSinConfirmar: deVersion.filter(l => !l.confirmado_at && l.abierto_at),
    sinAbrir: deVersion.filter(l => !l.confirmado_at && !l.abierto_at),
  }
}

// ── Vista principal de la ficha (protocolo primero) ─────────────────────────

/**
 * Lo que se muestra arriba de todo en la ficha del objetivo, por alcance
 * (todo el objetivo, o un puesto):
 *  · vigente: lo que hoy lee el vigilador (puede no haber).
 *  · trabajo: versiones en preparación (borrador o pendiente de aprobación),
 *    la más reciente primero. Puede haber más de una (Rapsodia: dos textos).
 *  · ultima: la última versión ESCRITA (trabajo o vigente), que es la que se
 *    muestra de entrada. No es necesariamente la que ve el vigilador.
 * Reemplazadas y descartadas quedan sólo en el historial.
 */
export interface AlcanceProtocolo {
  clave: string
  puesto_id: string | null
  puesto_nombre: string | null
  vigente: VersionProtocolo | null
  trabajo: VersionProtocolo[]
  ultima: VersionProtocolo | null
}

const masReciente = (a: VersionProtocolo, b: VersionProtocolo) =>
  (b.creado_at ?? '').localeCompare(a.creado_at ?? '') || b.numero - a.numero

export function vistaProtocolo(versiones: VersionProtocolo[]): AlcanceProtocolo[] {
  const porAlcance = new Map<string, VersionProtocolo[]>()
  for (const v of versiones) {
    const clave = v.puesto_id ?? 'objetivo'
    porAlcance.set(clave, [...(porAlcance.get(clave) ?? []), v])
  }
  const alcances: AlcanceProtocolo[] = []
  porAlcance.forEach((lista, clave) => {
    const vigente = lista.find(v => v.estado === 'vigente') ?? null
    const trabajo = lista.filter(v => v.estado === 'borrador' || v.estado === 'pendiente_aprobacion').sort(masReciente)
    const candidatas = [...trabajo, ...(vigente ? [vigente] : [])].sort(masReciente)
    alcances.push({
      clave, puesto_id: lista[0].puesto_id, puesto_nombre: lista[0].puesto_nombre,
      vigente, trabajo, ultima: candidatas[0] ?? null,
    })
  })
  return alcances.sort((a, b) => (a.puesto_id ? 1 : 0) - (b.puesto_id ? 1 : 0) || (a.puesto_nombre ?? '').localeCompare(b.puesto_nombre ?? ''))
}

// ── Comparación de versiones ────────────────────────────────────────────────

export interface LineaComparada { tipo: 'igual' | 'agregada' | 'quitada'; texto: string }

/**
 * Diferencia línea por línea (subsecuencia común más larga). Sirve para ver
 * qué cambió entre la versión vigente (o el original) y un borrador. Textos
 * de protocolo: decenas de líneas, el costo cuadrático no importa; por las
 * dudas, más de 2.000 líneas por lado no se comparan.
 */
export function compararLineas(antes: string, despues: string): LineaComparada[] | null {
  const a = antes.split('\n')
  const b = despues.split('\n')
  if (a.length > 2000 || b.length > 2000) return null
  const n = a.length, m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1])
    }
  }
  const out: LineaComparada[] = []
  let i = 0, j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ tipo: 'igual', texto: a[i] }); i++; j++ }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push({ tipo: 'quitada', texto: a[i] }); i++ }
    else { out.push({ tipo: 'agregada', texto: b[j] }); j++ }
  }
  while (i < n) out.push({ tipo: 'quitada', texto: a[i++] })
  while (j < m) out.push({ tipo: 'agregada', texto: b[j++] })
  return out
}
