import { IPlugin } from './IPlugin'
import { Logger } from '../logger/Logger'

export class PluginRegistry {
  private plugins: IPlugin[] = []

  constructor(private readonly logger: Logger) {}

  register(plugin: IPlugin): void {
    this.plugins.push(plugin)
    this.logger.debug(`Plugin registrado: ${plugin.name} v${plugin.version}`)
  }

  /**
   * Devuelve el primer plugin que puede manejar la extensión dada.
   * Retorna null si ningún plugin la soporta (el archivo se indexa igual, sin procesamiento).
   */
  find(extension: string): IPlugin | null {
    return this.plugins.find(p => p.canHandle(extension)) ?? null
  }

  async loadAll(): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.onLoad) {
        await plugin.onLoad()
      }
    }
  }

  async unloadAll(): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.onUnload) {
        await plugin.onUnload()
      }
    }
  }
}
