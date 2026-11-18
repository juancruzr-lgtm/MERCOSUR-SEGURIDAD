// Tasa de los intereses por mora INFORMATIVOS de Cobranzas (sólo para avisarle al cliente; no se registran ni se
// facturan). Gerencia, 18/11/2026: "en principio la BADLAR corregida para todos y que se pueda cambiar en contratos".
//  · Tasa general: fact_config.intereses, BADLAR de bancos privados × factor (arranca en × 1; la cambia Gerencia).
//  · Cada contrato puede tener la suya (fact_contratos.mora_tasa_tipo): BADLAR × su factor, TIM del BCRA, tasa fija
//    pactada (mora_tasa / mora_tasa_periodo) o sin intereses. Vacío = la general. 20261214110000.

export type TipoTasa = 'badlar' | 'tim' | 'fija' | 'sin_interes'
export type PeriodoTasa = 'anual' | 'mensual' | 'diaria'
export type TasaMora =
  | { tipo: 'badlar'; factor: number }
  | { tipo: 'tim' }
  | { tipo: 'fija'; tasa: number; periodo: PeriodoTasa }
  | { tipo: 'sin_interes' }

/** La tasa general con la que arranca (y la que se usa si no se puede leer): BADLAR × 1. */
export const TASA_GENERAL_INICIAL: TasaMora = { tipo: 'badlar', factor: 1 }

/** Campos de intereses de fact_contratos. */
export interface ContratoMora {
  id: string
  mora_tasa_tipo?: string | null
  mora_tasa_factor?: number | string | null
  mora_tasa?: number | string | null
  mora_tasa_periodo?: string | null
  mora_gracia_dias?: number | string | null
}

export const TIPOS_TASA: Record<TipoTasa, string> = {
  badlar: 'BADLAR × factor', tim: 'TIM del BCRA', fija: 'Tasa fija pactada', sin_interes: 'Sin intereses',
}
const PERIODOS: PeriodoTasa[] = ['anual', 'mensual', 'diaria']
const numero = (x: unknown): number | null => {
  if (x == null || x === '') return null
  const n = Number(String(x).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

/** Una tasa guardada (fact_config.intereses o la del contrato) → TasaMora; null si no es válida. */
export function leerTasa(v: { tipo?: unknown; factor?: unknown; tasa?: unknown; periodo?: unknown } | null | undefined): TasaMora | null {
  switch (v?.tipo) {
    case 'badlar': {
      const f = numero(v.factor)
      return f != null && f > 0 && f <= 10 ? { tipo: 'badlar', factor: f } : null
    }
    case 'tim': return { tipo: 'tim' }
    case 'sin_interes': return { tipo: 'sin_interes' }
    case 'fija': {
      const t = numero(v.tasa)
      return t != null && t > 0 && PERIODOS.includes(v.periodo as PeriodoTasa) ? { tipo: 'fija', tasa: t, periodo: v.periodo as PeriodoTasa } : null
    }
    default: return null
  }
}

/** La tasa general (valor de fact_config.intereses); si falta o no se entiende, BADLAR × 1. */
export const tasaGeneral = (valor: unknown): TasaMora => leerTasa(valor as any) ?? TASA_GENERAL_INICIAL

/**
 * Tasa con la que se calculan los intereses de las facturas de un contrato: la suya o, si no tiene, la general.
 * BADLAR sin factor propio usa el de la general. Los días de gracia salen del contrato (0 si no hay contrato).
 */
export function tasaDelContrato(k: ContratoMora | null | undefined, general: TasaMora): { tasa: TasaMora; propia: boolean; graciaDias: number } {
  const graciaDias = Math.max(0, Math.trunc(Number(k?.mora_gracia_dias ?? 0)) || 0)
  if (!k?.mora_tasa_tipo) return { tasa: general, propia: false, graciaDias }
  const factorGeneral = general.tipo === 'badlar' ? general.factor : 1
  const propia = leerTasa({ tipo: k.mora_tasa_tipo, factor: k.mora_tasa_factor ?? factorGeneral, tasa: k.mora_tasa, periodo: k.mora_tasa_periodo })
  return propia ? { tasa: propia, propia: true, graciaDias } : { tasa: general, propia: false, graciaDias }
}

const n = (x: number) => x.toLocaleString('es-AR', { maximumFractionDigits: 4 })

/** "BADLAR de bancos privados × 1,5 (BCRA)", "TIM del BCRA (…)", "3 % mensual (tasa pactada)", "sin intereses". */
export function describirTasa(t: TasaMora): string {
  switch (t.tipo) {
    case 'badlar': return t.factor === 1 ? 'BADLAR de bancos privados (BCRA)' : `BADLAR de bancos privados × ${n(t.factor)} (BCRA)`
    case 'tim': return 'TIM del BCRA (CCyC art. 768 inc. c)'
    case 'fija': return `${n(t.tasa)} % ${t.periodo} (tasa pactada)`
    case 'sin_interes': return 'sin intereses'
  }
}

/** Resumen de la tasa de un contrato para la lista de contratos ("tasa general", "BADLAR × 1,2", …). */
export function describirTasaContrato(k: ContratoMora): string {
  const gracia = Number(k.mora_gracia_dias) > 0 ? `, ${Number(k.mora_gracia_dias)} días de gracia` : ''
  if (!k.mora_tasa_tipo) return `intereses con la tasa general${gracia}`
  if (k.mora_tasa_tipo === 'badlar' && numero(k.mora_tasa_factor) == null) return `intereses BADLAR con el factor de la general${gracia}`
  const t = leerTasa({ tipo: k.mora_tasa_tipo, factor: k.mora_tasa_factor, tasa: k.mora_tasa, periodo: k.mora_tasa_periodo })
  if (!t) return `intereses: tasa incompleta (se usa la general)${gracia}`
  if (t.tipo === 'sin_interes') return 'sin intereses'
  return `intereses ${t.tipo === 'badlar' ? `BADLAR × ${n(t.factor)}` : t.tipo === 'tim' ? 'TIM del BCRA' : `${n(t.tasa)} % ${t.periodo} (pactada)`}${gracia}`
}
