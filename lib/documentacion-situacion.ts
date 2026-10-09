/**
 * lib/documentacion-situacion.ts
 *
 * Estado de una celda de la matriz de situación documental (persona × tipo),
 * a partir de situacionDeTipo. Misma regla que el legajo.
 */

import type { SituacionTipo } from '@/lib/documentacion'

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
