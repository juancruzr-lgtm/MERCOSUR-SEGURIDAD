import * as path from 'path'

// Extensiones soportadas en v1. Los demás formatos se ignoran silenciosamente.
const SUPPORTED_EXTENSIONS = new Set([
  '.pdf',
  '.doc', '.docx',
  '.xls', '.xlsx',
  '.csv',
  '.txt',
  '.jpg', '.jpeg', '.png',
])

// Nombres de archivo a ignorar siempre (case-insensitive)
const IGNORED_FILENAMES = new Set([
  'thumbs.db',
  'desktop.ini',
  '.ds_store',
])

// Directorios a ignorar siempre
const ALWAYS_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
])

export const MIME_MAP: Record<string, string> = {
  '.pdf':  'application/pdf',
  '.doc':  'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls':  'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv':  'text/csv',
  '.txt':  'text/plain',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
}

export class FileFilter {
  private ignoredDirectories: Set<string>
  private maxSizeBytes: number

  constructor(ignoredDirectories: string[], maxSizeMb: number) {
    this.ignoredDirectories = new Set([
      ...ALWAYS_IGNORED_DIRS,
      ...ignoredDirectories.map(d => d.toLowerCase()),
    ])
    this.maxSizeBytes = maxSizeMb * 1024 * 1024
  }

  shouldIgnoreDirectory(dirName: string): boolean {
    return this.ignoredDirectories.has(dirName.toLowerCase())
  }

  shouldIgnoreFile(filePath: string, sizeBytes: number): boolean {
    const baseName = path.basename(filePath).toLowerCase()

    // Archivos del sistema y temporales
    if (IGNORED_FILENAMES.has(baseName)) return true
    if (baseName.startsWith('~$')) return true
    if (baseName.startsWith('.')) return true
    if (baseName.endsWith('.tmp')) return true
    if (baseName.endsWith('.temp')) return true

    // Extensión no soportada → ignorar silenciosamente
    const ext = path.extname(baseName)
    if (!SUPPORTED_EXTENSIONS.has(ext)) return true

    // Archivo demasiado grande
    if (sizeBytes > this.maxSizeBytes) return true

    return false
  }

  getExtension(filePath: string): string {
    return path.extname(filePath).toLowerCase()
  }

  getMimeType(extension: string): string {
    return MIME_MAP[extension] ?? 'application/octet-stream'
  }
}
