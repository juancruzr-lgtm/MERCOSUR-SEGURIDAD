import { describe, expect, it } from 'vitest'
import {
  agruparObjetivos, calcularPrefactura, objetivosEnOtraPrefactura, renglonesPorObjetivo, tarifasParaObjetivo,
  type EntradaPrefactura, type HorasAprobadas, type TarifaGuardada,
} from '@/lib/facturacion/prefacturacion'
import {
  elegibleParaAceptarTodos, filasExcel, motivosRevision, objetivoAlDia, objetivosParaAceptar, propuestaDeFila, type FilaRevision,
} from '@/lib/facturacion/revision'

const K = 'k1'
const tar = (id: string, concepto: string, precio: string, objetivo_id: string | null = null): TarifaGuardada =>
  ({ id, concepto, precio, tratamiento_iva: 'adicional', alicuota_iva: '21', objetivo_id })
const foto = (min: number, extra: Partial<HorasAprobadas> = {}): HorasAprobadas =>
  ({ minutosTotales: min, minutosProgramados: min, minutosCubiertos: min, minutosDescubiertosNoFacturados: 0, fuentes: ['ap'], ...extra })
const entrada = (e: Partial<EntradaPrefactura>): EntradaPrefactura => ({
  modalidad: 'por_hora', cuitReceptor: '30501125594', periodo: { desde: '2026-10-01', hastaExclusivo: '2026-11-01' }, horas: null, tarifas: [],
  ajustes: [], separarDiurnaNocturna: false, requiere: [], cumplidos: [], oc: null, anticipoNeto: 0, pendientesComerciales: [], ...e,
})

describe('tarifa general y tarifa específica', () => {
  const todas = [tar('g', 'hora', '1000'), tar('m', 'hora', '1500', 'macro')]
  it('el objetivo con precio propio usa el suyo; los demás, el general', () => {
    expect(tarifasParaObjetivo(todas, 'macro')[0]).toMatchObject({ id: 'm', precio: '1500' })
    expect(tarifasParaObjetivo(todas, 'castagnino')[0]).toMatchObject({ id: 'g', precio: '1000' })
    expect(tarifasParaObjetivo(todas, null)[0]).toMatchObject({ id: 'g' })
  })
  it('sin tarifa general ni propia no inventa precio', () => {
    expect(tarifasParaObjetivo([tar('m', 'hora', '1500', 'macro')], 'castagnino')).toEqual([])
  })
})

describe('distintos precios dentro de una factura', () => {
  const objs = [{ objetivo_id: 'macro', nombre: 'MUSEO MACRO' }, { objetivo_id: 'cast', nombre: 'MUSEO CASTAGNINO' }]
  const horasDe = (id: string) => foto(id === 'macro' ? 600 : 1200)

  it('un renglón por objetivo, cada uno con su precio, y el total es la suma', () => {
    const todas = [tar('g', 'hora', '1000'), tar('m', 'hora', '1500', 'macro')]
    const porObjetivo = renglonesPorObjetivo(objs, todas, 'por_hora', horasDe)
    const r = calcularPrefactura(entrada({ horas: foto(1800), tarifas: tarifasParaObjetivo(todas, null), porObjetivo }))
    expect(r.lineas.map(l => [l.concepto, l.cantidad, l.precio])).toEqual([
      ['Horas de vigilancia — MUSEO MACRO', '10', '1500'], ['Horas de vigilancia — MUSEO CASTAGNINO', '20', '1000']])
    expect(r.importes?.neto).toBe(10 * 150000 + 20 * 100000)
  })

  it('si todos usan la tarifa general, queda un solo renglón como hasta ahora (no cambia lo ya calculado)', () => {
    expect(renglonesPorObjetivo(objs, [tar('g', 'hora', '1000')], 'por_hora', horasDe)).toBeUndefined()
    const r = calcularPrefactura(entrada({ horas: foto(1800), tarifas: [tarifasParaObjetivo([tar('g', 'hora', '1000')], null)[0]] }))
    expect(r.lineas.map(l => [l.concepto, l.cantidad])).toEqual([['Horas de vigilancia', '30']])
  })

  it('diurnas y nocturnas con precios distintos por objetivo', () => {
    const todas = [tar('d', 'hora_diurna', '1000'), tar('n', 'hora_nocturna', '1200'), tar('dn', 'hora_nocturna', '1300', 'er')]
    const o2 = [{ objetivo_id: 'sf', nombre: 'SANTA FE' }, { objetivo_id: 'er', nombre: 'ENTRE RIOS' }]
    const porObjetivo = renglonesPorObjetivo(o2, todas, 'por_hora', () => foto(720, { minutosDiurnos: 480, minutosNocturnos: 240 }))
    const r = calcularPrefactura(entrada({ horas: foto(1440, { minutosDiurnos: 960, minutosNocturnos: 480 }), separarDiurnaNocturna: true, porObjetivo }))
    expect(r.lineas.map(l => [l.concepto, l.precio])).toEqual([
      ['Horas diurnas — SANTA FE', '1000'], ['Horas nocturnas — SANTA FE', '1200'],
      ['Horas diurnas — ENTRE RIOS', '1000'], ['Horas nocturnas — ENTRE RIOS', '1300']])
  })

  it('un objetivo sin precio (ni propio ni general) bloquea la factura en vez de facturarlo en cero', () => {
    const porObjetivo = renglonesPorObjetivo(objs, [tar('m', 'hora', '1500', 'macro')], 'por_hora', horasDe)
    const r = calcularPrefactura(entrada({ horas: foto(1800), porObjetivo }))
    expect(r.importes).toBeNull()
    expect(r.requisitos.some(x => x.tipo === 'tarifa_definida')).toBe(true)
  })

  it('abono conjunto: el general se cobra una sola vez; el objetivo con abono propio va aparte', () => {
    const o2 = [{ objetivo_id: 'srt', nombre: 'SRT' }, { objetivo_id: 'vt', nombre: 'SRT VENADO TUERTO' }]
    expect(renglonesPorObjetivo(o2, [tar('a', 'abono', '19626154')], 'abono', () => null)).toBeUndefined()
    const porObjetivo = renglonesPorObjetivo(o2, [tar('a', 'abono', '100'), tar('v', 'abono', '40', 'vt')], 'abono', () => null)!
    const r = calcularPrefactura(entrada({ modalidad: 'abono', porObjetivo }))
    expect(r.lineas.map(l => [l.concepto, l.precio])).toEqual([['Abono mensual — SRT VENADO TUERTO', '40'], ['Abono mensual — SRT', '100']])
  })
})

describe('agrupación de objetivos en facturas', () => {
  const v = (objetivo_id: string, grupo_factura: string | null = null) => ({ objetivo_id, grupo_factura, objetivo: { nombre: objetivo_id.toUpperCase() } })

  it('sin grupos cargados las claves son las de siempre (no cambia ninguna agrupación existente)', () => {
    expect(agruparObjetivos({ id: K, agrupacion: 'objetivo' }, [v('a'), v('b')]).map(g => [g.clave, g.objetivoId]))
      .toEqual([['objetivo:a', 'a'], ['objetivo:b', 'b']])
    expect(agruparObjetivos({ id: K, agrupacion: 'cliente' }, [v('a'), v('b')]).map(g => [g.clave, g.objetivoId, g.objs.length]))
      .toEqual([[`contrato:${K}`, null, 2]])
    expect(agruparObjetivos({ id: K, agrupacion: 'cliente' }, []).map(g => g.clave)).toEqual([`contrato:${K}`])
    expect(agruparObjetivos({ id: K, agrupacion: 'objetivo' }, [])).toEqual([])
  })

  it('Municipalidad: dos grupos y un objetivo con factura propia', () => {
    const gs = agruparObjetivos({ id: K, agrupacion: 'objetivo' }, [v('macro', 'Museos'), v('cast', 'museos '), v('casona'), v('plaza', 'Plazas')])
    expect(gs.map(g => [g.clave, g.objs.map(o => o.objetivo_id), g.objetivoId])).toEqual([
      [`grupo:${K}:museos`, ['macro', 'cast'], null], ['objetivo:casona', ['casona'], 'casona'], [`grupo:${K}:plazas`, ['plaza'], 'plaza']])
  })

  it('cambiar la agrupación no altera las horas: el total facturable es el mismo', () => {
    const minutos: Record<string, number> = { a: 600, b: 900, c: 300 }
    const total = (gs: ReturnType<typeof agruparObjetivos>) => gs.reduce((s, g) => s + g.objs.reduce((x, o) => x + minutos[o.objetivo_id], 0), 0)
    const antes = agruparObjetivos({ id: K, agrupacion: 'objetivo' }, [v('a'), v('b'), v('c')])
    const despues = agruparObjetivos({ id: K, agrupacion: 'objetivo' }, [v('a', 'X'), v('b', 'X'), v('c')])
    expect(antes).toHaveLength(3)
    expect(despues).toHaveLength(2)
    expect(total(despues)).toBe(total(antes))
  })

  it('reagrupar no factura dos veces: el objetivo que sigue en otra prefactura viva se detecta', () => {
    const otras = [
      { agrupacion_clave: 'objetivo:a', objetivo_id: 'a', estado: 'emitida' },
      { agrupacion_clave: 'objetivo:b', objetivo_id: 'b', estado: 'descartada' },
      { agrupacion_clave: `contrato:${K}`, objetivo_id: null, objetivos_incluidos: null, estado: 'lista_revision' },
    ]
    expect(objetivosEnOtraPrefactura(otras, `grupo:${K}:x`, ['a', 'b'], ['a', 'b', 'c']).map(o => [o.objetivoId, o.estado]))
      .toEqual([['a', 'emitida'], ['a', 'lista_revision'], ['b', 'lista_revision']])
    expect(objetivosEnOtraPrefactura(otras.slice(0, 2), 'objetivo:a', ['a'], ['a'])).toEqual([])
    expect(objetivosEnOtraPrefactura([{ agrupacion_clave: `grupo:${K}:y`, objetivos_incluidos: ['c'], estado: 'en_preparacion' }], `grupo:${K}:x`, ['a', 'b'], ['a', 'b', 'c'])).toEqual([])
  })
})

describe('revisión: aceptar, aceptar todos y correcciones posteriores', () => {
  const prop = (min: number, extra: any = {}) => ({ horas: { minutosCubiertos: min, minutosDescubiertos: 0, turnosFuturos: 0, turnosSinRegistro: 0, revisar: [], ...extra.horas }, franjaDefinida: true, ...extra.r })
  const fila = (objetivos: FilaRevision['objetivos'], extra: Partial<FilaRevision> = {}): FilaRevision =>
    ({ modalidad: 'por_hora', separarDiurnaNocturna: false, tarifas: [tar('g', 'hora', '1000')], objetivos, prefactura: null, ...extra })
  const o = (id: string, propuesta: any, aprobada: number | null = null, extra: any = {}) =>
    ({ objetivoId: id, nombre: id.toUpperCase(), propuesta, error: null, aprobada: aprobada == null ? null : { minutos_aprobados: aprobada }, ...extra })

  it('aceptación individual: sólo los objetivos sin aprobar o con propuesta distinta', () => {
    const f = fila([o('a', prop(600), 600), o('b', prop(900)), o('c', prop(300), 240)])
    expect(objetivoAlDia(f.objetivos[0])).toBe(true)
    expect(objetivosParaAceptar(f).map(x => x.objetivoId)).toEqual(['b', 'c'])
    expect(propuestaDeFila(f)).toBe(1800)
  })

  it('aceptar todos: entra lo limpio y pendiente; lo ya aceptado no', () => {
    expect(elegibleParaAceptarTodos(fila([o('a', prop(600))]))).toBe(true)
    expect(elegibleParaAceptarTodos(fila([o('a', prop(600), 600)]))).toBe(false)
    expect(elegibleParaAceptarTodos(fila([o('a', null)]))).toBe(false) // todavía calculando
  })

  it('aceptar todos no toma diferencias, faltas de tarifa ni inconsistencias', () => {
    const casos: Array<[string, FilaRevision]> = [
      ['superposición', fila([o('a', prop(600, { horas: { revisar: [{ fecha: '2026-10-02', detalle: 'x' }] } }))])],
      ['turnos sin horas', fila([o('a', prop(600, { horas: { turnosSinRegistro: 2 } }))])],
      ['descubiertas sin decidir', fila([o('a', prop(600, { horas: { minutosDescubiertos: 120 } }))])],
      ['sin tarifa', fila([o('a', prop(600))], { tarifas: [] })],
      ['tarifa sólo de otro objetivo', fila([o('a', prop(600)), o('b', prop(60))], { tarifas: [tar('x', 'hora', '1', 'a')] })],
      ['falta franja nocturna', fila([o('a', prop(600, { r: { franjaDefinida: false } }))], { separarDiurnaNocturna: true, tarifas: [tar('d', 'hora_diurna', '1'), tar('n', 'hora_nocturna', '1')] })],
      ['error de cálculo', fila([{ ...o('a', null), error: 'timeout' }])],
    ]
    for (const [nombre, f] of casos) {
      expect(motivosRevision(f).length, nombre).toBeGreaterThan(0)
      expect(elegibleParaAceptarTodos(f), nombre).toBe(false)
    }
  })

  it('descubiertas decididas en Ver turnos dejan de bloquear y cambian la propuesta', () => {
    const p = prop(600, { horas: { minutosDescubiertos: 120 } })
    expect(elegibleParaAceptarTodos(fila([o('a', p, null, { tratamiento: 'no_facturar' })]))).toBe(true)
    expect(propuestaDeFila(fila([o('a', p, null, { tratamiento: 'facturar' })]))).toBe(720)
  })

  it('corrección posterior en Reportes: se marca la diferencia y no se reemplaza sola', () => {
    const desvio = { r: { desvio: { hayDiferencia: true, cubiertosAprobados: 600, cubiertosActuales: 660 } } }
    const f = fila([o('a', prop(660, desvio), 600)])
    expect(motivosRevision(f).join(' ')).toMatch(/Reportes cambió después de aprobar: aprobado 10 h, hoy 11 h/)
    expect(elegibleParaAceptarTodos(f)).toBe(false)
    expect(objetivosParaAceptar(f).map(x => x.objetivoId)).toEqual(['a']) // a mano sí se puede reemplazar
  })

  it('prefactura aprobada o emitida: protegida, no entra en aceptar todos', () => {
    for (const estado of ['aprobada_emitir', 'emitida']) {
      const f = fila([o('a', prop(660), 600)], { prefactura: { estado } })
      expect(motivosRevision(f)[0]).toMatch(/no se cambia/)
      expect(elegibleParaAceptarTodos(f)).toBe(false)
    }
  })

  it('abono: no tiene horas para aceptar, pero se controla su tarifa', () => {
    expect(elegibleParaAceptarTodos(fila([o('a', null)], { modalidad: 'abono', tarifas: [tar('a', 'abono', '1')] }))).toBe(false)
    expect(motivosRevision(fila([], { modalidad: 'abono', tarifas: [] }))).toEqual(['Sin tarifa vigente'])
  })
})

describe('Excel de prefacturas con precio por renglón', () => {
  it('cada renglón lleva su precio unitario y el grupo; total aparte', () => {
    const lineas = [
      { concepto: 'Horas de vigilancia — MUSEO MACRO', cantidad: '10', precio: '1500', importes: { neto: 1500000, iva: 315000, total: 1815000 } },
      { concepto: 'Horas de vigilancia — MUSEO CASTAGNINO', cantidad: '20', precio: '1000', importes: { neto: 2000000, iva: 420000, total: 2420000 } },
    ]
    const rows = filasExcel([{ cliente: { razon_social: 'MUNICIPALIDAD DE ROSARIO', cuit: '30999003156' }, tipo_comprobante: 6, agrupacion_clave: `grupo:${K}:museos`,
      grupo: 'Museos', periodo_desde: '2026-10-01', periodo_hasta_excl: '2026-11-01', lineas, neto_c: 3500000, iva_c: 735000, total_c: 4235000, requisitos: [] }], () => 'Borrador')
    expect(rows[0]).toContain('Precio unitario')
    expect(rows.slice(1).map(r => [r[3], r[4], r[5], r[6], r[7], r[10]])).toEqual([
      ['Museos', '01/10/2026 – 31/10/2026', 'Horas de vigilancia — MUSEO MACRO', 10, 1500, 18150],
      ['Museos', '01/10/2026 – 31/10/2026', 'Horas de vigilancia — MUSEO CASTAGNINO', 20, 1000, 24200],
      ['Museos', '01/10/2026 – 31/10/2026', 'TOTAL', null, null, 42350],
    ])
  })
})
