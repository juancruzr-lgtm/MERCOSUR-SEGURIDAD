/** Motivo del alta de un turno creado desde Reportes (ver app/api/turnos/auditoria-alta). */

export const MINUTOS_MAX_AUDITORIA_ALTA = 15
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type DatosAuditoriaAlta =
  | { ok: true; turno_id: string; origen: string; comentario: string }
  | { ok: false; error: string }

export function validarAuditoriaAlta(body: unknown): DatosAuditoriaAlta {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body inválido' }
  const b = body as Record<string, unknown>
  const turnoId = typeof b.turno_id === 'string' ? b.turno_id.trim() : ''
  if (!UUID.test(turnoId)) return { ok: false, error: 'turno_id inválido' }
  const origen = (typeof b.origen === 'string' ? b.origen : '').replace(/[^a-z0-9_ -]/gi, '').trim().slice(0, 40) || 'reportes'
  const comentario = (typeof b.comentario === 'string' ? b.comentario : '').trim().slice(0, 500)
  return {
    ok: true,
    turno_id: turnoId,
    origen,
    comentario: `Creado desde Reportes (${origen}) — ${comentario || 'sin comentario'}`,
  }
}
