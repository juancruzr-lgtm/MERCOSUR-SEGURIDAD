import { IPlugin, PluginResult } from '../IPlugin'
import { DocumentRecord } from '../../core/types'

// v1: stub — detecta PDFs pero no extrae contenido todavía.
// v2: implementar extracción de texto, tablas, firmantes, fechas.
export class PdfPlugin implements IPlugin {
  readonly name = 'pdf'
  readonly version = '1.0.0'
  readonly supportedExtensions = ['.pdf']

  canHandle(extension: string): boolean {
    return extension === '.pdf'
  }

  async process(_doc: DocumentRecord): Promise<PluginResult> {
    // TODO v2: leer contenido, extraer texto, detectar tipo de documento
    return { success: true }
  }
}
