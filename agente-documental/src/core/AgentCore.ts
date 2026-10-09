import * as fs from 'fs'
import * as path from 'path'
import chokidar from 'chokidar'
import { AgentConfig, ScanSummary } from './types'
import { Logger } from '../logger/Logger'
import { FileFilter } from '../scanner/FileFilter'
import { Scanner } from '../scanner/Scanner'
import { SupabaseRepository } from '../repository/SupabaseRepository'
import { Indexer } from '../indexer/Indexer'
import { planReconciliacion } from '../indexer/Reconciliacion'
import { PluginRegistry } from '../plugins/PluginRegistry'
import { PdfPlugin } from '../plugins/pdf/PdfPlugin'
import { WordPlugin } from '../plugins/word/WordPlugin'
import { ExcelPlugin } from '../plugins/excel/ExcelPlugin'
import { ImagesPlugin } from '../plugins/images/ImagesPlugin'
import { TxtPlugin } from '../plugins/txt/TxtPlugin'

const ESPERA_ANTES_DE_MARCAR_MS = 15_000

export interface ResumenSimulacion {
  totalArchivos: number
  nuevos: number
  cambiados: number
  sinCambios: number
  reaparecidos: number
  marcariaNoDisponibles: number
  protegidas: number
  excluidasEnIndice: number
  ilegibles: number
  reconciliacionAbortada: string | null
}

export class AgentCore {
  private readonly logger: Logger
  private readonly filter: FileFilter
  private readonly scanner: Scanner
  private readonly repo: SupabaseRepository
  private readonly indexer: Indexer
  private readonly plugins: PluginRegistry

  constructor(private readonly config: AgentConfig) {
    this.logger  = new Logger(config.logLevel)
    this.filter  = new FileFilter(config.ignoredDirectories, config.maxSizeMb)
    this.scanner = new Scanner(this.filter, this.logger)
    this.repo    = new SupabaseRepository(config.supabaseUrl, config.supabaseServiceRoleKey)
    this.indexer = new Indexer(this.repo, config, this.logger)
    this.plugins = new PluginRegistry(this.logger)

    // Registrar plugins v1
    this.plugins.register(new PdfPlugin())
    this.plugins.register(new WordPlugin())
    this.plugins.register(new ExcelPlugin())
    this.plugins.register(new ImagesPlugin())
    this.plugins.register(new TxtPlugin())
  }

  async testConnection(): Promise<void> {
    this.logger.info('Verificando conexión...')

    // 1. Supabase
    await this.repo.healthCheck()
    this.logger.info('  ✓ Supabase accesible')

    // 2. Tabla
    this.logger.info(`  ✓ Tabla repositorio_documental accesible`)

    // 3. Carpeta
    const rootPath = this.config.documentRootPath
    if (!fs.existsSync(rootPath)) {
      throw new Error(`DOCUMENT_ROOT_PATH no existe: ${rootPath}`)
    }
    const stat = fs.statSync(rootPath)
    if (!stat.isDirectory()) {
      throw new Error(`DOCUMENT_ROOT_PATH no es un directorio: ${rootPath}`)
    }
    this.logger.info(`  ✓ Carpeta accesible: ${rootPath}`)

    // 4. Configuración
    this.logger.info(`  ✓ Agente ID: ${this.config.agenteId}`)
    this.logger.info(`  ✓ Origen: ${this.config.origen}`)
    this.logger.info(`  ✓ Empresa: ${this.config.empresa}`)
    this.logger.info('Conexión verificada correctamente.')
  }

  async scan(): Promise<ScanSummary> {
    const rootPath = this.config.documentRootPath
    const iniciadoAt = new Date()

    this.logger.info(`Iniciando escaneo: ${rootPath}`)
    this.logger.info(`Agente: ${this.config.agenteId}`)

    await this.plugins.loadAll()

    const archivos = await this.scanner.scanDirectory(rootPath)
    this.logger.info(`Archivos detectados: ${archivos.length}`)

    const summary: ScanSummary = {
      agenteId:                this.config.agenteId,
      raiz:                    rootPath,
      iniciadoAt,
      finalizadoAt:            iniciadoAt,
      totalArchivos:           archivos.length,
      nuevos:                  0,
      actualizados:            0,
      sinCambios:              0,
      marcadosNoDisponibles:   0,
      errores:                 0,
    }

    const foundPaths = new Set<string>()

    for (const info of archivos) {
      foundPaths.add(info.rutaRelativa)
      const resultado = await this.indexer.processFile(info)
      summary[resultado === 'sin_cambios' ? 'sinCambios' :
              resultado === 'nuevo'        ? 'nuevos'     :
              resultado === 'actualizado'  ? 'actualizados' : 'errores']++
    }

    // Lo que no se pudo leer también cuenta como "visto": no se marca eliminado.
    await this.indexer.reconcileDeleted(foundPaths, summary, {
      dirsIlegibles: this.scanner.dirsIlegibles,
      archivosIlegibles: this.scanner.archivosIlegibles,
      excluida: ruta => this.filter.isInIgnoredPath(ruta),
    })

    summary.finalizadoAt = new Date()
    const duracionSeg = ((summary.finalizadoAt.getTime() - iniciadoAt.getTime()) / 1000).toFixed(1)

    this.logger.info('─────────────────────────────────────')
    this.logger.info(`Escaneo completado en ${duracionSeg}s`)
    this.logger.info(`  Nuevos:              ${summary.nuevos}`)
    this.logger.info(`  Actualizados:        ${summary.actualizados}`)
    this.logger.info(`  Sin cambios:         ${summary.sinCambios}`)
    this.logger.info(`  No disponibles:      ${summary.marcadosNoDisponibles}`)
    this.logger.info(`  Errores:             ${summary.errores}`)
    this.logger.info('─────────────────────────────────────')

    await this.plugins.unloadAll()
    return summary
  }

  /**
   * Simulación: escanea la carpeta y la compara contra el índice, SIN
   * escribir nada en la base (ni altas, ni cambios, ni eliminados). Sirve
   * para ver qué haría un `scan` antes de autorizarlo.
   */
  async simular(): Promise<ResumenSimulacion> {
    const rootPath = this.config.documentRootPath
    this.logger.info(`SIMULACIÓN (no escribe nada): ${rootPath}`)
    const archivos = await this.scanner.scanDirectory(rootPath)
    const indice = await this.repo.findIndexByAgent(this.config.agenteId)

    const r: ResumenSimulacion = {
      totalArchivos: archivos.length, nuevos: 0, cambiados: 0, sinCambios: 0, reaparecidos: 0,
      marcariaNoDisponibles: 0, protegidas: 0, excluidasEnIndice: 0,
      ilegibles: this.scanner.archivosIlegibles.size + this.scanner.dirsIlegibles.length,
      reconciliacionAbortada: null,
    }
    const encontradas = new Set<string>()
    for (const a of archivos) {
      encontradas.add(a.rutaRelativa)
      const previo = indice.get(a.rutaRelativa)
      if (!previo) r.nuevos++
      else if (previo.hash !== a.hashSha256) r.cambiados++
      else if (!previo.disponible) r.reaparecidos++
      else r.sinCambios++
    }
    const disponibles = Array.from(indice.entries()).filter(([, v]) => v.disponible).map(([k]) => k)
    const plan = planReconciliacion(disponibles, encontradas, {
      dirsIlegibles: this.scanner.dirsIlegibles,
      archivosIlegibles: this.scanner.archivosIlegibles,
      excluida: ruta => this.filter.isInIgnoredPath(ruta),
      umbralFaltantes: this.config.umbralFaltantes,
    })
    r.marcariaNoDisponibles = plan.marcar.length
    r.protegidas = plan.protegidas
    r.excluidasEnIndice = plan.excluidas
    r.reconciliacionAbortada = plan.abortada

    this.logger.info('─────────────── SIMULACIÓN ───────────────')
    this.logger.info(`  Archivos en disco:           ${r.totalArchivos}`)
    this.logger.info(`  Nuevos (se darían de alta):  ${r.nuevos}`)
    this.logger.info(`  Con contenido distinto:      ${r.cambiados}`)
    this.logger.info(`  Reaparecidos:                ${r.reaparecidos}`)
    this.logger.info(`  Sin cambios:                 ${r.sinCambios}`)
    this.logger.info(`  Se marcarían no disponibles: ${r.marcariaNoDisponibles}`)
    this.logger.info(`  Protegidos (no legibles):    ${r.protegidas}`)
    this.logger.info(`  En papelera (no se tocan):   ${r.excluidasEnIndice}`)
    if (r.reconciliacionAbortada) this.logger.warn(`  ${r.reconciliacionAbortada}`)
    this.logger.info('No se escribió nada en la base.')
    return r
  }

  async watch(): Promise<void> {
    // Escaneo inicial completo
    await this.scan()

    const rootPath = this.config.documentRootPath
    this.logger.info(`Observando cambios en: ${rootPath}`)
    this.logger.info('Presioná Ctrl+C para detener.')

    const watcher = chokidar.watch(rootPath, {
      ignored: (filePath: string) => {
        const parts = filePath.split(path.sep)
        return parts.some(p => this.filter.shouldIgnoreDirectory(p))
      },
      persistent:    true,
      ignoreInitial: true,    // ya escaneamos todo al inicio
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval:       200,
      },
    })

    const handleAddOrChange = async (filePath: string) => {
      const info = await this.scanner.scanFile(filePath, rootPath)
      if (!info) return
      await this.indexer.processFile(info)
    }

    // Un "unlink" de MEGA puede ser un reemplazo en curso (borra y vuelve a
    // escribir) o la unidad que se desmonta. Se espera y se vuelve a mirar:
    // sólo se marca si la raíz sigue accesible y el archivo sigue sin estar.
    const handleUnlink = async (filePath: string) => {
      const rutaRelativa = path.relative(rootPath, filePath).replace(/\\/g, '/')
      if (this.filter.isInIgnoredPath(rutaRelativa)) return
      await new Promise(r => setTimeout(r, ESPERA_ANTES_DE_MARCAR_MS))
      if (!fs.existsSync(rootPath)) {
        this.logger.warn(`La carpeta raíz no está accesible: no se marca ${rutaRelativa}`)
        return
      }
      if (fs.existsSync(filePath)) return
      await this.repo.markUnavailable(this.config.agenteId, rutaRelativa)
      this.logger.eliminado(rutaRelativa)
    }

    watcher.on('add',    handleAddOrChange)
    watcher.on('change', handleAddOrChange)
    watcher.on('unlink', handleUnlink)

    watcher.on('error', (err) => {
      this.logger.error(`Error en watcher: ${String(err)}`)
    })

    // Mantener el proceso vivo hasta Ctrl+C
    await new Promise<void>((_, reject) => {
      process.on('SIGINT', () => {
        this.logger.info('Deteniendo agente...')
        watcher.close().then(() => process.exit(0)).catch(reject)
      })
    })
  }
}
