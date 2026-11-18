// Series de la API de estadísticas monetarias v4.0 del BCRA (sólo lectura). La que se usa:
// Tasa de Intereses Moratorios (TIM), CCyC art. 768 inc. c: variable 1197, índice diario acumulado, publicado
// todos los días (verificado el 18/11/2026; es la misma serie y la misma URL que usa la calculadora oficial
// del BCRA). La v3 de la API responde 410.
import { ordenarSerie, type PuntoSerie } from './intereses-variables'

export const TIM_VARIABLE = 1197
export const TIM_DESCRIPCION = 'Tasa de Intereses Moratorios (TIM) del BCRA, Código Civil y Comercial art. 768 inc. c'
export const CALCULADORA_TIM = 'https://www.bcra.gob.ar/calculadora-de-tasa-de-intereses-moratorios-tim/'
export const PAGINA_BCRA = 3000

export function urlSerieBcra(variable: number, desde: string, hasta: string, offset = 0): string {
  return `https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/${variable}?desde=${desde}&hasta=${hasta}&limit=${PAGINA_BCRA}&offset=${offset}`
}

/** Respuesta de la API ({ metadata.resultset.count, results: [{ idVariable, detalle: [{ fecha, valor }] }] }) → serie ordenada. */
export function parsearSerieBcra(json: any): { puntos: PuntoSerie[]; total: number } {
  const resultados = Array.isArray(json?.results) ? json.results : []
  const detalle = resultados.flatMap((x: any) => (Array.isArray(x?.detalle) ? x.detalle : []))
  const puntos = ordenarSerie(detalle.map((p: any) => ({ fecha: String(p?.fecha ?? '').slice(0, 10), valor: Number(p?.valor) })))
  const total = Number(json?.metadata?.resultset?.count)
  return { puntos, total: Number.isFinite(total) ? total : puntos.length }
}
