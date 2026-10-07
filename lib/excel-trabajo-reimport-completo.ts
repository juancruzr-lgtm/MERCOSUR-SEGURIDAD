// lib/excel-trabajo-reimport-completo.ts
//
// Análisis COMPLETO de una subida del Excel de trabajo (JC 07/10: "se tienen que
// guardar todos los cambios que haga en ese archivo"). Reúne, contra lo que hoy
// tiene guardado el período:
//   · variables de entrada por persona (lo de siempre, compararReimport);
//   · parámetros del mes (B1:B4, C2:C3, AP6);
//   · importes calculados pisados a mano y textos editados;
//   · correcciones que en el archivo volvieron al valor del sistema (se quitan);
//   · advertencias de lo que el archivo trae y no se puede guardar.
// Sólo lee. El guardado lo hace la RPC guardar_reimport_excel_trabajo.

import {
  compararReimport, parseGridReimport, compararParametros, compararCeldasEditadas, advertenciasReimport,
  baselineDesdePlantilla, CLAVES_LEGAJO_VIGENCIA,
  type CeldaVisual, type ResultadoComparacion, type CambioParametro, type CambioCelda, type AdvertenciaReimport,
} from '@/lib/excel-trabajo-reimport'
import { plantillaTrabajoDelMes, anexarColumnaSindicato, cargarParametrosDelMes } from '@/lib/excel-trabajo-liquidacion'
import { PARAMETROS_CELDAS, CLAVE_CELDA, CLAVE_TEXTO, type ParametrosLiquidacion } from '@/lib/resumen-guardia'

export interface Quita {
  usuarioId: string
  nombre: string | null
  clave: string
  etiqueta: string
  /** Lo que estaba guardado y deja de aplicarse. */
  guardado: number | string | null
}

export interface AnalisisReimport {
  comparacion: ResultadoComparacion
  parametros: CambioParametro[]
  /** Celdas pisadas / textos nuevos o distintos de lo guardado. */
  celdas: CambioCelda[]
  /** Correcciones guardadas (del Excel) que el archivo ya no trae. */
  quitar: Quita[]
  advertencias: AdvertenciaReimport[]
  /** usuario_id marcados con SINDICATO en el archivo. */
  sindicato: string[]
  error: string | null
}

const igualValor = (a: number | string | null | undefined, b: number | string | null | undefined): boolean => {
  if (typeof a === 'number' || typeof b === 'number') return Math.abs(Number(a ?? 0) - Number(b ?? 0)) < 0.005
  return String(a ?? '').trim() === String(b ?? '').trim()
}

export async function analizarReimportCompleto(
  client: any,
  periodo: { id: string; mes: string },
  grid: CeldaVisual[][],
): Promise<AnalisisReimport> {
  const vacio = { parametros: [], celdas: [], quitar: [], advertencias: [], sindicato: [] }
  // Baseline: lo que calcula el sistema SIN correcciones (con los parámetros
  // guardados del mes). Con la columna SINDICATO, para detectar desmarcados.
  const base = await plantillaTrabajoDelMes(client, periodo.mes)
  if (base.error || !base.plantilla) {
    return { ...vacio, comparacion: null as any, error: 'No se pudo armar el baseline de MERCOSUR: ' + (base.error || 'sin datos') }
  }
  const baseSind = await anexarColumnaSindicato(client, base.plantilla, periodo.mes)
  const comparacion = compararReimport(base.plantilla, grid)
  if (comparacion.personasEnArchivo === 0 || comparacion.periodoDelArchivo !== periodo.mes) {
    return { ...vacio, comparacion, error: null }   // la pantalla explica el motivo
  }

  // Parámetros del archivo.
  const parametros = compararParametros(base.plantilla, grid, PARAMETROS_CELDAS)
  const guardados = await cargarParametrosDelMes(client, periodo.mes)
  const paramsArchivo: ParametrosLiquidacion = { ...guardados }
  for (const c of parametros) {
    const def = PARAMETROS_CELDAS.find(p => p.clave === c.clave)!
    ;(paramsArchivo as any)[def.campo] = c.excel
  }

  // Planilla ESPERADA: parámetros + variables del archivo, sin celdas/textos
  // pisados. Lo que el archivo tenga distinto de esto lo escribió Juan a mano.
  const archivo = parseGridReimport(grid)
  const ajustesArchivo = new Map<string, Record<string, number | null>>()
  for (const [uid, e] of Array.from(archivo.entries())) ajustesArchivo.set(uid, { ...e.valores })
  const esperada = await plantillaTrabajoDelMes(client, periodo.mes, ajustesArchivo, { parametros: paramsArchivo, textos: new Map() })
  if (esperada.error || !esperada.plantilla || !esperada.rearmar) {
    return { ...vacio, comparacion, error: 'No se pudo recalcular con los valores del archivo: ' + (esperada.error || 'sin datos') }
  }
  const manuales = compararCeldasEditadas(esperada.rearmar, grid)

  // Lo guardado hoy en el período.
  const { data: aj, error: errAj } = await client.from('liquidacion_ajuste')
    .select('empleado_id, clave, etiqueta, origen, valor_liquidacion, valor_texto').eq('periodo_id', periodo.id)
  const guardadosAj = errAj
    ? (((await client.from('liquidacion_ajuste').select('empleado_id, clave, etiqueta, origen, valor_liquidacion').eq('periodo_id', periodo.id)).data ?? []) as any[])
    : ((aj ?? []) as any[])
  const key = (u: string, c: string) => `${u}|${c}`
  const guardadoPor = new Map(guardadosAj.map(a => [key(String(a.empleado_id), String(a.clave)), a]))

  // Celdas/textos: sólo los que cambian respecto de lo guardado.
  const celdas = manuales.filter(m => {
    const g = guardadoPor.get(key(m.usuarioId, m.clave))
    if (!g) return true
    return !igualValor(m.tipo === 'texto' ? g.valor_texto : (g.valor_liquidacion == null ? null : Number(g.valor_liquidacion)), m.excel)
  })

  // Quitas: correcciones subidas antes desde el Excel que el archivo ya no trae
  // (la celda volvió al valor del sistema). Sólo para personas presentes.
  const deseadas = new Set<string>([
    ...comparacion.diffs.filter(d => d.usuarioId && !CLAVES_LEGAJO_VIGENCIA.has(d.clave)).map(d => key(d.usuarioId!, d.clave)),
    ...manuales.map(m => key(m.usuarioId, m.clave)),
  ])
  const baseline = baselineDesdePlantilla(base.plantilla)
  const quitar: Quita[] = []
  for (const g of guardadosAj) {
    const uid = String(g.empleado_id), clave = String(g.clave)
    if (g.origen !== 'excel_reimport' || !archivo.has(uid) || deseadas.has(key(uid, clave))) continue
    const esTexto = clave.startsWith(CLAVE_TEXTO)
    quitar.push({
      usuarioId: uid, nombre: archivo.get(uid)?.nombre ?? baseline.get(uid)?.nombre ?? null, clave,
      etiqueta: g.etiqueta ?? clave.replace(CLAVE_CELDA, '').replace(CLAVE_TEXTO, ''),
      guardado: esTexto ? (g.valor_texto ?? null) : (g.valor_liquidacion == null ? null : Number(g.valor_liquidacion)),
    })
  }

  const sindicatoBase = new Set(Array.from(baselineDesdePlantilla(baseSind).values()).filter(e => e.sindicato).map(e => e.usuarioId))
  const advertencias = advertenciasReimport(base.plantilla, grid, { sindicatoBase })
  const sindicato = Array.from(archivo.values()).filter(e => e.sindicato).map(e => e.usuarioId)
  return { comparacion, parametros, celdas, quitar, advertencias, sindicato, error: null }
}
