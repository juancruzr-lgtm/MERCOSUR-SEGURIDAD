/**
 * SyncManager — v1: módulo vacío con interfaz preparada.
 *
 * Futuro: orquestar sincronización de documentos desde fuentes externas:
 *   - SharePoint
 *   - Google Drive
 *   - Mega
 *   - Correo electrónico (IMAP)
 *   - OneDrive
 *
 * Cada fuente implementará ISyncAdapter y se registrará aquí.
 */

export interface ISyncAdapter {
  readonly name: string
  connect(): Promise<void>
  disconnect(): Promise<void>
  listChanges(since?: Date): Promise<RemoteChange[]>
  download(remoteId: string, localPath: string): Promise<void>
}

export interface RemoteChange {
  remoteId: string
  name: string
  action: 'created' | 'modified' | 'deleted'
  modifiedAt: Date
}

export class SyncManager {
  private adapters: ISyncAdapter[] = []

  register(_adapter: ISyncAdapter): void {
    // TODO v2: registrar adaptadores de fuentes externas
  }

  async syncAll(): Promise<void> {
    // TODO v2: iterar adapters, listar cambios, descargar, disparar indexación
  }
}
