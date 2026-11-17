/**
 * lib/tablero-gerencia/supervision-preventiva.ts
 *
 * Indicadores de supervisión PREVENTIVA. La visita vale por sí misma: una
 * supervisión sin observaciones NO es un resultado malo (no se penaliza).
 *
 * Tres dimensiones separadas, nunca mezcladas en un único puntaje:
 *   1. Cobertura preventiva  → presencia, frecuencia, franjas (noche, finde,
 *      feriado) y previsibilidad de horarios.
 *   2. Calidad de supervisión → visitas completas vs. incompletas (evidencia).
 *   3. Efectividad correctiva → problemas del objetivo corregidos/verificados
 *      y reincidencia (desde los casos del tablero).
 *
 * La frecuencia esperada es POR OBJETIVO (objetivos.frecuencia_supervision_horas,
 * ya existente). No hay frecuencia universal. Las exigencias de franja
 * (noche/finde) sólo aplican si el objetivo tuvo servicio en esa franja.
 *
 * Funciones puras: no leen la base ni escriben nada.
 */

import type { Caso } from './casos'

export interface SupervisionVisita {
  id: string
  objetivo_id: string
  supervisor_id: string | null
  estado: string | null            // ok | con_observacion | critico | incompleta
  created_at: string               // ISO UTC
}

export interface ObjetivoPreventivo {
  id: string
  nombre: string
  frecuencia_supervision_horas: number | null
}

export interface TurnoFranja {
  objetivo_id: string | null
  fecha: string
  hora_inicio: string | null
  hora_fin: string | null
  estado?: string | null
}

export interface ConfigPreventiva {
  /** Desde qué hora local una visita es nocturna (inclusive). */
  nocheDesde: number
  /** Hasta qué hora local (exclusive). */
  nocheHasta: number
  /** Cumplimiento mínimo de visitas esperadas para considerar adecuado. */
  minimoCumplimiento: number
  /** Visitas por encima de este múltiplo de lo esperado = concentración/exceso. */
  multiploExceso: number
  /** Una brecha mayor a frecuencia × este factor es un hueco de presencia. */
  factorBrecha: number
  /** Si el bloque de 2 h más usado concentra este % (con >= 4 visitas) = previsible. */
  umbralPrevisibilidad: number
  /** Visitas del mismo supervisor separadas por menos de estas horas = agrupadas. */
  horasVisitaAgrupada: number
}

export const CONFIG_PREVENTIVA_DEFECTO: ConfigPreventiva = {
  nocheDesde: 22,
  nocheHasta: 6,
  minimoCumplimiento: 0.7,
  multiploExceso: 2.5,
  factorBrecha: 2,
  umbralPrevisibilidad: 0.6,
  horasVisitaAgrupada: 1,
}

const H = 3_600_000
const TZ_MS = -3 * H // Argentina, sin horario de verano

/** Hora local (0–23), día ISO (1 = lunes … 7 = domingo) y fecha local. */
export function localDe(iso: string): { hora: number; diaSemana: number; fecha: string } {
  const d = new Date(new Date(iso).getTime() + TZ_MS)
  const dow = d.getUTCDay()
  return { hora: d.getUTCHours(), diaSemana: dow === 0 ? 7 : dow, fecha: d.toISOString().slice(0, 10) }
}

export function esNocturna(hora: number, c: ConfigPreventiva = CONFIG_PREVENTIVA_DEFECTO): boolean {
  return c.nocheDesde > c.nocheHasta ? hora >= c.nocheDesde || hora < c.nocheHasta : hora >= c.nocheDesde && hora < c.nocheHasta
}

function esFinde(diaSemana: number): boolean {
  return diaSemana === 6 || diaSemana === 7
}

/** ¿El turno toca la franja nocturna? (servicio que exige presencia de noche) */
function turnoNocturno(t: TurnoFranja, c: ConfigPreventiva): boolean {
  if (!t.hora_inicio || !t.hora_fin) return false
  const ini = Number(t.hora_inicio.slice(0, 2))
  const fin = Number(t.hora_fin.slice(0, 2))
  if (fin <= ini) return true // cruza medianoche
  for (let h = ini; h < fin; h++) if (esNocturna(h, c)) return true
  return false
}

function diaSemanaFecha(fecha: string): number {
  const dow = new Date(`${fecha}T12:00:00Z`).getUTCDay()
  return dow === 0 ? 7 : dow
}

export type ClasePreventiva = 'adecuada' | 'insuficiente' | 'excesiva' | 'sin_visitas'

export interface CoberturaObjetivo {
  objetivoId: string
  nombre: string
  frecuenciaHoras: number | null
  // 1. Cobertura preventiva
  visitas: number
  visitasEsperadas: number | null
  cumplimiento: number | null           // visitas / esperadas
  ultimaVisita: string | null
  horasDesdeUltima: number | null
  brechaMaximaHoras: number | null
  brechasExcedidas: number
  porSupervisor: Record<string, number>
  diurnas: number
  nocturnas: number
  finde: number
  feriado: number
  servicioNocturno: boolean
  servicioFinde: boolean
  sinCoberturaNocturna: boolean          // tuvo servicio de noche y ninguna visita nocturna
  sinCoberturaFinde: boolean
  distribucionHoraria: number[]          // 24 posiciones
  previsible: boolean                    // horarios concentrados → la visita deja de sorprender
  agrupadas: number                      // visitas del mismo supervisor muy juntas
  // 2. Calidad
  porEstado: Record<string, number>
  incompletas: number
  // 3. Efectividad correctiva
  problemas: number
  corregidos: number
  verificados: number
  reincidencias: number
  // Resultado
  clase: ClasePreventiva
  motivos: string[]
}

export interface CoberturaSupervisor {
  supervisorId: string
  visitas: number
  objetivos: number
  nocturnas: number
  finde: number
  incompletas: number
  conObservacion: number
  criticas: number
}

export interface ResumenPreventivo {
  objetivos: CoberturaObjetivo[]
  supervisores: CoberturaSupervisor[]
  totales: {
    visitas: number
    objetivosEvaluados: number
    adecuados: number
    insuficientes: number
    excesivos: number
    sinVisitas: number
    sinCoberturaNocturna: number
    sinCoberturaFinde: number
    previsibles: number
    pctNocturnas: number | null
    pctFinde: number | null
    pctIncompletas: number | null
  }
}

const RESUELTOS = new Set(['resuelto', 'verificado'])

export function coberturaPreventiva(p: {
  desdeIso: string
  hastaIso: string
  objetivos: ObjetivoPreventivo[]
  supervisiones: SupervisionVisita[]
  turnos?: TurnoFranja[]
  feriados?: ReadonlySet<string>
  casos?: Caso[]
  config?: Partial<ConfigPreventiva>
}): ResumenPreventivo {
  const c: ConfigPreventiva = { ...CONFIG_PREVENTIVA_DEFECTO, ...p.config }
  const desde = new Date(p.desdeIso).getTime()
  const hasta = new Date(p.hastaIso).getTime()
  const horasPeriodo = Math.max(0, (hasta - desde) / H)
  const feriados = p.feriados ?? new Set<string>()

  const visitasPorObj = new Map<string, SupervisionVisita[]>()
  for (const s of p.supervisiones) {
    const t = new Date(s.created_at).getTime()
    if (t < desde || t >= hasta) continue
    const l = visitasPorObj.get(s.objetivo_id) ?? []
    l.push(s)
    visitasPorObj.set(s.objetivo_id, l)
  }

  const servicioNoche = new Set<string>()
  const servicioFinde = new Set<string>()
  for (const t of p.turnos ?? []) {
    if (!t.objetivo_id || ['anulado', 'cancelado', 'reemplazado'].includes(t.estado ?? '')) continue
    if (turnoNocturno(t, c)) servicioNoche.add(t.objetivo_id)
    if (esFinde(diaSemanaFecha(t.fecha)) || feriados.has(t.fecha)) servicioFinde.add(t.objetivo_id)
  }

  const casosPorObj = new Map<string, Caso[]>()
  for (const k of p.casos ?? []) {
    if (!k.objetivoId) continue
    const l = casosPorObj.get(k.objetivoId) ?? []
    l.push(k)
    casosPorObj.set(k.objetivoId, l)
  }

  const porSupervisor = new Map<string, CoberturaSupervisor & { _obj: Set<string> }>()

  const objetivos: CoberturaObjetivo[] = p.objetivos.map(o => {
    const vs = (visitasPorObj.get(o.id) ?? []).slice().sort((a, b) => a.created_at.localeCompare(b.created_at))
    const frecuencia = o.frecuencia_supervision_horas && o.frecuencia_supervision_horas > 0 ? o.frecuencia_supervision_horas : null
    const esperadas = frecuencia ? Math.round((horasPeriodo / frecuencia) * 10) / 10 : null
    const distribucion = new Array<number>(24).fill(0)
    const porSup: Record<string, number> = {}
    const porEstado: Record<string, number> = {}
    let nocturnas = 0, finde = 0, feriado = 0, agrupadas = 0
    const ultimaDeSupervisor = new Map<string, number>()

    for (const v of vs) {
      const l = localDe(v.created_at)
      distribucion[l.hora]++
      if (esNocturna(l.hora, c)) nocturnas++
      if (esFinde(l.diaSemana)) finde++
      if (feriados.has(l.fecha)) feriado++
      const sup = v.supervisor_id ?? 'sin_supervisor'
      porSup[sup] = (porSup[sup] ?? 0) + 1
      const est = v.estado ?? 'sin_estado'
      porEstado[est] = (porEstado[est] ?? 0) + 1
      const t = new Date(v.created_at).getTime()
      const prev = ultimaDeSupervisor.get(sup)
      if (prev != null && (t - prev) / H < c.horasVisitaAgrupada) agrupadas++
      ultimaDeSupervisor.set(sup, t)

      const ps = porSupervisor.get(sup) ?? { supervisorId: sup, visitas: 0, objetivos: 0, nocturnas: 0, finde: 0, incompletas: 0, conObservacion: 0, criticas: 0, _obj: new Set<string>() }
      ps.visitas++
      ps._obj.add(o.id)
      if (esNocturna(l.hora, c)) ps.nocturnas++
      if (esFinde(l.diaSemana)) ps.finde++
      if (est === 'incompleta') ps.incompletas++
      if (est === 'con_observacion') ps.conObservacion++
      if (est === 'critico') ps.criticas++
      porSupervisor.set(sup, ps)
    }

    // Brechas: desde el inicio del período, entre visitas y hasta el final.
    const marcas = [desde, ...vs.map(v => new Date(v.created_at).getTime()), hasta]
    let brechaMax = 0
    let excedidas = 0
    for (let i = 1; i < marcas.length; i++) {
      const g = (marcas[i] - marcas[i - 1]) / H
      brechaMax = Math.max(brechaMax, g)
      if (frecuencia && g > frecuencia * c.factorBrecha) excedidas++
    }

    // Previsibilidad: bloque de 2 h (circular) con más visitas.
    let mejorBloque = 0
    for (let h = 0; h < 24; h++) mejorBloque = Math.max(mejorBloque, distribucion[h] + distribucion[(h + 1) % 24])
    const previsible = vs.length >= 4 && mejorBloque / vs.length >= c.umbralPrevisibilidad

    const ultima = vs.length ? vs[vs.length - 1].created_at : null
    const cumplimiento = esperadas && esperadas > 0 ? Math.round((vs.length / esperadas) * 100) / 100 : null
    const sinNoche = servicioNoche.has(o.id) && nocturnas === 0
    const sinFinde = servicioFinde.has(o.id) && finde === 0 && feriado === 0

    const casos = casosPorObj.get(o.id) ?? []
    const problemas = casos.filter(k => k.estado !== 'descartado').length
    const corregidos = casos.filter(k => RESUELTOS.has(k.estado)).length
    const verificados = casos.filter(k => k.estado === 'verificado').length
    const reincidencias = casos.filter(k => k.estado === 'reabierto').length

    const motivos: string[] = []
    let clase: ClasePreventiva
    if (vs.length === 0) {
      clase = 'sin_visitas'
      motivos.push('Sin visitas en el período')
    } else {
      if (cumplimiento != null && cumplimiento < c.minimoCumplimiento) motivos.push(`Visitas por debajo de lo esperado (${vs.length} de ${esperadas})`)
      if (excedidas > 0) motivos.push(`${excedidas} hueco(s) sin presencia mayores a ${frecuencia! * c.factorBrecha} h`)
      if (sinNoche) motivos.push('Tuvo servicio nocturno y ninguna visita de noche')
      if (sinFinde) motivos.push('Tuvo servicio en fin de semana/feriado y ninguna visita')
      const exceso = esperadas != null && esperadas > 0 && vs.length > esperadas * c.multiploExceso
      if (motivos.length) clase = 'insuficiente'
      else if (exceso) { clase = 'excesiva'; motivos.push(`Visitas muy por encima de lo esperado (${vs.length} vs ${esperadas}): revisar distribución entre objetivos`) }
      else clase = 'adecuada'
      if (previsible) motivos.push('Horarios de visita previsibles (concentrados en una franja de 2 h)')
      if (agrupadas > 0) motivos.push(`${agrupadas} visita(s) del mismo supervisor con menos de ${c.horasVisitaAgrupada} h de diferencia`)
    }

    return {
      objetivoId: o.id,
      nombre: o.nombre,
      frecuenciaHoras: frecuencia,
      visitas: vs.length,
      visitasEsperadas: esperadas,
      cumplimiento,
      ultimaVisita: ultima,
      horasDesdeUltima: ultima ? Math.round(((hasta - new Date(ultima).getTime()) / H) * 10) / 10 : null,
      brechaMaximaHoras: Math.round(brechaMax * 10) / 10,
      brechasExcedidas: excedidas,
      porSupervisor: porSup,
      diurnas: vs.length - nocturnas,
      nocturnas,
      finde,
      feriado,
      servicioNocturno: servicioNoche.has(o.id),
      servicioFinde: servicioFinde.has(o.id),
      sinCoberturaNocturna: sinNoche,
      sinCoberturaFinde: sinFinde,
      distribucionHoraria: distribucion,
      previsible,
      agrupadas,
      porEstado,
      incompletas: porEstado.incompleta ?? 0,
      problemas,
      corregidos,
      verificados,
      reincidencias,
      clase,
      motivos,
    }
  })

  const visitas = objetivos.reduce((a, o) => a + o.visitas, 0)
  const pct = (n: number) => (visitas ? Math.round((n / visitas) * 1000) / 10 : null)
  return {
    objetivos,
    supervisores: Array.from(porSupervisor.values()).map(({ _obj, ...s }) => ({ ...s, objetivos: _obj.size })).sort((a, b) => b.visitas - a.visitas),
    totales: {
      visitas,
      objetivosEvaluados: objetivos.length,
      adecuados: objetivos.filter(o => o.clase === 'adecuada').length,
      insuficientes: objetivos.filter(o => o.clase === 'insuficiente').length,
      excesivos: objetivos.filter(o => o.clase === 'excesiva').length,
      sinVisitas: objetivos.filter(o => o.clase === 'sin_visitas').length,
      sinCoberturaNocturna: objetivos.filter(o => o.sinCoberturaNocturna).length,
      sinCoberturaFinde: objetivos.filter(o => o.sinCoberturaFinde).length,
      previsibles: objetivos.filter(o => o.previsible).length,
      pctNocturnas: pct(objetivos.reduce((a, o) => a + o.nocturnas, 0)),
      pctFinde: pct(objetivos.reduce((a, o) => a + o.finde, 0)),
      pctIncompletas: pct(objetivos.reduce((a, o) => a + o.incompletas, 0)),
    },
  }
}
