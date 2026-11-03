import { describe, it, expect } from 'vitest'
import { URL_QR_ARCA, faltantesPdf, generarPdfComprobante, importesFinalesB, textoQr, type DatosPdf, type Emisor } from '@/lib/facturacion/comprobante-pdf'
import { datosComprobantesEnLinea, validarRegistroManual, type PrefacturaAprobada } from '@/lib/facturacion/emision-manual'
import { tipoComprobanteDe } from '@/lib/facturacion/servidor'
import { validarComprobante, type ComprobanteWsfe } from '@/lib/afip/wsfe'

describe('QR fiscal (especificación ARCA, JSON versión 1)', () => {
  it('reproduce exactamente el ejemplo oficial del instructivo', () => {
    // Ejemplo del documento "Especificaciones del QR incluido en las facturas electrónicas".
    const oficial = 'eyJ2ZXIiOjEsImZlY2hhIjoiMjAyMC0xMC0xMyIsImN1aXQiOjMwMDAwMDAwMDA3LCJwdG9WdGEiOjEwLCJ0aXBvQ21wIjoxLCJucm9DbXAiOjk0LCJpbXBvcnRlIjoxMjEwMCwibW9uZWRhIjoiRE9MIiwiY3R6Ijo2NSwidGlwb0RvY1JlYyI6ODAsIm5yb0RvY1JlYyI6MjAwMDAwMDAwMDEsInRpcG9Db2RBdXQiOiJFIiwiY29kQXV0Ijo3MDQxNzA1NDM2NzQ3Nn0='
    const t = textoQr({ fecha: '2020-10-13', cuit: '30000000007', ptoVta: 10, tipoCmp: 1, nroCmp: 94, importeC: 1210000, moneda: 'DOL', ctz: 65,
      tipoDocRec: 80, nroDocRec: '20000000001', codAut: '70417054367476' })
    expect(t).toBe(`${URL_QR_ARCA}?p=${oficial}`)
  })

  it('FA 2047 real: importe con centavos y CUIT del receptor', () => {
    const t = textoQr({ fecha: '2026-09-04', cuit: '30710705417', ptoVta: 1, tipoCmp: 1, nroCmp: 2047, importeC: 977697037, tipoDocRec: 80, nroDocRec: '30-71924433-1', codAut: '86362022922826' })
    const json = JSON.parse(Buffer.from(t.split('?p=')[1], 'base64').toString('utf8'))
    expect(json).toEqual({ ver: 1, fecha: '2026-09-04', cuit: 30710705417, ptoVta: 1, tipoCmp: 1, nroCmp: 2047, importe: 9776970.37, moneda: 'PES', ctz: 1,
      tipoDocRec: 80, nroDocRec: 30719244331, tipoCodAut: 'E', codAut: 86362022922826 })
  })
})

describe('PDF del comprobante autorizado', () => {
  const emisor: Emisor = { razon_social: 'MERCOSUR SEGURIDAD S.R.L.', domicilio: 'Mejico 1329 - Rosario, Santa Fe', condicion_iva: 'IVA Responsable Inscripto',
    cuit: '30710705417', iibb: 'PRUEBA-IIBB', inicio_actividades: '01/01/2000' } // IIBB e inicio: valores de prueba, no reales
  const fa: DatosPdf = {
    ambiente: 'homologacion', tipo: 1, punto_venta: 1, numero: 2047, fecha_emision: '2026-09-04', servicio_desde: '2026-08-01', servicio_hasta: '2026-08-31',
    vto_pago: '2026-09-04', neto_c: 808014080, iva_c: 169682957, total_c: 977697037, cae: '86362022922826', cae_vto: '2026-09-14',
    receptor: { cuit: '30719244331', razon_social: 'CONEXION ALTO DELTA S.A.', condicion_iva: 'responsable_inscripto', domicilio: 'Domicilio de prueba' },
    texto: 'Servicio de vigilancia agosto 2026 - OC 238', lineas: [{ concepto: 'Horas de vigilancia', cantidad: '544', precio: '14853.20', neto_c: 808014080 }],
    alicuota: '21', asociado: null, condicion_venta: 'Cuenta corriente',
  }

  it('genera un PDF válido para factura A, B y nota de crédito', async () => {
    for (const d of [fa, { ...fa, tipo: 6, receptor: { ...fa.receptor, condicion_iva: 'consumidor_final' } },
      { ...fa, tipo: 3, numero: 187, asociado: { tipo: 1, punto_venta: 1, numero: 2023, fecha: '2026-08-04' } }]) {
      const pdf = await generarPdfComprobante(d, emisor)
      expect(Buffer.from(pdf.slice(0, 5)).toString()).toBe('%PDF-')
      expect(pdf.length).toBeGreaterThan(3000)
    }
  })

  it('no se genera con datos fiscales faltantes (no se inventan)', async () => {
    expect(faltantesPdf({ ...emisor, iibb: '' }, fa)).toEqual(['Emisor: iibb'])
    expect(faltantesPdf(emisor, { ...fa, receptor: { ...fa.receptor, domicilio: null, condicion_iva: null } })).toEqual(['Receptor: condición frente al IVA', 'Receptor: domicilio'])
    await expect(generarPdfComprobante(fa, { ...emisor, inicio_actividades: '' })).rejects.toThrow(/inicio_actividades/)
  })

  it('factura B: los importes finales por línea suman exacto el total', () => {
    const r = importesFinalesB([33333, 33333, 33334], 100000, 121000)
    expect(r.reduce((a, b) => a + b, 0)).toBe(121000)
  })
})

describe('emisión manual (Comprobantes en línea)', () => {
  const p: PrefacturaAprobada = { tipo_comprobante: 1, cuit_receptor: '30719244331', periodo_desde: '2026-08-01', periodo_hasta_excl: '2026-09-01',
    fecha_vencimiento: '2026-09-04', texto_factura: 'Servicio de vigilancia agosto 2026', neto_c: 808014080, iva_c: 169682957, total_c: 977697037,
    lineas: [{ concepto: 'Horas de vigilancia', cantidad: '544', precio: '14853.20' }] }
  const d = { tipo: 1, punto_venta: 1, numero: 2047, fecha: '2026-09-04', cuit_receptor: '30-71924433-1', neto_c: 808014081, iva_c: 169682957, total_c: 977697037,
    cae: '86362022922826', cae_vto: '2026-09-14' }

  it('muestra los datos a cargar, con el período y el texto aprobados', () => {
    const x = datosComprobantesEnLinea(p, { razon_social: 'CONEXION ALTO DELTA S.A.', condicion_iva: 'responsable_inscripto' }, 1)
    const v = (campo: string) => x.find(f => f.campo === campo)?.valor
    expect(v('Tipo de comprobante')).toBe('Factura A')
    expect(v('Período facturado')).toBe('01/08/2026 a 31/08/2026')
    expect(v('Línea 1')).toContain('IVA 21 %')
    expect(v('Descripción (texto aprobado)')).toBe('Servicio de vigilancia agosto 2026')
  })

  it('acepta la FA 2047 real (ARCA redondeó el neto 1 centavo) y rechaza diferencias', () => {
    expect(validarRegistroManual(p, d, '2026-11-03')).toEqual([])
    expect(validarRegistroManual(p, { ...d, total_c: d.total_c + 1 }, '2026-11-03')).toContain('El total no es el aprobado.')
    expect(validarRegistroManual(p, { ...d, tipo: 6 }, '2026-11-03')).toContain('El tipo de comprobante no es el aprobado.')
    expect(validarRegistroManual(p, { ...d, cae: '12' }, '2026-11-03')).toContain('El CAE tiene 14 dígitos.')
    expect(validarRegistroManual(p, { ...d, fecha: '2026-12-01' }, '2026-11-03')).toContain('La fecha de emisión no puede ser futura.')
  })
})

describe('condición frente al IVA del receptor (RG 5616): no se supone', () => {
  it('tipo de comprobante sólo cuando surge sin duda', () => {
    expect(tipoComprobanteDe(null, null, 'responsable_inscripto')).toBe(1)
    expect(tipoComprobanteDe(null, null, 'exento')).toBe(6)
    expect(tipoComprobanteDe(null, null, null)).toBeNull()
    expect(tipoComprobanteDe(null, null, 'monotributo')).toBeNull()
    expect(tipoComprobanteDe(201, 1, null)).toBe(201)
  })

  it('WSFE no se arma sin condición, ni A a exento, ni B a responsable inscripto', () => {
    const base: ComprobanteWsfe = { tipo: 1, puntoVenta: 1, numero: 1, fecha: '2026-11-03', concepto: 2, docTipo: 80, docNro: '30719244331', condicionIvaReceptor: 1,
      servicioDesde: '2026-10-01', servicioHasta: '2026-10-31', vtoPago: '2026-11-03', netoC: 100, ivaC: 21, totalC: 121, alicuotas: [{ porcentaje: '21', baseC: 100, importeC: 21 }] }
    expect(validarComprobante(base)).toEqual([])
    expect(validarComprobante({ ...base, condicionIvaReceptor: 0 }).join(' ')).toContain('condición frente al IVA')
    expect(validarComprobante({ ...base, condicionIvaReceptor: 4 }).join(' ')).toContain('Factura A')
    expect(validarComprobante({ ...base, tipo: 6, condicionIvaReceptor: 1 }).join(' ')).toContain('corresponde factura A')
    expect(validarComprobante({ ...base, tipo: 6, condicionIvaReceptor: 4 })).toEqual([])
  })
})
