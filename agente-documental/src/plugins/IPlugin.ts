import { DocumentRecord } from '../core/types'

export interface PluginResult {
  success: boolean
  extractedData?: Record<string, unknown>  // futuro: contenido, entidades, fechas, partes
  error?: string
}

/**
 * Interfaz que todo plugin de procesamiento documental debe implementar.
 *
 * En v1 todos los plugins retornan { success: true } inmediatamente.
 * En v2+ implementarán process() con extracción real de contenido.
 */
export interface IPlugin {
  readonly name: string
  readonly version: string
  readonly supportedExtensions: string[]   // ej: ['.pdf', '.PDF']

  canHandle(extension: string): boolean
  process(doc: DocumentRecord): Promise<PluginResult>

  // Hooks de ciclo de vida (opcionales)
  onLoad?(): Promise<void>
  onUnload?(): Promise<void>
}
