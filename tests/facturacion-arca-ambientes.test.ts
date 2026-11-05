import { describe, it, expect } from 'vitest'
import forge from 'node-forge'
import { afipConfigDesdeEnv, afipConfigFacturacion } from '@/lib/afip/config'
import { interpretarDummy, interpretarPuntosVenta, xmlPuntosVenta, xmlDummy } from '@/lib/afip/wsfe'
import { cbuFceDe, storeAmbiente } from '@/lib/facturacion/ta-ambiente'
import { datosAmbiente, diagnosticar, leerCertificado, type PuertoDiagnostico } from '@/lib/facturacion/diagnostico-arca'
import type { AfipTA } from '@/lib/afip/wsaa'

function certificado(o: { cn: string; cuit: string; emisor: string; desde: Date; hasta: Date }) {
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = o.desde
  cert.validity.notAfter = o.hasta
  cert.setSubject([{ name: 'commonName', value: o.cn }, { type: '2.5.4.5', value: `CUIT ${o.cuit}` }])
  cert.setIssuer([{ name: 'commonName', value: o.emisor }])
  cert.sign(keys.privateKey, forge.md.sha256.create())
  return { certPem: forge.pki.certificateToPem(cert), keyPem: forge.pki.privateKeyToPem(keys.privateKey), otraKey: forge.pki.privateKeyToPem(forge.pki.rsa.generateKeyPair(1024).privateKey) }
}
const AHORA = new Date('2026-11-05T12:00:00Z')
const PROD = certificado({ cn: 'mercosur-ws', cuit: '30710705417', emisor: 'Computadores', desde: new Date('2026-09-18'), hasta: new Date('2028-09-17') })
const HOMO = certificado({ cn: 'mercosur-homo', cuit: '20313933335', emisor: 'Computadores Test', desde: new Date('2026-11-01'), hasta: new Date('2028-11-01') })

const ENV = {
  AFIP_CERT_PEM: PROD.certPem, AFIP_KEY_PEM: PROD.keyPem, AFIP_CUIT_REPRESENTADA: '30-71070541-7',
  AFIP_HOMO_CERT_PEM: HOMO.certPem, AFIP_HOMO_KEY_PEM: HOMO.keyPem, AFIP_HOMO_CUIT_REPRESENTADA: '30710705417',
}

describe('credenciales de facturación separadas por ambiente', () => {
  it('producción usa el certificado productivo y homologación el suyo, sin mezclarse', () => {
    const p = afipConfigFacturacion('produccion', ENV).config!
    const h = afipConfigFacturacion('homologacion', ENV).config!
    expect(p.homo).toBe(false)
    expect(h.homo).toBe(true)
    expect(p.certPem).toBe(PROD.certPem.trim())
    expect(h.certPem).toBe(HOMO.certPem.trim())
    expect(p.cuitRepresentada).toBe('30710705417')
  })
  it('homologación sin sus variables NO cae al certificado productivo', () => {
    const r = afipConfigFacturacion('homologacion', { ...ENV, AFIP_HOMO_CERT_PEM: undefined })
    expect(r.config).toBeUndefined()
    expect(r.error).toMatch(/AFIP_HOMO_CERT_PEM/)
  })
  it('rechaza cargar el certificado productivo como de homologación', () => {
    const r = afipConfigFacturacion('homologacion', { ...ENV, AFIP_HOMO_CERT_PEM: PROD.certPem, AFIP_HOMO_KEY_PEM: PROD.keyPem })
    expect(r.error).toMatch(/mismo que el productivo/)
  })
  it('producción se niega si AFIP_HOMO está encendido', () => {
    expect(afipConfigFacturacion('produccion', { ...ENV, AFIP_HOMO: '1' }).error).toMatch(/AFIP_HOMO/)
  })
  it('Padrón A13 y legajo siguen leyendo la configuración general sin cambios', () => {
    const viejo = { ...process.env }
    try {
      Object.assign(process.env, { AFIP_CERT_PEM: PROD.certPem, AFIP_KEY_PEM: PROD.keyPem, AFIP_CUIT_REPRESENTADA: '30710705417' })
      delete process.env.AFIP_HOMO
      const c = afipConfigDesdeEnv().config!
      expect(c.homo).toBe(false)
      expect(c.certPem).toBe(PROD.certPem.trim())
    } finally { process.env = viejo }
  })
})

describe('CBU de FCE', () => {
  it('se toma de fact_config "emisor" (no de "emision")', () => {
    expect(cbuFceDe([{ clave: 'emision', valor: { cuit_emisor: '30710705417' } }, { clave: 'emisor', valor: { cbu_fce: '0070220320000005115293' } }])).toBe('0070220320000005115293')
  })
  it('sin CBU válido devuelve null (y validarComprobante frena la FCE)', () => {
    expect(cbuFceDe([{ clave: 'emision', valor: { cbu_fce: '0070220320000005115293' } }])).toBeNull()
    expect(cbuFceDe([{ clave: 'emisor', valor: { cbu_fce: '123' } }])).toBeNull()
    expect(cbuFceDe(null)).toBeNull()
  })
})

describe('caché de ticket por ambiente', () => {
  it('homologación y producción no comparten el TA', async () => {
    const m = new Map<string, AfipTA>()
    const base = { get: async (s: string) => m.get(s) ?? null, set: async (s: string, t: AfipTA) => { m.set(s, t) } }
    await storeAmbiente(base, true).set('wsfe', { token: 'h', sign: 'h', expira: 1 })
    expect(await storeAmbiente(base, false).get('wsfe')).toBeNull()
    expect(Array.from(m.keys())).toEqual(['wsfe_homo'])
  })
})

describe('WSFE de sólo lectura', () => {
  it('los pedidos de diagnóstico no son FECAESolicitar', () => {
    const ta = { token: 't', sign: 's', expira: 0 }
    expect(xmlDummy()).toContain('FEDummy')
    expect(xmlPuntosVenta(ta, '30-71070541-7')).toContain('<ar:FEParamGetPtosVenta><ar:Auth>')
    expect(xmlPuntosVenta(ta, '30710705417')).not.toContain('FECAESolicitar')
  })
  it('interpreta FEDummy', () => {
    const x = '<soap:Envelope><soap:Body><FEDummyResponse><FEDummyResult><AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer></FEDummyResult></FEDummyResponse></soap:Body></soap:Envelope>'
    expect(interpretarDummy(x)).toEqual({ ok: true, app: 'OK', db: 'OK', auth: 'OK' })
    expect(interpretarDummy(null)).toEqual({ error: 'Sin respuesta de ARCA' })
  })
  it('interpreta FEParamGetPtosVenta (lista, 602 vacía y error)', () => {
    const x = '<Envelope><Body><FEParamGetPtosVentaResponse><FEParamGetPtosVentaResult><ResultGet><PtoVenta><Nro>4</Nro><EmisionTipo>CAE</EmisionTipo><Bloqueado>N</Bloqueado><FchBaja>NULL</FchBaja></PtoVenta><PtoVenta><Nro>9</Nro><EmisionTipo>CAEA</EmisionTipo><Bloqueado>S</Bloqueado><FchBaja>20260101</FchBaja></PtoVenta></ResultGet></FEParamGetPtosVentaResult></FEParamGetPtosVentaResponse></Body></Envelope>'
    expect(interpretarPuntosVenta(x)).toEqual({ ok: true, puntos: [
      { numero: 4, emisionTipo: 'CAE', bloqueado: false, baja: null },
      { numero: 9, emisionTipo: 'CAEA', bloqueado: true, baja: '20260101' }] })
    const vacio = '<Envelope><Body><FEParamGetPtosVentaResult><Errors><Err><Code>602</Code><Msg>Sin Resultados</Msg></Err></Errors></FEParamGetPtosVentaResult></Body></Envelope>'
    expect(interpretarPuntosVenta(vacio)).toEqual({ ok: true, puntos: [] })
    const err = '<Envelope><Body><FEParamGetPtosVentaResult><Errors><Err><Code>600</Code><Msg>ValidacionDeToken</Msg></Err></Errors></FEParamGetPtosVentaResult></Body></Envelope>'
    expect(interpretarPuntosVenta(err)).toEqual({ ok: false, error: '600: ValidacionDeToken' })
  })
})

describe('diagnóstico de conexión con ARCA', () => {
  const llamadas: string[] = []
  const arca = (o: Partial<PuertoDiagnostico> = {}): PuertoDiagnostico => ({
    servidores: async () => { llamadas.push('dummy'); return { ok: true, app: 'OK', db: 'OK', auth: 'OK' } },
    ticket: async () => { llamadas.push('ticket') },
    puntos: async () => { llamadas.push('puntos'); return { ok: true, puntos: [{ numero: 4, emisionTipo: 'CAE', bloqueado: false, baja: null }] } },
    ultimo: async x => { llamadas.push(`ultimo:${x.puntoVenta}:${x.tipo}`); return { ok: true, numero: 0 } },
    ...o,
  })
  const cfgProd = { cuit_emisor: '30710705417', punto_venta_prod: 4, punto_venta_homo: 4000, produccion_habilitada: false }

  it('punto de venta y CUIT por ambiente', () => {
    expect(datosAmbiente('produccion', { ...cfgProd, cuit_emisor_homo: '20313933335' })).toEqual({ puntoVenta: 4, cuitEmisor: '30710705417' })
    expect(datosAmbiente('homologacion', { ...cfgProd, cuit_emisor_homo: '20313933335' })).toEqual({ puntoVenta: 4000, cuitEmisor: '20313933335' })
    expect(datosAmbiente('produccion', { cuit_emisor: '30710705417', punto_venta: 1 } as any).puntoVenta).toBeNull()
  })

  it('producción lista: sólo consultas, informa las llaves sin cambiarlas', async () => {
    llamadas.length = 0
    const r = await diagnosticar({ ambiente: 'produccion', credenciales: afipConfigFacturacion('produccion', ENV), cfg: cfgProd, emisionRealServidor: false, arca: arca(), ahora: AHORA })
    expect(r.listo).toBe(true)
    expect(r.pasos.find(p => p.clave === 'llaves')!.detalle).toMatch(/produccion_habilitada = false · FACTURACION_EMISION_REAL = apagada/)
    expect(llamadas).toEqual(['dummy', 'ticket', 'puntos', 'ultimo:4:1', 'ultimo:4:6', 'ultimo:4:201'])
    expect(JSON.stringify(r)).not.toContain('PRIVATE KEY')
    expect(JSON.stringify(r)).not.toContain('BEGIN CERTIFICATE')
  })

  it('el punto 4 sin habilitar como Web Service es error', async () => {
    const r = await diagnosticar({ ambiente: 'produccion', credenciales: afipConfigFacturacion('produccion', ENV), cfg: cfgProd, emisionRealServidor: false, ahora: AHORA,
      arca: arca({ puntos: async () => ({ ok: true, puntos: [] }) }) })
    expect(r.listo).toBe(false)
    expect(r.pasos.find(p => p.clave === 'puntos_arca')).toMatchObject({ estado: 'error', detalle: expect.stringMatching(/no figura como Web Service/) })
  })

  it('certificado sin autorización para wsfe: lo explica y no sigue', async () => {
    llamadas.length = 0
    const r = await diagnosticar({ ambiente: 'produccion', credenciales: afipConfigFacturacion('produccion', ENV), cfg: cfgProd, emisionRealServidor: false, ahora: AHORA,
      arca: arca({ ticket: async () => { throw new Error('WSAA (wsfe): Computador no autorizado a acceder al servicio') } }) })
    expect(r.pasos.find(p => p.clave === 'ticket')!.detalle).toMatch(/Facturación Electrónica/)
    expect(llamadas.some(l => l.startsWith('ultimo'))).toBe(false)
  })

  it('homologación sin credenciales propias: error claro, no toca ARCA', async () => {
    llamadas.length = 0
    const r = await diagnosticar({ ambiente: 'homologacion', credenciales: afipConfigFacturacion('homologacion', { ...ENV, AFIP_HOMO_CERT_PEM: '' }), cfg: cfgProd, emisionRealServidor: false, arca: arca(), ahora: AHORA })
    expect(r.listo).toBe(false)
    expect(r.pasos.find(p => p.clave === 'credenciales')!.detalle).toMatch(/AFIP_HOMO_CERT_PEM/)
    expect(llamadas).toEqual([])
  })

  it('homologación: detecta CUIT distinto y certificado de otra autoridad', async () => {
    const credenciales = { config: { ...afipConfigFacturacion('homologacion', ENV).config!, certPem: PROD.certPem, keyPem: PROD.keyPem } }
    const r = await diagnosticar({ ambiente: 'homologacion', credenciales, cfg: { ...cfgProd, cuit_emisor_homo: '20313933335' }, emisionRealServidor: false, arca: arca(), ahora: AHORA })
    expect(r.pasos.find(p => p.clave === 'certificado')!.estado).toBe('error')
    expect(r.pasos.find(p => p.clave === 'cuit')!.estado).toBe('error')
  })

  it('lee los datos públicos del certificado y verifica la clave', () => {
    const d = leerCertificado(PROD.certPem, PROD.keyPem, AHORA)
    expect(d).toMatchObject({ cn: 'mercosur-ws', cuit: '30710705417', emisor: 'Computadores', vigente: true, claveCorresponde: true })
    expect(leerCertificado(PROD.certPem, PROD.otraKey, AHORA).claveCorresponde).toBe(false)
  })
})
