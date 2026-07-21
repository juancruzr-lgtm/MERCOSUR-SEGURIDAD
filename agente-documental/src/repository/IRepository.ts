import { DocumentRecord, FileInfo } from '../core/types'

export interface SaveDocumentResult {
  fueNuevo:      boolean
  hashCambio:    boolean
  versionActual: number
}

/**
 * Abstracción de persistencia del repositorio documental.
 *
 * En v1 la única implementación es SupabaseRepository.
 * Futuras implementaciones: LocalCacheRepository, HybridRepository, etc.
 * El Indexer depende únicamente de esta interfaz.
 */
export interface IRepository {
  /**
   * Busca un registro por agente y ruta relativa.
   * Retorna null si no existe.
   */
  findByRelativePath(
    agenteId: string,
    rutaRelativa: string,
  ): Promise<DocumentRecord | null>

  /**
   * Crea o actualiza un registro (upsert por agente_id + ruta_relativa).
   */
  upsert(doc: DocumentRecord): Promise<void>

  /**
   * Marca un documento como no disponible (disponible = false).
   * No elimina el registro.
   */
  markUnavailable(agenteId: string, rutaRelativa: string): Promise<void>

  /**
   * Devuelve todas las rutas relativas conocidas para un agente.
   * Usado por el escaneo completo para detectar eliminados.
   */
  findAllRelativePathsByAgent(agenteId: string): Promise<string[]>

  /**
   * Indexa un documento de forma atómica mediante la función SQL repdoc_upsert_atomico.
   * La decisión de versionar (incrementar version_actual) ocurre íntegramente en
   * PostgreSQL comparando el hash recibido contra el valor almacenado en ese instante,
   * nunca contra un valor pre-leído en Node. Seguro entre múltiples procesos concurrentes.
   */
  saveIndexedDocument(
    info: FileInfo,
    documentoUid: string,
    agenteId: string,
    origen: string,
    empresa: string,
  ): Promise<SaveDocumentResult>

  /**
   * Verifica que la tabla existe y es accesible.
   * Usado por test-connection.
   */
  healthCheck(): Promise<void>
}
