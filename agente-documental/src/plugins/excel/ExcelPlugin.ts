import { IPlugin, PluginResult } from '../IPlugin'
import { DocumentRecord } from '../../core/types'

// v1: stub.
// v2: parsing de planillas de turnos, liquidaciones, nómina.
export class ExcelPlugin implements IPlugin {
  readonly name = 'excel'
  readonly version = '1.0.0'
  readonly supportedExtensions = ['.xls', '.xlsx', '.csv']

  canHandle(extension: string): boolean {
    return this.supportedExtensions.includes(extension)
  }

  async process(_doc: DocumentRecord): Promise<PluginResult> {
    return { success: true }
  }
}
