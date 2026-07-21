import * as crypto from 'crypto'
import { AgentConfig, DocumentRecord, FileInfo, ScanSummary } from '../core/types'
import { IRepository } from '../repository/IRepository'
import { Logger } from '../logger/Logger'

export class Indexer {
  constructor(
    private readonly repo: IRepository,
    private readonly config: AgentConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * Procesa un archivo detectado por el Scanner.
   * Decide si es nuevo, modificado o sin cambios y actúa en consecuencia.
   */
  async processFile(info: FileInfo): Promise<'nuevo' | 'actualizado' | 'sin_cambios' | 'error'> {
    try {
      const existing = await this.repo.findByRelativePath(
        this.config.agenteId,
        info.rutaRelativa,
      )

      if (!existing) {
        await this.repo.upsert(this.buildNewRecord(info))
        this.logger.nuevo(info.rutaRelativa)
        return 'nuevo'
      }

      // Si estaba marcado como no disponible y reapareció → restaurar
      const hashCambio = existing.hashSha256 !== info.hashSha256
      const reapareció = !existing.disponible

      if (!hashCambio && !reapareció) {
        // Actualizar solo la fecha de última detección
        await this.repo.upsert({
          ...existing,
          detectadoPorUltimaVezAt: new Date(),
        })
        this.logger.sinCambios(info.rutaRelativa)
        return 'sin_cambios'
      }

      const updated: DocumentRecord = {
        ...existing,
        hashSha256:              info.hashSha256,
        tamanoBytes:             info.tamanoBytes,
        fechaCreacionArchivo:    info.fechaCreacion,
        fechaModificacionArchivo: info.fechaModificacion,
        detectadoPorUltimaVezAt: new Date(),
        disponible:              true,
        estadoIndexacion:        'indexado',
        ultimoError:             null,
        versionActual:           hashCambio ? existing.versionActual + 1 : existing.versionActual,
      }

      await this.repo.upsert(updated)
      this.logger.actualizado(info.rutaRelativa)
      return 'actualizado'

    } catch (err) {
      const msg = String(err)
      this.logger.archivoError(info.rutaRelativa, msg)

      // Intentar registrar el error en el repositorio sin relanzar
      try {
        const existing = await this.repo.findByRelativePath(
          this.config.agenteId,
          info.rutaRelativa,
        )
        if (existing) {
          await this.repo.upsert({
            ...existing,
            estadoIndexacion: 'error',
            ultimoError: msg.slice(0, 500),
          })
        }
      } catch {
        // silencioso — no podemos hacer más
      }

      return 'error'
    }
  }

  /**
   * Compara los archivos encontrados en disco contra los conocidos en la base.
   * Marca como no disponibles los que desaparecieron.
   */
  async reconcileDeleted(
    foundPaths: Set<string>,
    summary: Pick<ScanSummary, 'marcadosNoDisponibles'>,
  ): Promise<void> {
    const knownPaths = await this.repo.findAllRelativePathsByAgent(this.config.agenteId)
    this.logger.debug(`reconcileDeleted: ${knownPaths.length} rutas conocidas recuperadas de la base`)

    for (const knownPath of knownPaths) {
      if (!foundPaths.has(knownPath)) {
        await this.repo.markUnavailable(this.config.agenteId, knownPath)
        this.logger.eliminado(knownPath)
        summary.marcadosNoDisponibles++
      }
    }
  }

  private buildNewRecord(info: FileInfo): DocumentRecord {
    const now = new Date()
    return {
      documentoUid:              crypto.randomUUID(),
      versionActual:             1,
      agenteId:                  this.config.agenteId,
      origen:                    this.config.origen,
      empresa:                   this.config.empresa,
      tipoDocumento:             null,
      nombreArchivo:             info.nombreArchivo,
      extension:                 info.extension,
      mimeType:                  info.mimeType,
      rutaRelativa:              info.rutaRelativa,
      tamanoBytes:               info.tamanoBytes,
      hashSha256:                info.hashSha256,
      fechaCreacionArchivo:      info.fechaCreacion,
      fechaModificacionArchivo:  info.fechaModificacion,
      detectadoPorPrimeraVezAt:  now,
      detectadoPorUltimaVezAt:   now,
      disponible:                true,
      estadoIndexacion:          'indexado',
      categoria:                 null,
      etiquetas:                 [],
      ultimoError:               null,
    }
  }
}
