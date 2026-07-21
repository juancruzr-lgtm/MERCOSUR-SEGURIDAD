import { IPlugin, PluginResult } from '../IPlugin'
import { DocumentRecord } from '../../core/types'

// v1: stub.
// v2: extracción de texto plano, logs, informes simples.
export class TxtPlugin implements IPlugin {
  readonly name = 'txt'
  readonly version = '1.0.0'
  readonly supportedExtensions = ['.txt']

  canHandle(extension: string): boolean {
    return extension === '.txt'
  }

  async process(_doc: DocumentRecord): Promise<PluginResult> {
    return { success: true }
  }
}
