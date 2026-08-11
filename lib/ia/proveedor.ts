// lib/ia/proveedor.ts
//
// Interfaz mínima del proveedor de visión. Una interfaz, una implementación.
// Cambiar de proveedor = escribir un segundo archivo que la cumpla.
// Sin registro de plugins, sin carga dinámica, sin formato intermedio propio.

export type PedidoVision = {
  /** Imagen a analizar. */
  imagen: { bytes: Buffer, mime: string }
  /** Fotos de referencia (uniforme correcto, ejemplo de libro). Puede ir vacío. */
  referencias?: Array<{ bytes: Buffer, mime: string }>
  prompt: string
  /** JSON Schema que la respuesta debe cumplir. */
  schema: Record<string, unknown>
  modelo: string
  timeoutMs?: number
}

export type RespuestaVision = {
  json: unknown
  modelo: string
  tokensEntrada: number | null
  tokensSalida: number | null
  respuestaId: string | null
}

/** Errores que valen un reintento vs. errores que no. */
export type ClaseError = 'transitorio' | 'permanente'

export class ErrorProveedor extends Error {
  readonly clase: ClaseError
  constructor(mensaje: string, clase: ClaseError) {
    super(mensaje)
    this.name = 'ErrorProveedor'
    this.clase = clase
  }
}

export interface ProveedorVision {
  readonly nombre: string
  analizar(pedido: PedidoVision): Promise<RespuestaVision>
}
