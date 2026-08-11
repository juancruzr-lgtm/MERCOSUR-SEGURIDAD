// lib/ia/gemini.ts
//
// Implementación de ProveedorVision sobre la Gemini API (generateContent).
//
// Sin SDK: un fetch a la API REST. Evita una dependencia nueva en el bundle y
// deja explícito exactamente qué sale de nuestra infraestructura.
//
// La clave se lee de process.env.GEMINI_API_KEY. Server-side únicamente:
// este módulo sólo se importa desde route handlers con runtime = 'nodejs'.

import { ErrorProveedor, type PedidoVision, type ProveedorVision, type RespuestaVision } from './proveedor'

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const TIMEOUT_DEFECTO_MS = 60_000

/** Modelo por defecto. Se sobreescribe desde ia_configuraciones.modelo. */
export const MODELO_GEMINI_DEFECTO = 'gemini-3.5-flash'

function claseDeStatus(status: number): 'transitorio' | 'permanente' {
  // 429 (cuota del free tier), 500, 503 y timeouts se reintentan.
  // 400 (schema/pedido mal armado), 401/403 (clave) y 404 (modelo) no.
  if (status === 429 || status >= 500) return 'transitorio'
  return 'permanente'
}

export class GeminiVision implements ProveedorVision {
  readonly nombre = 'gemini'
  private readonly apiKey: string

  constructor(apiKey?: string) {
    const clave = apiKey ?? process.env.GEMINI_API_KEY
    if (!clave) {
      throw new ErrorProveedor(
        'Falta GEMINI_API_KEY. Cargala en las variables de entorno del servidor.',
        'permanente',
      )
    }
    this.apiKey = clave
  }

  async analizar(pedido: PedidoVision): Promise<RespuestaVision> {
    const partes: unknown[] = []

    // Las referencias van PRIMERO y rotuladas, para que el modelo entienda que
    // son el patrón y no la evidencia bajo análisis.
    for (const ref of pedido.referencias ?? []) {
      partes.push({ text: 'REFERENCIA (así debería verse lo correcto):' })
      partes.push({ inline_data: { mime_type: ref.mime, data: ref.bytes.toString('base64') } })
    }

    partes.push({ text: 'EVIDENCIA A ANALIZAR:' })
    partes.push({ inline_data: { mime_type: pedido.imagen.mime, data: pedido.imagen.bytes.toString('base64') } })
    partes.push({ text: pedido.prompt })

    const cuerpo = {
      contents: [{ role: 'user', parts: partes }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: pedido.schema,
        temperature: 0,
      },
    }

    const control = new AbortController()
    const timeout = setTimeout(() => control.abort(), pedido.timeoutMs ?? TIMEOUT_DEFECTO_MS)

    let res: Response
    try {
      res = await fetch(`${BASE}/${encodeURIComponent(pedido.modelo)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify(cuerpo),
        signal: control.signal,
      })
    } catch (e: any) {
      throw new ErrorProveedor(
        e?.name === 'AbortError' ? 'Timeout del proveedor' : `Error de red: ${e?.message ?? e}`,
        'transitorio',
      )
    } finally {
      clearTimeout(timeout)
    }

    const texto = await res.text()

    if (!res.ok) {
      // El cuerpo de error de Gemini puede traer la clave si el pedido fue mal
      // armado; se recorta y no se registra completo.
      throw new ErrorProveedor(`HTTP ${res.status}: ${texto.slice(0, 300)}`, claseDeStatus(res.status))
    }

    let sobre: any
    try {
      sobre = JSON.parse(texto)
    } catch {
      throw new ErrorProveedor('El proveedor devolvió algo que no es JSON', 'transitorio')
    }

    const candidato = sobre?.candidates?.[0]

    // Un bloqueo por filtros de seguridad es definitivo para esta imagen:
    // reintentar da lo mismo.
    if (!candidato || candidato.finishReason === 'SAFETY' || candidato.finishReason === 'PROHIBITED_CONTENT') {
      throw new ErrorProveedor(
        `El proveedor no devolvió contenido (finishReason: ${candidato?.finishReason ?? 'sin candidato'})`,
        'permanente',
      )
    }

    const contenido: string = (candidato.content?.parts ?? [])
      .map((p: any) => p?.text ?? '')
      .join('')
      .trim()

    if (!contenido) {
      throw new ErrorProveedor('Respuesta vacía del proveedor', 'transitorio')
    }

    let json: unknown
    try {
      json = JSON.parse(contenido)
    } catch {
      throw new ErrorProveedor('La respuesta no cumple el schema JSON pedido', 'transitorio')
    }

    return {
      json,
      modelo: sobre?.modelVersion ?? pedido.modelo,
      tokensEntrada: sobre?.usageMetadata?.promptTokenCount ?? null,
      tokensSalida: sobre?.usageMetadata?.candidatesTokenCount ?? null,
      respuestaId: sobre?.responseId ?? null,
    }
  }
}
