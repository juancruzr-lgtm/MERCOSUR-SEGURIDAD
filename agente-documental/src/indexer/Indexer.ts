import * as crypto from 'crypto'
import { AgentConfig, DocumentRecord, FileInfo, ScanSummary } from '../core/types'
import { IRepository } from '../repository/IRepository'
import { Logger } from '../logger/Logger'
import { OpcionesReconciliacion, PlanReconciliacion, planReconciliacion } from './Reconciliacion'

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
      const result = await this.repo.saveIndexedDocument(
        info,
        crypto.randomUUID(),
        this.config.agenteId,
        this.config.origen,
        this.config.empresa,
      )

      if (result.fueNuevo) {
        this.logger.nuevo(info.rutaRelativa)
        return 'nuevo'
      }
      if (result.hashCambio) {
        this.logger.actualizado(info.rutaRelativa)
        return 'actualizado'
      }
      this.logger.sinCambios(info.rutaRelativa)
      return 'sin_cambios'

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
   * Compara los archivos encontrados en disco contra los conocidos en la base
   * y marca como no disponibles los que desaparecieron, con las protecciones
   * de planReconciliacion (carpetas ilegibles, papelera, umbral).
   */
  async reconcileDeleted(
    foundPaths: Set<string>,
    summary: Pick<ScanSummary, 'marcadosNoDisponibles'>,
    opciones: Omit<OpcionesReconciliacion, 'umbralFaltantes' | 'forzar'>,
  ): Promise<PlanReconciliacion> {
    const knownPaths = await this.repo.findAllRelativePathsByAgent(this.config.agenteId)
    this.logger.debug(`reconcileDeleted: ${knownPaths.length} rutas conocidas recuperadas de la base`)

    const plan = planReconciliacion(knownPaths, foundPaths, {
      ...opciones,
      umbralFaltantes: this.config.umbralFaltantes,
      forzar: this.config.forzarReconciliacion,
    })
    if (plan.abortada) {
      this.logger.warn(`Reconciliación NO aplicada: ${plan.abortada}`)
      return plan
    }
    if (plan.protegidas) this.logger.warn(`${plan.protegidas} archivo(s) no se marcaron eliminados porque su carpeta o el archivo no se pudieron leer`)
    if (plan.excluidas) this.logger.info(`${plan.excluidas} ruta(s) en carpetas excluidas (papelera) quedan como estaban`)

    for (const knownPath of plan.marcar) {
      await this.repo.markUnavailable(this.config.agenteId, knownPath)
      this.logger.eliminado(knownPath)
      summary.marcadosNoDisponibles++
    }
    return plan
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
