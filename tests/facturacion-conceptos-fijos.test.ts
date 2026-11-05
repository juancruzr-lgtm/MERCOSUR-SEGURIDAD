// Contratos mixtos: horas + conceptos mensuales fijos en el mismo comprobante.
// Caso de referencia: Trading Internacional (horas + guardia de alarmas, IVA 21 % en ambos).
import { describe, it, expect } from 'vitest'
import { conceptosFijosDelPeriodo, conceptosParaGrupo, type ConceptoFijoGuardado, type ConceptoFijoVigente } from '@/lib/facturacion/conceptos-fijos'
import { calcularPrefactura, huellaMaterial, type EntradaPrefactura, type HorasAprobadas } from '@/lib/facturacion/prefacturacion'
import { conceptosFijosDeContrato } from '@/lib/facturacion/servidor'

const K = 'k-trading'
const alarma = (id: string, importe: string, desde: string, hasta: string | null, extra: Partial<ConceptoFijoGuardado> = {}): ConceptoFijoGuardado => ({
  id, contrato_id: K, objetivo_id: null, codigo: 'guardia_alarmas', descripcion: 'Servicio de guardia de alarmas', importe,
  tratamiento_iva: 'adicional', alicuota_iva: '21', vigencia_desde: desde, vigencia_hasta: hasta, factura_sin_horas: false, ...extra,
})
// Vigencias como las dejaría fact_concepto_fijo_agregar (cada una cierra la anterior).
const ALARMAS = [
  alarma('a10', '132611.71', '2026-10-01', '2026-10-31'),
  alarma('a11', '135246.77', '2026-11-01', '2026-11-30'),
  alarma('a12', '137970.65', '2026-12-01', null),
]
const OCT = { desde: '2026-10-01', hastaExclusivo: '2026-11-01' }
const NOV = { desde: '2026-11-01', hastaExclusivo: '2026-12-01' }

const horas = (min: number): HorasAprobadas => ({ minutosTotales: min, minutosProgramados: min, minutosCubiertos: min, minutosDescubiertosNoFacturados: 0, fuentes: ['ap1'] })
const entrada = (extra: Partial<EntradaPrefactura> = {}): EntradaPrefactura => ({
  modalidad: 'por_hora', cuitReceptor: '30685441175', periodo: OCT, horas: horas(252 * 60),
  tarifas: [{ id: 't10', concepto: 'hora', precio: '15723.72', tratamientoIva: 'adicional', alicuotaIva: '21' }],
  ajustes: [], separarDiurnaNocturna: false, requiere: [], cumplidos: [], oc: null, anticipoNeto: 0, pendientesComerciales: [], ...extra,
})
const vig = (p = OCT) => conceptosFijosDelPeriodo(ALARMAS, p).vigentes

describe('período y vigencia', () => {
  it('cada mes toma SU importe: oct 132.611,71 · nov 135.246,77 · dic 137.970,65', () => {
    expect(vig(OCT).map(c => c.importe)).toEqual(['132611.71'])
    expect(vig(NOV).map(c => c.importe)).toEqual(['135246.77'])
    expect(vig({ desde: '2026-12-01', hastaExclusivo: '2027-01-01' }).map(c => c.importe)).toEqual(['137970.65'])
  })

  it('un mes fuera de vigencia no lleva el concepto', () => {
    expect(vig({ desde: '2026-09-01', hastaExclusivo: '2026-10-01' })).toEqual([])
    const cerrado = [alarma('x', '1', '2026-10-01', '2026-10-31')]
    expect(conceptosFijosDelPeriodo(cerrado, NOV).vigentes).toEqual([])
  })

  it('período parcial (corte día 26): va ENTERO, sin prorrateo, con el importe vigente al inicio, y avisa el cambio', () => {
    const r = conceptosFijosDelPeriodo(ALARMAS, { desde: '2026-10-26', hastaExclusivo: '2026-11-26' })
    expect(r.vigentes).toHaveLength(1)
    expect(r.vigentes[0].importe).toBe('132611.71')
    expect(r.avisos[0]).toMatch(/cambia de importe dentro del período/)
  })

  it('una vigencia que empieza a mitad del período (sin una anterior) se factura entera ese período', () => {
    const r = conceptosFijosDelPeriodo([alarma('m', '1000', '2026-10-15', null)], OCT)
    expect(r.vigentes.map(c => c.importe)).toEqual(['1000'])
  })
})

describe('un solo comprobante por concepto', () => {
  const v: ConceptoFijoVigente[] = [
    { ...vig()[0] },
    { id: 'mon', codigo: 'monitoreo', descripcion: 'Monitoreo', importe: '50000', tratamientoIva: 'exento', alicuotaIva: '0', objetivoId: 'o2', facturaSinHoras: false },
  ]
  it('del contrato → al comprobante del contrato entero; con objetivo → al que incluye ese objetivo', () => {
    const grupos = [{ clave: 'contrato:k', objIds: ['o1'] }, { clave: 'grupo:k:b', objIds: ['o2'] }]
    expect(conceptosParaGrupo(v, grupos[0], grupos).conceptos.map(c => c.codigo)).toEqual(['guardia_alarmas'])
    expect(conceptosParaGrupo(v, grupos[1], grupos).conceptos.map(c => c.codigo)).toEqual(['monitoreo'])
  })
  it('varios comprobantes por objetivo: el del contrato va sólo en el primero por clave (nunca en dos)', () => {
    const grupos = [{ clave: 'objetivo:o2', objIds: ['o2'] }, { clave: 'objetivo:o1', objIds: ['o1'] }]
    const total = grupos.flatMap(g => conceptosParaGrupo(v, g, grupos).conceptos.filter(c => c.codigo === 'guardia_alarmas'))
    expect(total).toHaveLength(1)
    expect(conceptosParaGrupo(v, grupos[1], grupos).conceptos.map(c => c.codigo)).toContain('guardia_alarmas')
  })
  it('concepto de un objetivo que no se factura en el período: queda huérfano, no se inventa comprobante', () => {
    const grupos = [{ clave: 'contrato:k', objIds: ['o1'] }]
    expect(conceptosParaGrupo(v, grupos[0], grupos).huerfanos.map(c => c.codigo)).toEqual(['monitoreo'])
  })
})

describe('motor de prefacturas', () => {
  it('TRADING oct-2026: horas + alarmas en el MISMO comprobante, IVA 21 % en cada renglón', () => {
    const r = calcularPrefactura(entrada({ conceptosFijos: vig() }))
    expect(r.lineas.map(l => l.concepto)).toEqual(['Horas de vigilancia', 'Servicio de guardia de alarmas'])
    const [h, a] = r.lineas
    expect(h.importes).toEqual({ neto: 396237744, iva: 83209926, total: 479447670 }) // 252 h × 15.723,72
    expect(a.importes).toEqual({ neto: 13261171, iva: 2784846, total: 16046017 })   // 132.611,71 + 21 %
    expect(a.conceptoFijoId).toBe('a10')
    expect(r.importes).toEqual({ neto: h.importes.neto + a.importes.neto, iva: h.importes.iva + a.importes.iva, total: h.importes.total + a.importes.total })
    expect(r.requisitos).toEqual([])
  })

  it('el mismo concepto pasado dos veces sale una sola vez', () => {
    const r = calcularPrefactura(entrada({ conceptosFijos: [...vig(), ...vig()] }))
    expect(r.lineas.filter(l => l.concepto === 'Servicio de guardia de alarmas')).toHaveLength(1)
  })

  it('sin horas aprobadas NO se factura el concepto fijo (queda el requisito de horas y un aviso)', () => {
    const r = calcularPrefactura(entrada({ horas: null, conceptosFijos: vig() }))
    expect(r.importes).toBeNull()
    expect(r.lineas).toEqual([])
    expect(r.requisitos.map(x => x.tipo)).toContain('horas_aprobadas')
    expect(r.avisos.join(' ')).toMatch(/no se incluye: no hay horas aprobadas/)
  })

  it('con factura_sin_horas (decisión contractual expresa) se factura sólo el concepto fijo', () => {
    const c = { ...vig()[0], facturaSinHoras: true }
    const r = calcularPrefactura(entrada({ horas: null, conceptosFijos: [c] }))
    expect(r.lineas.map(l => l.concepto)).toEqual(['Servicio de guardia de alarmas'])
    expect(r.importes?.total).toBe(16046017)
    expect(r.requisitos.map(x => x.tipo)).not.toContain('horas_aprobadas')
  })

  it('IVA por concepto: un concepto exento no suma IVA aunque las horas sí', () => {
    const exento: ConceptoFijoVigente = { id: 'e', codigo: 'monitoreo', descripcion: 'Monitoreo', importe: '50000', tratamientoIva: 'exento', alicuotaIva: '0', objetivoId: null, facturaSinHoras: false }
    const r = calcularPrefactura(entrada({ conceptosFijos: [exento] }))
    expect(r.lineas[1].importes).toEqual({ neto: 5000000, iva: 0, total: 5000000 })
  })

  it('IVA sin definir en el concepto: no se calcula y se pide definirlo (no se infiere)', () => {
    const c = { ...vig()[0], tratamientoIva: 'sin_definir' as const }
    const r = calcularPrefactura(entrada({ conceptosFijos: [c] }))
    expect(r.importes).toBeNull()
    expect(r.requisitos.some(x => x.tipo === 'iva_definido' && /guardia de alarmas/.test(x.detalle))).toBe(true)
  })

  it('contrato por abono + concepto fijo: ambos renglones', () => {
    const r = calcularPrefactura(entrada({ modalidad: 'abono', horas: null, tarifas: [{ id: 'ab', concepto: 'abono', precio: '1000000', tratamientoIva: 'adicional', alicuotaIva: '21' }], conceptosFijos: vig() }))
    expect(r.lineas.map(l => l.concepto)).toEqual(['Abono mensual', 'Servicio de guardia de alarmas'])
  })

  it('sin conceptos fijos el resultado es el de siempre (las tarifas horarias no cambian)', () => {
    const antes = calcularPrefactura(entrada())
    const despues = calcularPrefactura(entrada({ conceptosFijos: [] }))
    expect(despues).toEqual(antes)
    expect(antes.lineas).toHaveLength(1)
  })

  it('la huella de aprobación cambia si cambia el importe del concepto', () => {
    const base = (c: ConceptoFijoVigente[]) => {
      const r = calcularPrefactura(entrada({ conceptosFijos: c }))
      return huellaMaterial({ cuitReceptor: '30685441175', tipoComprobante: 1, periodo: OCT, lineas: r.lineas, importes: r.importes, texto: 't', vencimiento: null })
    }
    expect(base(vig())).not.toBe(base([{ ...vig()[0], importe: '132611.72' }]))
    expect(base(vig())).not.toBe(base([]))
  })
})

describe('servidor', () => {
  const dbCon = (resultado: { data: any; error: any }) => ({
    from: () => { const q: any = { select: () => q, eq: () => q, lt: () => q, or: () => Promise.resolve(resultado) }; return q },
  }) as any
  it('sin la migración aplicada (tabla inexistente) el contrato se factura como siempre', async () => {
    const r = await conceptosFijosDeContrato(dbCon({ data: null, error: { code: '42P01', message: 'relation "public.fact_conceptos_fijos" does not exist' } }), K, OCT)
    expect(r).toEqual({ vigentes: [], avisos: [] })
    const r2 = await conceptosFijosDeContrato(dbCon({ data: null, error: { code: 'PGRST205', message: "Could not find the table 'public.fact_conceptos_fijos'" } }), K, OCT)
    expect(r2.vigentes).toEqual([])
  })
  it('otro error de lectura no se esconde', async () => {
    await expect(conceptosFijosDeContrato(dbCon({ data: null, error: { code: '42501', message: 'permission denied' } }), K, OCT)).rejects.toThrow(/permission denied/)
  })
  it('con datos, aplica la regla del período', async () => {
    const r = await conceptosFijosDeContrato(dbCon({ data: ALARMAS, error: null }), K, NOV)
    expect(r.vigentes.map(c => c.importe)).toEqual(['135246.77'])
  })
})

describe('pantalla: carga de conceptos', () => {
  it('importeDecimal: formato argentino y con punto decimal', async () => {
    const { importeDecimal, codigoDesde } = await import('@/components/facturacion/ConceptosFijos')
    expect(importeDecimal('132.611,71')).toBe('132611.71')
    expect(importeDecimal('$ 135.246,77')).toBe('135246.77')
    expect(importeDecimal('137970.65')).toBe('137970.65')
    expect(importeDecimal('   ')).toBeNull()
    expect(codigoDesde('Servicio de guardia de alarmas')).toBe('servicio_de_guardia_de_alarmas')
    expect(codigoDesde('Monitoreo 24 h')).toBe('monitoreo_24_h')
  })
})
