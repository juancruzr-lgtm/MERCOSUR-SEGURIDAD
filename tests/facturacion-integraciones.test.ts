import { describe, it, expect } from 'vitest'
import { interpretarCae, interpretarConsulta, interpretarUltimo, validarComprobante, xmlSolicitarCae, type ComprobanteWsfe } from '@/lib/afip/wsfe'
import { horasDelObjetivo, instantesTurno } from '@/lib/facturacion/horas'
import { periodoFacturacion } from '@/lib/facturacion/periodos'
import { leerCsvArcaEmitidos, leerExtracto } from '@/lib/facturacion/importadores'

const TA = { token: 'T', sign: 'S', expira: Date.now() + 3600e3 }

describe('WSFE', () => {
  const fa: ComprobanteWsfe = {
    tipo: 1, puntoVenta: 1, numero: 2047, fecha: '2026-09-04', concepto: 2, docTipo: 80, docNro: '30-11111111-8', condicionIvaReceptor: 1,
    servicioDesde: '2026-08-01', servicioHasta: '2026-08-31', vtoPago: '2026-09-04',
    netoC: 808014080, ivaC: 169682957, totalC: 977697037, alicuotas: [{ porcentaje: '21', baseC: 808014080, importeC: 169682957 }],
  }

  it('arma la solicitud con importes, servicio y alícuota 21 %', () => {
    expect(validarComprobante(fa)).toEqual([])
    const x = xmlSolicitarCae(TA, '30710705417', fa)
    expect(x).toContain('<ar:ImpTotal>9776970.37</ar:ImpTotal>')
    expect(x).toContain('<ar:Id>5</ar:Id><ar:BaseImp>8080140.80</ar:BaseImp>')
    expect(x).toContain('<ar:FchServDesde>20260801</ar:FchServDesde>')
    expect(x).toContain('<ar:CondicionIVAReceptorId>1</ar:CondicionIVAReceptorId>')
  })

  it('rechaza antes de enviar: totales que no cierran, NC sin asociado, FCE sin CBU', () => {
    expect(validarComprobante({ ...fa, totalC: 1 }).length).toBeGreaterThan(0)
    expect(validarComprobante({ ...fa, tipo: 3 }).join(' ')).toContain('asociado')
    expect(validarComprobante({ ...fa, tipo: 201 }).join(' ')).toContain('2101')
  })

  it('NC parcial vinculada a la factura', () => {
    const nc = { ...fa, tipo: 3, numero: 187, netoC: 180180800, ivaC: 37837968, totalC: 218018768, alicuotas: [{ porcentaje: '21', baseC: 180180800, importeC: 37837968 }],
      asociado: { tipo: 1, puntoVenta: 1, numero: 2023, cuit: '30710705417', fecha: '2026-08-27' } }
    expect(validarComprobante(nc)).toEqual([])
    expect(xmlSolicitarCae(TA, '30710705417', nc)).toContain('<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>1</ar:Tipo><ar:PtoVta>1</ar:PtoVta><ar:Nro>2023</ar:Nro>')
  })

  const env = (cuerpo: string) => `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${cuerpo}</soap:Body></soap:Envelope>`

  it('aprobado sólo con CAE y vencimiento', () => {
    const ok = interpretarCae(env(`<FECAESolicitarResponse><FECAESolicitarResult><FeCabResp><Resultado>A</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><Resultado>A</Resultado><CAE>76111111111111</CAE><CAEFchVto>20260914</CAEFchVto><CbteFch>20260904</CbteFch></FECAEDetResponse></FeDetResp></FECAESolicitarResult></FECAESolicitarResponse>`), 200)
    expect(ok).toMatchObject({ resultado: 'A', cae: '76111111111111', caeVto: '2026-09-14', fecha: '2026-09-04' })
    const sinCae = interpretarCae(env(`<FECAESolicitarResponse><FECAESolicitarResult><FeDetResp><FECAEDetResponse><Resultado>A</Resultado></FECAEDetResponse></FeDetResp></FECAESolicitarResult></FECAESolicitarResponse>`), 200)
    expect(sinCae.resultado).toBe('incierta')
  })

  it('rechazo explícito vs. respuesta incierta', () => {
    const r = interpretarCae(env(`<FECAESolicitarResponse><FECAESolicitarResult><FeCabResp><Resultado>R</Resultado></FeCabResp><FeDetResp><FECAEDetResponse><Resultado>R</Resultado><Observaciones><Obs><Code>10016</Code><Msg>Número no correlativo</Msg></Obs></Observaciones></FECAEDetResponse></FeDetResp></FECAESolicitarResult></FECAESolicitarResponse>`), 200)
    expect(r.resultado).toBe('R')
    expect(interpretarCae(null, null).resultado).toBe('incierta')
    expect(interpretarCae('<html>502 Bad Gateway</html>', 502).resultado).toBe('incierta')
  })

  it('consulta: 602 = no existe; otro error no se toma como "no existe"', () => {
    expect(interpretarConsulta(env(`<FECompConsultarResponse><FECompConsultarResult><Errors><Err><Code>602</Code><Msg>No existen datos</Msg></Err></Errors></FECompConsultarResult></FECompConsultarResponse>`))).toMatchObject({ encontrado: false })
    expect(interpretarConsulta(env(`<FECompConsultarResponse><FECompConsultarResult><Errors><Err><Code>600</Code><Msg>No autorizado</Msg></Err></Errors></FECompConsultarResult></FECompConsultarResponse>`))).toHaveProperty('error')
    const enc = interpretarConsulta(env(`<FECompConsultarResponse><FECompConsultarResult><ResultGet><CodAutorizacion>761</CodAutorizacion><FchVto>20260914</FchVto><CbteFch>20260904</CbteFch><ImpTotal>9776970.37</ImpTotal></ResultGet></FECompConsultarResult></FECompConsultarResponse>`))
    expect(enc).toMatchObject({ encontrado: true, totalC: 977697037 })
  })

  it('último autorizado', () => {
    expect(interpretarUltimo(env(`<FECompUltimoAutorizadoResponse><FECompUltimoAutorizadoResult><PtoVta>1</PtoVta><CbteTipo>1</CbteTipo><CbteNro>2046</CbteNro></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>`))).toEqual({ ok: true, numero: 2046 })
  })
})

describe('horas desde la app', () => {
  const OBJ = 'obj-1'
  const periodo = periodoFacturacion({ tipo: 'corte', diaInicio: 26 }, '2026-10')

  it('turno 20→08 del 25/10 cruza el corte: sólo 4 h van a octubre', () => {
    const t = { id: 't1', fecha: '2026-10-25', hora_inicio: '20:00:00', hora_fin: '08:00:00', objetivo_id: OBJ, estado: 'cubierto' }
    expect(instantesTurno(t)).toEqual({ inicio: '2026-10-25T23:00:00.000Z', fin: '2026-10-26T11:00:00.000Z' })
    const r = horasDelObjetivo({
      objetivoId: OBJ, periodo, separarDiurnaNocturna: false, franjaNocturna: null, ahora: new Date('2026-11-03T12:00:00Z'),
      turnos: [t],
      registros: [{ id: 'r1', turno_id: 't1', guardia_id: 'g', horas_liquidables: 12 }],
    })
    expect(r.minutosRegistrados).toBe(240)
  })

  it('turno pasado sin registro queda pendiente, no como cero facturable; anulados no cuentan', () => {
    const r = horasDelObjetivo({
      objetivoId: OBJ, periodo, separarDiurnaNocturna: false, franjaNocturna: null, ahora: new Date('2026-11-03T12:00:00Z'),
      turnos: [
        { id: 't1', fecha: '2026-10-10', hora_inicio: '08:00:00', hora_fin: '20:00:00', objetivo_id: OBJ, estado: 'sin_cubrir' },
        { id: 't2', fecha: '2026-10-11', hora_inicio: '08:00:00', hora_fin: '20:00:00', objetivo_id: OBJ, estado: 'anulado' },
      ],
      registros: [],
    })
    expect(r).toMatchObject({ minutosRegistrados: 0, minutosSinRegistro: 720, turnosSinRegistro: 1 })
  })

  it('registro corregido hacia otro objetivo se factura en ese objetivo', () => {
    const base = { objetivoId: OBJ, periodo, separarDiurnaNocturna: false, franjaNocturna: null, ahora: new Date('2026-11-03T12:00:00Z'),
      turnos: [{ id: 't1', fecha: '2026-10-10', hora_inicio: '08:00:00', hora_fin: '20:00:00', objetivo_id: OBJ, estado: 'cubierto' }],
      registros: [{ id: 'r1', turno_id: 't1', guardia_id: 'g', horas_liquidables: 12, objetivo_final_id: 'obj-2' }] }
    expect(horasDelObjetivo(base).minutosRegistrados).toBe(0)
    expect(horasDelObjetivo({ ...base, objetivoId: 'obj-2' }).minutosRegistrados).toBe(720)
  })

  it('diurnas + nocturnas = liquidables con franja contractual', () => {
    const r = horasDelObjetivo({
      objetivoId: OBJ, periodo: periodoFacturacion({ tipo: 'mes_calendario' }, '2026-10'), separarDiurnaNocturna: true,
      franjaNocturna: { desde: '21:00', hasta: '06:00' }, ahora: new Date('2026-11-03T12:00:00Z'),
      turnos: [{ id: 't1', fecha: '2026-10-10', hora_inicio: '18:00:00', hora_fin: '06:00:00', objetivo_id: OBJ, estado: 'cubierto' }],
      registros: [{ id: 'r1', turno_id: 't1', guardia_id: 'g', horas_liquidables: 12 }],
    })
    expect([r.minutosDiurnos, r.minutosNocturnos]).toEqual([180, 540])
  })
})

describe('importadores', () => {
  const csv = [
    'Fecha de Emisión;Tipo de Comprobante;Punto de Venta;Número Desde;Número Hasta;Cód. Autorización;Tipo Doc. Receptor;Nro. Doc. Receptor;Denominación Receptor;Tipo Cambio;Moneda;Imp. Neto Gravado;Imp. Neto No Gravado;Imp. Op. Exentas;Otros Tributos;IVA;Imp. Total',
    '2026-09-04;1 - Factura A;1;2047;2047;76111111111111;80;30111111118;CONEXION ALTO DELTA SA;1;$;8080140,80;0;0;0;1696829,57;9776970,37',
    '2026-08-20;3 - Nota de Crédito A;3;186;186;76222;80;30222222229;LAROMET SA;1;$;1536379,35;0;0;0;322639,66;1859019,01',
    '2026-09-04;1 - Factura A;1;2047;2047;76111111111111;80;30111111118;CONEXION ALTO DELTA SA;1;$;8080140,80;0;0;0;1696829,57;9776970,37',
  ].join('\n')

  it('CSV de ARCA: colapsa repetidas y lee importes argentinos', () => {
    const r = leerCsvArcaEmitidos(csv)
    expect(r.errores).toEqual([])
    expect(r.repetidas).toBe(1)
    expect(r.filas.map(f => [f.clave, f.total_c])).toEqual([['1-1-2047', 977697037], ['3-3-186', 185901901]])
  })

  it('CSV sin columnas reconocibles no inventa datos', () => {
    expect(leerCsvArcaEmitidos('a;b;c\n1;2;3').errores[0].motivo).toContain('No se reconocen')
  })

  it('extracto: clasifica, toma CUIT del concepto y distingue líneas iguales', () => {
    const ext = [
      'Banco X - Cuenta 511522209', '',
      'Fecha;Concepto;Referencia;Débito;Crédito',
      '09/10/2026;TRANSF RECIBIDA 30-11111111-8 CONEXION;OP323;;8.768.296,17',
      '15/10/2026;RESCATE FCI;;;500.000,00',
      '20/10/2026;PAGO PROVEEDOR;;100.000,00;',
      '21/10/2026;DEPOSITO;;;1.000,00',
      '21/10/2026;DEPOSITO;;;1.000,00',
    ].join('\n')
    const r = leerExtracto(ext, '30710705417')
    expect(r.errores).toEqual([])
    expect(r.filas.map(f => [f.importe_c, f.clasificacion, f.cuit_contraparte])).toEqual([
      [876829617, 'cobranza_posible', '30111111118'], [50000000, 'no_cobranza', null], [-10000000, 'debito', null],
      [100000, 'cobranza_posible', null], [100000, 'cobranza_posible', null],
    ])
    expect(new Set(r.filas.map(f => f.hash)).size).toBe(5)
    expect(leerExtracto(ext, '30710705417').filas.map(f => f.hash)).toEqual(r.filas.map(f => f.hash))
  })
})

import { alicuotaDe, ejecutarEmision, type Emision, type PuertoArca, type PuertoBase } from '@/lib/facturacion/emision-servidor'

describe('ciclo de emisión', () => {
  const e: Emision = { id: 'E1', estado: 'preparada', ambiente: 'homologacion', cuit_emisor: '30710705417', tipo: 1, punto_venta: 1, numero: null,
    solicitud: { cuit_receptor: '30111111118', neto_c: 808014080, iva_c: 169682957, total_c: 977697037, periodo_desde: '2026-08-01', periodo_hasta: '2026-08-31', vto_pago: '2026-09-04' } }
  const opts = { hoy: '2026-09-04', condicionIva: 'responsable_inscripto' }
  const base = () => {
    const log: string[] = []
    const b: PuertoBase = {
      iniciarEnvio: async (_id, n) => { log.push(`envio:${n}`) },
      resultado: async (_id, r) => { log.push(`resultado:${r.resultado}`) },
      consulta: async (_id, r) => { log.push(`consulta:${r.encontrado}`) },
    }
    return { b, log }
  }

  it('alícuota deducida del neto e IVA', () => {
    expect(alicuotaDe(808014080, 169682957)).toBe('21')
    expect(alicuotaDe(100, 0)).toBe('0')
    expect(alicuotaDe(100000, 5000)).toBeNull()
  })

  it('timeout → incierta; el siguiente intento consulta en vez de reenviar', async () => {
    const { b, log } = base()
    let solicitudes = 0
    const arca: PuertoArca = {
      ultimo: async () => ({ ok: true, numero: 2046 }),
      solicitar: async () => { solicitudes++; return { resultado: 'incierta', motivo: 'timeout', crudo: null } },
      consultar: async ({ numero }) => ({ encontrado: true, cae: '761', caeVto: '2026-09-14', fecha: '2026-09-04', totalC: 977697037, crudo: { numero } }),
    }
    expect((await ejecutarEmision(e, arca, b, opts)).estado).toBe('incierta')
    const r2 = await ejecutarEmision({ ...e, estado: 'incierta', numero: 2047 }, arca, b, opts)
    expect(r2).toMatchObject({ estado: 'autorizada', numero: 2047 })
    expect(solicitudes).toBe(1)
    expect(log).toEqual(['envio:2047', 'resultado:incierta', 'consulta:true'])
  })

  it('consulta con error de ARCA no se toma como "no existe"', async () => {
    const { b, log } = base()
    const arca: PuertoArca = { ultimo: async () => ({ ok: true, numero: 1 }), solicitar: async () => { throw new Error('no') }, consultar: async () => ({ error: 'servicio caído' }) }
    expect((await ejecutarEmision({ ...e, estado: 'incierta', numero: 2047 }, arca, b, opts)).estado).toBe('incierta')
    expect(log).toEqual([])
  })

  it('comprobante inválido no se envía', async () => {
    const { b, log } = base()
    const arca: PuertoArca = { ultimo: async () => ({ ok: true, numero: 1 }), solicitar: async () => { throw new Error('no debería') }, consultar: async () => ({ error: 'x' }) }
    const r = await ejecutarEmision({ ...e, solicitud: { ...e.solicitud, iva_c: 1 } }, arca, b, opts)
    expect(r.estado).toBe('invalida')
    expect(log).toEqual([])
  })
})
