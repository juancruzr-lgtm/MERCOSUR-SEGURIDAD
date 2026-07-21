import * as crypto from 'crypto'
import * as fs from 'fs'

/**
 * Calcula el hash SHA-256 de un archivo leyéndolo en streaming.
 * No carga el archivo completo en memoria, soporta archivos grandes.
 */
export function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)

    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', err => reject(err))
  })
}
