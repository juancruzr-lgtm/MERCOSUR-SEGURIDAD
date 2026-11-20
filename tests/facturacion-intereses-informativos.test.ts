// Intereses por mora INFORMATIVOS en Cobranzas. Gerencia, 18/11/2026: "que me figure en la parte de cobros, que uses
// en principio la tasa BADLAR corregida para todos y que esta tasa se pueda cambiar en contratos … se va a aplicar
// efectivamente el día del cobro … pero nos debe mostrar a la fecha el acumulado de intereses y también debe permitir
// no cobrarlo" + "que sea sólo de vista para avisarle al cliente". BADLAR corregida = BADLAR × factor (× 1 al empezar).
// Valores reales de la BADLAR de bancos privados (serie 7 de la API v4.0 del BCRA) del 20/10 al 16/11/2026.
import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import { conVencimiento, type CondicionesPago } from '@/lib/facturacion/estado-cobro'
import { interesConTasa, ordenarSerie, tramosDeMora } from '@/lib/facturacion/intereses-variables'
import { calcularIntereses, seriesNecesarias, textoParaCliente, totalIntereses, type DatosIntereses } from '@/lib/facturacion/intereses-cobranzas'
import { BADLAR_VARIABLE, SERIES_BCRA, esSerieBcra, urlSerieBcra } from '@/lib/facturacion/serie-bcra'
import { TASA_GENERAL_INICIAL, describirTasa, describirTasaContrato, leerTasa, tasaDelContrato, tasaGeneral, type TasaMora } from '@/lib/facturacion/tasa-mora'
import { formatoPesos } from '@/lib/facturacion/dinero'

const BADLAR = ordenarSerie(([
  ['2026-10-20', 23.25], ['2026-10-21', 22.375], ['2026-10-22', 22.9375], ['2026-10-23', 23.0625], ['2026-10-26', 22.1875], ['2026-10-27', 23.5],
  ['2026-10-28', 22.1875], ['2026-10-29', 23.125], ['2026-10-30', 22.75], ['2026-11-02', 22.3125], ['2026-11-03', 22.75], ['2026-11-04', 21.5],
  ['2026-11-05', 22.5], ['2026-11-11', 22.375], ['2026-11-12', 22.125], ['2026-11-13', 22.4375], ['2026-11-16', 22.6875],
] as Array<[string, number]>).map(([fecha, valor]) => ({ fecha, valor })))
const S = 1000000000 // $ 10.000.000 en centavos
const BADLAR_X1: TasaMora = { tipo: 'badlar', factor: 1 }
// Tasa de cada día (la del último día hábil): el 01/11 (domingo) rige la del viernes 30/10; del 06 al 10/11 no hubo
// publicación y rige la del 05/11; sábado y domingo, la del viernes; el 17 y el 18/11, la del 16/11.
const SUMA_01_05 = 22.75 + 22.3125 + 22.75 + 21.5 + 22.5 // 111,8125
const SUMA_01_10 = SUMA_01_05 + 22.5 * 5 // 224,3125
const SUMA_01_18 = SUMA_01_10 + 22.375 + 22.125 + 22.4375 * 3 + 22.6875 * 3 // 404,1875

describe('BADLAR corregida (BADLAR × factor): interés simple día por día', () => {
  it('pagada el 10/11, vencida el 31/10: 10 días, el del pago incluido, con la tasa del último día hábil', () => {
    const r = interesConTasa({ total_c: S, vencimiento: '2026-10-31', movimientos: [{ fecha: '2026-11-10', importe_c: -S }], hasta: '2026-11-18', tasa: BADLAR_X1, series: { badlar: BADLAR } })
    expect(r.tramos).toHaveLength(1)
    expect(r.tramos[0]).toMatchObject({ desde: '2026-11-01', hasta: '2026-11-10', dias: 10, saldo_c: S, tna_equivalente: 22.43 })
    expect(r.interes_c).toBe(Math.round((S * SUMA_01_10) / 36500))
    expect(r.interes_c).toBe(6145548) // $ 61.455,48 sobre $ 10.000.000
    expect(r.dias_mora).toBe(10)
  })
  it('el factor corrige la tasa (× 1,5)', () => {
    const r = interesConTasa({ total_c: S, vencimiento: '2026-10-31', movimientos: [{ fecha: '2026-11-10', importe_c: -S }], hasta: '2026-11-18', tasa: { tipo: 'badlar', factor: 1.5 }, series: { badlar: BADLAR } })
    expect(r.interes_c).toBe(Math.round((S * SUMA_01_10 * 1.5) / 36500))
    expect(r.tramos[0].tna_equivalente).toBe(33.65)
  })
  it('todavía impaga: lo acumulado a la fecha (hoy cuenta)', () => {
    const r = interesConTasa({ total_c: S, vencimiento: '2026-10-31', movimientos: [], hasta: '2026-11-18', tasa: BADLAR_X1, series: { badlar: BADLAR } })
    expect(r.tramos.map(t => [t.desde, t.hasta, t.dias])).toEqual([['2026-11-01', '2026-11-18', 18]])
    expect(r.interes_c).toBe(Math.round((S * SUMA_01_18) / 36500))
  })
  it('pago parcial: cierra el tramo ese día y el saldo nuevo corre desde el siguiente', () => {
    const r = interesConTasa({ total_c: S, vencimiento: '2026-10-31', movimientos: [{ fecha: '2026-11-05', importe_c: -S / 2 }], hasta: '2026-11-18', tasa: BADLAR_X1, series: { badlar: BADLAR } })
    expect(r.tramos.map(t => [t.desde, t.hasta, t.saldo_c, t.interes_c])).toEqual([
      ['2026-11-01', '2026-11-05', S, Math.round((S * SUMA_01_05) / 36500)],
      ['2026-11-06', '2026-11-18', S / 2, Math.round(((S / 2) * (SUMA_01_18 - SUMA_01_05)) / 36500)],
    ])
  })
  it('sin dato de la BADLAR (antes del comienzo de la serie): no se cuenta y se avisa', () => {
    const r = interesConTasa({ total_c: S, vencimiento: '2026-09-30', movimientos: [], hasta: '2026-11-18', tasa: BADLAR_X1, series: { badlar: BADLAR } })
    expect(r.sin_dato).toBe(true)
    expect(r.interes_c).toBe(0)
    expect(interesConTasa({ total_c: S, vencimiento: '2026-10-31', movimientos: [], hasta: '2026-11-18', tasa: BADLAR_X1, series: {} }).sin_dato).toBe(true)
  })
})

describe('tasa fija pactada, sin intereses y tramos', () => {
  it('3 % mensual: saldo × tasa × días / 3.000 (como fact_interes_calcular)', () => {
    const r = interesConTasa({ total_c: S, vencimiento: '2026-10-31', movimientos: [{ fecha: '2026-11-10', importe_c: -S }], hasta: '2026-11-18', tasa: { tipo: 'fija', tasa: 3, periodo: 'mensual' }, series: {} })
    expect(r.interes_c).toBe(10000000)
    expect(r.tramos[0].tna_equivalente).toBe(36.5)
    expect(interesConTasa({ total_c: S, vencimiento: '2026-10-31', movimientos: [], hasta: '2026-11-01', tasa: { tipo: 'fija', tasa: 36.5, periodo: 'anual' }, series: {} }).interes_c).toBe(1000000)
  })
  it('sin intereses: cero, sin tramos', () => {
    const r = interesConTasa({ total_c: S, vencimiento: '2026-10-31', movimientos: [], hasta: '2026-11-18', tasa: { tipo: 'sin_interes' }, series: {} })
    expect(r).toMatchObject({ interes_c: 0, tramos: [], sin_dato: false })
  })
  it('tramos: días de gracia, ND que suma, pagos fuera de la mora y fechas inválidas', () => {
    const t = tramosDeMora({ total_c: S, vencimiento: '2026-10-31', graciaDias: 5, hasta: '2026-11-18', movimientos: [
      { fecha: '2026-10-20', importe_c: -S / 4 }, { fecha: '2026-11-08', importe_c: S / 4 }, { fecha: '', importe_c: -S }, { fecha: '2026-12-01', importe_c: -S }] })
    expect(t.desde).toBe('2026-11-06')
    expect(t.tramos.map(x => [x.desde, x.hasta, x.saldo_c])).toEqual([['2026-11-06', '2026-11-08', 0.75 * S], ['2026-11-09', '2026-11-18', S]])
  })
})

describe('tasa general y tasa de cada contrato', () => {
  it('la general arranca en BADLAR × 1 y la cambia Gerencia (fact_config.intereses)', () => {
    expect(TASA_GENERAL_INICIAL).toEqual({ tipo: 'badlar', factor: 1 })
    expect(tasaGeneral(undefined)).toEqual(BADLAR_X1)
    expect(tasaGeneral({ tipo: 'badlar', factor: 1.5 })).toEqual({ tipo: 'badlar', factor: 1.5 })
    expect(tasaGeneral({ tipo: 'tim' })).toEqual({ tipo: 'tim' })
    expect(tasaGeneral({ tipo: 'fija', tasa: 3 })).toEqual(BADLAR_X1) // sin período no se entiende: queda la inicial
    expect(leerTasa({ tipo: 'badlar', factor: 0 })).toBeNull()
    expect(leerTasa({ tipo: 'badlar', factor: '1,25' })).toEqual({ tipo: 'badlar', factor: 1.25 })
    expect(leerTasa({ tipo: 'otra' })).toBeNull()
  })
  it('el contrato sin tasa propia usa la general; con tasa propia, la suya; la gracia sale del contrato', () => {
    const general: TasaMora = { tipo: 'badlar', factor: 1.5 }
    expect(tasaDelContrato(null, general)).toEqual({ tasa: general, propia: false, graciaDias: 0 })
    expect(tasaDelContrato({ id: 'k', mora_tasa_tipo: null, mora_gracia_dias: 5 }, general)).toEqual({ tasa: general, propia: false, graciaDias: 5 })
    expect(tasaDelContrato({ id: 'k', mora_tasa_tipo: 'badlar', mora_tasa_factor: '1.2000' }, general).tasa).toEqual({ tipo: 'badlar', factor: 1.2 })
    expect(tasaDelContrato({ id: 'k', mora_tasa_tipo: 'badlar', mora_tasa_factor: null }, general).tasa).toEqual({ tipo: 'badlar', factor: 1.5 })
    expect(tasaDelContrato({ id: 'k', mora_tasa_tipo: 'tim' }, general)).toMatchObject({ tasa: { tipo: 'tim' }, propia: true })
    expect(tasaDelContrato({ id: 'k', mora_tasa_tipo: 'fija', mora_tasa: '3.0000', mora_tasa_periodo: 'mensual' }, general).tasa).toEqual({ tipo: 'fija', tasa: 3, periodo: 'mensual' })
    expect(tasaDelContrato({ id: 'k', mora_tasa_tipo: 'sin_interes' }, general).tasa).toEqual({ tipo: 'sin_interes' })
  })
  it('textos de la tasa', () => {
    expect(describirTasa(BADLAR_X1)).toBe('BADLAR de bancos privados (BCRA)')
    expect(describirTasa({ tipo: 'badlar', factor: 1.5 })).toBe('BADLAR de bancos privados × 1,5 (BCRA)')
    expect(describirTasa({ tipo: 'fija', tasa: 3, periodo: 'mensual' })).toBe('3 % mensual (tasa pactada)')
    expect(describirTasaContrato({ id: 'k' })).toBe('intereses con la tasa general')
    expect(describirTasaContrato({ id: 'k', mora_tasa_tipo: 'badlar', mora_tasa_factor: '1.2000', mora_gracia_dias: 5 })).toBe('intereses BADLAR × 1,2, 5 días de gracia')
    expect(describirTasaContrato({ id: 'k', mora_tasa_tipo: 'sin_interes' })).toBe('sin intereses')
  })
})

describe('Cobranzas: el interés de cada factura a la fecha', () => {
  const cond: CondicionesPago = {
    contratos: [
      { id: 'k1', cliente_id: 'c1', estado: 'vigente', pago_evento: 'emision', dias_vencimiento: 30, pago_dia_mes: null },
      { id: 'k2', cliente_id: 'c2', estado: 'vigente', pago_evento: 'emision', dias_vencimiento: 30, pago_dia_mes: null },
    ],
    contratoDePrefactura: new Map(), prefacturaDeComprobante: new Map(), seguimiento: new Map(),
  }
  const fila = (id: string, cliente: string, tipo: number, emision: string, aplicado: number) =>
    ({ comprobante_id: id, cliente_id: cliente, tipo, fecha_emision: emision, vto_pago: null, total_c: S, nc_c: 0, nd_c: 0, aplicado_c: aplicado, saldo_c: S - aplicado })
  const filas = conVencimiento([
    fila('impaga', 'c1', 1, '2026-10-01', 0), // vence el 31/10 (30 días desde la emisión), tasa general
    fila('pactada', 'c2', 1, '2026-10-01', 0), // contrato con tasa fija propia
    fila('pagada', 'c1', 1, '2026-10-01', S), // pagada el 10/11
    fila('por_vencer', 'c1', 1, '2026-11-10', 0),
    fila('nota_suelta', 'c1', 2, '2026-10-01', 0),
    fila('retenciones', 'c1', 1, '2026-10-01', 0.8 * S), // cobrado el 80 % el 05/11: lo demás son retenciones
  ], cond)
  const datos = (general: TasaMora = BADLAR_X1): DatosIntereses => ({
    general,
    contratos: new Map([['k1', { id: 'k1', mora_tasa_tipo: null, mora_gracia_dias: 0 }], ['k2', { id: 'k2', mora_tasa_tipo: 'fija', mora_tasa: '3', mora_tasa_periodo: 'mensual', mora_gracia_dias: 0 }]]),
    movs: new Map([['pagada', [{ fecha: '2026-11-10', importe_c: -S }]], ['retenciones', [{ fecha: '2026-11-05', importe_c: -0.8 * S }]]]),
    ultimoCobro: new Map([['pagada', '2026-11-10'], ['retenciones', '2026-11-05']]),
    noCobrar: new Map([['impaga', { motivo: 'Acordado con el cliente', at: null }]]),
  })
  const pf = calcularIntereses(filas, cond, datos(), { badlar: BADLAR }, '2026-11-18')

  it('sólo facturas en mora: ni las por vencer ni las notas sueltas', () => {
    expect(Array.from(pf.keys()).sort()).toEqual(['impaga', 'pactada', 'pagada', 'retenciones'])
  })
  it('impaga: con la tasa general, lo acumulado a hoy; queda marcada «no cobrar» con su motivo', () => {
    expect(pf.get('impaga')).toMatchObject({ tasa: BADLAR_X1, propia: false, vencimiento: '2026-10-31', cerradaEl: null, interes_c: Math.round((S * SUMA_01_18) / 36500), noCobrar: { motivo: 'Acordado con el cliente' } })
  })
  it('contrato con tasa propia: la del contrato', () => {
    expect(pf.get('pactada')).toMatchObject({ tasa: { tipo: 'fija', tasa: 3, periodo: 'mensual' }, propia: true, interes_c: 18000000 })
  })
  it('pagada: los días quedan cerrados el día del pago', () => {
    expect(pf.get('pagada')).toMatchObject({ cerradaEl: '2026-11-10', dias_mora: 10, interes_c: 6145548 })
  })
  it('lo que falta sólo por retenciones no genera interés: se cierra el día del último cobro', () => {
    expect(pf.get('retenciones')).toMatchObject({ cerradaEl: '2026-11-05', dias_mora: 5, interes_c: Math.round((S * SUMA_01_05) / 36500) })
  })
  it('el total para avisarle al cliente no suma las marcadas «no cobrar»', () => {
    expect(totalIntereses(['impaga', 'pactada', 'pagada', 'retenciones', 'por_vencer'], pf)).toBe(18000000 + 6145548 + Math.round((S * SUMA_01_05) / 36500))
    expect(totalIntereses(['impaga'], null)).toBe(0)
  })
  it('pide al BCRA sólo las series que usan las tasas, desde el primer día de mora', () => {
    expect(seriesNecesarias(filas, cond, datos(), '2026-11-18')).toEqual({ badlar: '2026-11-01' })
    expect(seriesNecesarias(filas, cond, datos({ tipo: 'tim' }), '2026-11-18')).toEqual({ tim: '2026-11-01' })
    expect(seriesNecesarias(filas, cond, datos({ tipo: 'sin_interes' }), '2026-11-18')).toEqual({})
    // Sin condiciones de pago (p. ej. sin permiso): vence a emisión + 30 y usa la tasa general.
    expect(calcularIntereses(filas, null, datos(), { badlar: BADLAR }, '2026-11-18').get('pactada')).toMatchObject({ propia: false, tasa: BADLAR_X1 })
  })
  it('texto para el cliente: las facturas con interés a cobrar y el total', () => {
    const texto = textoParaCliente('Cliente Uno', [{ numero: 'A 0003-00002033', i: pf.get('pagada')! }, { numero: 'A 0003-00002040', i: pf.get('impaga')! }], '2026-11-18')
    expect(texto).toContain('Cliente Uno — intereses por mora al 18/11/2026')
    expect(texto).toContain(`• A 0003-00002033: venció el 31/10/2026; 10 días de mora hasta el pago del 10/11/2026: ${formatoPesos(6145548)} (BADLAR de bancos privados (BCRA))`)
    expect(texto).not.toContain('00002040') // marcada «no cobrar»
    expect(texto).toContain(`Total: ${formatoPesos(6145548)}`)
  })
})

describe('sólo de vista: no registra intereses ni factura', () => {
  const leer = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
  const rpcs = (src: string) => Array.from(src.matchAll(/\brpc\('([a-z_]+)'/g), m => m[1])
  const PROHIBIDO = /['"`]fact_interes_(calcular|registrar)|['"`]fact_nota_|['"`]emitir|\.(insert|update|upsert|delete)\(/
  it('la ruta sólo pide BADLAR (serie 7) o TIM (serie 1197) al BCRA', () => {
    expect(SERIES_BCRA.badlar.variable).toBe(BADLAR_VARIABLE)
    expect(BADLAR_VARIABLE).toBe(7)
    expect(SERIES_BCRA.tim.variable).toBe(1197)
    expect(esSerieBcra('badlar') && esSerieBcra('tim')).toBe(true)
    expect(esSerieBcra('otra') || esSerieBcra('1')).toBe(false)
    expect(urlSerieBcra(7, '2026-10-22', '2026-11-18')).toBe('https://api.bcra.gob.ar/estadisticas/v4.0/monetarias/7?desde=2026-10-22&hasta=2026-11-18&limit=3000&offset=0')
  })
  it('el cálculo y la carga sólo leen', () => {
    for (const f of ['lib/facturacion/intereses-cobranzas.ts', 'lib/facturacion/intereses-variables.ts', 'lib/facturacion/tasa-mora.ts']) {
      const src = leer(f)
      expect(rpcs(src), f).toEqual([])
      expect(src, f).not.toMatch(PROHIBIDO)
    }
  })
  it('las pantallas sólo guardan la marca «no cobrar» y la tasa general (con historial en la base)', () => {
    expect(rpcs(leer('components/facturacion/InteresFactura.tsx'))).toEqual(['fact_interes_no_cobrar', 'fact_interes_no_cobrar'])
    expect(rpcs(leer('components/facturacion/InteresesMora.tsx'))).toEqual(['fact_intereses_config_guardar'])
    for (const f of ['components/facturacion/InteresFactura.tsx', 'components/facturacion/InteresesMora.tsx']) expect(leer(f), f).not.toMatch(PROHIBIDO)
  })
  it('se ve en Facturas y cobros, en la cuenta del cliente y la tasa se elige en el contrato', () => {
    const fc = leer('components/facturacion/FacturasCobros.tsx')
    expect(fc).toMatch(/useIntereses\(filas, cond, hoy, recarga\)/)
    expect(fc).toMatch(/<CeldaInteres /)
    expect(fc).toMatch(/<DetalleInteres /)
    expect(fc).toMatch(/Intereses por mora \(informativo\)/)
    const cu = leer('components/facturacion/Cobranzas.tsx')
    expect(cu).toMatch(/useIntereses\(d\.saldos, d\.cond, hoy, recarga\)/)
    expect(cu).toMatch(/Copiar detalle para el cliente/)
    const co = leer('components/facturacion/Condiciones.tsx')
    expect(co).toMatch(/mora_tasa_tipo/)
    expect(co).toMatch(/BADLAR × factor propio/)
  })
})
