/**
 * lib/gerencia.ts
 *
 * Los indicadores del Tablero de Gerencia.
 *
 * ── Una sola fuente ──────────────────────────────────────────────────────────
 * Todo sale de `evaluaciones_mensuales`. Gerencia no recalcula desde turnos,
 * rondas ni fichajes: si tuviera su propia cuenta, el día que una de las dos
 * cambiara la otra quedaría mintiendo y nadie lo notaría hasta comparar las
 * pantallas a mano.
 *
 * ── Las dos magnitudes no se mezclan ─────────────────────────────────────────
 * `notaPromedio` va sobre 10 y es la calificación. `ponderadoPromedio` va en
 * porcentaje y es otra cosa. Están en campos distintos, con unidades distintas,
 * y ninguna función de este módulo devuelve el ponderado en escala 0-10.
 */

import type { FilaPublicada } from '@/lib/mi-desempeno'

export const NOTA_APROBADO = 6

export interface DimensionAgregada {
  clave: string
  etiqueta: string
  /** Promedio de la nota de esa dimensión, sobre 10. */
  promedio: number
  /** Sobre cuántas personas se pudo medir. */
  medidas: number
  /** Peso acordado. Explica por qué una dimensión mueve más el resultado. */
  peso: number
}

export interface ResumenGerencia {
  periodo: string
  total: number
  /** Con calificación: el denominador de los promedios. */
  conNota: number
  sinMuestra: number
  parciales: number
  aprobados: number
  aplazados: number
  /** Sobre 10. Es la nota. `null` si nadie tiene. */
  notaPromedio: number | null
  /** En porcentaje. NO es la nota y no se muestra con formato /10. */
  ponderadoPromedio: number | null
  /** Cobertura evaluativa promedio, en porcentaje. */
  coberturaPromedio: number | null
  conTope: number
  /** Cuántas personas por nota entera. La clave es el piso: 8 son 8,0 a 8,9. */
  distribucion: Record<number, number>
  /** De peor a mejor promedio: las que explican los resultados. */
  dimensiones: DimensionAgregada[]
}

const prom = (xs: number[]): number | null =>
  xs.length === 0 ? null : Math.round((xs.reduce((s, v) => s + v, 0) / xs.length) * 100) / 100

const lista = (v: unknown): any[] => (Array.isArray(v) ? v : [])

export function resumirGerencia(
  filas: readonly FilaPublicada[],
  periodo: string,
): ResumenGerencia {
  const conNota = filas.filter(f => !f.datos_insuficientes && f.nota_final !== null)

  const distribucion: Record<number, number> = {}
  for (const f of conNota) {
    const piso = Math.floor(Number(f.nota_final))
    distribucion[piso] = (distribucion[piso] ?? 0) + 1
  }

  // Las dimensiones se promedian sólo donde se pudieron medir. Contar un
  // "no aplica" como cero hundiría el promedio de quien no tenía esa obligación.
  const acumulado = new Map<string, { etiqueta: string; peso: number; notas: number[] }>()
  for (const f of filas) {
    for (const d of lista(f.dimensiones)) {
      const peso = Number(d?.peso ?? 0)
      if (peso <= 0) continue
      const clave = String(d.clave ?? '')
      if (!acumulado.has(clave)) {
        acumulado.set(clave, { etiqueta: String(d.etiqueta ?? clave), peso, notas: [] })
      }
      if (d?.estado === 'puntuable' && typeof d.nota === 'number') {
        acumulado.get(clave)!.notas.push(d.nota)
      }
    }
  }

  const dimensiones: DimensionAgregada[] = Array.from(acumulado.entries())
    .map(([clave, v]) => ({
      clave,
      etiqueta: v.etiqueta,
      promedio: prom(v.notas) ?? 0,
      medidas: v.notas.length,
      peso: v.peso,
    }))
    .filter(d => d.medidas > 0)
    .sort((a, b) => a.promedio - b.promedio)

  return {
    periodo,
    total: filas.length,
    conNota: conNota.length,
    sinMuestra: filas.length - conNota.length,
    parciales: filas.filter(f => f.alcance === 'parcial').length,
    aprobados: conNota.filter(f => Number(f.nota_final) >= NOTA_APROBADO).length,
    aplazados: conNota.filter(f => Number(f.nota_final) < NOTA_APROBADO).length,
    notaPromedio: prom(conNota.map(f => Number(f.nota_final))),
    ponderadoPromedio: prom(
      conNota.map(f => Number(f.cumplimiento_ponderado)).filter(v => !Number.isNaN(v)),
    ),
    coberturaPromedio: prom(
      filas.map(f => Number(f.cobertura)).filter(v => !Number.isNaN(v)),
    ),
    conTope: conNota.filter(f => lista(f.faltas).length > 0).length,
    distribucion,
    dimensiones,
  }
}

export interface PuntoEvolucion {
  periodo: string
  notaPromedio: number | null
  ponderadoPromedio: number | null
  evaluados: number
}

/**
 * La serie mensual.
 *
 * Con un solo mes devuelve un solo punto y nada más. No se dibuja una
 * tendencia con un punto: dos meses son el mínimo para poder decir "mejoró", y
 * decirlo antes sería inventarlo.
 */
export function evolucionMensual(filas: readonly FilaPublicada[]): PuntoEvolucion[] {
  const porPeriodo = new Map<string, FilaPublicada[]>()
  for (const f of filas) {
    if (!porPeriodo.has(f.periodo)) porPeriodo.set(f.periodo, [])
    porPeriodo.get(f.periodo)!.push(f)
  }

  return Array.from(porPeriodo.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([periodo, fs]) => {
      const r = resumirGerencia(fs, periodo)
      return {
        periodo,
        notaPromedio: r.notaPromedio,
        ponderadoPromedio: r.ponderadoPromedio,
        evaluados: r.conNota,
      }
    })
}

export const hayTendencia = (serie: readonly PuntoEvolucion[]): boolean => serie.length >= 2
