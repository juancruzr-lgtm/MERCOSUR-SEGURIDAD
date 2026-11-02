// Excepción autorizada para reconocer horas sin respaldo (migración 20261121120000).
//
// Regla: las horas se reconocen con respaldo (fichaje, fotos o rondas del
// vigilador, o una supervisión cargada en el objetivo durante el turno). Una
// confirmación sin ese respaldo la rechaza la base con CONFIRMACION_SIN_EVIDENCIA
// y sólo pasa con una excepción autorizada por jefatura operativa,
// administración o gerencia, con motivo. La excepción es de un solo uso y la
// base deja el registro (quién, rol, cuándo, motivo) al consumirla.

export const MOTIVO_EXCEPCION_MINIMO = 20

const CODIGO_SIN_EVIDENCIA = 'CONFIRMACION_SIN_EVIDENCIA'

export function mensajeDeError(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error && 'message' in error) return String((error as { message: unknown }).message)
  return typeof error === 'string' ? error : ''
}

/** ¿La base rechazó la confirmación por falta de respaldo? */
export function esConfirmacionSinEvidencia(error: unknown): boolean {
  return mensajeDeError(error).includes(CODIGO_SIN_EVIDENCIA)
}

export function motivoExcepcionValido(motivo: string): boolean {
  return motivo.trim().length >= MOTIVO_EXCEPCION_MINIMO
}

interface ClienteRpc {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown, error: { message: string } | null }>
}

/** Pregunta al servidor si el usuario de la sesión puede autorizar (no se replica la lista en el cliente). */
export async function puedoAutorizarExcepcion(cliente: ClienteRpc): Promise<boolean> {
  const { data, error } = await cliente.rpc('puedo_autorizar_excepcion_asistencia')
  if (error) return false
  return data === true
}

export async function autorizarExcepcionAsistencia(
  cliente: ClienteRpc,
  args: { operacionId: string, turnoId: string, motivo: string },
): Promise<{ excepcionId: string, venceAt: string }> {
  if (!motivoExcepcionValido(args.motivo)) {
    throw new Error(`El motivo debe tener al menos ${MOTIVO_EXCEPCION_MINIMO} caracteres: qué se verificó y por qué no hay respaldo.`)
  }
  const { data, error } = await cliente.rpc('autorizar_excepcion_asistencia', {
    p_operacion_id: args.operacionId,
    p_turno_id: args.turnoId,
    p_motivo: args.motivo.trim(),
  })
  if (error) throw new Error(error.message)
  const r = (data || {}) as { excepcion_id?: string, vence_at?: string }
  if (!r.excepcion_id) throw new Error('El servidor no devolvió la excepción autorizada.')
  return { excepcionId: r.excepcion_id, venceAt: r.vence_at || '' }
}
