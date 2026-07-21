import * as fs from 'fs'
import * as path from 'path'
import { FileInfo } from '../core/types'
import { FileFilter } from './FileFilter'
import { hashFile } from './Hasher'
import { Logger } from '../logger/Logger'

export class Scanner {
  constructor(
    private readonly filter: FileFilter,
    private readonly logger: Logger,
  ) {}

  /**
   * Recorre recursivamente la carpeta raíz y devuelve FileInfo
   * de todos los archivos que pasan el filtro.
   */
  async scanDirectory(rootPath: string): Promise<FileInfo[]> {
    const results: FileInfo[] = []
    await this.walk(rootPath, rootPath, results)
    return results
  }

  /**
   * Procesa un único archivo (para uso desde el watcher).
   * Retorna null si el archivo debe ignorarse.
   */
  async scanFile(filePath: string, rootPath: string): Promise<FileInfo | null> {
    let stats: fs.Stats
    try {
      stats = await fs.promises.stat(filePath)
    } catch {
      return null
    }

    if (!stats.isFile()) return null
    if (this.filter.shouldIgnoreFile(filePath, stats.size)) return null

    return this.buildFileInfo(filePath, rootPath, stats)
  }

  private async walk(
    currentPath: string,
    rootPath: string,
    results: FileInfo[],
  ): Promise<void> {
    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(currentPath, { withFileTypes: true })
    } catch (err) {
      this.logger.warn(`No se puede leer directorio: ${currentPath} — ${String(err)}`)
      return
    }

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name)

      if (entry.isDirectory()) {
        if (this.filter.shouldIgnoreDirectory(entry.name)) continue
        await this.walk(fullPath, rootPath, results)
        continue
      }

      if (!entry.isFile()) continue

      let stats: fs.Stats
      try {
        stats = await fs.promises.stat(fullPath)
      } catch (err) {
        this.logger.warn(`No se puede leer archivo: ${fullPath} — ${String(err)}`)
        continue
      }

      if (this.filter.shouldIgnoreFile(fullPath, stats.size)) continue

      try {
        const info = await this.buildFileInfo(fullPath, rootPath, stats)
        results.push(info)
      } catch (err) {
        this.logger.archivoError(
          path.relative(rootPath, fullPath),
          String(err),
        )
      }
    }
  }

  private async buildFileInfo(
    filePath: string,
    rootPath: string,
    stats: fs.Stats,
  ): Promise<FileInfo> {
    const extension = this.filter.getExtension(filePath)
    const hash = await hashFile(filePath)

    return {
      nombreArchivo: path.basename(filePath),
      extension,
      mimeType: this.filter.getMimeType(extension),
      rutaAbsoluta: filePath,
      rutaRelativa: path.relative(rootPath, filePath).replace(/\\/g, '/'),
      tamanoBytes: stats.size,
      fechaCreacion: stats.birthtime ?? null,
      fechaModificacion: stats.mtime,
      hashSha256: hash,
    }
  }
}
