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
  const estados: any[] = [], reagrupes: any[] = []
  const db: any = {
    from: desde,
    rpc: async (fn: string, args: any) => {
      if (fn === 'fact_prefactura_guardar') guardadas.push(args)
      if (fn === 'fact_prefactura_estado') {
        estados.push(args)
        // Como la función real: sólo desde estados en preparación.
        const p = (tablas.fact_prefacturas ?? []).find(x => x.id === args.p_id)
        if (!p || ['aprobada_emitir', 'emitida'].includes(p.estado)) return { data: null, error: { message: 'Transición no permitida' } }
        p.estado = args.p_estado; p.version++
      }
      if (fn === 'fact_prefacturas_reagrupar') {
        reagrupes.push(args)
        // Como la función de la base: todo o nada.
        if ((tablas as any).__falla) return { data: null, error: { message: (tablas as any).__falla } }
        for (const d of args.p_descartar) {
          const p = (tablas.fact_prefacturas ?? []).find(x => x.id === d.id)
          if (!p || ['aprobada_emitir', 'emitida'].includes(p.estado)) return { data: null, error: { message: 'Reagrupar: aprobada' } }
        }
        for (const d of args.p_descartar) {
          const p = tablas.fact_prefacturas.find(x => x.id === d.id)!
          p.estado = 'descartada'; p.version++
          estados.push({ p_id: d.id, p_estado: 'descartada', p_version: d.version, p_motivo: d.motivo })
        }
        for (const g of args.p_guardar) guardadas.push({ p_id: g.id, p_datos: g.datos, p_version: g.version })
        return { data: { descartadas: args.p_descartar.length }, error: null }
      }
      return { data: 'p-nueva', error: null }
    },
  }
  return { db, guardadas, estados, reagrupes }
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

  const pref = (id: string, clave: string, estado: string, objetivo_id: string | null, objetivos_incluidos: string[] | null = null) =>
    ({ id, contrato_id: K, cliente_id: 'c-muni', agrupacion_clave: clave, objetivo_id, objetivos_incluidos, periodo_desde: '2026-10-01', periodo_hasta_excl: '2026-11-01', estado, version: 1 })

  it('reagrupado: la prefactura anterior EN PREPARACIÓN se descarta con motivo y el grupo se arma completo', async () => {
    const vieja = pref('p-vieja', 'objetivo:macro', 'lista_revision', 'macro')
    const casona = pref('p-casona', 'objetivo:casona', 'esperando_requisitos', 'casona', ['casona'])
    const { db, guardadas, estados } = baseEnMemoria(tablasBase({ fact_prefacturas: [vieja, casona] }))
    const r = await generarPrefacturas(db, '2026-10', '2026-11-04')
    expect(r.errores).toEqual([])
    expect(r.reagrupadas).toBe(1)
    expect(estados).toEqual([{ p_id: 'p-vieja', p_estado: 'descartada', p_version: 1, p_motivo: 'Reagrupada: sus objetivos se facturan ahora en «Museos»' }])
    expect(guardadas.map(g => g.p_datos.agrupacion_clave).sort()).toEqual(['grupo:k-muni:museos', 'objetivo:casona'])
    // La Casona sigue en su prefactura (misma clave): se actualiza, no se reemplaza.
    expect(guardadas.find(g => g.p_datos.agrupacion_clave === 'objetivo:casona').p_id).toBe('p-casona')
    // Sin doble facturación: cada objetivo en una sola prefactura viva.
    const objs = guardadas.flatMap(g => g.p_datos.objetivos_incluidos)
    expect(objs.sort()).toEqual(['casona', 'cast', 'macro'])
  })

  it('reagrupado: descarte y altas van en UNA sola llamada atómica a la base', async () => {
    const vieja = pref('p-vieja', 'objetivo:macro', 'lista_revision', 'macro')
    const { db, reagrupes } = baseEnMemoria(tablasBase({ fact_prefacturas: [vieja] }))
    await generarPrefacturas(db, '2026-10', '2026-11-04')
    expect(reagrupes).toHaveLength(1)
    expect(reagrupes[0].p_descartar.map((d: any) => d.id)).toEqual(['p-vieja'])
    expect(reagrupes[0].p_guardar.map((g: any) => g.datos.agrupacion_clave).sort()).toEqual(['grupo:k-muni:museos', 'objetivo:casona'])
  })

  it('si falla el guardado de las nuevas, la anterior NO queda descartada (todo o nada)', async () => {
    const vieja = pref('p-vieja', 'objetivo:macro', 'lista_revision', 'macro')
    const tablas: any = tablasBase({ fact_prefacturas: [vieja] }); tablas.__falla = 'La prefactura cambió; recargá'
    const { db, guardadas, estados } = baseEnMemoria(tablas)
    const r = await generarPrefacturas(db, '2026-10', '2026-11-04')
    expect(vieja.estado).toBe('lista_revision')
    expect(estados).toEqual([])
    expect(guardadas).toEqual([])
    expect(r.reagrupadas).toBe(0)
    expect(r.errores.join(' ')).toMatch(/no se reagrupó \(quedó todo como estaba\): La prefactura cambió/)
  })

  it('sin la migración aplicada no reagrupa y lo dice (no descarta ni crea)', async () => {
    const vieja = pref('p-vieja', 'objetivo:macro', 'lista_revision', 'macro')
    const tablas: any = tablasBase({ fact_prefacturas: [vieja] }); tablas.__falla = 'Could not find the function public.fact_prefacturas_reagrupar(p_descartar, p_guardar) in the schema cache'
    const { db, guardadas } = baseEnMemoria(tablas)
    const r = await generarPrefacturas(db, '2026-10', '2026-11-04')
    expect(vieja.estado).toBe('lista_revision')
    expect(guardadas).toEqual([])
    expect(r.errores.join(' ')).toMatch(/falta aplicar la migración 20261203120000/)
  })

  it('si un objetivo de la anterior queda sin reemplazo (p. ej. ocupado por una aprobada), no descarta nada', async () => {
    // La vieja cubría macro y casona; casona está en una aprobada → su grupo no se arma → macro+casona sin reemplazo completo.
    const vieja = pref('p-vieja', 'contrato:k-muni', 'lista_revision', null, ['macro', 'casona'])
    const apr = pref('p-apr', 'otro:casona', 'aprobada_emitir', 'casona', ['casona'])
    const { db, guardadas, estados, reagrupes } = baseEnMemoria(tablasBase({ fact_prefacturas: [vieja, apr] }))
    const r = await generarPrefacturas(db, '2026-10', '2026-11-04')
    expect(reagrupes).toEqual([])
    expect(estados).toEqual([])
    expect(guardadas).toEqual([])
    expect(vieja.estado).toBe('lista_revision')
    expect(r.errores.join(' ')).toMatch(/no se reagrupó \(quedó todo como estaba\)/)
  })

  it('reagrupado con la prefactura anterior APROBADA: no se toca y el objetivo queda para revisión expresa', async () => {
    const aprobada = pref('p-apr', 'objetivo:macro', 'aprobada_emitir', 'macro')
    const { db, guardadas, estados } = baseEnMemoria(tablasBase({ fact_prefacturas: [aprobada] }))
    const r = await generarPrefacturas(db, '2026-10', '2026-11-04')
    expect(estados).toEqual([])
    expect(aprobada.estado).toBe('aprobada_emitir')
    expect(r.errores.join(' ')).toMatch(/MUSEO MACRO ya está en otra prefactura del período \(aprobada_emitir\)\. Está aprobada o emitida: no se reagrupa sola/)
    expect(guardadas.map(g => g.p_datos.agrupacion_clave)).toEqual(['objetivo:casona'])
  })

  it('reagrupado desde una factura por contrato (sin objetivos_incluidos): se descarta y se reparte en los grupos vigentes', async () => {
    const vieja = pref('p-contrato', `contrato:${K}`, 'esperando_requisitos', null)
    const { db, guardadas, estados } = baseEnMemoria(tablasBase({ fact_prefacturas: [vieja] }))
    const r = await generarPrefacturas(db, '2026-10', '2026-11-04')
    expect(r.errores).toEqual([])
    expect(estados.map(e => [e.p_id, e.p_estado])).toEqual([['p-contrato', 'descartada']])
    expect(estados[0].p_motivo).toBe('Reagrupada: sus objetivos se facturan ahora en «Museos», «LA CASONA»')
    expect(guardadas.map(g => g.p_datos.agrupacion_clave).sort()).toEqual(['grupo:k-muni:museos', 'objetivo:casona'])
  })

  it('segunda corrida: no vuelve a descartar ni duplica (actualiza las mismas prefacturas)', async () => {
    const tablas = tablasBase({ fact_prefacturas: [pref('p-vieja', 'objetivo:macro', 'lista_revision', 'macro')] })
    const { db, guardadas, estados } = baseEnMemoria(tablas)
    await generarPrefacturas(db, '2026-10', '2026-11-04')
    // Las nuevas quedan guardadas como prefacturas vivas para la segunda corrida.
    guardadas.forEach((g, i) => tablas.fact_prefacturas.push({ id: `p-n${i}`, version: 1, estado: 'lista_revision', ...g.p_datos }))
    const antes = estados.length, n = guardadas.length
    const r2 = await generarPrefacturas(db, '2026-10', '2026-11-04')
    expect(r2.reagrupadas).toBe(0)
    expect(estados.length).toBe(antes)
    expect(guardadas.slice(n).map(g => g.p_id).sort()).toEqual(['p-n0', 'p-n1'])
  })

  it('una prefactura emitida no se recalcula', async () => {
    const emitida = { id: 'p-em', contrato_id: K, cliente_id: 'c-muni', agrupacion_clave: 'objetivo:casona', objetivo_id: 'casona', objetivos_incluidos: ['casona'],
      periodo_desde: '2026-10-01', periodo_hasta_excl: '2026-11-01', estado: 'emitida', version: 4 }
    const { db, guardadas } = baseEnMemoria(tablasBase({ fact_prefacturas: [emitida] }))
    const r = await generarPrefacturas(db, '2026-10', '2026-11-04')
    expect(r.sin_cambios).toBe(1)
    expect(guardadas.some(g => g.p_datos.agrupacion_clave === 'objetivo:casona')).toBe(false)
  })

  it('una prefactura aprobada para emitir tampoco se recalcula (no cambia de contenido sola)', async () => {
    const aprobada = { id: 'p-apr', contrato_id: K, cliente_id: 'c-muni', agrupacion_clave: 'objetivo:casona', objetivo_id: 'casona', objetivos_incluidos: ['casona'],
      periodo_desde: '2026-10-01', periodo_hasta_excl: '2026-11-01', estado: 'aprobada_emitir', version: 4 }
    const { db, guardadas, estados } = baseEnMemoria(tablasBase({ fact_prefacturas: [aprobada] }))
    const r = await generarPrefacturas(db, '2026-10', '2026-11-04')
    expect(r.sin_cambios).toBe(1)
    expect(estados).toEqual([])
    expect(guardadas.some(g => g.p_datos.agrupacion_clave === 'objetivo:casona')).toBe(false)
  })

  it('con contrato indicado recalcula sólo ese contrato', async () => {
    const otro = { ...contrato, id: 'k-otro', cliente_id: 'c-otro' }
    const { db, guardadas } = baseEnMemoria(tablasBase({ fact_contratos: [contrato, otro] }))
    await generarPrefacturas(db, '2026-10', '2026-11-04', K)
    expect(new Set(guardadas.map(g => g.p_datos.contrato_id))).toEqual(new Set([K]))
  })
})
