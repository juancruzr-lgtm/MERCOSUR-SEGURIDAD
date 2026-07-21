import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { DocumentRecord } from '../core/types'
import { IRepository } from './IRepository'

const TABLE = 'repositorio_documental'

// Mapeo de nombres TypeScript (camelCase) ↔ Supabase (snake_case)

function toRow(doc: DocumentRecord): Record<string, unknown> {
  return {
    documento_uid:               doc.documentoUid,
    version_actual:              doc.versionActual,
    agente_id:                   doc.agenteId,
    origen:                      doc.origen,
    empresa:                     doc.empresa,
    tipo_documento:              doc.tipoDocumento,
    nombre_archivo:              doc.nombreArchivo,
    extension:                   doc.extension,
    mime_type:                   doc.mimeType,
    ruta_relativa:               doc.rutaRelativa,
    tamano_bytes:                doc.tamanoBytes,
    hash_sha256:                 doc.hashSha256,
    fecha_creacion_archivo:      doc.fechaCreacionArchivo?.toISOString() ?? null,
    fecha_modificacion_archivo:  doc.fechaModificacionArchivo.toISOString(),
    detectado_por_primera_vez_at: doc.detectadoPorPrimeraVezAt.toISOString(),
    detectado_por_ultima_vez_at:  doc.detectadoPorUltimaVezAt.toISOString(),
    disponible:                  doc.disponible,
    estado_indexacion:           doc.estadoIndexacion,
    categoria:                   doc.categoria,
    etiquetas:                   doc.etiquetas,
    ultimo_error:                doc.ultimoError,
    actualizado_at:              new Date().toISOString(),
  }
}

function fromRow(row: Record<string, unknown>): DocumentRecord {
  return {
    id:                           row['id'] as string,
    documentoUid:                 row['documento_uid'] as string,
    versionActual:                row['version_actual'] as number,
    agenteId:                     row['agente_id'] as string,
    origen:                       row['origen'] as string,
    empresa:                      row['empresa'] as string,
    tipoDocumento:                row['tipo_documento'] as string | null,
    nombreArchivo:                row['nombre_archivo'] as string,
    extension:                    row['extension'] as string,
    mimeType:                     row['mime_type'] as string,
    rutaRelativa:                 row['ruta_relativa'] as string,
    tamanoBytes:                  row['tamano_bytes'] as number,
    hashSha256:                   row['hash_sha256'] as string,
    fechaCreacionArchivo:         row['fecha_creacion_archivo']
                                    ? new Date(row['fecha_creacion_archivo'] as string)
                                    : null,
    fechaModificacionArchivo:     new Date(row['fecha_modificacion_archivo'] as string),
    detectadoPorPrimeraVezAt:     new Date(row['detectado_por_primera_vez_at'] as string),
    detectadoPorUltimaVezAt:      new Date(row['detectado_por_ultima_vez_at'] as string),
    disponible:                   row['disponible'] as boolean,
    estadoIndexacion:             row['estado_indexacion'] as DocumentRecord['estadoIndexacion'],
    categoria:                    row['categoria'] as string | null,
    etiquetas:                    (row['etiquetas'] as string[]) ?? [],
    ultimoError:                  row['ultimo_error'] as string | null,
    creadoAt:                     row['creado_at'] ? new Date(row['creado_at'] as string) : undefined,
    actualizadoAt:                row['actualizado_at'] ? new Date(row['actualizado_at'] as string) : undefined,
  }
}

export class SupabaseRepository implements IRepository {
  private client: SupabaseClient

  constructor(supabaseUrl: string, serviceRoleKey: string) {
    this.client = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }

  async findByRelativePath(
    agenteId: string,
    rutaRelativa: string,
  ): Promise<DocumentRecord | null> {
    const { data, error } = await this.client
      .from(TABLE)
      .select('*')
      .eq('agente_id', agenteId)
      .eq('ruta_relativa', rutaRelativa)
      .maybeSingle()

    if (error) throw new Error(`findByRelativePath: ${error.message}`)
    if (!data) return null
    return fromRow(data as Record<string, unknown>)
  }

  async upsert(doc: DocumentRecord): Promise<void> {
    const row = toRow(doc)

    const { error } = await this.client
      .from(TABLE)
      .upsert(row, { onConflict: 'agente_id,ruta_relativa' })

    if (error) throw new Error(`upsert: ${error.message}`)
  }

  async markUnavailable(agenteId: string, rutaRelativa: string): Promise<void> {
    const { error } = await this.client
      .from(TABLE)
      .update({
        disponible:    false,
        actualizado_at: new Date().toISOString(),
      })
      .eq('agente_id', agenteId)
      .eq('ruta_relativa', rutaRelativa)

    if (error) throw new Error(`markUnavailable: ${error.message}`)
  }

  async findAllRelativePathsByAgent(agenteId: string): Promise<string[]> {
    // PostgREST limita cada respuesta a 1.000 filas por defecto.
    // Paginamos explícitamente hasta recuperar la página vacía que indica fin de datos.
    // MAX_PAGES es un tope de seguridad: 500 páginas × 1.000 filas = 500.000 registros máx.
    const PAGE_SIZE = 1000
    const MAX_PAGES = 500
    const paths: string[] = []

    for (let page = 0; page < MAX_PAGES; page++) {
      const from = page * PAGE_SIZE
      const to   = from + PAGE_SIZE - 1

      const { data, error } = await this.client
        .from(TABLE)
        .select('ruta_relativa')
        .eq('agente_id', agenteId)
        .eq('disponible', true)
        .range(from, to)

      if (error) throw new Error(`findAllRelativePathsByAgent (página ${page}): ${error.message}`)

      const rows = data ?? []
      for (const r of rows) {
        paths.push((r as Record<string, unknown>)['ruta_relativa'] as string)
      }

      if (rows.length < PAGE_SIZE) break
    }

    return paths
  }

  async healthCheck(): Promise<void> {
    const { error } = await this.client
      .from(TABLE)
      .select('id')
      .limit(1)

    if (error) throw new Error(`Tabla '${TABLE}' no accesible: ${error.message}`)
  }
}
