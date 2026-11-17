/**
 * lib/tablero-gerencia/calidad.ts
 *
 * Gestión de calidad sobre los casos del tablero:
 *  - agruparProblemas: varias alertas de la MISMA causa (mismo tipo, mismo
 *    objetivo y misma persona —o mismo objetivo si la causa es técnica o de
 *    configuración—) forman UN problema. Los casos originales se conservan
 *    dentro del grupo: nada se borra ni se fusiona en la base.
 *  - indicadoresCalidad: detección interna vs. reclamos de clientes, % detectado
 *    antes del reclamo, tiempos, vencidos, verificados, reincidencias y
 *    efectividad de las acciones correctivas.
 *
 * Funciones puras.
 */

import { casoVencido, horasHastaResolucion, type Caso, type TipoCaso } from './casos'

export interface Problema {
  clave: string
  tipo: TipoCaso
  objetivoId: string | null
  empleadoId: string | null
  causa: Caso['causa']
  casos: Caso[]
  desde: string
  hasta: string
  abiertos: number
  /** Resuelto/verificado y después volvió a aparecer (caso posterior a la resolución). */
  reincidio: boolean
}

const CERRADOS = new Set(['resuelto', 'verificado', 'descartado'])

export function agruparProblemas(casos: Caso[]): Problema[] {
  const grupos = new Map<string, Caso[]>()
  for (const c of casos) {
    if (c.estado === 'descartado') continue
    const tecnica = c.causa === 'tecnica_gps' || c.causa === 'configuracion'
    const clave = `${c.tipo}|${c.objetivoId ?? '-'}|${tecnica ? `causa:${c.causa}` : c.empleadoId ?? '-'}`
    const l = grupos.get(clave) ?? []
    l.push(c)
    grupos.set(clave, l)
  }
  return Array.from(grupos.entries()).map(([clave, l]) => {
    const orden = l.slice().sort((a, b) => a.fechaHecho.localeCompare(b.fechaHecho))
    const primeraResolucion = orden.map(resueltoAt).filter((x): x is string => !!x).sort()[0] ?? null
    return {
      clave,
      tipo: orden[0].tipo,
      objetivoId: orden[0].objetivoId,
      empleadoId: orden[0].causa === 'tecnica_gps' || orden[0].causa === 'configuracion' ? null : orden[0].empleadoId,
      causa: orden[0].causa,
      casos: orden,
      desde: orden[0].fechaHecho,
      hasta: orden[orden.length - 1].fechaHecho,
      abiertos: orden.filter(c => !CERRADOS.has(c.estado)).length,
      reincidio: (!!primeraResolucion && orden.some(c => c.detectadoAt > primeraResolucion)) || orden.some(c => c.estado === 'reabierto'),
    }
  }).sort((a, b) => b.casos.length - a.casos.length)
}

function resueltoAt(c: Caso): string | null {
  const ev = c.eventos.find(e => e.accion === 'marcar_resuelto')
  return ev?.at ?? null
}

export interface ReclamoCliente {
  id: string
  clienteId: string | null
  objetivoId: string | null
  fecha: string                 // AAAA-MM-DD
  recibidoAt: string            // ISO
  descripcion: string
  /** Caso del tablero vinculado (si el problema ya estaba detectado o se abrió por el reclamo). */
  casoId: string | null
  estado: 'abierto' | 'en_gestion' | 'respondido' | 'cerrado'
}

export interface IndicadoresCalidad {
  detectadosInternamente: number
  reclamosClientes: number
  reclamosConCasoPrevio: number
  /** % de reclamos cuyo problema ya estaba detectado internamente antes del reclamo. null sin reclamos. */
  pctDetectadoAntesDelReclamo: number | null
  horasPromedioResolucion: number | null
  vencidos: number
  resueltos: number
  verificados: number
  problemas: number
  problemasReincidentes: number
  /** Problemas resueltos que NO reincidieron / problemas resueltos. */
  efectividadCorrectiva: number | null
}

export function indicadoresCalidad(casos: Caso[], reclamos: ReclamoCliente[], ahoraIso: string): IndicadoresCalidad {
  const porId = new Map(casos.map(c => [c.id, c]))
  const conPrevio = reclamos.filter(r => {
    const c = r.casoId ? porId.get(r.casoId) : undefined
    return !!c && c.detectadoAt < r.recibidoAt
  }).length
  const tiempos = casos.map(horasHastaResolucion).filter((h): h is number => h != null)
  const problemas = agruparProblemas(casos)
  const resueltos = problemas.filter(p => p.casos.some(c => c.estado === 'resuelto' || c.estado === 'verificado'))
  return {
    detectadosInternamente: casos.filter(c => c.estado !== 'descartado').length,
    reclamosClientes: reclamos.length,
    reclamosConCasoPrevio: conPrevio,
    pctDetectadoAntesDelReclamo: reclamos.length ? Math.round((conPrevio / reclamos.length) * 1000) / 10 : null,
    horasPromedioResolucion: tiempos.length ? Math.round((tiempos.reduce((a, b) => a + b, 0) / tiempos.length) * 10) / 10 : null,
    vencidos: casos.filter(c => casoVencido(c, ahoraIso)).length,
    resueltos: casos.filter(c => c.estado === 'resuelto' || c.estado === 'verificado').length,
    verificados: casos.filter(c => c.estado === 'verificado').length,
    problemas: problemas.length,
    problemasReincidentes: problemas.filter(p => p.reincidio).length,
    efectividadCorrectiva: resueltos.length ? Math.round((resueltos.filter(p => !p.reincidio).length / resueltos.length) * 1000) / 10 : null,
  }
}

/** Etiquetas de estado en el lenguaje de la orden de Gerencia (sin cambiar la máquina de estados). */
export const ETIQUETA_ESTADO_CALIDAD: Record<Caso['estado'], string> = {
  detectado: 'Detectado',
  en_revision: 'En revisión',
  comunicado: 'Acción asignada',
  respondido: 'Acción asignada (respondió)',
  resuelto: 'Corregido',
  verificado: 'Verificado · cerrado',
  descartado: 'Descartado (falso positivo)',
  reabierto: 'Reabierto (reincidencia)',
}
