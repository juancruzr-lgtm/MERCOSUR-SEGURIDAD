// Conciliación de facturas emitidas fuera de la app (importadas del archivo de ARCA) con las prefacturas.
// ARCA no las devuelve por web service: 11002 para los PV que no son Web Service (11/11/2026).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { clasificar, fechaCompatible, horasFacturadas, periodoDesdeTexto, periodoEfectivo, pesosTexto, superpone, type ComprobanteExterno, type PrefacturaAbierta } from '@/lib/facturacion/externas-arca'
import { guardasEmisionReal, numeroComprobante, pideCaeFacturaReal, solicitudCoincide } from '@/lib/facturacion/emision-guardas'

const comp = (o: Partial<ComprobanteExterno>): ComprobanteExterno => ({
  id: 'c1', tipo: 1, puntoVenta: 1, numero: 2075, fecha: '2026-11-05', docNro: '30702637895', receptor: 'LAS BLONDAS SA',
  netoC: 409726070, ivaC: 86042475, totalC: 495768545, cae: '76451064999999', ...o,
})
const pref = (o: Partial<PrefacturaAbierta>): PrefacturaAbierta => ({
  id: 'p1', version: 6, estado: 'aprobada_emitir', cuit_receptor: '30702637895', tipo_comprobante: 1, total_c: 495768545, neto_c: 409726070, iva_c: 86042475,
  periodo_desde: '2026-10-01', periodo_hasta_excl: '2026-11-01', cliente: 'LAS BLONDAS SA',
  lineas: [{ concepto: 'Horas de vigilancia', cantidad: '294.5', precio: '13912.6', importes: { neto: 409726070, total: 495768545 } }], ...o,
})

describe('fechaCompatible y horas facturadas', () => {
  it('octubre: emitidas del 25/10 al 15/12; las de principios de octubre son de septiembre', () => {
    const p = { periodo_hasta_excl: '2026-11-01' }
    expect(['2026-10-25', '2026-11-05', '2026-12-16'].every(f => fechaCompatible(f, p))).toBe(true)
    expect(['2026-10-03', '2026-12-17'].some(f => fechaCompatible(f, p))).toBe(false)
  })
  it('A: neto / precio; B con tarifa IVA incluido: total / precio', () => {
    expect(horasFacturadas(pref({}), { netoC: 409726070, totalC: 495768545 })).toEqual({ reales: 294.5, prefactura: 294.5 })
    // Hagana real de octubre: neto 1.827.388,81 a 12.690,20 la hora = 144 h (la app calculó 160 h, mes calendario).
    const hag = pref({ lineas: [{ cantidad: '160', precio: '12690.2', importes: { neto: 203043200, total: 245682272 } }] })
    expect(horasFacturadas(hag, { netoC: 182738881, totalC: 221114045 })?.reales).toBe(144)
    const b = pref({ tipo_comprobante: 6, lineas: [{ cantidad: '248', precio: '13808.53', importes: { neto: 283017805, total: 342451544 } }] })
    expect(horasFacturadas(b, { netoC: 283017805, totalC: 342451544 })?.reales).toBe(248)
    expect(horasFacturadas(pref({ lineas: [] }), { netoC: 1, totalC: 1 })).toBeNull()
  })
})

describe('clasificar (conciliación automática)', () => {
  it('exacta: mismo CUIT, tipo y total, una de cada lado', () => {
    const r = clasificar([pref({})], [comp({})])
    expect(r.vincular).toEqual([expect.objectContaining({ exacta: true })])
  })
  it('una sola factura posible pero con otro total (Hagana, Club): NO se vincula sola; queda para revisión con la diferencia', () => {
    const r = clasificar([pref({})], [comp({ totalC: 504657907 })])
    expect(r.vincular).toEqual([])
    expect(r.ambiguas).toHaveLength(1)
    expect(r.ambiguas[0].comprobantes.map(c => c.id)).toEqual(['c1'])
    expect(r.ambiguas[0].motivo).toContain('diferencia de $ 88.893,62')
    expect(r.sinPrefactura).toEqual([])
  })
  it('Nación: prefactura sin importe (horas sin aprobar) → revisión, nunca se vincula sola', () => {
    const r = clasificar([pref({ total_c: null, estado: 'esperando_requisitos' })], [comp({ totalC: 2807948924 })])
    expect(r.vincular).toEqual([])
    expect(r.ambiguas[0].motivo).toMatch(/todavía no tiene importe/)
  })
  it('Trading: la de septiembre emitida el 25/10 no se confunde con la exacta de octubre', () => {
    const r = clasificar([pref({})], [comp({ id: 'sep', fecha: '2026-10-25', totalC: 492492467 }), comp({ id: 'oct', fecha: '2026-11-01' })])
    expect(r.vincular.map(v => v.comprobante.id)).toEqual(['oct'])
    expect(r.sinPrefactura.map(c => c.id)).toEqual(['sep'])
  })
  it('Laromet: varias prefacturas y varias facturas del mismo cliente sin total exacto → ambiguas, no se vincula nada', () => {
    const ps = ['a', 'b', 'c'].map(id => pref({ id, total_c: null, lineas: [] }))
    const cs = ['x', 'y'].map(id => comp({ id, totalC: 100 }))
    const r = clasificar(ps, cs)
    expect(r.vincular).toEqual([])
    expect(r.ambiguas).toHaveLength(3)
    expect(r.sinPrefactura).toEqual([])
  })
  it('lo exacto se resuelve primero aunque el cliente tenga varias facturas', () => {
    const r = clasificar([pref({ id: 'a', total_c: 100 }), pref({ id: 'b', total_c: 200 })], [comp({ id: 'x', totalC: 200 }), comp({ id: 'y', totalC: 333 })])
    expect(r.vincular.map(v => [v.prefactura.id, v.comprobante.id, v.exacta])).toEqual([['b', 'x', true]])
    expect(r.ambiguas.map(a => [a.prefactura.id, a.comprobantes.map(c => c.id).join()])).toEqual([['a', 'y']])
    expect(r.ambiguas[0].motivo).toContain('diferencia de $ 2,33')
  })
  it('pesos con signo y período escrito a mano', () => {
    expect(pesosTexto(-2456822700)).toBe('$ -24.568.227,00')
    expect(pesosTexto(5)).toBe('$ 0,05')
    expect(periodoDesdeTexto('26/09/2026-25/10/2026')).toEqual({ desde: '2026-09-26', hasta: '2026-10-25' })
    expect(periodoDesdeTexto(' 26/9/2026 al 25/10/2026 ')).toEqual({ desde: '2026-09-26', hasta: '2026-10-25' })
    expect(periodoDesdeTexto('')).toBeNull()
    expect(['31/02/2026-25/10/2026', '26/10/2026-25/09/2026', 'octubre'].map(periodoDesdeTexto)).toEqual(['invalido', 'invalido', 'invalido'])
  })
  it('otro tipo de comprobante: pendiente, no se vincula', () => {
    const r = clasificar([pref({ tipo_comprobante: 201 })], [comp({})])
    expect(r.vincular).toEqual([])
    expect(r.ambiguas[0].motivo).toMatch(/tipo de comprobante distinto/)
  })
  it('un abono igual de septiembre (emitido a principios de octubre) no cierra octubre; lo que no está queda sin factura', () => {
    const r = clasificar([pref({})], [comp({ fecha: '2026-10-03' })])
    expect(r.vincular).toEqual([])
    expect(r.sinFactura).toHaveLength(1)
  })
})

describe('período efectivo y superposición (Hagana, corte 26–25)', () => {
  it('una prefactura conciliada usa el período realmente facturado', () => {
    const oct = { periodo_desde: '2026-10-01', periodo_hasta_excl: '2026-11-01', conciliacion: { periodo_facturado: { desde: '2026-09-26', hasta: '2026-10-25' } } }
    expect(periodoEfectivo(oct)).toEqual({ desde: '2026-09-26', hastaExcl: '2026-10-26' })
    expect(superpone(periodoEfectivo(oct), { desde: '2026-10-26', hastaExcl: '2026-11-26' })).toBe(false) // noviembre con corte
    expect(superpone(periodoEfectivo(oct), { desde: '2026-09-26', hastaExcl: '2026-10-26' })).toBe(true) // octubre con corte = ya facturado
    expect(superpone(periodoEfectivo({ periodo_desde: '2026-10-01', periodo_hasta_excl: '2026-11-01' }), { desde: '2026-10-26', hastaExcl: '2026-11-26' })).toBe(true)
  })
})

describe('guardas de la emisión real', () => {
  const base = {
    esGerencia: true, prefactura: { id: 'p1', cuit_receptor: '30544099457', tipo_comprobante: 6, total_c: 342451544, periodo_desde: '2026-10-01', periodo_hasta_excl: '2026-11-01' },
    confirmacion: { tipo: 6, cuit: '30-54409945-7', total_c: 342451544 }, confirmoNoEmitidaFuera: true,
    importadasSinConciliar: [], otrasDelServicio: [], ultimaImportacionAt: '2026-11-11T17:41:00Z', ahora: new Date('2026-11-12T12:00:00Z'),
  }
  it('con todo en orden no bloquea', () => {
    expect(guardasEmisionReal(base)).toEqual([])
  })
  it('sólo Gerencia, y sobre el comprobante concreto (tipo, CUIT, total y "no se emitió por fuera"): sin excepción', () => {
    expect(guardasEmisionReal({ ...base, esGerencia: false })).toEqual([expect.objectContaining({ codigo: 'confirmacion', excepcionable: false })])
    expect(guardasEmisionReal({ ...base, confirmacion: { ...base.confirmacion, total_c: 1 } })[0].codigo).toBe('confirmacion')
    expect(guardasEmisionReal({ ...base, confirmacion: null })[0].excepcionable).toBe(false)
    expect(guardasEmisionReal({ ...base, confirmoNoEmitidaFuera: false })[0].codigo).toBe('confirmacion')
  })
  it('factura de ARCA sin conciliar del mismo cliente y período: posible duplicado', () => {
    const r = guardasEmisionReal({ ...base, importadasSinConciliar: [{ tipo: 6, punto_venta: 1, numero: 845, fecha_emision: '2026-11-12', doc_nro_receptor: '30544099457', total_c: 342451544 }] })
    expect(r).toEqual([expect.objectContaining({ codigo: 'posible_duplicado', excepcionable: true })])
    // La de septiembre (emitida el 03/10) no es de este período.
    expect(guardasEmisionReal({ ...base, importadasSinConciliar: [{ tipo: 6, punto_venta: 1, numero: 835, fecha_emision: '2026-10-03', doc_nro_receptor: '30544099457', total_c: 1 }] })).toEqual([])
  })
  it('el servicio ya está emitido en un período superpuesto', () => {
    const r = guardasEmisionReal({ ...base, otrasDelServicio: [{ id: 'otra', estado: 'emitida', periodo_desde: '2026-09-26', periodo_hasta_excl: '2026-10-26' }] })
    expect(r[0]).toMatchObject({ codigo: 'periodo_superpuesto', excepcionable: true })
  })
  it('sin una importación de Mis Comprobantes posterior al período y de los últimos 7 días no se emite', () => {
    expect(guardasEmisionReal({ ...base, ultimaImportacionAt: null })[0].codigo).toBe('importacion_vieja')
    expect(guardasEmisionReal({ ...base, ultimaImportacionAt: '2026-11-01T10:00:00Z', ahora: new Date('2026-11-20T12:00:00Z') })[0].codigo).toBe('importacion_vieja')
    expect(guardasEmisionReal({ ...base, ultimaImportacionAt: '2026-10-30T10:00:00Z', ahora: new Date('2026-10-31T12:00:00Z') })[0].codigo).toBe('importacion_vieja')
  })
})

describe('emisión real: el CAE sólo se pide desde la prefactura y con lo confirmado', () => {
  const e = { ambiente: 'produccion', tipo: 6, estado: 'preparada', prefactura_id: 'p1', solicitud: { cuit_receptor: '30544099457', total_c: 342451544 } }
  it('factura de servicio real preparada o rechazada: el próximo paso pide CAE', () => {
    expect(pideCaeFacturaReal(e)).toBe(true)
    expect(pideCaeFacturaReal({ ...e, estado: 'rechazada' })).toBe(true)
    expect(pideCaeFacturaReal({ ...e, tipo: 201 })).toBe(true)
  })
  it('consultar (incierta/enviando), homologación y notas de crédito/débito no entran', () => {
    expect(pideCaeFacturaReal({ ...e, estado: 'incierta' })).toBe(false)
    expect(pideCaeFacturaReal({ ...e, estado: 'enviando' })).toBe(false)
    expect(pideCaeFacturaReal({ ...e, estado: 'autorizada' })).toBe(false)
    expect(pideCaeFacturaReal({ ...e, ambiente: 'homologacion' })).toBe(false)
    expect(pideCaeFacturaReal({ ...e, tipo: 8, prefactura_id: null })).toBe(false)
    expect(pideCaeFacturaReal({ ...e, tipo: 3 })).toBe(false)
  })
  it('lo preparado tiene que ser lo que confirmó Gerencia (tipo, CUIT y total)', () => {
    const conf = { tipo: 6, cuit: '30-54409945-7', total_c: 342451544 }
    expect(solicitudCoincide(e, conf)).toBe(true)
    expect(solicitudCoincide(e, { ...conf, total_c: 342451545 })).toBe(false)
    expect(solicitudCoincide(e, { ...conf, tipo: 1 })).toBe(false)
    expect(solicitudCoincide(e, { ...conf, cuit: '30707891579' })).toBe(false)
    expect(solicitudCoincide(e, null)).toBe(false)
    expect(solicitudCoincide({ ...e, solicitud: { cuit_receptor: '30544099457' } }, conf)).toBe(false)
  })
  it('número como se lee en la factura', () => {
    expect(numeroComprobante(4, 1)).toBe('0004-00000001')
    expect(numeroComprobante(4, 12345)).toBe('0004-00012345')
  })
})

describe('rutas', () => {
  const leer = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8')
  it('/api/facturacion/emitir: una factura real que pide CAE no sale por emision_id y tiene que coincidir con lo confirmado, ANTES de llamar a ARCA', () => {
    const post = leer('app/api/facturacion/emitir/route.ts').slice(leer('app/api/facturacion/emitir/route.ts').indexOf('export async function POST'))
    const bloque = post.indexOf('if (pideCaeFacturaReal(e))')
    expect(bloque).toBeGreaterThan(0)
    expect(post.indexOf('if (porEmisionId)', bloque)).toBeGreaterThan(bloque)
    expect(post.indexOf('solicitudCoincide(e, b.confirmacion)', bloque)).toBeGreaterThan(bloque)
    // Antes de la llave del servidor, del certificado, del ticket y de ejecutarEmision (que pide el CAE).
    for (const despues of ["process.env.FACTURACION_EMISION_REAL", 'obtenerTA(', 'ejecutarEmision(']) expect(post.indexOf(despues)).toBeGreaterThan(bloque)
  })
  it('/api/facturacion/numero-previsto: sólo lectura (último autorizado + 1), nunca pide CAE ni prepara emisiones', () => {
    const src = leer('app/api/facturacion/numero-previsto/route.ts')
    expect(src).toMatch(/ultimoAutorizado\(/)
    expect(src).not.toMatch(/solicitarCae|FECAESolicitar|fact_emision_preparar|fact_emision_iniciar_envio|ejecutarEmision|export async function POST/)
    expect(src).toMatch(/facturacion_puede_actual/)
    expect(src).toMatch(/homo: false/)
  })
  it('Bandeja: la confirmación de Gerencia muestra cliente, CUIT, período, tipo, total y número previsto', () => {
    const src = leer('components/facturacion/Bandeja.tsx')
    const i = src.indexOf('EMITIR FACTURA REAL EN ARCA')
    const texto = src.slice(i, src.indexOf('`))', i))
    for (const x of ['Cliente:', 'CUIT:', 'Período:', 'Tipo:', 'Importe total:', 'Número previsto:', 'sujeto a la autorización definitiva de ARCA', 'NO se facturó por fuera']) expect(texto).toContain(x)
    // El número se consulta antes de preguntar; sin número no se emite.
    const handler = src.lastIndexOf('Confirmación EXPRESA de Gerencia', i)
    const consulta = src.indexOf('numero-previsto?prefactura_id=', handler)
    expect(handler).toBeGreaterThan(0)
    expect(consulta).toBeGreaterThan(handler)
    expect(consulta).toBeLessThan(i)
    expect(src.slice(consulta, i)).toMatch(/No se emitió nada/)
  })
  it('/api/facturacion/conciliar no habla con ARCA y vincula con la RPC de conciliación', () => {
    const src = leer('app/api/facturacion/conciliar/route.ts')
    expect(src).not.toMatch(/solicitarCae|FECAESolicitar|consultarComprobante|ultimoAutorizado/)
    expect(src).toMatch(/rpc\('fact_prefactura_conciliar'/)
    expect(src).toMatch(/facturacion_puede_actual/)
    expect(src).toMatch(/motivo\.length < 5/) // la manual exige motivo
    // Antes de aplicar 20261212100000: un aviso claro (columna inexistente = 42703), no un error por prefactura.
    expect(src).toMatch(/select\('conciliacion'\)/)
    expect(src).toMatch(/42703/)
  })
  it('/api/facturacion/emitir: las guardas de producción corren ANTES de preparar la emisión (y del CAE)', () => {
    const src = leer('app/api/facturacion/emitir/route.ts')
    const post = src.slice(src.indexOf('export async function POST'))
    expect(post.indexOf('guardasProduccion(c, b)')).toBeGreaterThan(0)
    expect(post.indexOf('guardasProduccion(c, b)')).toBeLessThan(post.indexOf("rpc('fact_emision_preparar'"))
    expect(src).toMatch(/puede_acceder_gerencia_actual/)
    expect(src).toMatch(/fact_excepcion_duplicado/)
  })
})
