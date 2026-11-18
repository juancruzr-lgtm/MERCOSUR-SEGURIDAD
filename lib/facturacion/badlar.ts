// Serie diaria de la tasa BADLAR de bancos privados (% nominal anual) que publica el BCRA en su API de
// estadísticas monetarias v4.0, variable 7 ("Tasa de interés BADLAR de bancos privados", en porcentaje
// nominal anual; verificado el 18/11/2026: la v3 responde 410). Sólo lectura.
import { ordenarSerie, type PuntoSerie } from './intereses-variables'

export const BADLAR_VARIABLE = 7
export const BADLAR_DESCRIPCION = 'Tasa BADLAR de bancos privados (BCRA, % nominal anual)'
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
