import { IPlugin, PluginResult } from '../IPlugin'
import { DocumentRecord } from '../../core/types'

// v1: stub — detecta .doc/.docx pero no extrae contenido todavía.
// v2: implementar extracción de cláusulas, partes, fechas de vigencia.
export class WordPlugin implements IPlugin {
  readonly name = 'word'
  readonly version = '1.0.0'
  readonly supportedExtensions = ['.doc', '.docx']

  canHandle(extension: string): boolean {
    return this.supportedExtensions.includes(extension)
  }

  async process(_doc: DocumentRecord): Promise<PluginResult> {
    return { success: true }
  }
}
