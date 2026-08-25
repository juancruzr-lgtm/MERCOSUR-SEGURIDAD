// Cierre Operativo Diario del supervisor.
//
// Es un AGREGADOR, no un modulo. No recalcula nada: recibe items ya detectados
// por las fuentes que existen —la bandeja de planillas, las alertas de ronda,
// el detector de alertas operativas y la bandeja de fotos IA— y responde una
// sola pregunta: que le queda a ESTE supervisor antes de cerrar su guardia.
//
// La meta operativa es "pendientes de hoy = 0". Cero no significa que todo
// haya salido bien: significa que el supervisor tomo la decision que le
// correspondia. Por eso una derivacion correcta a Administracion SALE de su
// cuenta aunque siga abierta para Administracion.

import { resolverResponsablesOperativos } from '@/lib/responsables-operativos'
import type {
  AsignacionZona, GuardiaOperativa, UsuarioBasico,
} from '@/lib/responsables-operativos'

export const CATEGORIAS_CIERRE = ['planillas', 'rondas', 'operacion', 'fotos_ia'] as const
export type CategoriaCierre = typeof CATEGORIAS_CIERRE[number]

export const ETIQUETA_CATEGORIA_CIERRE: Record<CategoriaCierre, string> = {
  planillas: 'Planillas',
  rondas:    'Rondas',
  operacion: 'Operación',
  fotos_ia:  'Fotos IA',
}

export interface ItemCierre {
  /** Identidad estable del item dentro de su categoria. */
  id: string
  categoria: CategoriaCierre
  /**
   * Fecha operativa del HECHO (YYYY-MM-DD), no la del reloj. Es la que decide
   * si el item es de hoy o arrastre, y la que se usa para atribuir responsable.
   * En un turno que cruza medianoche sigue siendo la fecha del turno.
   */
  fecha: string
  /** HH:MM del hecho. Junto con `fecha` ubica el instante para el resolver. */
  hora: string
  objetivoId: string | null
  zonaId: string | null
  zonaNombre?: string | null
  /** Texto corto para la lista. */
  etiqueta: string
  /**
   * El supervisor ya decidio. Incluye la derivacion correcta a Administracion:
   * ese item sigue pendiente para Administracion, pero no para el.
   */
  resueltoPorSupervisor: boolean
}

export interface ResumenCierre {
  total: number
  porCategoria: Record<CategoriaCierre, number>
  items: ItemCierre[]
}

export interface CierreOperativo {
  fechaOperativa: string
  hoy: ResumenCierre
  anteriores: ResumenCierre
}

function resumenVacio(): ResumenCierre {
  const porCategoria = Object.fromEntries(
    CATEGORIAS_CIERRE.map(c => [c, 0]),
  ) as Record<CategoriaCierre, number>
  return { total: 0, porCategoria, items: [] }
}

/**
 * Un item cuenta como pendiente del supervisor mientras no haya tomado su
 * decision. Resuelto, confirmado, justificado, revisado o correctamente
 * derivado: todos salen, y todos llegan aca como `resueltoPorSupervisor`.
 */
export function cuentaComoPendiente(item: ItemCierre): boolean {
  return !item.resueltoPorSupervisor
}

export function resumirCierre(items: ItemCierre[]): ResumenCierre {
  const resumen = resumenVacio()
  for (const item of items) {
    if (!cuentaComoPendiente(item)) continue
    resumen.items.push(item)
    resumen.porCategoria[item.categoria] += 1
    resumen.total += 1
  }
  return resumen
}

/**
 * Separa lo de hoy del arrastre. No se mezclan a proposito: si el supervisor ve
 * un solo numero, no puede saber si su guardia quedo limpia o si esta cargando
 * deuda de otros dias.
 */
export function construirCierreOperativo(
  items: ItemCierre[],
  fechaOperativa: string,
): CierreOperativo {
  const hoy: ItemCierre[] = []
  const anteriores: ItemCierre[] = []
  for (const item of items) {
    if (item.fecha >= fechaOperativa) hoy.push(item)
    else anteriores.push(item)
  }
  return {
    fechaOperativa,
    hoy:        resumirCierre(hoy),
    anteriores: resumirCierre(anteriores),
  }
}

/** "3 planillas · 2 rondas · 1 operación". Vacio cuando no hay nada. */
export function detalleCierre(resumen: ResumenCierre): string {
  return CATEGORIAS_CIERRE
    .filter(c => resumen.porCategoria[c] > 0)
    .map(c => `${resumen.porCategoria[c]} ${ETIQUETA_CATEGORIA_CIERRE[c].toLowerCase()}`)
    .join(' · ')
}

export function cierreEstaLimpio(cierre: CierreOperativo): boolean {
  return cierre.hoy.total === 0
}

// ── Presentación ─────────────────────────────────────────────────────────────

/** Los items de un resumen, agrupados por categoría y ordenados por hora. */
export function agruparPorCategoria(resumen: ResumenCierre): Array<{
  categoria: CategoriaCierre
  items: ItemCierre[]
}> {
  return CATEGORIAS_CIERRE
    .map(categoria => ({
      categoria,
      items: resumen.items
        .filter(i => i.categoria === categoria)
        .sort((a, b) => b.fecha.localeCompare(a.fecha) || a.hora.localeCompare(b.hora)),
    }))
    .filter(g => g.items.length > 0)
}

/**
 * El texto del aviso de cierre. Uno solo por responsable y por día: el que
 * recibe veinte avisos deja de leerlos, y el cierre es justamente el resumen
 * de todo lo demás.
 *
 * Dice el número y qué es, no "revisá el sistema": un aviso que obliga a abrir
 * la app para saber si hace falta abrir la app no sirve de nada.
 */
export function textoPushCierre(cierre: CierreOperativo): { titulo: string; cuerpo: string } {
  const hoy = cierre.hoy.total
  const arrastre = cierre.anteriores.total

  if (hoy === 0 && arrastre === 0) {
    return {
      titulo: 'Cierre operativo al día',
      cuerpo: 'No te queda nada pendiente para cerrar la guardia.',
    }
  }

  const titulo = hoy === 0
    ? 'Cierre operativo: hoy sin pendientes'
    : `Cierre operativo: ${hoy} pendiente${hoy === 1 ? '' : 's'}`

  const partes: string[] = []
  if (hoy > 0) partes.push(`Hoy: ${detalleCierre(cierre.hoy)}.`)
  if (arrastre > 0) {
    partes.push(`De días anteriores: ${arrastre} sin resolver (${detalleCierre(cierre.anteriores)}).`)
  }
  return { titulo, cuerpo: partes.join(' ') }
}

// ── Responsable de cada item ─────────────────────────────────────────────────
//
// Se resuelve con la fecha y hora DEL HECHO, no con las de ahora. Es lo que
// evita que una incidencia vieja cambie de dueño cada vez que rota la guardia:
// el que estaba cuando paso sigue siendo el responsable.
//
// LIMITACION CONOCIDA, asumida a proposito: depende de que las filas de
// supervisores_guardia de esa fecha sigan existiendo. Si se regenera la
// programacion de un mes pasado, la atribucion historica se mueve con ella. No
// se persiste el responsable en una tabla nueva porque eso amplia el alcance;
// queda anotado como deuda.

export interface CatalogosResponsable {
  guardias: GuardiaOperativa[]
  supervisorZonas: AsignacionZona[]
  zonas: Array<{ id: string; nombre: string }>
  usuarios?: UsuarioBasico[]
}

export function responsablesDeItem(
  item: ItemCierre,
  catalogos: CatalogosResponsable,
): string[] {
  return resolverResponsablesOperativos({
    zonaId:          item.zonaId,
    zonaNombre:      item.zonaNombre ?? null,
    fecha:           item.fecha,
    hora:            item.hora,
    guardias:        catalogos.guardias,
    supervisorZonas: catalogos.supervisorZonas,
    zonas:           catalogos.zonas,
    usuarios:        catalogos.usuarios,
  }).responsables
}

/**
 * Los items que le tocan a un usuario. Nunca por `rol === 'supervisor'`: eso ya
 * se elimino del ruteo de push y volver a usarlo seria una regresion —dejaria
 * afuera a un responsable con rol admin.
 */
export function itemsDeResponsable(
  items: ItemCierre[],
  usuarioId: string,
  catalogos: CatalogosResponsable,
): ItemCierre[] {
  return items.filter(item => responsablesDeItem(item, catalogos).includes(usuarioId))
}

export function cierreDeResponsable(
  items: ItemCierre[],
  usuarioId: string,
  fechaOperativa: string,
  catalogos: CatalogosResponsable,
): CierreOperativo {
  return construirCierreOperativo(itemsDeResponsable(items, usuarioId, catalogos), fechaOperativa)
}
