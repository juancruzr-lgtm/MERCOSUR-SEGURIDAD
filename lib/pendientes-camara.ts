/**
 * lib/pendientes-camara.ts
 *
 * Resiliencia ante la cámara (auditoría PWA oct-2026).
 *
 * En Android con poca memoria, abrir la cámara del sistema con
 * `<input capture>` puede matar la pestaña: al volver, la app arranca de cero.
 * Producción mostró ráfagas de hasta 49 sesiones/hora de un mismo usuario
 * alrededor de `camara_libro_abierta` / `camara_uniforme_abierta`.
 *
 * Qué se puede salvar y qué no (límite de la plataforma web):
 *   - La foto que se estaba sacando en el momento en que el sistema mató la
 *     pestaña NO vuelve: el resultado del selector de archivos se pierde con
 *     la pestaña. Hay que sacarla otra vez.
 *   - Todo lo anterior SÍ se salva: el paso del flujo (fichaje o punto de
 *     ronda), el GPS ya tomado y las fotos ya sacadas (p. ej. la del libro
 *     cuando la que mata la pestaña es la cámara del uniforme).
 *
 * Diseño:
 *   - Flujo (JSON chico) en localStorage + sessionStorage. localStorage
 *     sobrevive aunque el sistema mate el proceso completo, cosa que
 *     sessionStorage no garantiza.
 *   - Fotos (Blob ya comprimido) en IndexedDB, como "pendientes" hasta que la
 *     subida se confirme; ahí se borran.
 *   - Acotado: máx. MAX_FOTOS_PENDIENTES fotos y MAX_BYTES_PENDIENTES en total;
 *     se purgan solas a las 24 h. Si no entra, se descartan las más viejas.
 *   - Sin IndexedDB (modo incógnito viejo, cuota) todo sigue funcionando como
 *     antes: guardar falla en silencio y restaurar devuelve null.
 */

export const MAX_FOTOS_PENDIENTES = 6
export const MAX_BYTES_PENDIENTES = 8 * 1024 * 1024
export const MAX_BYTES_FOTO_PENDIENTE = 4 * 1024 * 1024
export const EDAD_MAXIMA_PENDIENTE_MS = 24 * 60 * 60 * 1000

export type FlujoCamara = 'ingreso' | 'ronda'

export interface FotoPendiente {
  /** `${flujo}:${refId}:${tipo}` */
  clave: string
  flujo: FlujoCamara
  /** turno_id (ingreso) o ejecucion_punto_id (ronda). */
  ref_id: string
  /** libro | uniforme | punto */
  tipo: string
  usuario_id: string | null
  nombre: string
  mime: string
  bytes: number
  creado_ms: number
  blob: Blob
}

export type MetaFotoPendiente = Omit<FotoPendiente, 'blob'>

export function claveFotoPendiente(flujo: FlujoCamara, refId: string, tipo: string): string {
  return `${flujo}:${refId}:${tipo}`
}

/**
 * Qué borrar para que, después de agregar `nueva`, queden ≤ maxItems y
 * ≤ maxBytes, sin nada más viejo que maxEdadMs. Pura: la prueba la usa sin
 * IndexedDB. Nunca propone borrar la `nueva`.
 */
export function planPurga(
  existentes: Array<Pick<FotoPendiente, 'clave' | 'bytes' | 'creado_ms'>>,
  ahora: number,
  nueva: Pick<FotoPendiente, 'clave' | 'bytes'> | null = null,
  limites = { maxItems: MAX_FOTOS_PENDIENTES, maxBytes: MAX_BYTES_PENDIENTES, maxEdadMs: EDAD_MAXIMA_PENDIENTE_MS },
): string[] {
  const borrar = new Set<string>()
  // La que se reemplaza (misma clave) sale siempre.
  if (nueva) for (const e of existentes) if (e.clave === nueva.clave) borrar.add(e.clave)
  for (const e of existentes) if (ahora - e.creado_ms > limites.maxEdadMs) borrar.add(e.clave)

  const vivas = existentes
    .filter(e => !borrar.has(e.clave))
    .sort((a, b) => a.creado_ms - b.creado_ms) // las más viejas primero
  let items = vivas.length + (nueva ? 1 : 0)
  let bytes = vivas.reduce((s, e) => s + e.bytes, 0) + (nueva?.bytes ?? 0)
  for (const e of vivas) {
    if (items <= limites.maxItems && bytes <= limites.maxBytes) break
    borrar.add(e.clave)
    items--
    bytes -= e.bytes
  }
  return Array.from(borrar)
}

// ── Almacén (IndexedDB en el navegador; memoria en pruebas) ──────────────────

export interface AlmacenFotos {
  todas(): Promise<FotoPendiente[]>
  leer(clave: string): Promise<FotoPendiente | null>
  poner(item: FotoPendiente): Promise<void>
  borrar(clave: string): Promise<void>
}

export function almacenEnMemoria(): AlmacenFotos & { _mapa: Map<string, FotoPendiente> } {
  const mapa = new Map<string, FotoPendiente>()
  return {
    _mapa: mapa,
    async todas() { return Array.from(mapa.values()) },
    async leer(c) { return mapa.get(c) ?? null },
    async poner(i) { mapa.set(i.clave, i) },
    async borrar(c) { mapa.delete(c) },
  }
}

const DB_NOMBRE = 'mercosur-pendientes'
const DB_VERSION = 1
const STORE = 'fotos'

function almacenIndexedDb(): AlmacenFotos | null {
  if (typeof indexedDB === 'undefined') return null
  let dbPromesa: Promise<IDBDatabase> | null = null
  const abrir = () => {
    if (!dbPromesa) {
      dbPromesa = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NOMBRE, DB_VERSION)
        req.onupgradeneeded = () => {
          const db = req.result
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'clave' })
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => { dbPromesa = null; reject(req.error) }
      })
    }
    return dbPromesa
  }
  const tx = async <T>(modo: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
    const db = await abrir()
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, modo)
      const req = fn(t.objectStore(STORE))
      t.oncomplete = () => resolve(req ? (req as IDBRequest<T>).result : undefined)
      t.onerror = () => reject(t.error)
      t.onabort = () => reject(t.error)
    })
  }
  return {
    async todas() { return ((await tx('readonly', s => s.getAll())) as FotoPendiente[] | undefined) ?? [] },
    async leer(c) { return ((await tx('readonly', s => s.get(c))) as FotoPendiente | undefined) ?? null },
    async poner(i) { await tx('readwrite', s => s.put(i)) },
    async borrar(c) { await tx('readwrite', s => s.delete(c)) },
  }
}

let almacenActual: AlmacenFotos | null | undefined
function almacen(): AlmacenFotos | null {
  if (almacenActual === undefined) {
    try { almacenActual = almacenIndexedDb() } catch { almacenActual = null }
  }
  return almacenActual
}

/** Sólo para pruebas: reemplaza el almacén (null = sin IndexedDB). */
export function usarAlmacenFotos(a: AlmacenFotos | null | undefined) {
  almacenActual = a
}

// ── API de fotos ─────────────────────────────────────────────────────────────

export async function guardarFotoPendiente(
  datos: { flujo: FlujoCamara; refId: string; tipo: string; usuarioId?: string | null; archivo: Blob; nombre?: string },
  ahora = Date.now(),
): Promise<boolean> {
  const a = almacen()
  if (!a) return false
  if (datos.archivo.size <= 0 || datos.archivo.size > MAX_BYTES_FOTO_PENDIENTE) return false
  try {
    const clave = claveFotoPendiente(datos.flujo, datos.refId, datos.tipo)
    const item: FotoPendiente = {
      clave,
      flujo: datos.flujo,
      ref_id: datos.refId,
      tipo: datos.tipo,
      usuario_id: datos.usuarioId ?? null,
      nombre: datos.nombre ?? ((datos.archivo as File).name || `${datos.tipo}.jpg`),
      mime: datos.archivo.type || 'image/jpeg',
      bytes: datos.archivo.size,
      creado_ms: ahora,
      blob: datos.archivo,
    }
    const existentes = await a.todas()
    for (const c of planPurga(existentes, ahora, item)) await a.borrar(c)
    await a.poner(item)
    return true
  } catch {
    return false
  }
}

/** La foto pendiente como File, o null (no existe, venció o no hay IndexedDB). */
export async function leerFotoPendiente(
  flujo: FlujoCamara, refId: string, tipo: string, usuarioId: string | null = null, ahora = Date.now(),
): Promise<File | null> {
  const a = almacen()
  if (!a) return null
  try {
    const item = await a.leer(claveFotoPendiente(flujo, refId, tipo))
    if (!item) return null
    if (ahora - item.creado_ms > EDAD_MAXIMA_PENDIENTE_MS || (usuarioId && item.usuario_id && item.usuario_id !== usuarioId)) {
      await a.borrar(item.clave)
      return null
    }
    return new File([item.blob], item.nombre, { type: item.mime })
  } catch {
    return null
  }
}

export async function borrarFotoPendiente(flujo: FlujoCamara, refId: string, tipo: string): Promise<void> {
  try { await almacen()?.borrar(claveFotoPendiente(flujo, refId, tipo)) } catch { /* nada */ }
}

/** Borra todas las fotos de un flujo/referencia (p. ej. ingreso confirmado). */
export async function borrarFotosDe(flujo: FlujoCamara, refId: string): Promise<void> {
  const a = almacen()
  if (!a) return
  try {
    for (const i of await a.todas()) if (i.flujo === flujo && i.ref_id === refId) await a.borrar(i.clave)
  } catch { /* nada */ }
}

/** Purga lo vencido. Se llama al montar las pantallas móviles. */
export async function purgarFotosPendientes(ahora = Date.now()): Promise<number> {
  const a = almacen()
  if (!a) return 0
  try {
    const plan = planPurga(await a.todas(), ahora)
    for (const c of plan) await a.borrar(c)
    return plan.length
  } catch {
    return 0
  }
}

/** Para el Diagnóstico: metadatos sin los blobs. */
export async function listarFotosPendientes(): Promise<MetaFotoPendiente[]> {
  const a = almacen()
  if (!a) return []
  try {
    return (await a.todas())
      .map(({ blob: _b, ...meta }) => meta)
      .sort((x, y) => x.creado_ms - y.creado_ms)
  } catch {
    return []
  }
}

// ── Flujo en curso (JSON chico) ──────────────────────────────────────────────

/**
 * Guarda el estado del flujo en sessionStorage (como antes) y en localStorage
 * (sobrevive a que el sistema mate el proceso entero). Lleva su timestamp.
 */
export function guardarFlujo(clave: string, datos: Record<string, unknown>): void {
  const texto = JSON.stringify(datos)
  try { sessionStorage.setItem(clave, texto) } catch { /* sin storage */ }
  try { localStorage.setItem(clave, texto) } catch { /* sin storage */ }
}

/** Lee primero sessionStorage y, si no está, localStorage. */
export function leerFlujo(clave: string): string | null {
  try {
    const s = sessionStorage.getItem(clave)
    if (s) return s
  } catch { /* sin storage */ }
  try { return localStorage.getItem(clave) } catch { return null }
}

export function borrarFlujo(clave: string): void {
  try { sessionStorage.removeItem(clave) } catch { /* sin storage */ }
  try { localStorage.removeItem(clave) } catch { /* sin storage */ }
}

export const CLAVE_RONDA_EN_CURSO = 'mercosur.ronda_punto_en_curso.v1'
/** El GPS de un punto se reusa tras la recarga sólo si es reciente. */
export const EDAD_MAXIMA_GPS_RONDA_MS = 2 * 60 * 1000
