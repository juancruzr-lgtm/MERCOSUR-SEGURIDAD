import { describe, it, expect } from 'vitest'
import { aCentavos, desglosarIva, importePorMinutos, productoCentavos, formatoPesos } from '@/lib/facturacion/dinero'
import { periodoFacturacion, minutosEnRango, clasificarDiurnaNocturna, vencimientoPorDias, servicioActivoEnPeriodo } from '@/lib/facturacion/periodos'
import { clasificarNotaCredito, saldoComprobante, cuitValido, claveComprobante, tipoAsociadoValido, numeroVisible } from '@/lib/facturacion/comprobantes'
import { validarAplicacion, antiguedadDeuda, puedeCambiarCheque, validarSaldoInicial } from '@/lib/facturacion/cuenta-corriente'
import { proponerAsociaciones, clasificarMovimiento, type ClienteIdentidad, type ComprobanteAbierto } from '@/lib/facturacion/conciliacion'
import { calcularPrefactura, estadoSugerido, huellaMaterial, puedeTransicionar, validarConsumoOc, type EntradaPrefactura } from '@/lib/facturacion/prefacturacion'

const CUIT_PROPIO = '30710705417'

describe('dinero', () => {
  it('lee formato argentino y decimales largos sin perder el centavo', () => {
    expect(aCentavos('9.776.970,37')).toBe(977697037)
    expect(aCentavos('1.000.000')).toBe(100000000)
    expect(aCentavos(14853.2)).toBe(1485320)
    expect(productoCentavos('544', '14853.20')).toBe(808014080)
  })

  it('Conexión Alto Delta: 544 h × $14.853,20 + IVA = $9.776.970,37 (FA 0001-2047)', () => {
    const bruto = importePorMinutos(544 * 60, '14853.20')
    const r = desglosarIva(bruto, 'adicional', '21')
    expect(r.ok && r.importes).toEqual({ neto: 808014080, iva: 169682957, total: 977697037 })
  })

  it('IVA incluido: neto + IVA == total exacto', () => {
    const r = desglosarIva(121000, 'incluido', '21')
    expect(r.ok && r.importes).toEqual({ neto: 100000, iva: 21000, total: 121000 })
    const r2 = desglosarIva(100001, 'incluido', '21')
    expect(r2.ok && r2.importes.neto + r2.importes.iva).toBe(100001)
  })

  it('tarifa sin tratamiento de IVA declarado no se calcula', () => {
    expect(desglosarIva(100, 'sin_definir').ok).toBe(false)
  })

  it('minutos fraccionarios: 7 h 20 min a $1.000,00 = $7.333,33', () => {
    expect(importePorMinutos(440, '1000')).toBe(733333)
  })

  it('PNC Remolques: abono $1.000.000 + IVA', () => {
    const r = desglosarIva(aCentavos('1000000'), 'adicional')
    expect(r.ok && formatoPesos(r.importes.total)).toBe('$ 1.210.000,00')
  })
})

describe('períodos', () => {
  it('La Caja / Hagana: 26 al 25, nombrado por el mes de cierre', () => {
    const p = periodoFacturacion({ tipo: 'corte', diaInicio: 26 }, '2026-10')
    expect(p.desde).toBe('2026-09-26')
    expect(p.hastaExclusivo).toBe('2026-10-26')
    expect(p.instanteHasta).toBe('2026-10-26T03:00:00.000Z')
  })

  it('un turno que cruza el corte se reparte por minutos, sin duplicar', () => {
    const oct = periodoFacturacion({ tipo: 'corte', diaInicio: 26 }, '2026-10')
    const nov = periodoFacturacion({ tipo: 'corte', diaInicio: 26 }, '2026-11')
    // 25/10 20:00 → 26/10 08:00 hora argentina
    const ini = '2026-10-25T23:00:00.000Z', fin = '2026-10-26T11:00:00.000Z'
    const a = minutosEnRango(ini, fin, oct.instanteDesde, oct.instanteHasta)
    const b = minutosEnRango(ini, fin, nov.instanteDesde, nov.instanteHasta)
    expect([a, b]).toEqual([240, 480])
  })

  it('mes calendario', () => {
    const p = periodoFacturacion({ tipo: 'mes_calendario' }, '2026-09')
    expect([p.desde, p.hastaExclusivo]).toEqual(['2026-09-01', '2026-10-01'])
  })

  it('Nación Servicios: diurnas/nocturnas por franja contractual', () => {
    // 18:00 → 06:00 AR con franja nocturna 21–06
    const r = clasificarDiurnaNocturna('2026-10-10T21:00:00.000Z', '2026-10-11T09:00:00.000Z', { desde: '21:00', hasta: '06:00' })
    expect(r).toEqual({ diurnos: 180, nocturnos: 540 })
    const d = clasificarDiurnaNocturna('2026-10-10T09:00:00.000Z', '2026-10-10T21:00:00.000Z', { desde: '21:00', hasta: '06:00' })
    expect(d).toEqual({ diurnos: 720, nocturnos: 0 })
  })

  it('vencimiento a 45 días (La Caja)', () => {
    expect(vencimientoPorDias('2026-10-27', 45)).toBe('2026-12-11')
  })

  it('servicio terminado: factura sólo períodos con prestación', () => {
    const ecco = { fechaInicio: '2025-01-01', fechaFin: '2026-08-31' }
    expect(servicioActivoEnPeriodo(ecco, { desde: '2026-08-01', hastaExclusivo: '2026-09-01' })).toBe(true)
    expect(servicioActivoEnPeriodo(ecco, { desde: '2026-10-01', hastaExclusivo: '2026-11-01' })).toBe(false)
  })
})

describe('comprobantes y notas de crédito', () => {
  it('CUIT con dígito verificador', () => {
    expect(cuitValido('33-69345023-9')).toBe(true) // ARCA (Depósito Fiscal)
    expect(cuitValido(CUIT_PROPIO)).toBe(true)
    expect(cuitValido('33-69345023-8')).toBe(false)
  })

  it('identidad por emisor + tipo + PV + número', () => {
    expect(claveComprobante({ cuitEmisor: '30-71070541-7', tipo: 1, puntoVenta: 1, numero: 2047 })).toBe('30710705417-001-00001-00002047')
    expect(numeroVisible({ tipo: 6, puntoVenta: 1, numero: 834 })).toBe('FC B 0001-00000834')
  })

  it('Laromet: NC 186 por el total de FA 0001-2018 es reversión total', () => {
    const total = aCentavos('1859019,01')
    const r = clasificarNotaCredito(total, [], total)
    expect(r).toEqual({ ok: true, alcance: 'total', saldoFiscal: 0 })
    expect(saldoComprobante({ total, notasCredito: [total] })).toBe(0)
  })

  it('Hagana: NC 187 por 152 h es corrección parcial; saldo $2.180.187,68', () => {
    const total = aCentavos('4360375,36')
    const nc = aCentavos('2180187,68')
    const r = clasificarNotaCredito(total, [], nc)
    expect(r.ok && r.alcance).toBe('parcial')
    expect(saldoComprobante({ total, notasCredito: [nc] })).toBe(218018768)
  })

  it('una NC no puede acreditar más de lo que queda', () => {
    const r = clasificarNotaCredito(1000, [600], 500)
    expect(r.ok).toBe(false)
  })

  it('NC A sólo sobre factura A de la misma familia', () => {
    expect(tipoAsociadoValido(3, 1)).toBe(true)
    expect(tipoAsociadoValido(3, 6)).toBe(false)
    expect(tipoAsociadoValido(203, 1)).toBe(false)
    expect(tipoAsociadoValido(203, 201)).toBe(true)
  })

  it('aplicaciones revertidas no reducen el saldo', () => {
    expect(saldoComprobante({ total: 1000, aplicaciones: [{ importe: 400 }, { importe: 600, revertido: true }] })).toBe(600)
  })
})

describe('cuenta corriente', () => {
  const fac = { id: 'F1', clienteId: 'C1', saldo: 1000, clase: 'factura' as const }

  it('retención estimada no cancela deuda; con certificado sí', () => {
    const est = { tipo: 'retencion' as const, id: 'R1', importe: 100, aplicado: 0, clienteId: 'C1', estado: 'estimada' as const }
    expect(validarAplicacion(est, fac, 100, []).ok).toBe(false)
    expect(validarAplicacion({ ...est, estado: 'certificado_recibido' }, fac, 100, []).ok).toBe(true)
  })

  it('no aplica dos veces el mismo cobro/certificado', () => {
    const cob = { tipo: 'cobro' as const, id: 'P1', importe: 500, aplicado: 0, clienteId: 'C1' }
    expect(validarAplicacion(cob, fac, 500, [{ origenId: 'P1', destinoId: 'F1' }]).ok).toBe(false)
  })

  it('no supera lo disponible del cobro ni el saldo; pagos parciales sí', () => {
    const cob = { tipo: 'cobro' as const, id: 'P1', importe: 1500, aplicado: 1000, clienteId: 'C1' }
    expect(validarAplicacion(cob, fac, 600, []).ok).toBe(false)
    expect(validarAplicacion({ ...cob, aplicado: 0 }, fac, 1200, []).ok).toBe(false)
    expect(validarAplicacion({ ...cob, aplicado: 0 }, fac, 400, []).ok).toBe(true)
  })

  it('cheque rechazado no se aplica; transiciones controladas', () => {
    const cob = { tipo: 'cobro' as const, id: 'P1', importe: 500, aplicado: 0, clienteId: 'C1', chequeEstado: 'rechazado' as const }
    expect(validarAplicacion(cob, fac, 100, []).ok).toBe(false)
    expect(puedeCambiarCheque('acreditado', 'en_cartera')).toBe(false)
    expect(puedeCambiarCheque('depositado', 'rechazado')).toBe(true)
  })

  it('antigüedad de deuda por tramos', () => {
    const r = antiguedadDeuda([
      { saldo: 100, vencimiento: '2026-11-10' },
      { saldo: 200, vencimiento: '2026-10-20' },
      { saldo: 300, vencimiento: '2026-07-01' },
      { saldo: 0, vencimiento: '2026-01-01' },
    ], '2026-11-03')
    expect(r).toEqual({ no_vencido: 100, '1_30': 200, '31_60': 0, '61_90': 0, mas_90: 300 })
  })

  it('saldo inicial sin respaldo se rechaza', () => {
    expect(validarSaldoInicial({ importe: 100, fecha: '2026-01-01', respaldoDocumentoId: null, detalle: 'extracto de octubre' }).ok).toBe(false)
  })
})

describe('conciliación', () => {
  const alto: ClienteIdentidad = { id: 'CAD', cuit: '30-11111111-8', razonSocial: 'Conexión Alto Delta', alias: ['ALTO DELTA'] }
  const univ: ClienteIdentidad = { id: 'UNI', cuit: '30-22222222-1', razonSocial: 'Club Universitario', alias: [] }
  const fa2047: ComprobanteAbierto = { id: 'FA2047', clienteId: 'CAD', numeroVisible: 'FC A 0001-00002047', numero: 2047, fecha: '2026-09-04', total: 977697037, saldo: 977697037 }
  const fb834: ComprobanteAbierto = { id: 'FB834', clienteId: 'UNI', numeroVisible: 'FC B 0001-00000834', numero: 834, fecha: '2026-10-01', total: 926155020, saldo: 926155020 }
  const retsAlto = [
    { id: 'G409', clienteId: 'CAD', impuesto: 'Ganancias', certificado: '409', importe: aCentavos('160259,42'), fecha: '2026-10-09', ordenPago: '323' },
    { id: 'I8', clienteId: 'CAD', impuesto: 'IVA', certificado: '8', importe: aCentavos('848414,78'), fecha: '2026-10-09', ordenPago: '323' },
  ]

  it('Conexión Alto Delta: transferencia + certificados = total exacto; fuerte pero vínculo inferido', () => {
    const { propuestas } = proponerAsociaciones({
      movimiento: { id: 'M1', fecha: '2026-10-09', importe: aCentavos('8768296,17'), concepto: 'TRANSFERENCIA RECIBIDA', cuitContraparte: '30111111118' },
      cuitPropio: CUIT_PROPIO, clientes: [alto, univ], comprobantes: [fa2047, fb834], retenciones: retsAlto,
    })
    expect(propuestas).toHaveLength(1)
    const p = propuestas[0]
    expect(p.fuerza).toBe('fuerte')
    expect(p.aplicaciones.reduce((a, x) => a + x.importe, 0)).toBe(fa2047.total)
    expect(p.aplicaciones.filter(a => a.origen === 'retencion').every(a => a.vinculo === 'inferido')).toBe(true)
    expect(p.motivos.join(' ')).toContain('orden de pago 323')
    expect(p.advertencias.join(' ')).toContain('no citan la factura')
  })

  it('Universitario: ingreso igual a FB 834 con CUIT compatible → fuerte', () => {
    const { propuestas } = proponerAsociaciones({
      movimiento: { id: 'M2', fecha: '2026-10-26', importe: 926155020, concepto: 'CR TRANSF', cuitContraparte: '30222222221' },
      cuitPropio: CUIT_PROPIO, clientes: [alto, univ], comprobantes: [fa2047, fb834], retenciones: [],
    })
    expect(propuestas).toHaveLength(1)
    expect(propuestas[0].fuerza).toBe('fuerte')
    expect(propuestas[0].advertencias).toEqual([])
  })

  it('Universitario: con saldo previo impago se advierte; con duplicado de importe deja de ser fuerte', () => {
    const vieja = { ...fb834, id: 'FB800', numero: 800, numeroVisible: 'FC B 0001-00000800', fecha: '2026-09-01', saldo: 5000, total: 5000 }
    const r1 = proponerAsociaciones({
      movimiento: { id: 'M2', fecha: '2026-10-26', importe: 926155020, concepto: 'CR TRANSF', cuitContraparte: '30222222221' },
      cuitPropio: CUIT_PROPIO, clientes: [univ], comprobantes: [fb834, vieja], retenciones: [],
    })
    expect(r1.propuestas[0].advertencias.join(' ')).toContain('anterior(es) impago(s)')
    const gemela = { ...fb834, id: 'FB835', numero: 835, numeroVisible: 'FC B 0001-00000835' }
    const r2 = proponerAsociaciones({
      movimiento: { id: 'M2', fecha: '2026-10-26', importe: 926155020, concepto: 'CR TRANSF', cuitContraparte: '30222222221' },
      cuitPropio: CUIT_PROPIO, clientes: [univ], comprobantes: [fb834, gemela], retenciones: [],
    })
    expect(r2.propuestas.every(p => p.fuerza === 'media')).toBe(true)
  })

  it('igualdad de importe sin identidad = débil', () => {
    const { propuestas } = proponerAsociaciones({
      movimiento: { id: 'M3', fecha: '2026-10-26', importe: 926155020, concepto: 'DEPOSITO' },
      cuitPropio: CUIT_PROPIO, clientes: [alto, univ], comprobantes: [fb834], retenciones: [],
    })
    expect(propuestas[0].fuerza).toBe('debil')
  })

  it('movimiento ya aplicado no se vuelve a proponer', () => {
    const { propuestas } = proponerAsociaciones({
      movimiento: { id: 'M2', fecha: '2026-10-26', importe: 926155020, aplicado: 926155020, concepto: 'CR', cuitContraparte: '30222222221' },
      cuitPropio: CUIT_PROPIO, clientes: [univ], comprobantes: [fb834], retenciones: [],
    })
    expect(propuestas).toHaveLength(0)
  })

  it('rescates, transferencias propias y reversos no son cobranza', () => {
    const base = { id: 'X', fecha: '2026-10-05', importe: 100000 }
    expect(clasificarMovimiento({ ...base, concepto: 'RESCATE FCI SUPER AHORRO' }, CUIT_PROPIO).tipo).toBe('no_cobranza')
    expect(clasificarMovimiento({ ...base, concepto: 'TRANSFERENCIA', cuitContraparte: CUIT_PROPIO }, CUIT_PROPIO).tipo).toBe('no_cobranza')
    expect(clasificarMovimiento({ ...base, concepto: 'REVERSO DEBITO' }, CUIT_PROPIO).tipo).toBe('no_cobranza')
    expect(clasificarMovimiento({ ...base, concepto: 'TRANSFERENCIA RECIBIDA' }, CUIT_PROPIO).tipo).toBe('cobranza_posible')
  })
})

describe('prefacturación', () => {
  const base: EntradaPrefactura = {
    modalidad: 'por_hora', cuitReceptor: '30111111118',
    periodo: { desde: '2026-08-01', hastaExclusivo: '2026-09-01' },
    horas: { minutosTotales: 544 * 60, minutosRegistrados: 544 * 60, minutosPendientesAprobacion: 0, fuentes: ['t1'] },
    tarifas: [{ id: 'T1', concepto: 'hora', precio: '14853.20', tratamientoIva: 'adicional', alicuotaIva: '21' }],
    ajustes: [], separarDiurnaNocturna: false, requiere: ['oc_mensual'], cumplidos: ['oc_mensual'],
    oc: { id: 'OC238', numero: '238', vigenciaDesde: '2026-08-01', vigenciaHasta: '2026-08-31', montoNeto: null, horas: 544, consumidoNeto: 0, consumidoHoras: 0 },
    anticipoNeto: 0, pendientesComerciales: [],
  }

  it('Alto Delta con OC 238 cubre 544 h → lista para revisión con el total exacto', () => {
    const r = calcularPrefactura(base)
    expect(r.importes?.total).toBe(977697037)
    expect(r.requisitos).toEqual([])
    expect(estadoSugerido(r)).toBe('lista_revision')
  })

  it('sin OC mensual queda esperando requisitos', () => {
    const r = calcularPrefactura({ ...base, cumplidos: [], oc: null })
    expect(r.requisitos.map(x => x.tipo)).toContain('oc_mensual')
    expect(estadoSugerido(r)).toBe('esperando_requisitos')
  })

  it('horas que exceden la OC se marcan', () => {
    const r = calcularPrefactura({ ...base, horas: { ...base.horas!, minutosTotales: 600 * 60 } })
    expect(r.requisitos.some(x => x.detalle.includes('cubre 544 h'))).toBe(true)
  })

  it('tarifa sin IVA declarado bloquea el cálculo (no se infiere)', () => {
    const r = calcularPrefactura({ ...base, tarifas: [{ ...base.tarifas[0], tratamientoIva: 'sin_definir' }] })
    expect(r.importes).toBeNull()
    expect(r.requisitos.map(x => x.tipo)).toContain('iva_definido')
  })

  it('horas vacías NO se convierten en cero facturable', () => {
    const r = calcularPrefactura({ ...base, horas: null })
    expect(r.importes).toBeNull()
    expect(r.requisitos.map(x => x.tipo)).toContain('horas_aprobadas')
  })

  it('Nación Servicios: sin franja contractual no calcula; con franja separa líneas', () => {
    const tarifas = [
      { id: 'D', concepto: 'hora_diurna' as const, precio: '10000', tratamientoIva: 'adicional' as const, alicuotaIva: '21' },
      { id: 'N', concepto: 'hora_nocturna' as const, precio: '12000', tratamientoIva: 'adicional' as const, alicuotaIva: '21' },
    ]
    const sin = calcularPrefactura({ ...base, separarDiurnaNocturna: true, tarifas, requiere: [], cumplidos: [], oc: null })
    expect(sin.requisitos.map(x => x.tipo)).toContain('franja_nocturna')
    const con = calcularPrefactura({
      ...base, separarDiurnaNocturna: true, tarifas, requiere: [], cumplidos: [], oc: null,
      horas: { minutosTotales: 1536 * 60, minutosDiurnos: 1040 * 60, minutosNocturnos: 496 * 60, minutosRegistrados: 1536 * 60, minutosPendientesAprobacion: 0, fuentes: [] },
    })
    expect(con.lineas.map(l => [l.concepto, l.cantidad])).toEqual([['Horas diurnas', '1040'], ['Horas nocturnas', '496']])
    expect(con.importes?.neto).toBe((1040 * 10000 + 496 * 12000) * 100)
  })

  it('INTA: lo cubierto por el anticipo no se vuelve a facturar', () => {
    const r = calcularPrefactura({ ...base, requiere: [], cumplidos: [], oc: null, anticipoNeto: 808014080 })
    expect(r.importes).toEqual({ neto: 0, iva: 0, total: 0 })
    expect(r.avisos.join(' ')).toContain('cubierto por el anticipo')
  })

  it('PNC: abono confirmado; adicionales pendientes como definición comercial', () => {
    const r = calcularPrefactura({
      ...base, modalidad: 'abono', horas: null, requiere: [], cumplidos: [], oc: null,
      tarifas: [{ id: 'AB', concepto: 'abono', precio: '1000000', tratamientoIva: 'adicional', alicuotaIva: '21' }],
      pendientesComerciales: ['Tratamiento de adicionales pendiente de definición con el contador.'],
    })
    expect(r.importes?.total).toBe(121000000)
    expect(r.requisitos.map(x => x.tipo)).toEqual(['definicion_comercial'])
  })

  it('ajustes comerciales sólo entran aprobados', () => {
    const r = calcularPrefactura({ ...base, ajustes: [{ id: 'a', descripcion: 'Bonificación', importeNeto: -100000, motivo: 'acuerdo', responsableId: 'u', aprobado: false }] })
    expect(r.importes?.total).toBe(977697037)
  })

  it('OC compartida: el monto no se multiplica por objetivo; se consume una sola vez', () => {
    const oc = { id: 'OC', numero: '295', vigenciaDesde: '2026-01-01', vigenciaHasta: '2026-12-31', montoNeto: 1000000, horas: null, consumidoNeto: 700000, consumidoHoras: 0 }
    const p = { desde: '2026-10-01', hastaExclusivo: '2026-11-01' }
    expect(validarConsumoOc(oc, p, 300000, 0)).toEqual({ ok: true, saldoNeto: 0 })
    expect(validarConsumoOc(oc, p, 300001, 0).ok).toBe(false)
    expect(validarConsumoOc({ ...oc, vigenciaHasta: '2026-09-30' }, p, 1, 0).ok).toBe(false)
  })

  it('cambio material (texto, importe) cambia la huella → vuelve a revisión', () => {
    const r = calcularPrefactura(base)
    const h = (texto: string) => huellaMaterial({ cuitReceptor: base.cuitReceptor, tipoComprobante: 1, periodo: base.periodo, lineas: r.lineas, importes: r.importes, texto, vencimiento: null })
    expect(h('Servicio agosto')).toBe(h('Servicio   agosto'))
    expect(h('Servicio agosto')).not.toBe(h('Servicio septiembre'))
  })

  it('sólo ARCA lleva a emitida; una aprobada puede volver a revisión', () => {
    expect(puedeTransicionar('lista_revision', 'emitida')).toBe(false)
    expect(puedeTransicionar('aprobada_emitir', 'emitida')).toBe(true)
    expect(puedeTransicionar('aprobada_emitir', 'lista_revision')).toBe(true)
    expect(puedeTransicionar('emitida', 'lista_revision')).toBe(false)
  })
})
