/**
 * Tipos centrales del Agente MERCOSUR.
 *
 * NOTA ARQUITECTURAL — EventBus (v2):
 * En v1 los módulos se comunican con llamadas directas.
 * Cuando se incorpore el EventBus, los eventos serán de este tipo:
 *
 *   type AgentEvent =
 *     | { type: 'file:detected';       payload: FileInfo }
 *     | { type: 'file:indexed';        payload: DocumentRecord }
 *     | { type: 'file:error';          payload: { path: string; error: Error } }
 *     | { type: 'scan:started';        payload: { root: string } }
 *     | { type: 'scan:completed';      payload: ScanSummary }
 *     | { type: 'agent:ready' }
 *     | { type: 'agent:stopping' }
 *     // v3+ (IA):
 *     | { type: 'document:classified'; payload: { uid: string; categoria: string; tipo: string } }
 *     | { type: 'document:embedded';   payload: { uid: string; vectorId: string } }
 *     | { type: 'sync:completed';      payload: { source: string; count: number } }
 */

// ─── Información cruda de un archivo en disco ────────────────

export interface FileInfo {
  nombreArchivo: string
  extension: string        // en minúsculas, con punto: '.pdf'
  mimeType: string
  rutaAbsoluta: string     // solo para operaciones de filesystem, nunca persiste
  rutaRelativa: string     // relativa a DOCUMENT_ROOT_PATH — dato operativo
  tamanoBytes: number
  fechaCreacion: Date | null
  fechaModificacion: Date
  hashSha256: string
}

// ─── Registro en la base de datos ────────────────────────────

export type EstadoIndexacion = 'indexado' | 'pendiente' | 'error' | 'ignorado'

export interface DocumentRecord {
  id?: string
  documentoUid: string     // identidad estable a través del tiempo
  versionActual: number    // empieza en 1, sube con cada cambio de hash

  agenteId: string
  origen: string
  empresa: string
  tipoDocumento: string | null  // null hasta que IA clasifique

  nombreArchivo: string
  extension: string
  mimeType: string
  rutaRelativa: string

  tamanoBytes: number
  hashSha256: string
  fechaCreacionArchivo: Date | null
  fechaModificacionArchivo: Date

  detectadoPorPrimeraVezAt: Date
  detectadoPorUltimaVezAt: Date

  disponible: boolean
  estadoIndexacion: EstadoIndexacion
  categoria: string | null      // null hasta que IA clasifique
  etiquetas: string[]           // vacío hasta que IA etiquete

  ultimoError: string | null
  creadoAt?: Date
  actualizadoAt?: Date
}

// ─── Resultado de un escaneo completo ────────────────────────

export interface ScanSummary {
  agenteId: string
  raiz: string
  iniciadoAt: Date
  finalizadoAt: Date
  totalArchivos: number
  nuevos: number
  actualizados: number
  sinCambios: number
  marcadosNoDisponibles: number
  errores: number
}

// ─── Modo de ejecución ───────────────────────────────────────

export type AgentMode = 'scan' | 'watch' | 'test-connection'

// ─── Configuración del agente ────────────────────────────────

export interface AgentConfig {
  supabaseUrl: string
  supabaseServiceRoleKey: string
  agenteId: string
  origen: string
  empresa: string
  documentRootPath: string
  maxSizeMb: number
  ignoredDirectories: string[]
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}
