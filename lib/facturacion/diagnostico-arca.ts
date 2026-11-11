/**
 * lib/facturacion/diagnostico-arca.ts
 *
 * Diagnóstico de la conexión con ARCA (WSFE) para un ambiente. SÓLO LECTURA:
 * FEDummy, ticket de acceso de WSAA, FEParamGetPtosVenta y FECompUltimoAutorizado.
 * Nunca llama a FECAESolicitar ni toca fact_emisiones / fact_comprobantes.
 * No devuelve certificado, clave, token ni sign: sólo datos públicos del certificado.
 */

import forge from 'node-forge'
import type { AfipConfig, AmbienteArca } from '@/lib/afip/config'
import type { EstadoServidores, PuntoVentaArca } from '@/lib/afip/wsfe'

export type EstadoPaso = 'ok' | 'aviso' | 'error' | 'omitido'
export type Paso = { clave: string; titulo: string; estado: EstadoPaso; detalle: string }

export type ConfigEmision = {
  cuit_emisor?: string | null
  cuit_emisor_homo?: string | null
  punto_venta_prod?: number | string | null
  punto_venta_homo?: number | string | null
  produccion_habilitada?: boolean
  homologacion_habilitada?: boolean
}

export type PuertoDiagnostico = {
  servidores(): Promise<EstadoServidores>
  ticket(): Promise<void>
  puntos(): Promise<{ ok: true; puntos: PuntoVentaArca[] } | { ok: false; error: string }>
  ultimo(o: { puntoVenta: number; tipo: number }): Promise<{ ok: true; numero: number } | { ok: false; error: string }>
}

export const TIPOS_FACTURA: Record<number, string> = { 1: 'Factura A', 6: 'Factura B', 201: 'FCE A' }

/** Punto de venta y CUIT emisor que corresponden al ambiente (sin mezclar). */
export function datosAmbiente(ambiente: AmbienteArca, cfg: ConfigEmision) {
  const pv = Number(ambiente === 'produccion' ? cfg.punto_venta_prod : cfg.punto_venta_homo)
  const cuit = String((ambiente === 'homologacion' ? cfg.cuit_emisor_homo || cfg.cuit_emisor : cfg.cuit_emisor) ?? '').replace(/\D/g, '')
  return { puntoVenta: Number.isInteger(pv) && pv > 0 ? pv : null, cuitEmisor: cuit || null }
}

export type DatosCertificado = { cn: string; cuit: string | null; serie: string; emisor: string; desde: string; hasta: string; vigente: boolean; claveCorresponde: boolean }

export function leerCertificado(certPem: string, keyPem: string, ahora = new Date()): DatosCertificado {
  const cert = forge.pki.certificateFromPem(certPem)
  const attr = (n: string) => String(cert.subject.getField(n)?.value ?? '')
  const serie = String(cert.subject.attributes.find(a => a.name === 'serialNumber' || a.type === '2.5.4.5')?.value ?? '')
  let claveCorresponde = false
  try {
    const key = forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey
    const pub = cert.publicKey as forge.pki.rsa.PublicKey
    claveCorresponde = key.n.equals(pub.n) && key.e.equals(pub.e)
  } catch { claveCorresponde = false }
  return {
    cn: attr('CN'),
    cuit: serie.replace(/\D/g, '') || null,
    // Número de serie del certificado, el mismo que muestra ARCA ("Nro Serie"): dice cuál está cargado.
    // (Sin el 00 que DER agrega adelante cuando el primer byte es ≥ 0x80.)
    serie: String(cert.serialNumber ?? '').toLowerCase().replace(/^00(?=[89a-f])/, ''),
    emisor: String(cert.issuer.getField('CN')?.value ?? ''),
    desde: cert.validity.notBefore.toISOString(),
    hasta: cert.validity.notAfter.toISOString(),
    vigente: cert.validity.notBefore <= ahora && ahora <= cert.validity.notAfter,
    claveCorresponde,
  }
}

export async function diagnosticar(o: {
  ambiente: AmbienteArca
  credenciales: { config?: AfipConfig; error?: string }
  cfg: ConfigEmision
  emisionRealServidor: boolean
  arca: PuertoDiagnostico
  ahora?: Date
}): Promise<{ ambiente: AmbienteArca; listo: boolean; pasos: Paso[] }> {
  const pasos: Paso[] = []
  const paso = (clave: string, titulo: string, estado: EstadoPaso, detalle: string) => { pasos.push({ clave, titulo, estado, detalle }) }
  const fin = () => ({ ambiente: o.ambiente, listo: !pasos.some(p => p.estado === 'error' || p.estado === 'omitido'), pasos })
  const omitirResto = (desde: string[]) => desde.forEach(k => paso(k, TITULOS[k], 'omitido', 'No se ejecutó por el error anterior'))
  const homo = o.ambiente === 'homologacion'
  const { puntoVenta, cuitEmisor } = datosAmbiente(o.ambiente, o.cfg)

  // Llaves: se informan, el diagnóstico no las cambia.
  const llaveBase = homo ? o.cfg.homologacion_habilitada === true : o.cfg.produccion_habilitada === true
  const llaves = homo
    ? `homologacion_habilitada = ${llaveBase}`
    : `produccion_habilitada = ${llaveBase} · FACTURACION_EMISION_REAL = ${o.emisionRealServidor ? '1' : 'apagada'}`
  paso('llaves', TITULOS.llaves, 'aviso', `${llaves}. El diagnóstico no las modifica.`)

  if (!o.credenciales.config) {
    paso('credenciales', TITULOS.credenciales, 'error', o.credenciales.error ?? 'Sin credenciales')
    omitirResto(['certificado', 'cuit', 'punto_venta', 'servidores', 'ticket', 'puntos_arca', 'numeracion'])
    return fin()
  }
  const c = o.credenciales.config
  paso('credenciales', TITULOS.credenciales, 'ok', `Credenciales de ${homo ? 'homologación' : 'producción'} cargadas en el servidor`)

  let cert: DatosCertificado | null = null
  try { cert = leerCertificado(c.certPem, c.keyPem, o.ahora) } catch (e: any) {
    paso('certificado', TITULOS.certificado, 'error', `Certificado ilegible: ${e?.message ?? e}`)
  }
  if (cert) {
    const delAmbiente = homo ? /test|homo/i.test(cert.emisor) : !/test|homo/i.test(cert.emisor)
    const problemas = [
      !cert.vigente && 'no está vigente',
      !cert.claveCorresponde && 'la clave privada no corresponde al certificado',
      !delAmbiente && `lo emitió "${cert.emisor}", que no es la autoridad de ${homo ? 'homologación' : 'producción'}`,
    ].filter(Boolean)
    paso('certificado', TITULOS.certificado, problemas.length ? 'error' : 'ok',
      `Alias ${cert.cn}${cert.cuit ? ` · CUIT ${cert.cuit}` : ''}${cert.serie ? ` · serie ${cert.serie}` : ''} · emisor ${cert.emisor} · vence ${cert.hasta.slice(0, 10)}` + (problemas.length ? ` · ${problemas.join('; ')}` : ''))
  }

  if (!cuitEmisor) paso('cuit', TITULOS.cuit, 'error', 'Falta cuit_emisor en fact_config.emision')
  else if (cuitEmisor !== c.cuitRepresentada) paso('cuit', TITULOS.cuit, 'error', `fact_config dice ${cuitEmisor} y las credenciales representan a ${c.cuitRepresentada}`)
  else paso('cuit', TITULOS.cuit, 'ok', `Emite como ${cuitEmisor}`)

  const clavePv = homo ? 'punto_venta_homo' : 'punto_venta_prod'
  paso('punto_venta', TITULOS.punto_venta, puntoVenta ? 'ok' : 'error', puntoVenta ? `${clavePv} = ${puntoVenta}` : `Falta fact_config.emision.${clavePv}`)

  const srv = await o.arca.servidores()
  if ('error' in srv) paso('servidores', TITULOS.servidores, 'error', srv.error)
  else paso('servidores', TITULOS.servidores, srv.ok ? 'ok' : 'error', `App ${srv.app} · Base ${srv.db} · Autenticación ${srv.auth}`)

  if (pasos.some(p => p.estado === 'error' && ['certificado'].includes(p.clave))) {
    omitirResto(['ticket', 'puntos_arca', 'numeracion'])
    return fin()
  }
  try {
    await o.arca.ticket()
    paso('ticket', TITULOS.ticket, 'ok', 'WSAA entregó el ticket de acceso para wsfe: el certificado está autorizado')
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    paso('ticket', TITULOS.ticket, 'error', /no autorizado|not authorized|cms.cert|computador/i.test(msg)
      ? `${msg} — falta asociar el certificado al servicio "Facturación Electrónica" (wsfe)`
      : msg)
    omitirResto(['puntos_arca', 'numeracion'])
    return fin()
  }

  const pts = await o.arca.puntos()
  if ('error' in pts) paso('puntos_arca', TITULOS.puntos_arca, 'error', pts.error)
  else {
    const lista = pts.puntos.map(p => `${p.numero} (${p.emisionTipo}${p.bloqueado ? ', bloqueado' : ''}${p.baja ? `, baja ${p.baja}` : ''})`).join(', ') || 'ninguno'
    const p = puntoVenta ? pts.puntos.find(x => x.numero === puntoVenta) : undefined
    if (homo) {
      paso('puntos_arca', TITULOS.puntos_arca, 'ok', `Puntos Web Service en homologación: ${lista}. En homologación ARCA acepta cualquier número.`)
    } else if (!puntoVenta) {
      paso('puntos_arca', TITULOS.puntos_arca, 'error', `Puntos Web Service habilitados: ${lista}`)
    } else if (!p) {
      paso('puntos_arca', TITULOS.puntos_arca, 'error', `El ${puntoVenta} no figura como Web Service (habilitados: ${lista})`)
    } else if (p.bloqueado || p.baja || !/CAE/i.test(p.emisionTipo) || /CAEA/i.test(p.emisionTipo)) {
      paso('puntos_arca', TITULOS.puntos_arca, 'error', `El ${puntoVenta} no se puede usar: ${p.emisionTipo}${p.bloqueado ? ', bloqueado' : ''}${p.baja ? `, baja ${p.baja}` : ''}`)
    } else {
      paso('puntos_arca', TITULOS.puntos_arca, 'ok', `El ${puntoVenta} está habilitado (${p.emisionTipo})`)
    }
  }

  if (!puntoVenta) {
    paso('numeracion', TITULOS.numeracion, 'omitido', 'Sin punto de venta configurado')
    return fin()
  }
  const nums: string[] = []
  let fallo = false
  for (const tipo of Object.keys(TIPOS_FACTURA).map(Number)) {
    const r = await o.arca.ultimo({ puntoVenta, tipo })
    if ('error' in r) { fallo = true; nums.push(`${TIPOS_FACTURA[tipo]}: ${r.error}`) }
    else nums.push(`${TIPOS_FACTURA[tipo]}: último ${r.numero}`)
  }
  paso('numeracion', TITULOS.numeracion, fallo ? 'error' : 'ok', `PV ${puntoVenta} · ${nums.join(' · ')}`)
  return fin()
}

const TITULOS: Record<string, string> = {
  llaves: 'Habilitación de la emisión',
  credenciales: 'Credenciales del ambiente',
  certificado: 'Certificado',
  cuit: 'CUIT emisor',
  punto_venta: 'Punto de venta configurado',
  servidores: 'Servidores de ARCA (FEDummy)',
  ticket: 'Autorización WSAA para wsfe',
  puntos_arca: 'Puntos de venta Web Service en ARCA',
  numeracion: 'Numeración fiscal (último autorizado)',
}
