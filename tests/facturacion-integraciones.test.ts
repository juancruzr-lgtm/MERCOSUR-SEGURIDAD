import { describe, it, expect } from 'vitest'
import { interpretarCae, interpretarConsulta, interpretarUltimo, validarComprobante, xmlSolicitarCae, type ComprobanteWsfe } from '@/lib/afip/wsfe'
import { horasDelObjetivo, instantesTurno, minutosAprobables, ubicarHora } from '@/lib/facturacion/horas'
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

describe('horas facturables desde la app (no son horas liquidables)', () => {
  const OBJ = 'obj-1'
  const AHORA = new Date('2026-11-03T12:00:00Z')
  const oct = periodoFacturacion({ tipo: 'mes_calendario' }, '2026-10')
  const base = { objetivoId: OBJ, periodo: oct, separarDiurnaNocturna: false, franjaNocturna: null, ahora: AHORA }
  const turno = (id: string, fecha: string, ini: string, fin: string, extra: Record<string, unknown> = {}) =>
    ({ id, fecha, hora_inicio: ini, hora_fin: fin, objetivo_id: OBJ, estado: 'cubierto', puesto_id: 'P1', ...extra })
  const reg = (id: string, turno_id: string, extra: Record<string, unknown> = {}) => ({ id, turno_id, guardia_id: `g-${id}`, ...extra })

  it('turno 20→08 del 25/10 cruza el corte 26→25: sólo 4 h van a octubre', () => {
    const t = turno('t1', '2026-10-25', '20:00:00', '08:00:00')
    expect(instantesTurno(t)).toEqual({ inicio: '2026-10-25T23:00:00.000Z', fin: '2026-10-26T11:00:00.000Z' })
    const r = horasDelObjetivo({ ...base, periodo: periodoFacturacion({ tipo: 'corte', diaInicio: 26 }, '2026-10'),
      turnos: [t], registros: [reg('r1', 't1', { horas_liquidables: 12 })] })
    expect([r.minutosProgramados, r.minutosCubiertos]).toEqual([240, 240])
  })

  it('turno pasado sin registro = descubierto (no cero facturable); anulados no cuentan', () => {
    const r = horasDelObjetivo({ ...base, registros: [], turnos: [
      turno('t1', '2026-10-10', '08:00:00', '20:00:00', { estado: 'sin_cubrir' }),
      turno('t2', '2026-10-11', '08:00:00', '20:00:00', { estado: 'anulado' }),
    ] })
    expect(r).toMatchObject({ minutosProgramados: 720, minutosCubiertos: 0, minutosDescubiertos: 720, turnosSinRegistro: 1 })
  })

  it('turno futuro no es descubierto todavía', () => {
    const r = horasDelObjetivo({ ...base, ahora: new Date('2026-10-10T12:00:00Z'), registros: [],
      turnos: [turno('t1', '2026-10-20', '08:00:00', '20:00:00')] })
    expect(r).toMatchObject({ minutosDescubiertos: 0, turnosFuturos: 1 })
  })

  it('registro corregido hacia otro objetivo se factura en ese objetivo', () => {
    const p = { ...base, turnos: [turno('t1', '2026-10-10', '08:00:00', '20:00:00')], registros: [reg('r1', 't1', { horas_liquidables: 12, objetivo_final_id: 'obj-2' })] }
    expect(horasDelObjetivo(p).minutosCubiertos).toBe(0)
    expect(horasDelObjetivo({ ...p, objetivoId: 'obj-2' }).minutosCubiertos).toBe(720)
  })

  it('diurnas + nocturnas = cubiertas con la franja contractual', () => {
    const r = horasDelObjetivo({ ...base, separarDiurnaNocturna: true, franjaNocturna: { desde: '21:00', hasta: '06:00' },
      turnos: [turno('t1', '2026-10-10', '18:00:00', '06:00:00')], registros: [reg('r1', 't1', { horas_liquidables: 12 })] })
    expect([r.minutosDiurnos, r.minutosNocturnos]).toEqual([180, 540])
  })

  it('horarios corregidos son `time` (HH:MM:SS): se ubican en el día correcto', () => {
    const t = turno('t1', '2026-10-10', '22:00:00', '06:00:00')
    const ini = Date.parse(instantesTurno(t).inicio), fin = Date.parse(instantesTurno(t).fin)
    expect(new Date(ubicarHora('2026-10-10', '22:10:00', ini)!).toISOString()).toBe('2026-10-11T01:10:00.000Z')
    expect(new Date(ubicarHora('2026-10-10', '05:00:00', fin)!).toISOString()).toBe('2026-10-11T08:00:00.000Z')
    // Salida corregida a las 02:00: cubre 22→02 (4 h), con la mitad nocturna bien clasificada.
    const r = horasDelObjetivo({ ...base, separarDiurnaNocturna: true, franjaNocturna: { desde: '21:00', hasta: '06:00' }, turnos: [t],
      registros: [reg('r1', 't1', { hora_entrada_final: '22:00:00', hora_salida_final: '02:00:00', horas_liquidables: 4 })] })
    expect(r).toMatchObject({ minutosCubiertos: 240, minutosNocturnos: 240, minutosDiurnos: 0, minutosDescubiertos: 240 })
  })

  it('relevo superpuesto en el mismo puesto NO se factura dos veces', () => {
    // A 06–18 se queda hasta 18:30; B 18–06 llega 17:30. Una hora con dos vigiladores.
    const turnos = [turno('A', '2026-10-10', '06:00:00', '18:00:00'), turno('B', '2026-10-10', '18:00:00', '06:00:00')]
    const registros = [
      reg('rA', 'A', { hora_entrada_real: '06:00:00', hora_salida_real: '18:30:00', hora_salida_final: '18:30:00', horas_liquidables: 12 }),
      reg('rB', 'B', { hora_entrada_real: '17:30:00', hora_entrada_final: '17:30:00', hora_salida_real: '06:00:00', horas_liquidables: 12 }),
    ]
    const r = horasDelObjetivo({ ...base, turnos, registros })
    expect(r).toMatchObject({ minutosProgramados: 1440, minutosCubiertos: 1440, minutosSuperpuestos: 60, minutosDescubiertos: 0 })
    // Sólo si el contrato lo prevé se suma la superposición.
    expect(horasDelObjetivo({ ...base, turnos, registros, superposicion: 'sumar' }).minutosCubiertos).toBe(1500)
  })

  it('relevo anticipado: el que llega antes tapa la salida anticipada del anterior', () => {
    const turnos = [turno('A', '2026-10-10', '06:00:00', '18:00:00'), turno('B', '2026-10-10', '18:00:00', '06:00:00')]
    const registros = [
      reg('rA', 'A', { hora_entrada_real: '06:00:00', hora_salida_final: '17:00:00', horas_liquidables: 11 }),
      reg('rB', 'B', { hora_entrada_final: '17:00:00', hora_salida_real: '06:00:00', horas_liquidables: 13 }),
    ]
    expect(horasDelObjetivo({ ...base, turnos, registros })).toMatchObject({ minutosCubiertos: 1440, minutosDescubiertos: 0, minutosSuperpuestos: 0 })
  })

  it('dos puestos simultáneos se suman (no es superposición)', () => {
    const r = horasDelObjetivo({ ...base,
      turnos: [turno('A', '2026-10-10', '08:00:00', '20:00:00'), turno('B', '2026-10-10', '08:00:00', '20:00:00', { puesto_id: 'P2' })],
      registros: [reg('rA', 'A', { horas_liquidables: 12 }), reg('rB', 'B', { horas_liquidables: 12 })] })
    expect(r).toMatchObject({ minutosCubiertos: 1440, minutosSuperpuestos: 0 })
  })

  it('cobertura parcial: llegó 4 h tarde → 8 h cubiertas y 4 h descubiertas; lo fuera de horario es excedente', () => {
    const r = horasDelObjetivo({ ...base, turnos: [turno('A', '2026-10-10', '06:00:00', '18:00:00')],
      registros: [reg('rA', 'A', { hora_entrada_final: '10:00:00', hora_salida_final: '19:00:00', horas_liquidables: 8 })] })
    expect(r).toMatchObject({ minutosCubiertos: 480, minutosDescubiertos: 240, minutosExcedentes: 60 })
  })

  it('Administración decide sobre lo descubierto sin tocar lo cubierto', () => {
    const r = horasDelObjetivo({ ...base, turnos: [turno('A', '2026-10-10', '06:00:00', '18:00:00')],
      registros: [reg('rA', 'A', { hora_entrada_final: '10:00:00', hora_salida_final: '18:00:00', horas_liquidables: 8 })] })
    expect(minutosAprobables(r, 'no_facturar').aprobados).toBe(480)
    expect(minutosAprobables(r, 'facturar').aprobados).toBe(720)
    expect(r.minutosCubiertos).toBe(480)
  })

  it('turnos sin puesto no se unen y se avisan', () => {
    const r = horasDelObjetivo({ ...base, turnos: [turno('A', '2026-10-10', '08:00:00', '20:00:00', { puesto_id: null })],
      registros: [reg('rA', 'A', { horas_liquidables: 12 })] })
    expect(r.turnosSinPuesto).toBe(1)
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

describe('ciclo de emisión: nunca dos facturas fiscales por un error de comunicación', () => {
  const AHORA = Date.parse('2026-09-04T15:00:00Z')
  const e: Emision = { id: 'E1', estado: 'preparada', ambiente: 'homologacion', cuit_emisor: '30710705417', tipo: 1, punto_venta: 1, numero: null,
    numeros_intentados: [], ultimo_intento_at: null,
    solicitud: { cuit_receptor: '30111111118', neto_c: 808014080, iva_c: 169682957, total_c: 977697037, periodo_desde: '2026-08-01', periodo_hasta: '2026-08-31', vto_pago: '2026-09-04' } }
  const opts = { hoy: '2026-09-04', condicionIva: 'responsable_inscripto', ahoraMs: AHORA }
  const base = (opciones: { iniciarFalla?: boolean } = {}) => {
    const log: string[] = []
    const b: PuertoBase = {
      iniciarEnvio: async (_id, n) => { if (opciones.iniciarFalla) throw new Error('La emisión está enviando'); log.push(`envio:${n}`) },
      resultado: async (_id, r) => { log.push(`resultado:${r.resultado}`) },
      consulta: async (_id, r) => { log.push(`consulta:${r.numero}:${r.encontrado}`); return r.encontrado ? 'COMP' : null },
    }
    return { b, log }
  }
  const encontrado = (numero: number, totalC = 977697037) => ({ encontrado: true as const, cae: '761', caeVto: '2026-09-14', fecha: '2026-09-04', totalC, crudo: { numero } })

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
      consultar: async ({ numero }) => encontrado(numero),
    }
    expect((await ejecutarEmision(e, arca, b, opts)).estado).toBe('incierta')
    const r2 = await ejecutarEmision({ ...e, estado: 'incierta', numero: 2047, numeros_intentados: [2047] }, arca, b, opts)
    expect(r2).toMatchObject({ estado: 'autorizada', numero: 2047 })
    expect(solicitudes).toBe(1)
    expect(log).toEqual(['envio:2047', 'resultado:incierta', 'consulta:2047:true'])
  })

  it('envío en curso (< 2 min): no consulta ni reenvía', async () => {
    const { b, log } = base()
    const arca: PuertoArca = { ultimo: async () => { throw new Error('no') }, solicitar: async () => { throw new Error('no') }, consultar: async () => { throw new Error('no') } }
    const r = await ejecutarEmision({ ...e, estado: 'enviando', numero: 2047, numeros_intentados: [2047], ultimo_intento_at: new Date(AHORA - 30000).toISOString() }, arca, b, opts)
    expect(r.estado).toBe('en_curso')
    expect(log).toEqual([])
  })

  it('envío colgado (> 2 min) se resuelve consultando el mismo número', async () => {
    const { b } = base()
    const arca: PuertoArca = { ultimo: async () => { throw new Error('no') }, solicitar: async () => { throw new Error('no') }, consultar: async ({ numero }) => encontrado(numero) }
    const r = await ejecutarEmision({ ...e, estado: 'enviando', numero: 2047, numeros_intentados: [2047], ultimo_intento_at: new Date(AHORA - 5 * 60000).toISOString() }, arca, b, opts)
    expect(r).toMatchObject({ estado: 'autorizada', numero: 2047 })
  })

  it('reintento tras rechazo: si un número anterior quedó autorizado, se registra ése y NO se emite otro', async () => {
    const { b, log } = base()
    let solicitudes = 0
    const arca: PuertoArca = {
      ultimo: async () => ({ ok: true, numero: 2047 }),
      solicitar: async () => { solicitudes++; return { resultado: 'A', cae: 'x', caeVto: '2026-09-14', fecha: '2026-09-04', observaciones: [], crudo: null } },
      consultar: async ({ numero }) => (numero === 2047 ? encontrado(2047) : { encontrado: false as const, crudo: null }),
    }
    const r = await ejecutarEmision({ ...e, estado: 'rechazada', numeros_intentados: [2047] }, arca, b, opts)
    expect(r).toMatchObject({ estado: 'autorizada', numero: 2047 })
    expect(solicitudes).toBe(0)
    expect(log).toEqual(['consulta:2047:true'])
  })

  it('reintento tras rechazo real: consulta los anteriores y recién después pide número nuevo', async () => {
    const { b, log } = base()
    const arca: PuertoArca = {
      ultimo: async () => ({ ok: true, numero: 2047 }),
      solicitar: async c => ({ resultado: 'A', cae: '762', caeVto: '2026-09-14', fecha: '2026-09-04', observaciones: [], crudo: { n: c.numero } }),
      consultar: async () => ({ encontrado: false as const, crudo: null }),
    }
    const r = await ejecutarEmision({ ...e, estado: 'rechazada', numeros_intentados: [2047] }, arca, b, opts)
    expect(r).toMatchObject({ estado: 'autorizada', numero: 2048 })
    expect(log).toEqual(['envio:2048', 'resultado:A'])
  })

  it('si no se puede consultar un número anterior, no se reenvía', async () => {
    const { b, log } = base()
    const arca: PuertoArca = { ultimo: async () => ({ ok: true, numero: 2047 }), solicitar: async () => { throw new Error('no') }, consultar: async () => ({ error: 'servicio caído' }) }
    expect((await ejecutarEmision({ ...e, estado: 'rechazada', numeros_intentados: [2047] }, arca, b, opts)).estado).toBe('incierta')
    expect(log).toEqual([])
  })

  it('número encontrado con otro importe: queda incierta para revisión manual', async () => {
    const { b } = base()
    const arca: PuertoArca = { ultimo: async () => ({ ok: true, numero: 1 }), solicitar: async () => { throw new Error('no') }, consultar: async ({ numero }) => encontrado(numero, 1) }
    expect((await ejecutarEmision({ ...e, estado: 'incierta', numero: 2047, numeros_intentados: [2047] }, arca, b, opts)).estado).toBe('incierta')
  })

  it('dos pedidos simultáneos: el segundo no llega a ARCA', async () => {
    const { b } = base({ iniciarFalla: true })
    let solicitudes = 0
    const arca: PuertoArca = { ultimo: async () => ({ ok: true, numero: 2046 }), solicitar: async () => { solicitudes++; throw new Error('no') }, consultar: async () => ({ error: 'x' }) }
    expect((await ejecutarEmision(e, arca, b, opts)).estado).toBe('en_curso')
    expect(solicitudes).toBe(0)
  })

  it('comprobante inválido no se envía (totales, o sin IVA definido)', async () => {
    const { b, log } = base()
    const arca: PuertoArca = { ultimo: async () => ({ ok: true, numero: 1 }), solicitar: async () => { throw new Error('no debería') }, consultar: async () => ({ error: 'x' }) }
    expect((await ejecutarEmision({ ...e, solicitud: { ...e.solicitud, iva_c: 1 } }, arca, b, opts)).estado).toBe('invalida')
    expect((await ejecutarEmision({ ...e, solicitud: { ...e.solicitud, iva_c: 0, total_c: 808014080 } }, arca, b, opts)).estado).toBe('invalida')
    expect(log).toEqual([])
  })
})

import { cuentaEnExtracto } from '@/lib/facturacion/importadores'
import { clasificarMovimiento } from '@/lib/facturacion/conciliacion'

describe('bancos: cuenta del extracto y movimientos que no son cobranza', () => {
  it('lee la cuenta declarada en el nombre del archivo o el encabezado; si no hay, no inventa', () => {
    expect(cuentaEnExtracto('EXTRACTO_511522209-D2026-10-01_H2026-10-31.csv')).toBe('511522209')
    expect(cuentaEnExtracto('Banco Municipal\nCuenta Corriente N° 123-456/7\nFecha;Concepto')).toBe('1234567')
    expect(cuentaEnExtracto('Fecha;Concepto;Importe')).toBeNull()
  })

  it('impuestos, percepciones y comisiones no son cobranza', () => {
    const m = (concepto: string) => clasificarMovimiento({ id: 'x', fecha: '2026-10-01', importe: 1000, concepto }, '30710705417').tipo
    expect(m('DEV IMP LEY 25413')).toBe('no_cobranza')
    expect(m('SIRCREB REINTEGRO')).toBe('no_cobranza')
    expect(m('COMISION MANTENIMIENTO')).toBe('no_cobranza')
    expect(m('ECHEQ DEPOSITADO 30-11111111-8')).toBe('cobranza_posible')
  })
})
