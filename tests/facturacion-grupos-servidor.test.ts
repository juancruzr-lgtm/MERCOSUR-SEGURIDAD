// Generación de prefacturas con grupos de factura y precio por objetivo, por el
// camino real del servidor (generarPrefacturas) sobre una base en memoria.
import { describe, expect, it } from 'vitest'
import { generarPrefacturas } from '@/lib/facturacion/servidor'

const K = 'k-muni'
const contrato = { id: K, cliente_id: 'c-muni', nombre: 'Municipalidad', modalidad: 'por_hora', agrupacion: 'objetivo', regla_periodo: 'mes_calendario',
  estado: 'vigente', requisitos: [], pendientes_comerciales: [], tipo_comprobante: 6, dias_vencimiento: 30, separar_diurna_nocturna: false,
  cliente: { id: 'c-muni', cuit: '30999003156', razon_social: 'MUNICIPALIDAD DE ROSARIO', condicion_iva: 'exento', tipo_comprobante: null } }
const vinc = (objetivo_id: string, nombre: string, grupo_factura: string | null) =>
  ({ id: `v-${objetivo_id}`, contrato_id: K, objetivo_id, desde: null, hasta: null, anulado_at: null, grupo_factura, objetivo: { id: objetivo_id, nombre } })
const tarifa = (id: string, precio: string, objetivo_id: string | null) =>
  ({ id, contrato_id: K, objetivo_id, concepto: 'hora', precio, tratamiento_iva: 'exento', alicuota_iva: '0', vigencia_desde: '2026-10-01', vigencia_hasta: null })
const ap = (objetivo_id: string, min: number) => ({ id: `ap-${objetivo_id}`, contrato_id: K, objetivo_id, periodo_desde: '2026-10-01', periodo_hasta_excl: '2026-11-01',
  estado: 'aprobada', minutos_aprobados: min, minutos_programados: min, minutos_cubiertos: min, minutos_descubiertos: 0, tratamiento_descubiertos: 'no_facturar' })

function baseEnMemoria(tablas: Record<string, any[]>) {
  const guardadas: any[] = []
  const desde = (nombre: string) => {
    const filtros: Array<(r: any) => boolean> = []
    const q: any = {
      select() { return q },
      eq(c: string, v: any) { filtros.push(r => r[c] === v); return q },
      neq(c: string, v: any) { filtros.push(r => r[c] !== v); return q },
      in(c: string, vs: any[]) { filtros.push(r => vs.includes(r[c])); return q },
      is(c: string, v: any) { filtros.push(r => (r[c] ?? null) === v); return q },
      lte(c: string, v: any) { filtros.push(r => r[c] <= v); return q },
      gt(c: string, v: any) { filtros.push(r => r[c] > v); return q },
      lt(c: string, v: any) { filtros.push(r => r[c] < v); return q },
      not() { return q }, or() { return q }, order() { return q }, limit() { return q },
      maybeSingle: async () => ({ data: (tablas[nombre] ?? []).filter(r => filtros.every(f => f(r)))[0] ?? null, error: null }),
      then: (ok: any, mal: any) => Promise.resolve({ data: (tablas[nombre] ?? []).filter(r => filtros.every(f => f(r))), error: null }).then(ok, mal),
    }
    return q
  }
  const db: any = {
    from: desde,
    rpc: async (fn: string, args: any) => { if (fn === 'fact_prefactura_guardar') guardadas.push(args); return { data: 'p-nueva', error: null } },
  }
  return { db, guardadas }
}

const tablasBase = (extra: Record<string, any[]> = {}) => ({
  fact_contratos: [contrato],
  fact_config: [{ clave: 'emision', valor: { punto_venta: 3 } }],
  fact_contrato_objetivos: [vinc('macro', 'MUSEO MACRO', 'Museos'), vinc('cast', 'MUSEO CASTAGNINO', 'Museos'), vinc('casona', 'LA CASONA', null)],
  fact_tarifas: [tarifa('t-gral', '1000', null), tarifa('t-macro', '1500', 'macro')],
  fact_horas_aprobaciones: [ap('macro', 600), ap('cast', 1200), ap('casona', 300)],
  fact_prefacturas: [], fact_ordenes_compra: [], fact_conformidades: [], fact_ajustes: [],
  ...extra,
})

describe('generarPrefacturas con grupos de factura', () => {
  it('Museos en una factura con un precio por objetivo; La Casona aparte con el general', async () => {
    const { db, guardadas } = baseEnMemoria(tablasBase())
    const r = await generarPrefacturas(db, '2026-10', '2026-11-04')
    expect(r.errores).toEqual([])
    expect(r.creadas).toBe(2)
    const museos = guardadas.find(g => g.p_datos.agrupacion_clave === `grupo:${K}:museos`)!.p_datos
    expect(museos.objetivo_id).toBeNull()
    expect(museos.objetivos_incluidos).toEqual(['macro', 'cast'])
    expect(museos.lineas.map((l: any) => [l.concepto, l.cantidad, l.precio])).toEqual([
      ['Horas de vigilancia — MUSEO MACRO', '10', '1500'], ['Horas de vigilancia — MUSEO CASTAGNINO', '20', '1000']])
    expect(museos.total_c).toBe(10 * 150000 + 20 * 100000)
    expect(museos.minutos_aprobados).toBe(1800) // las horas son las aprobadas: agrupar no las cambia
    const casona = guardadas.find(g => g.p_datos.agrupacion_clave === 'objetivo:casona')!.p_datos
    expect(casona.lineas.map((l: any) => [l.concepto, l.precio])).toEqual([['Horas de vigilancia', '1000']])
    expect(casona.objetivos_incluidos).toEqual(['casona'])
  })

  it('sin grupos cargados genera las mismas claves y renglones que antes', async () => {
    const vs = tablasBase().fact_contrato_objetivos.map(v => ({ ...v, grupo_factura: null }))
    const { db, guardadas } = baseEnMemoria(tablasBase({ fact_contrato_objetivos: vs, fact_tarifas: [tarifa('t-gral', '1000', null)] }))
    await generarPrefacturas(db, '2026-10', '2026-11-04')
    expect(guardadas.map(g => [g.p_datos.agrupacion_clave, g.p_datos.lineas.length])).toEqual([['objetivo:macro', 1], ['objetivo:cast', 1], ['objetivo:casona', 1]])
  })

  it('reagrupado con la prefactura anterior viva: no factura el objetivo dos veces, avisa que hay que descartarla', async () => {
    const viva = { id: 'p-vieja', contrato_id: K, cliente_id: 'c-muni', agrupacion_clave: 'objetivo:macro', objetivo_id: 'macro', objetivos_incluidos: null,
      periodo_desde: '2026-10-01', periodo_hasta_excl: '2026-11-01', estado: 'lista_revision', version: 1 }
    const { db, guardadas } = baseEnMemoria(tablasBase({ fact_prefacturas: [viva] }))
    const r = await generarPrefacturas(db, '2026-10', '2026-11-04')
    expect(r.errores.join(' ')).toMatch(/MUSEO MACRO ya está en otra prefactura del período \(lista_revision\)\. Descartala antes de reagrupar/)
    expect(guardadas.map(g => g.p_datos.agrupacion_clave)).toEqual(['objetivo:casona'])
  })

  it('una prefactura emitida no se recalcula', async () => {
    const emitida = { id: 'p-em', contrato_id: K, cliente_id: 'c-muni', agrupacion_clave: 'objetivo:casona', objetivo_id: 'casona', objetivos_incluidos: ['casona'],
      periodo_desde: '2026-10-01', periodo_hasta_excl: '2026-11-01', estado: 'emitida', version: 4 }
    const { db, guardadas } = baseEnMemoria(tablasBase({ fact_prefacturas: [emitida] }))
    const r = await generarPrefacturas(db, '2026-10', '2026-11-04')
    expect(r.sin_cambios).toBe(1)
    expect(guardadas.some(g => g.p_datos.agrupacion_clave === 'objetivo:casona')).toBe(false)
  })

  it('con contrato indicado recalcula sólo ese contrato', async () => {
    const otro = { ...contrato, id: 'k-otro', cliente_id: 'c-otro' }
    const { db, guardadas } = baseEnMemoria(tablasBase({ fact_contratos: [contrato, otro] }))
    await generarPrefacturas(db, '2026-10', '2026-11-04', K)
    expect(new Set(guardadas.map(g => g.p_datos.contrato_id))).toEqual(new Set([K]))
  })
})
