/**
 * Alta de la fila de evidencia DESPUÉS de subir la foto a Storage.
 *
 * Producción (nov-2026) mostró "La foto se subió pero no pudo registrarse:
 * TypeError: fetch failed": el objeto quedó en Storage y la fila no, por una
 * falla transitoria entre el servidor y la base. La fila es idempotente
 * (upsert por proceso_tipo+proceso_id+tipo_evidencia, path determinístico),
 * así que se reintenta con backoff corto antes de rendirse.
 */

export const ESPERAS_REINTENTO_REGISTRO_MS = [300, 900] as const

/** ¿El error parece transitorio (red/servidor) y no un rechazo de la base? */
export function errorTransitorioRegistro(mensaje: string | null | undefined): boolean {
  return /fetch failed|Failed to fetch|network|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket|timeout|timed out|aborted|\b50[234]\b|connection/i
    .test(mensaje ?? '')
}

const dormirReal = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/**
 * Ejecuta `registrar` y, si falla con un error transitorio, lo repite tras cada
 * espera de `esperas`. Devuelve el último resultado (nunca lanza si
 * `registrar` no lanza).
 */
export async function registrarConReintentos<T extends { error: { message: string } | null }>(
  registrar: () => PromiseLike<T>,
  esperas: readonly number[] = ESPERAS_REINTENTO_REGISTRO_MS,
  dormir: (ms: number) => Promise<void> = dormirReal,
): Promise<{ resultado: T; intentos: number }> {
  let resultado = await registrar()
  let intentos = 1
  for (const espera of esperas) {
    if (!resultado.error || !errorTransitorioRegistro(resultado.error.message)) break
    await dormir(espera)
    resultado = await registrar()
    intentos++
  }
  return { resultado, intentos }
}
