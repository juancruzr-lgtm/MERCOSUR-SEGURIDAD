/**
 * lib/documentacion-situacion.ts
 *
 * Estado de una celda de la matriz de situación documental (persona × tipo),
 * a partir de situacionDeTipo. Misma regla que el legajo.
 */

import type { PersonaControl, SituacionTipo, TipoDocumento } from '@/lib/documentacion'

export type Celda = { corto: string; color: string; fondo: string; titulo: string }

/** Estado de una celda, en el orden en que importa para Administración. */
export function celdaDe(s: SituacionTipo): Celda {
  const p = s.pendiente?.estado
  if (s.base === 'no_corresponde') return { corto: 'N/C', color: '#94a3b8', fondo: 'transparent', titulo: 'No corresponde' }
  if (p === 'pendiente_revision') return { corto: 'Rev', color: '#fbbf24', fondo: 'rgba(245,158,11,.12)', titulo: 'Presentado, en revisión' }
  if (p === 'rechazado') return { corto: 'Rech', color: '#fca5a5', fondo: 'rgba(239,68,68,.12)', titulo: 'Rechazado' }
  if (p === 'pendiente_aceptacion') return { corto: 'Conf', color: '#93c5fd', fondo: 'rgba(59,130,246,.12)', titulo: 'Espera la constancia de la persona' }
  if (p === 'observado') return { corto: 'Obs', color: '#fca5a5', fondo: 'rgba(239,68,68,.12)', titulo: 'La persona avisó un error' }
  if (s.base === 'vencido') return { corto: 'Venc', color: '#fca5a5', fondo: 'rgba(239,68,68,.16)', titulo: 'Vencido' }
  if (s.base === 'por_vencer') return { corto: 'xVen', color: '#fbbf24', fondo: 'rgba(245,158,11,.12)', titulo: 'Por vencer' }
  if (s.base === 'validado') return { corto: 'OK', color: '#86efac', fondo: 'rgba(34,197,94,.12)', titulo: 'Validado' }
  if (s.marca?.situacion === 'solicitado') return { corto: 'Sol', color: '#93c5fd', fondo: 'transparent', titulo: 'Solicitado, sin presentar' }
  if (s.base === 'falta') return { corto: 'Falta', color: '#fca5a5', fondo: 'transparent', titulo: 'Pendiente de presentar' }
  return { corto: '·', color: '#475569', fondo: 'transparent', titulo: 'No cargado (opcional / si corresponde)' }
}

// ── Tablero y filtros de la matriz ──────────────────────────────────────────

export type CeldaMatriz = { t: TipoDocumento; s: SituacionTipo }
export type FilaMatriz = { p: PersonaControl; celdas: CeldaMatriz[]; validadas: number; obligatorias: number }

/** Estados por los que se puede filtrar (códigos de celdaDe). */
export const ESTADOS_MATRIZ: [string, string][] = [
  ['OK', 'Presentado y aprobado'], ['Rev', 'Presentado, pendiente de revisión'], ['Rech', 'Rechazado'],
  ['Venc', 'Vencido'], ['xVen', 'Próximo a vencer'], ['Falta', 'Faltante'], ['Sol', 'Solicitado'],
  ['Conf', 'Espera constancia'], ['Obs', 'Error avisado por la persona'], ['N/C', 'No corresponde'],
]

/** Un legajo está completo si todo lo obligatorio que le corresponde está validado. */
export const legajoCompleto = (f: FilaMatriz) => f.obligatorias > 0 && f.validadas === f.obligatorias

export function indicadoresMatriz(filas: FilaMatriz[]) {
  const tot = filas.reduce((a, f) => a + f.obligatorias, 0)
  const ok = filas.reduce((a, f) => a + f.validadas, 0)
  const cuenta = (codigos: string[]) => filas.reduce((a, f) => a + f.celdas.filter(c => codigos.includes(celdaDe(c.s).corto)).length, 0)
  const completos = filas.filter(legajoCompleto).length
  return {
    empleados: filas.length,
    completos,
    incompletos: filas.length - completos,
    avance: tot ? Math.round((ok / tot) * 100) : 0,
    enRevision: cuenta(['Rev']),
    rechazados: cuenta(['Rech']),
    vencidos: cuenta(['Venc']),
    porVencer: cuenta(['xVen']),
    pendientesPresentacion: cuenta(['Falta', 'Sol']),
  }
}

export type FiltroMatriz = { texto?: string; estado?: string; tipo?: string; soloIncompletos?: boolean }

const normal = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/**
 * Filtra filas: por persona (apellido, nombre o legajo), por categoría
 * (deja sólo esa columna) y por estado (personas con al menos una celda en ese
 * estado, dentro de la categoría elegida si hay).
 */
export function filtrarMatriz(filas: FilaMatriz[], f: FiltroMatriz): FilaMatriz[] {
  const texto = normal((f.texto ?? '').trim())
  return filas
    .map(fila => (f.tipo ? { ...fila, celdas: fila.celdas.filter(c => c.t.codigo === f.tipo) } : fila))
    .filter(fila => !texto || normal(`${fila.p.apellido} ${fila.p.nombre} ${fila.p.legajo ?? ''}`).includes(texto))
    .filter(fila => !f.estado || fila.celdas.some(c => celdaDe(c.s).corto === f.estado))
    .filter(fila => !f.soloIncompletos || !legajoCompleto(fila))
}
