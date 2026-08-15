/**
 * lib/carga-operativa.ts
 *
 * Clasificación de la CARGA OPERATIVA de una zona: cuántas horas de servicios
 * bajo supervisión caen en cada franja de guardia, partidas en
 *
 *   · exclusiva de un supervisor (nadie más de guardia en ese tramo);
 *   · compartida entre los que están de guardia a la vez (Rosario de día:
 *     Sabino + Sergio), contada UNA sola vez en el total de la zona;
 *   · sin supervisor, si de verdad no cubre nadie.
 *
 * QUÉ NO ES ESTA MÉTRICA. No son horas trabajadas por el supervisor: de día
 * los supervisores además atienden clientes y trámites. Repartir la carga
 * compartida 50/50 —o por cabeza, como hacía el cálculo anterior de la
 * pantalla de Supervisiones— da a entender una medición de trabajo personal
 * que estos números no pueden sostener. El desempeño individual se mide con
 * datos reales (supervisiones hechas, intervenciones, alertas atendidas); la
 * carga sólo dice cuántas horas de servicio tiene cada uno bajo su
 * responsabilidad, y cuáles comparte.
 *
 * Reglas de resolución por tramo, las mismas del resolver de responsables
 * (lib/responsables-operativos): cubren las guardias efectivas de la zona
 * (nocturnos, sin francos/ausencias/inactivas, rol operativo 'supervisor');
 * un tramo sin ninguna guardia cae al responsable ÚNICO de supervisor_zonas
 * si existe (Rafaela → su responsable, sin hardcodear), y si la zona tiene
 * varios asignados y ninguna guardia que decida, el tramo queda "sin
 * supervisor": no se elige uno arbitrariamente.
 *
 * FRONTERA DEL PERÍODO: pasar guardias desde UN DÍA ANTES del período (los
 * nocturnos entrantes) hasta UN DÍA DESPUÉS (los turnos que terminan pasadas
 * las 07:00 del día siguiente al cierre, como los que van hasta las 08:00).
 * Sin ese día extra, la cola de los últimos nocturnos aparece como "sin
 * supervisor" aunque la guardia del día siguiente exista: fue el origen de
 * las 2 h fantasma de PEAJE/PNC en la auditoría de agosto 2026.
 *
 * Todo se calcula en MINUTOS y se convierte a horas recién al final: el total
 * de la zona es la suma exacta de sus partes, sin deriva de redondeo. La
 * pantalla redondea al mostrar, nunca antes de sumar.
 */

import { guardiaCubre, hora5, normalizarTextoGuardia } from '@/lib/guardias-supervisor'
import type { AsignacionZona, GuardiaOperativa, UsuarioBasico } from '@/lib/responsables-operativos'
import { ESTADOS_SIN_OBLIGACION } from '@/lib/revision-operativa'

// ── Entradas ─────────────────────────────────────────────────────────────────

export interface TurnoCarga {
  objetivo_id: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado?: string | null
}

export interface ObjetivoCarga {
  id: string
  zona_id?: string | null
  es_prueba?: boolean | null
}

export interface ParametrosCarga {
  /** Turnos del período. Los reemplazados/anulados/cancelados se descartan acá. */
  turnos: TurnoCarga[]
  /** Objetivos ya filtrados por estado activo; los es_prueba se descartan acá. */
  objetivos: ObjetivoCarga[]
  /** Guardias desde un día antes hasta un día después del período (ver cabecera). */
  guardias: GuardiaOperativa[]
  supervisorZonas: AsignacionZona[]
  zonas: Array<{ id: string; nombre: string }>
  /** Con lista, sólo usuarios activos cuentan como cobertura. */
  usuarios?: UsuarioBasico[]
}

// ── Salidas ──────────────────────────────────────────────────────────────────

export interface CargaCompartida {
  /** Ordenados, para que la franja Sabino+Sergio tenga una sola identidad. */
  supervisorIds: string[]
  horas: number
}

export interface CargaZona {
  zonaId: string
  /** Exclusiva + compartida (una vez) + sin supervisor. Identidad exacta. */
  totalHoras: number
  exclusivas: Record<string, number>
  compartidas: CargaCompartida[]
  sinSupervisor: number
}

/** La parte de un supervisor: su exclusiva y las compartidas donde está. */
export interface CargaSupervisor {
  exclusiva: number
  compartidas: CargaCompartida[]
}

export const LEYENDA_CARGA =
  'Carga operativa de servicios bajo supervisión. No son horas trabajadas por el supervisor: la franja compartida cuenta una sola vez en la zona y no se reparte.'

// ── Cálculo ──────────────────────────────────────────────────────────────────

const minutosAbs = (fecha: string, hora: string): number | null => {
  const [anio, mes, dia] = String(fecha).slice(0, 10).split('-').map(Number)
  const [hh, mm] = hora5(hora).split(':').map(Number)
  if (!anio || !mes || !dia || !Number.isFinite(hh) || !Number.isFinite(mm)) return null
  return Date.UTC(anio, mes - 1, dia, hh, mm) / 60000
}

export function clasificarCargaZonas(params: ParametrosCarga): Map<string, CargaZona> {
  const { turnos, objetivos, guardias, supervisorZonas, zonas, usuarios } = params

  const usuarioActivo = (id?: string | null): boolean => {
    if (!id) return false
    if (!usuarios) return true
    const usuario = usuarios.find(u => u.id === id)
    return Boolean(usuario) && normalizarTextoGuardia(usuario!.estado || 'activo') === 'activo'
  }

  // Guardias que cuentan como cobertura, en rangos absolutos, por zona
  // normalizada. Mismos filtros que el resolver de responsables.
  const guardiasPorZona = new Map<string, Array<{ supervisorId: string; ini: number; fin: number }>>()
  for (const guardia of guardias) {
    if (!guardiaCubre(guardia)) continue
    if (normalizarTextoGuardia(guardia.rol_operativo || 'supervisor') !== 'supervisor') continue
    if (!usuarioActivo(guardia.supervisor_id)) continue
    const ini = minutosAbs(String(guardia.fecha ?? ''), String(guardia.hora_inicio ?? ''))
    let fin = minutosAbs(String(guardia.fecha ?? ''), String(guardia.hora_fin ?? ''))
    if (ini === null || fin === null) continue
    if (fin <= ini) fin += 1440
    const clave = normalizarTextoGuardia(guardia.zona)
    if (!guardiasPorZona.has(clave)) guardiasPorZona.set(clave, [])
    guardiasPorZona.get(clave)!.push({ supervisorId: guardia.supervisor_id as string, ini, fin })
  }

  // Fallback por zona: el responsable único de supervisor_zonas, si existe.
  const fallbackPorZona = new Map<string, string | null>()
  for (const zona of zonas) {
    const asignados = supervisorZonas
      .filter(a => a.zona_id === zona.id && usuarioActivo(a.supervisor_id))
      .map(a => a.supervisor_id)
      .filter((id, i, todos) => todos.indexOf(id) === i)
    fallbackPorZona.set(zona.id, asignados.length === 1 ? asignados[0] : null)
  }

  const nombreZonaNorm = new Map<string, string>()
  zonas.forEach(z => nombreZonaNorm.set(z.id, normalizarTextoGuardia(z.nombre)))
  const zonaDeObjetivo = new Map<string, string>()
  objetivos.forEach(o => { if (o.zona_id && !o.es_prueba) zonaDeObjetivo.set(o.id, o.zona_id) })

  // Acumuladores en minutos; a horas recién al final.
  type Acumulador = {
    exclusivas: Map<string, number>
    compartidas: Map<string, { ids: string[]; min: number }>
    sinSupervisor: number
    total: number
  }
  const porZona = new Map<string, Acumulador>()

  for (const turno of turnos) {
    if (ESTADOS_SIN_OBLIGACION.has(turno.estado || '')) continue
    const zonaId = zonaDeObjetivo.get(turno.objetivo_id)
    if (!zonaId) continue

    const ini = minutosAbs(turno.fecha, turno.hora_inicio)
    let fin = minutosAbs(turno.fecha, turno.hora_fin)
    if (ini === null || fin === null) continue
    if (fin <= ini) fin += 1440

    const franjas = guardiasPorZona.get(nombreZonaNorm.get(zonaId) ?? '') ?? []
    const solapadas = franjas.filter(g => g.ini < fin && g.fin > ini)

    // Cortes: los extremos del turno más los límites de guardia que caen
    // adentro. Entre dos cortes consecutivos el conjunto de cobertura no
    // cambia, así que se clasifica cada tramo entero de una vez.
    const cortes = [ini, fin]
    for (const g of solapadas) {
      if (g.ini > ini && g.ini < fin) cortes.push(g.ini)
      if (g.fin > ini && g.fin < fin) cortes.push(g.fin)
    }
    cortes.sort((a, b) => a - b)

    if (!porZona.has(zonaId)) {
      porZona.set(zonaId, { exclusivas: new Map(), compartidas: new Map(), sinSupervisor: 0, total: 0 })
    }
    const acumulador = porZona.get(zonaId)!

    for (let i = 0; i < cortes.length - 1; i++) {
      const a = cortes[i]
      const b = cortes[i + 1]
      if (b <= a) continue
      const duracion = b - a
      acumulador.total += duracion

      const cubren = solapadas
        .filter(g => g.ini <= a && g.fin >= b)
        .map(g => g.supervisorId)
        .filter((id, idx, todos) => todos.indexOf(id) === idx)
        .sort()

      if (cubren.length > 1) {
        const clave = cubren.join('|')
        const compartida = acumulador.compartidas.get(clave) ?? { ids: cubren, min: 0 }
        compartida.min += duracion
        acumulador.compartidas.set(clave, compartida)
      } else if (cubren.length === 1) {
        acumulador.exclusivas.set(cubren[0], (acumulador.exclusivas.get(cubren[0]) ?? 0) + duracion)
      } else {
        const responsable = fallbackPorZona.get(zonaId) ?? null
        if (responsable) {
          acumulador.exclusivas.set(responsable, (acumulador.exclusivas.get(responsable) ?? 0) + duracion)
        } else {
          acumulador.sinSupervisor += duracion
        }
      }
    }
  }

  const resultado = new Map<string, CargaZona>()
  porZona.forEach((acumulador, zonaId) => {
    const exclusivas: Record<string, number> = {}
    acumulador.exclusivas.forEach((min, id) => { exclusivas[id] = min / 60 })
    resultado.set(zonaId, {
      zonaId,
      totalHoras: acumulador.total / 60,
      exclusivas,
      compartidas: Array.from(acumulador.compartidas.values())
        .map(c => ({ supervisorIds: c.ids, horas: c.min / 60 }))
        .sort((x, y) => y.horas - x.horas),
      sinSupervisor: acumulador.sinSupervisor / 60,
    })
  })

  return resultado
}

/**
 * La parte de UN supervisor sobre las zonas que cubre: su exclusiva total y
 * las franjas compartidas en las que participa, para mostrarlas rotuladas —
 * nunca sumadas a la exclusiva en un solo número.
 */
export function cargaDeSupervisor(
  cargas: Map<string, CargaZona>,
  supervisorId: string,
  zonaIds: Iterable<string>,
): CargaSupervisor {
  let exclusiva = 0
  const compartidasPorClave = new Map<string, CargaCompartida>()

  for (const zonaId of Array.from(zonaIds)) {
    const carga = cargas.get(zonaId)
    if (!carga) continue
    exclusiva += carga.exclusivas[supervisorId] ?? 0
    for (const compartida of carga.compartidas) {
      if (!compartida.supervisorIds.includes(supervisorId)) continue
      const clave = compartida.supervisorIds.join('|')
      const previa = compartidasPorClave.get(clave)
      if (previa) previa.horas += compartida.horas
      else compartidasPorClave.set(clave, { supervisorIds: compartida.supervisorIds, horas: compartida.horas })
    }
  }

  return {
    exclusiva,
    compartidas: Array.from(compartidasPorClave.values()).sort((a, b) => b.horas - a.horas),
  }
}
