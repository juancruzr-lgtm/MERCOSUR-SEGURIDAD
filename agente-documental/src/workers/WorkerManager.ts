/**
 * WorkerManager — v1: módulo vacío con interfaz preparada.
 *
 * Futuro: procesar documentos en paralelo usando worker_threads de Node.js.
 * Útil para OCR, generación de embeddings y extracción con IA sobre
 * volúmenes grandes de documentos sin bloquear el hilo principal.
 */

export interface IWorkerTask {
  type: string
  payload: unknown
}

export interface IWorkerResult {
  success: boolean
  data?: unknown
  error?: string
}

export class WorkerManager {
  async dispatch(_task: IWorkerTask): Promise<IWorkerResult> {
    // TODO v2: enviar tarea a worker_threads pool
    return { success: true }
  }

  async shutdown(): Promise<void> {
    // TODO v2: graceful shutdown de workers activos
  }
}
