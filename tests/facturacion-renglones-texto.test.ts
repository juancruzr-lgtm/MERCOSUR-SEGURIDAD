import { describe, expect, it } from 'vitest'
import {
  calcularPrefactura, minutosAFacturar, renglonesPorObjetivo, tarifasParaObjetivo, textoRenglon,
  type EntradaPrefactura, type HorasAprobadas, type TarifaGuardada,
} from '@/lib/facturacion/prefacturacion'

const tar = (id: string, precio: string, objetivo_id: string | null = null): TarifaGuardada =>
  ({ id, concepto: 'hora', precio, tratamiento_iva: 'incluido', alicuota_iva: '21', objetivo_id })
const foto = (min: number): HorasAprobadas =>
  ({ minutosTotales: min, minutosProgramados: min, minutosCubiertos: min, minutosDescubiertosNoFacturados: 0, fuentes: ['ap'] })
const entrada = (e: Partial<EntradaPrefactura>): EntradaPrefactura => ({
  modalidad: 'por_hora', cuitReceptor: '30999003156', periodo: { desde: '2026-10-01', hastaExclusivo: '2026-11-01' }, horas: null, tarifas: [],
  ajustes: [], separarDiurnaNocturna: false, requiere: [], cumplidos: [], oc: null, anticipoNeto: 0, pendientesComerciales: [], ...e,
})

const LIC = 'Licitación privada n° 21/2026 expte. n° 4863/2026 para la contratación del servicio de seguridad y vigilancia para actividades organizadas por la secretaria de cultura y educación - rosario- santa fe {mes} {año} -'

describe('texto del renglón', () => {
  it('completa mes, año, período y objetivo', () => {
    const t = textoRenglon('Servicio {objetivo} {mes} {año} ({periodo})', { mes: '2026-10', periodo: { desde: '2026-10-01', hastaExclusivo: '2026-11-01' }, objetivo: 'Feria' })
    expect(t).toBe('Servicio Feria octubre 2026 (01/10/2026 al 31/10/2026)')
  })
  it('vacío no inventa texto', () => {
    expect(textoRenglon('  ', { mes: '2026-10', periodo: { desde: '2026-10-01', hastaExclusivo: '2026-11-01' }, objetivo: 'x' })).toBeNull()
  })
  it('período de corte: {mes} es el mes de prestación, no el del primer día', () => {
    const t = textoRenglon('{mes} {periodo}', { mes: '2026-10', periodo: { desde: '2026-09-26', hastaExclusivo: '2026-10-26' }, objetivo: 'x' })
    expect(t).toBe('octubre 26/09/2026 al 25/10/2026')
  })
})

describe('factura de Cultura de octubre 2026 (caso real)', () => {
  const objs = [
    { objetivo_id: 'ballet', nombre: 'ESCUELA DE BALLET (CULTURA)', texto: `${LIC} Escuela de Ballet` },
    { objetivo_id: 'peat', nombre: 'NOCHE DE LAS PEATONALES (CULTURA)', texto: `${LIC} Noche de las peatonales` },
    { objetivo_id: 'plan', nombre: 'PLANETARIO (CULTURA)', texto: `${LIC} Planetario` },
    { objetivo_id: 'feria', nombre: 'FERIA DEL LIBRO (CULTURA)', texto: `${LIC} Feria del Libro` },
    { objetivo_id: 'event', nombre: 'Servicio eventual', texto: null },
  ]
  const todas = objs.map(o => tar(o.objetivo_id, '13900', o.objetivo_id))
  // Horas de la planilla cargadas como "a facturar" (Reportes: Peatonales 106,75 y Feria 1.957,5).
  const facturar: Record<string, number> = { ballet: 600, peat: 109 * 60, plan: 360, feria: 1963 * 60, event: 0 }

  it('sólo cantidad × precio, con el texto de la licitación y sin renglones de ajuste', () => {
    const porObjetivo = renglonesPorObjetivo(objs, todas, 'por_hora', id => foto(facturar[id]))
    const total = Object.values(facturar).reduce((a, b) => a + b, 0)
    const r = calcularPrefactura(entrada({ horas: foto(total), tarifas: tarifasParaObjetivo(todas, null), porObjetivo, mes: '2026-10' }))
    expect(r.lineas.map(l => [l.concepto.split(' - ').pop(), l.cantidad, l.precio])).toEqual([
      ['Escuela de Ballet', '10', '13900'],
      ['Noche de las peatonales', '109', '13900'],
      ['Planetario', '6', '13900'],
      ['Feria del Libro', '1963', '13900'],
    ])
    expect(r.lineas[0].concepto).toContain('santa fe octubre 2026 - Escuela de Ballet')
    expect(r.lineas.some(l => l.concepto.startsWith('Ajuste'))).toBe(false)
    expect(r.importes?.total).toBe(2902320000)
  })
})

describe('horas a facturar', () => {
  it('con horas según planilla se factura eso; sin ellas, lo aprobado de Reportes', () => {
    expect(minutosAFacturar({ minutos_aprobados: 117450, minutos_facturar: 117780 })).toBe(117780)
    expect(minutosAFacturar({ minutos_aprobados: 117450, minutos_facturar: null })).toBe(117450)
    expect(minutosAFacturar({ minutos_aprobados: 600, minutos_facturar: 0 })).toBe(0)
  })
})

describe('un solo objetivo con texto propio', () => {
  it('Teatro: el renglón usa el texto del contrato', () => {
    const r = calcularPrefactura(entrada({ horas: foto(196 * 60), tarifas: [{ id: 't', concepto: 'hora', precio: '14750', tratamientoIva: 'incluido', alicuotaIva: '21' }],
      textoRenglon: 'Servicio de seguridad y vigilancia Teatro Municipal La Comedia {mes} {año} Período {periodo} Expte. 22791/2026.', mes: '2026-10' }))
    expect(r.lineas).toHaveLength(1)
    expect(r.lineas[0].concepto).toBe('Servicio de seguridad y vigilancia Teatro Municipal La Comedia octubre 2026 Período 01/10/2026 al 31/10/2026 Expte. 22791/2026.')
    expect(r.importes?.total).toBe(289100000)
  })
  it('sin texto, el genérico de siempre', () => {
    const r = calcularPrefactura(entrada({ horas: foto(600), tarifas: [{ id: 't', concepto: 'hora', precio: '1000', tratamientoIva: 'incluido', alicuotaIva: '21' }] }))
    expect(r.lineas[0].concepto).toBe('Horas de vigilancia')
  })
})
