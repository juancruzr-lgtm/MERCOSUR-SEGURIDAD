import { IPlugin, PluginResult } from '../IPlugin'
import { DocumentRecord } from '../../core/types'

// v1: stub.
// v2: OCR para documentos escaneados, reconocimiento de DNI, carnet, badge.
export class ImagesPlugin implements IPlugin {
  readonly name = 'images'
  readonly version = '1.0.0'
  readonly supportedExtensions = ['.jpg', '.jpeg', '.png']

  canHandle(extension: string): boolean {
    return this.supportedExtensions.includes(extension)
  }

  async process(_doc: DocumentRecord): Promise<PluginResult> {
    return { success: true }
  }
}
