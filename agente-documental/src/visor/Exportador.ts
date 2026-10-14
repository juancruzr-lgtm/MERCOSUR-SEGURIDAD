/**
 * Copia al servidor de las fotos de credenciales aprobadas.
 *
 * La base encola cada cara aprobada (documental_exportaciones) con su destino
 * relativo a la raíz de MEGA: ADMINISTRACION/POLICIA/CREDENCIALES/«APELLIDO NOMBRE - AAAA-MM-DD - Frente.jpg».
 * Este proceso la baja del bucket privado y la escribe en el disco de SRV02.
 *   - Sólo escribe dentro de ADMINISTRACION/POLICIA/CREDENCIALES (nunca en otra carpeta de MEGA).
 *   - Nunca pisa un archivo: si ya existe uno con ese nombre, no lo toca y lo da por hecho.
 *   - No borra nada.
 */

import * as fs from 'fs'
import * as path from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'

export const CARPETA_PERMITIDA = 'ADMINISTRACION/POLICIA/CREDENCIALES/'

/** Ruta absoluta del destino, o null si sale de ADMINISTRACION/POLICIA/CREDENCIALES o de la raíz. */
export function rutaDestino(base: string, destino: string): string | null {
  const rel = destino.replace(/\\/g, '/')
  if (!rel.startsWith(CARPETA_PERMITIDA) || rel.includes('..') || path.isAbsolute(rel)) return null
  const nombre = rel.slice(CARPETA_PERMITIDA.length)
  if (!nombre || nombre.includes('/') || /[<>:"|?*\x00-\x1f]/.test(nombre)) return null
  const raiz = path.resolve(base)
  const abs = path.resolve(raiz, ...rel.split('/'))
  return abs.startsWith(raiz + path.sep) ? abs : null
}

type Log = { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void }
interface Pendiente { id: number; bucket: string; ruta_origen: string; destino: string }

export class Exportador {
  constructor(private supabase: SupabaseClient, private base: string, private agente: string, private log: Log) {}

  /** Atiende lo que haya en la cola (hasta 10 por vuelta). Devuelve cuántas copió. */
  async atender(): Promise<number> {
    const { data, error } = await this.supabase.rpc('documental_exportacion_tomar', { p_lector: this.agente })
    if (error) { this.log.warn(`No se pudo leer la cola de copias: ${error.message}`); return 0 }
    let n = 0
    for (const p of (data as Pendiente[] | null) ?? []) {
      const r = await this.copiar(p)
      await this.supabase.rpc('documental_exportacion_resultado', { p_id: p.id, p_ok: r === null, p_error: r })
      if (r === null) n++
      else this.log.warn(`Copia ${p.id}: ${r}`)
    }
    if (n) this.log.info(`Copiadas al servidor: ${n}`)
    return n
  }

  private async copiar(p: Pendiente): Promise<string | null> {
    const destino = rutaDestino(this.base, p.destino)
    if (!destino) return 'Destino fuera de ADMINISTRACION/POLICIA/CREDENCIALES'
    if (fs.existsSync(destino)) return null
    const { data, error } = await this.supabase.storage.from(p.bucket).download(p.ruta_origen)
    if (error || !data) return `No se pudo bajar el archivo: ${error?.message ?? 'vacío'}`
    try {
      await fs.promises.mkdir(path.dirname(destino), { recursive: true })
      // 'wx': falla si el archivo ya existe; nunca pisa.
      await fs.promises.writeFile(destino, Buffer.from(await data.arrayBuffer()), { flag: 'wx' })
      return null
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      if (err.code === 'EEXIST') return null
      return `No se pudo escribir en el servidor: ${err.message}`
    }
  }
}
