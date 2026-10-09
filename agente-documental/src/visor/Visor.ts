/**
 * Lector a pedido del archivo histórico (visor del Legajo Digital).
 *
 * NO es el agente de indexación: no escanea, no observa carpetas y no escribe
 * en repositorio_documental. Sólo atiende pedidos individuales que
 * Administración/Gerencia hizo desde la app:
 *
 *   1. toma un pedido (legajo_historico_vista_tomar),
 *   2. lee ESE archivo de la copia local de MEGA, en modo lectura,
 *   3. verifica que el SHA-256 sea el del índice,
 *   4. lo sube al bucket privado legajo-historico-temporal,
 *   5. marca el pedido listo (vence a los 10 minutos),
 *   6. borra las copias vencidas.
 *
 * Los logs no llevan rutas ni nombres de archivo (pueden tener datos
 * personales): sólo el id del pedido.
 */

import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import type { SupabaseClient } from '@supabase/supabase-js'

export const BUCKET = 'legajo-historico-temporal'
export const MAX_BYTES = 25 * 1024 * 1024
export const MIME: Record<string, string> = {
  '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
}

/** Tipo real por los primeros bytes (no por la extensión). */
export function tipoReal(b: Uint8Array): string | null {
  const es = (firma: number[], desde = 0) => b.length >= desde + firma.length && firma.every((x, i) => b[desde + i] === x)
  if (es([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (es([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (es([0x52, 0x49, 0x46, 0x46]) && es([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  const cab = Buffer.from(b.subarray(0, 1024)).toString('latin1')
  if (cab.includes('%PDF-')) return 'application/pdf'
  return null
}

/** "EMPLEADOS/=C:\\MEGA\\mercosur mega;ADMINISTRACION/=D:\\Admin" → [[prefijo, raíz]] (el más largo primero). */
export function leerRaices(texto: string): [string, string][] {
  return texto.split(';').map(s => s.trim()).filter(Boolean).map(par => {
    const i = par.indexOf('=')
    if (i < 0) throw new Error('VISOR_RAICES: cada entrada es PREFIJO=RUTA')
    return [par.slice(0, i).trim().replace(/\\/g, '/'), par.slice(i + 1).trim()] as [string, string]
  }).sort((a, b) => b[0].length - a[0].length)
}

/**
 * Ruta local de un archivo del índice, sin salir de la raíz configurada.
 * Devuelve null si ningún prefijo corresponde o si la ruta intenta salir.
 */
export function resolverRuta(rutaRelativa: string, raices: [string, string][]): string | null {
  const rel = rutaRelativa.replace(/\\/g, '/')
  if (rel.split('/').some(p => p === '..') || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return null
  for (const [prefijo, raiz] of raices) {
    if (!rel.toLowerCase().startsWith(prefijo.toLowerCase())) continue
    const base = path.resolve(raiz)
    const destino = path.resolve(base, rel.slice(prefijo.length))
    if (destino !== base && destino.startsWith(base + path.sep)) return destino
    return null
  }
  return null
}

export interface Pedido { id: string; ruta_relativa: string; hash_esperado: string; extension: string }

export interface Registro { info(m: string): void; warn(m: string): void; error(m: string): void }

export class Visor {
  constructor(
    private supabase: SupabaseClient,
    private raices: [string, string][],
    private agenteId: string,
    private log: Registro,
  ) {}

  /** Atiende un pedido. Devuelve true si hubo uno. */
  async atenderUno(): Promise<boolean> {
    const { data, error } = await this.supabase.rpc('legajo_historico_vista_tomar', { p_agente: this.agenteId })
    if (error) { this.log.error(`No se pudo leer la cola: ${error.message}`); return false }
    const pedido = ((data as Pedido[] | null) ?? [])[0]
    if (!pedido) return false
    try {
      await this.procesar(pedido)
    } catch (e) {
      await this.fallar(pedido.id, 'No se pudo leer el archivo')
      this.log.error(`Pedido ${pedido.id}: ${e instanceof Error ? e.name : 'error'}`)
    }
    return true
  }

  private async fallar(id: string, mensaje: string) {
    await this.supabase.rpc('legajo_historico_vista_error', { p_id: id, p_error: mensaje })
  }

  private async procesar(p: Pedido) {
    const ext = p.extension.toLowerCase()
    const mime = MIME[ext]
    if (!mime) return this.fallar(p.id, 'Tipo de archivo no permitido')
    const local = resolverRuta(p.ruta_relativa, this.raices)
    if (!local) return this.fallar(p.id, 'La ruta no corresponde a una carpeta configurada en SRV02')
    let st: fs.Stats
    try { st = await fs.promises.stat(local) } catch { return this.fallar(p.id, 'El archivo no está en la copia de MEGA de SRV02') }
    if (!st.isFile()) return this.fallar(p.id, 'No es un archivo')
    if (st.size > MAX_BYTES) return this.fallar(p.id, 'El archivo supera los 25 MB')

    // Sólo lectura: el original no se abre para escribir.
    const contenido = await fs.promises.readFile(local, { flag: 'r' })
    const hash = crypto.createHash('sha256').update(contenido).digest('hex')
    if (hash !== p.hash_esperado) {
      // No se sube nada: la base registra el hash leído y deja el pedido en error.
      await this.supabase.rpc('legajo_historico_vista_lista', { p_id: p.id, p_objeto: null, p_mime: mime, p_bytes: contenido.length, p_hash: hash })
      this.log.warn(`Pedido ${p.id}: el hash no coincide con el índice`)
      return
    }
    if (tipoReal(contenido) !== mime) return this.fallar(p.id, 'El contenido no corresponde a su extensión')
    const objeto = `${p.id}${ext}`
    const { error: eSubir } = await this.supabase.storage.from(BUCKET).upload(objeto, contenido, { contentType: mime, upsert: false })
    if (eSubir) return this.fallar(p.id, 'No se pudo subir la copia temporal')
    const { data: ok, error: eLista } = await this.supabase.rpc('legajo_historico_vista_lista', {
      p_id: p.id, p_objeto: objeto, p_mime: mime, p_bytes: contenido.length, p_hash: hash,
    })
    if (eLista || ok !== true) {
      await this.supabase.storage.from(BUCKET).remove([objeto])
      return this.fallar(p.id, 'No se pudo completar el pedido')
    }
    this.log.info(`Pedido ${p.id}: listo (${Math.round(contenido.length / 1024)} KB, hash verificado)`)
  }

  /** Borra las copias vencidas o con error. Devuelve cuántas borró. */
  async limpiar(): Promise<number> {
    const { data, error } = await this.supabase.rpc('legajo_historico_vistas_a_borrar')
    if (error) { this.log.error(`No se pudo leer las copias a borrar: ${error.message}`); return 0 }
    let n = 0
    for (const v of (data as { id: string; objeto: string }[] | null) ?? []) {
      const { error: eBorrar } = await this.supabase.storage.from(BUCKET).remove([v.objeto])
      if (eBorrar) { this.log.warn(`Copia ${v.id}: no se pudo borrar`); continue }
      await this.supabase.rpc('legajo_historico_vista_borrada', { p_id: v.id })
      n++
    }
    if (n) this.log.info(`${n} copia(s) temporal(es) borrada(s)`)
    return n
  }
}
