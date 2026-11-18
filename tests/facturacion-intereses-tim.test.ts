// Intereses por mora con la Tasa de Intereses Moratorios (TIM) del BCRA (CCyC art. 768 inc. c). Gerencia,
// 18/11/2026: "mejor esta tasa" → la de la calculadora oficial del BCRA. SÓLO CÁLCULO.
// Valores reales de la serie 1197 (API v4.0) del 30/10 al 18/11/2026.
import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { coeficienteTim, interesConTim, ordenarSerie, valorDelDia } from '@/lib/facturacion/intereses-variables'
import { CALCULADORA_TIM, TIM_VARIABLE, parsearSerieBcra, urlSerieBcra } from '@/lib/facturacion/serie-bcra'

const TIM = ordenarSerie(([
  ['2026-10-30', 171008.2888], ['2026-10-31', 171126.3063], ['2026-11-01', 171244.4052], ['2026-11-02', 171362.5856], ['2026-11-03', 171480.8475],
  ['2026-11-04', 171599.1909], ['2026-11-05', 171717.616], ['2026-11-06', 171836.1228], ['2026-11-07', 171954.7113], ['2026-11-08', 172073.3816],
  ['2026-11-09', 172192.1337], ['2026-11-10', 172310.9677], ['2026-11-11', 172429.8837], ['2026-11-12', 172548.8817], ['2026-11-13', 172667.9618],
  ['2026-11-14', 172787.124], ['2026-11-15', 172906.3684], ['2026-11-16', 173025.6951], ['2026-11-17', 173145.1041], ['2026-11-18', 173284.9386],
] as Array<[string, number]>).map(([fecha, valor]) => ({ fecha, valor })))
const S = 1000000000 // $ 10.000.000 en centavos

describe('TIM: la cuenta de la calculadora oficial del BCRA', () => {
  it('coeficiente = (100 + TIM del día de cierre) / (100 + TIM del día anterior al inicio)', () => {
    expect(coeficienteTim(TIM, '2026-11-01', '2026-11-10')).toBeCloseTo((100 + 172310.9677) / (100 + 171126.3063), 12)
    expect(coeficienteTim(TIM, '2026-10-01', '2026-11-10')).toBeNull() // la serie de prueba empieza el 30/10
  })
  it('valor del día: el publicado o, si todavía no hay, el último anterior', () => {
    expect(valorDelDia(TIM, '2026-11-05')).toBe(171717.616)
    expect(valorDelDia(TIM, '2026-11-19')).toBe(173284.9386)
    expect(valorDelDia(TIM, '2026-10-29')).toBeNull()
  })
  it('lee la serie 1197 de la API v4.0 (la misma URL que la calculadora)', () => {
    const json = { status: 200, metadata: { resultset: { count: 2 } }, results: [{ idVariable: 1197, detalle: [{ fecha: '2026-11-18', valor: 173284.9386 }, { fecha: '2026-11-17', valor: 173145.1041 }] }] }
    expect(parsearSerieBcra(json)).toEqual({ total: 2, puntos: [{ fecha: '2026-11-17', valor: 173145.1041 }, { fecha: '2026-11-18', valor: 173284.9386 }] })
    expect(TIM_VARIABLE).toBe(1197)
    expect(urlSerieBcra(1197, '2026-10-31', '2026-11-18')).toBe('https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/1197?desde=2026-10-31&hasta=2026-11-18&limit=3000&offset=0')
    expect(CALCULADORA_TIM).toBe('https://www.bcra.gob.ar/calculadora-de-tasa-de-intereses-moratorios-tim/')
  })
})

describe('interés por mora de una factura (inicio = día siguiente al vencimiento; cierre = día del pago)', () => {
  it('pagada fuera de término: igual que la calculadora con inicio 01/11 y cierre 10/11', () => {
    const r = interesConTim({ total_c: S, vencimiento: '2026-10-31', movimientos: [{ fecha: '2026-11-10', importe_c: -S }], hasta: '2026-11-18', serie: TIM })
    expect(r.tramos).toHaveLength(1)
    expect(r.tramos[0]).toMatchObject({ desde: '2026-11-01', hasta: '2026-11-10', dias: 10, saldo_c: S, interes_c: 6918688 })
    expect(r.interes_c).toBe(Math.round(S * ((100 + 172310.9677) / (100 + 171126.3063) - 1)))
    expect(r.dias_mora).toBe(10)
  })
  it('todavía impaga: hasta la fecha de cálculo', () => {
    const r = interesConTim({ total_c: S, vencimiento: '2026-10-31', movimientos: [], hasta: '2026-11-18', serie: TIM })
    expect(r.tramos.map(t => [t.desde, t.hasta, t.dias, t.interes_c])).toEqual([['2026-11-01', '2026-11-18', 18, 12606896]])
    expect(r.tramos[0].tna_equivalente).toBeGreaterThan(20)
  })
  it('pagos parciales: el pago cierra el tramo ese día y el saldo nuevo corre desde el siguiente', () => {
    const r = interesConTim({ total_c: S, vencimiento: '2026-10-31', movimientos: [{ fecha: '2026-11-05', importe_c: -S / 2 }], hasta: '2026-11-18', serie: TIM })
    expect(r.tramos.map(t => [t.desde, t.hasta, t.saldo_c, t.interes_c])).toEqual([['2026-11-01', '2026-11-05', S, 3453381], ['2026-11-06', '2026-11-18', S / 2, 4561007]])
    expect(r.interes_c).toBe(3453381 + 4561007)
  })
  it('pagada el día del vencimiento: sin interés; un día después: un día', () => {
    expect(interesConTim({ total_c: S, vencimiento: '2026-10-31', movimientos: [{ fecha: '2026-10-31', importe_c: -S }], hasta: '2026-11-18', serie: TIM }).interes_c).toBe(0)
    const r = interesConTim({ total_c: S, vencimiento: '2026-10-31', movimientos: [{ fecha: '2026-11-01', importe_c: -S }], hasta: '2026-11-18', serie: TIM })
    expect(r.tramos.map(t => [t.desde, t.hasta, t.dias, t.interes_c])).toEqual([['2026-11-01', '2026-11-01', 1, 689724]])
  })
  it('días de gracia: el inicio se corre', () => {
    const r = interesConTim({ total_c: S, vencimiento: '2026-10-31', graciaDias: 5, movimientos: [], hasta: '2026-11-18', serie: TIM })
    expect(r.desde).toBe('2026-11-06')
    expect(r.interes_c).toBe(9122013)
  })
  it('una nota de débito suma al saldo desde el día siguiente', () => {
    const r = interesConTim({ total_c: S, vencimiento: '2026-10-31', hasta: '2026-11-04', serie: TIM,
      movimientos: [{ fecha: '2026-11-02', importe_c: S }, { fecha: '2026-11-04', importe_c: -2 * S }] })
    expect(r.tramos.map(t => [t.desde, t.hasta, t.saldo_c, t.interes_c])).toEqual([['2026-11-01', '2026-11-02', S, 1379924], ['2026-11-03', '2026-11-04', 2 * S, 2759848]])
  })
  it('sin mora todavía, o sin dato de la TIM: no calcula', () => {
    expect(interesConTim({ total_c: S, vencimiento: '2026-12-31', movimientos: [], hasta: '2026-11-18', serie: TIM }).tramos).toEqual([])
    const r = interesConTim({ total_c: S, vencimiento: '2026-09-30', movimientos: [], hasta: '2026-11-18', serie: TIM })
    expect(r.sin_dato).toBe(true)
    expect(r.interes_c).toBe(0)
  })
})

describe('sólo lectura', () => {
  const leer = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
  it('la ruta de las series del BCRA sólo lee, exige Gerencia o Administración y sólo pide BADLAR o TIM', () => {
    const src = leer('app/api/facturacion/serie-bcra/route.ts')
    expect(src).toMatch(/facturacion_puede_actual/)
    expect(src).toMatch(/esSerieBcra\(serie\)/)
    expect(src).toMatch(/urlSerieBcra\(variable/)
    expect(src).not.toMatch(/\.(insert|update|upsert|delete)\(|export async function (POST|PUT|PATCH|DELETE)/)
    expect(src.match(/\.rpc\('/g)).toHaveLength(1)
  })
  it('la pantalla de intereses no registra intereses ni pide notas de débito (sólo guarda la tasa general)', () => {
    const src = leer('components/facturacion/InteresesMora.tsx')
    // Ninguna escritura salvo la tasa general: ni intereses/notas de la base, ni emisión, ni escrituras directas.
    expect(Array.from(src.matchAll(/\brpc\('([a-z_]+)'/g), m => m[1])).toEqual(['fact_intereses_config_guardar'])
    expect(src).not.toMatch(/['"`]fact_interes_(calcular|registrar)|['"`]fact_nota_|['"`]emitir|\.(insert|update|upsert|delete)\(/)
    expect(src).toMatch(/informativos/)
    expect(src).toMatch(/avisarle al cliente/)
    expect(leer('components/facturacion/Cobranzas.tsx')).toMatch(/<InteresesMora \/>/)
  })
})
