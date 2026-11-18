// Intereses por mora con la BADLAR del BCRA (Gerencia, 18/11/2026): SÓLO CÁLCULO, mismas reglas que
// public.fact_interes_calcular pero con la tasa de cada día (× factor + puntos).
import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { corregirTasa, interesConTasaVariable, ordenarSerie, tasaDelDia } from '@/lib/facturacion/intereses-variables'
import { BADLAR_VARIABLE, parsearSerieBcra, urlSerieBcra } from '@/lib/facturacion/badlar'

const constante = (valor: number) => [{ fecha: '2026-01-01', valor }]

describe('serie diaria del BCRA', () => {
  it('cada día usa la tasa del último día hábil publicado', () => {
    const s = ordenarSerie([{ fecha: '2026-11-02', valor: 30 }, { fecha: '2026-10-30', valor: 40 }, { fecha: '2026-11-02', valor: 30 }])
    expect(s).toEqual([{ fecha: '2026-10-30', valor: 40 }, { fecha: '2026-11-02', valor: 30 }])
    expect(tasaDelDia(s, '2026-10-30')).toBe(40)
    expect(tasaDelDia(s, '2026-11-01')).toBe(40) // domingo: la del viernes
    expect(tasaDelDia(s, '2026-11-05')).toBe(30)
    expect(tasaDelDia(s, '2026-10-29')).toBeNull()
  })
  it('lee la respuesta de la API v4.0 (variable 7, BADLAR bancos privados, % nominal anual)', () => {
    const json = { status: 200, metadata: { resultset: { count: 3, offset: 0, limit: 3000 } },
      results: [{ idVariable: 7, detalle: [{ fecha: '2026-11-16', valor: 22.6875 }, { fecha: '2026-11-13', valor: 22.4375 }, { fecha: '2026-11-12', valor: 22.125 }] }] }
    expect(parsearSerieBcra(json)).toEqual({ total: 3, puntos: [{ fecha: '2026-11-12', valor: 22.125 }, { fecha: '2026-11-13', valor: 22.4375 }, { fecha: '2026-11-16', valor: 22.6875 }] })
    expect(parsearSerieBcra({}).puntos).toEqual([])
    expect(BADLAR_VARIABLE).toBe(7)
    expect(urlSerieBcra(7, '2026-08-01', '2026-11-18')).toBe('https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/7?desde=2026-08-01&hasta=2026-11-18&limit=3000&offset=0')
  })
  it('corrección: tasa × factor + puntos', () => {
    expect(corregirTasa(22.5, { factor: 1, puntos: 0 })).toBe(22.5)
    expect(corregirTasa(20, { factor: 1.5, puntos: 2 })).toBe(32)
  })
})

describe('interés con tasa variable (mismas reglas que fact_interes_calcular)', () => {
  it('pagada fuera de término: desde el día siguiente al vencimiento hasta el día anterior al cobro', () => {
    // Vence 31/10, se paga entero el 10/11: mora del 01/11 al 09/11 = 9 días. Con tasa fija da lo mismo que la base:
    // round(1.000.000 × 36,5 × 9 / 36.500) = 9.000 centavos.
    const r = interesConTasaVariable({ total_c: 1000000, vencimiento: '2026-10-31', movimientos: [{ fecha: '2026-11-10', importe_c: -1000000 }], hasta: '2026-11-18', serie: constante(36.5) })
    expect(r.tramos).toEqual([{ desde: '2026-11-01', hasta: '2026-11-09', dias: 9, saldo_c: 1000000, tasa_promedio: 36.5, interes_c: 9000 }])
    expect(r.interes_c).toBe(9000)
    expect(r.dias_mora).toBe(9)
  })
  it('pagos parciales: un tramo por saldo', () => {
    const r = interesConTasaVariable({ total_c: 1000000, vencimiento: '2026-10-31', hasta: '2026-11-30', serie: constante(36.5),
      movimientos: [{ fecha: '2026-11-05', importe_c: -500000 }, { fecha: '2026-11-15', importe_c: -500000 }] })
    expect(r.tramos.map(t => [t.desde, t.hasta, t.dias, t.saldo_c, t.interes_c])).toEqual([
      ['2026-11-01', '2026-11-04', 4, 1000000, 4000], ['2026-11-05', '2026-11-14', 10, 500000, 5000]])
    expect(r.interes_c).toBe(9000)
  })
  it('tasa que cambia: cada día la suya (fin de semana con la del viernes)', () => {
    const serie = ordenarSerie([{ fecha: '2026-10-30', valor: 40 }, { fecha: '2026-11-02', valor: 30 }])
    const r = interesConTasaVariable({ total_c: 3650000, vencimiento: '2026-10-31', movimientos: [], hasta: '2026-11-03', serie })
    // 01/11 al 40 % (4.000) + 02/11 y 03/11 al 30 % (3.000 c/u)
    expect(r.interes_c).toBe(10000)
    expect(r.tramos).toHaveLength(1)
    expect(r.tramos[0].tasa_promedio).toBeCloseTo(33.3333, 3)
  })
  it('corrección y días de gracia', () => {
    const r = interesConTasaVariable({ total_c: 3650000, vencimiento: '2026-10-31', graciaDias: 5, movimientos: [], hasta: '2026-11-06', serie: constante(20), correccion: { factor: 1.5, puntos: 2 } })
    expect(r.desde).toBe('2026-11-06')
    expect(r.tramos).toEqual([{ desde: '2026-11-06', hasta: '2026-11-06', dias: 1, saldo_c: 3650000, tasa_promedio: 32, interes_c: 3200 }])
  })
  it('una nota de débito suma al saldo desde su fecha; una NC resta', () => {
    const r = interesConTasaVariable({ total_c: 1000000, vencimiento: '2026-10-31', hasta: '2026-11-04', serie: constante(36.5),
      movimientos: [{ fecha: '2026-11-03', importe_c: 1000000 }, { fecha: '2026-11-04', importe_c: -2000000 }] })
    expect(r.tramos.map(t => [t.desde, t.hasta, t.saldo_c, t.interes_c])).toEqual([['2026-11-01', '2026-11-02', 1000000, 2000], ['2026-11-03', '2026-11-03', 2000000, 2000]])
  })
  it('sin mora: pagada a tiempo, el primer día de mora o todavía no vencida', () => {
    expect(interesConTasaVariable({ total_c: 1000000, vencimiento: '2026-10-31', movimientos: [{ fecha: '2026-10-31', importe_c: -1000000 }], hasta: '2026-11-18', serie: constante(30) }).interes_c).toBe(0)
    expect(interesConTasaVariable({ total_c: 1000000, vencimiento: '2026-10-31', movimientos: [{ fecha: '2026-11-01', importe_c: -1000000 }], hasta: '2026-11-18', serie: constante(30) }).interes_c).toBe(0)
    expect(interesConTasaVariable({ total_c: 1000000, vencimiento: '2026-12-31', movimientos: [], hasta: '2026-11-18', serie: constante(30) }).tramos).toEqual([])
  })
  it('los días sin tasa publicada no se cuentan (y se informan)', () => {
    const r = interesConTasaVariable({ total_c: 3650000, vencimiento: '2026-10-31', movimientos: [], hasta: '2026-11-03', serie: [{ fecha: '2026-11-03', valor: 36.5 }] })
    expect(r.dias_sin_tasa).toBe(2)
    expect(r.interes_c).toBe(3650)
  })
})

describe('sólo lectura', () => {
  const leer = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
  it('la ruta de la BADLAR sólo lee del BCRA y exige Gerencia o Administración', () => {
    const src = leer('app/api/facturacion/badlar/route.ts')
    expect(src).toMatch(/facturacion_puede_actual/)
    expect(src).toMatch(/urlSerieBcra\(BADLAR_VARIABLE/)
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(|export async function (POST|PUT|PATCH|DELETE)/)
    expect(src.match(/\.rpc\('/g)).toHaveLength(1)
  })
  it('la pantalla de intereses no registra intereses ni pide notas de débito', () => {
    const src = leer('components/facturacion/InteresesBadlar.tsx')
    // Ninguna llamada que escriba: ni RPC, ni intereses/notas de la base, ni emisión, ni escrituras directas.
    expect(src).not.toMatch(/\brpc\(|['"`]fact_interes_|['"`]fact_nota_|['"`]emitir|\.(insert|update|upsert|delete)\(/)
    expect(src).not.toMatch(/import \{[^}]*\brpc\b/)
    expect(src).toMatch(/sólo cálculo/i)
    expect(leer('components/facturacion/Cobranzas.tsx')).toMatch(/<InteresesBadlar \/>/)
  })
})
