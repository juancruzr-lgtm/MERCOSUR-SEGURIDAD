// Aviso de horas cambiadas después de aceptarlas: diferencia turno por turno, quién
// cambió qué y por qué, y qué hacer según el estado de la prefactura. Además, los
// carteles de la pantalla (punto de venta, pruebas de homologación y su PDF).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { armarCambios, compararDetalle, guiaDiferencia, textoCampo, valorLegible, type FilaDetalle } from '@/lib/facturacion/cambios-horas'
import { avisosVigentes, esAvisoPuntoVenta, estadoVisible } from '@/lib/facturacion/datos'
import { cambiosDeHoras } from '@/lib/facturacion/servidor'

const fila = (turno_id: string, fecha: string, cubiertos: number, extra: Partial<FilaDetalle> = {}): FilaDetalle =>
  ({ turno_id, fecha, cubiertos, programados: cubiertos, estado: 'cubierto', registro_id: `r${turno_id}`, ...extra })

describe('compararDetalle: foto aceptada vs. hoy', () => {
  it('sin cambios no informa nada', () => {
    const foto = [fila('A', '2026-10-10', 480), fila('B', '2026-10-11', 480)]
    expect(compararDetalle(foto, foto)).toEqual([])
    expect(compararDetalle(null, undefined)).toEqual([])
  })
  it('turno nuevo (supervisor que se quedó), turno quitado y turno cambiado, ordenados por fecha', () => {
    const foto = [fila('A', '2026-10-10', 480), fila('B', '2026-10-11', 480), fila('X', '2026-10-09', 240)]
    const hoy = [fila('A', '2026-10-10', 480), fila('B', '2026-10-11', 360), fila('U', '2026-10-12', 180)]
    const c = compararDetalle(foto, hoy)
    expect(c.map(x => [x.turnoId, x.tipo, x.antes, x.ahora, x.diferencia])).toEqual([
      ['X', 'quitado', 240, 0, -240],
      ['B', 'cambiado', 480, 360, -120],
      ['U', 'nuevo', 0, 180, 180],
    ])
  })
  it('suma los registros de un mismo turno y descarta renglones sin turno', () => {
    const foto = [fila('A', '2026-10-10', 240, { registro_id: 'r1' }), fila('A', '2026-10-10', 240, { registro_id: 'r2' })]
    const hoy = [fila('A', '2026-10-10', 480, { registro_id: 'r1' }), { fecha: '2026-10-10', cubiertos: 99 } as any]
    expect(compararDetalle(foto, hoy)).toEqual([])
  })
  it('informa el estado de antes y de hoy', () => {
    const c = compararDetalle([fila('A', '2026-10-10', 480)], [fila('A', '2026-10-10', 0, { estado: 'sin_registro' })])
    expect(c[0]).toMatchObject({ tipo: 'cambiado', estadoAntes: 'cubierto', estadoAhora: 'sin_registro', diferencia: -480 })
  })
})

describe('armarCambios: quién, qué y por qué', () => {
  const aceptadoAt = '2026-11-02T12:00:00+00:00'
  const cambios = compararDetalle([fila('B', '2026-10-11', 480)], [fila('B', '2026-10-11', 360), fila('U', '2026-10-12', 180)])
  it('pega la auditoría de cada turno, en orden', () => {
    const r = armarCambios({
      cambios, aceptadoAt,
      auditoria: [
        { turnoId: 'B', cuando: '2026-11-05T10:00:00+00:00', quien: 'Ana Supervisora', campo: 'hora_salida_final', antes: '15:00', despues: '13:00', motivo: 'Se retiró antes', origen: 'registro' },
        { turnoId: 'B', cuando: '2026-11-04T10:00:00+00:00', quien: 'Ana Supervisora', campo: 'comentario_final', antes: null, despues: 'aviso', motivo: 'aviso previo', origen: 'registro' },
      ],
      turnos: [{ id: 'B', created_at: '2026-10-01T00:00:00+00:00', hora_inicio: '07:00:00', hora_fin: '15:00:00' }],
      registros: [],
    })
    const b = r.find(x => x.turnoId === 'B')!
    expect(b.horario).toBe('07:00–15:00')
    expect(b.motivos.map(m => m.campo)).toEqual(['comentario_final', 'hora_salida_final'])
    expect(b.eventos).toEqual([]) // el turno es de antes de aceptar
  })
  it('sin auditoría: turno y registro cargados después de aceptar, y anulaciones', () => {
    const r = armarCambios({
      cambios, aceptadoAt, auditoria: [],
      turnos: [{ id: 'U', created_at: '2026-11-04T09:00:00+00:00', origen: 'manual', hora_inicio: '15:00:00', hora_fin: '18:00:00' }],
      registros: [
        { turno_id: 'U', created_at: '2026-11-04T09:05:00+00:00', origen_cobertura: 'cobertura_urgente' },
        { turno_id: 'B', created_at: '2026-10-11T07:00:00+00:00', registro_anulado_motivo: 'duplicado' },
      ],
    })
    expect(r.find(x => x.turnoId === 'U')!.eventos).toEqual([
      { tipo: 'turno_cargado', cuando: '2026-11-04T09:00:00+00:00', detalle: 'manual' },
      { tipo: 'registro_cargado', cuando: '2026-11-04T09:05:00+00:00', detalle: 'cobertura_urgente' },
    ])
    expect(r.find(x => x.turnoId === 'B')!.eventos).toEqual([{ tipo: 'anulado', detalle: 'duplicado' }])
  })
  it('nombres de campos legibles y sin mostrar ids', () => {
    expect(textoCampo('hora_salida_final')).toBe('salida')
    expect(textoCampo('guardia_id')).toBe('vigilador')
    expect(textoCampo('campo_nuevo_raro')).toBe('campo nuevo raro')
    expect(valorLegible('guardia_id', '3f1c0e9a-0000-0000-0000-000000000000')).toBeNull()
    expect(valorLegible('hora_fin', '18:00')).toBe('18:00')
  })
})

describe('guiaDiferencia: qué hacer según el estado', () => {
  it('sin aprobar: Reemplazar recalcula la prefactura', () => {
    for (const e of [null, 'en_preparacion', 'esperando_requisitos', 'lista_revision']) {
      expect(guiaDiferencia(e, 180)).toMatch(/se sumen.*Reemplazar/)
      expect(guiaDiferencia(e, -60)).toMatch(/se descuenten.*Reemplazar/)
    }
  })
  it('aprobada sin emitir: volver a revisión o, si se emite así, nota de débito/crédito', () => {
    expect(guiaDiferencia('aprobada_emitir', 90)).toMatch(/En revisión.*Reemplazar.*nota de débito por 1\.5 h/)
    expect(guiaDiferencia('aprobada_emitir', -60)).toMatch(/nota de crédito por 1 h/)
  })
  it('emitida: más horas → nota de débito (la segunda factura todavía no existe); menos → nota de crédito', () => {
    expect(guiaDiferencia('emitida', 180)).toMatch(/3 h de más.*nota de débito.*NC\/ND.*segunda factura.*todavía no/)
    expect(guiaDiferencia('emitida', -180)).toMatch(/3 h de menos.*nota de crédito parcial/)
  })
  it('total igual: avisa si cambiaron las descubiertas o sólo turnos puntuales', () => {
    expect(guiaDiferencia('lista_revision', 0, 120)).toMatch(/descubiertas/)
    expect(guiaDiferencia('lista_revision', 0, 0)).toMatch(/turnos puntuales/)
  })
})

// ── cambiosDeHoras (servidor) con un cliente falso ─────────────────────────
type Filtro = [string, string, any]
function aplicar(filas: any[], filtros: Filtro[]) {
  return filas.filter(f => filtros.every(([op, c, v]) =>
    op === 'eq' ? f[c] === v : op === 'in' ? (v as any[]).includes(f[c]) : op === 'gte' ? f[c] >= v : op === 'lt' ? f[c] < v : true))
}
function cliente(tablas: Record<string, any[]>, extra: { single?: Record<string, any>; maybe?: Record<string, any> } = {}) {
  const log: Array<{ tabla: string; filtros: Filtro[] }> = []
  return {
    log,
    from(tabla: string) {
      const filtros: Filtro[] = []
      log.push({ tabla, filtros })
      const filas = () => aplicar(tablas[tabla] ?? [], filtros)
      const q: any = {
        select: () => q, order: () => q, limit: () => q,
        eq: (c: string, v: any) => { filtros.push(['eq', c, v]); return q },
        gte: (c: string, v: any) => { filtros.push(['gte', c, v]); return q },
        lt: (c: string, v: any) => { filtros.push(['lt', c, v]); return q },
        in: (c: string, v: any) => { filtros.push(['in', c, v]); return q },
        single: async () => ({ data: extra.single?.[tabla] ?? null, error: null }),
        maybeSingle: async () => ({ data: extra.maybe?.[tabla] ?? null, error: null }),
        range: async (a: number) => ({ data: a > 0 ? [] : filas(), error: null }),
        then: (ok: any, mal: any) => Promise.resolve({ data: filas(), error: null }).then(ok, mal),
      }
      return q
    },
  }
}

describe('cambiosDeHoras (servidor)', () => {
  const OBJ = 'obj-1'
  const ACEPTADO = '2026-11-02T12:00:00+00:00'
  const TURNOS = [
    { id: 'A', fecha: '2026-10-10', hora_inicio: '07:00:00', hora_fin: '15:00:00', objetivo_id: OBJ, puesto_id: 'P1', estado: 'cubierto', tipo_evento: 'normal', created_at: '2026-10-01T00:00:00+00:00' },
    { id: 'B', fecha: '2026-10-11', hora_inicio: '07:00:00', hora_fin: '15:00:00', objetivo_id: OBJ, puesto_id: 'P1', estado: 'cubierto', tipo_evento: 'normal', created_at: '2026-10-01T00:00:00+00:00' },
    { id: 'U', fecha: '2026-10-12', hora_inicio: '15:00:00', hora_fin: '18:00:00', objetivo_id: OBJ, puesto_id: 'P2', estado: 'cubierto', tipo_evento: 'normal', created_at: '2026-11-04T09:00:00+00:00', origen: 'manual' },
  ]
  const REGISTROS = [
    { id: 'rA', turno_id: 'A', guardia_id: 'g1', hora_entrada_real: '07:00:00', hora_salida_real: '15:00:00', created_at: '2026-10-10T10:00:00+00:00' },
    // Corregido después de aceptar: la supervisora dejó 6 h (se retiró antes).
    { id: 'rB', turno_id: 'B', guardia_id: 'g1', hora_entrada_real: '07:00:00', hora_salida_real: '15:00:00', horas_liquidables: 6, created_at: '2026-10-11T10:00:00+00:00' },
    { id: 'rU', turno_id: 'U', guardia_id: 'g2', hora_entrada_real: '15:00:00', hora_salida_real: '18:00:00', created_at: '2026-11-04T09:05:00+00:00' },
  ]
  const APROBACION = {
    id: 'ap-1', aprobado_at: ACEPTADO, aprobado_por: 'u-adm', minutos_aprobados: 960, minutos_cubiertos: 960, minutos_descubiertos: 0,
    detalle: [fila('A', '2026-10-10', 480), fila('B', '2026-10-11', 480)],
  }
  const arma = () => {
    const db = cliente({ turnos: TURNOS, registros_asistencia: REGISTROS },
      { single: { fact_contratos: { id: 'k1', regla_periodo: 'mes_calendario', superposicion: 'unir' } }, maybe: { fact_horas_aprobaciones: APROBACION } })
    const admin = cliente({
      registros_asistencia_auditoria: [
        { turno_id: 'B', modificado_por: 'u-sup', campo: 'horas_liquidables', valor_anterior: '8', valor_nuevo: '6', motivo: 'Se retiró antes', created_at: '2026-11-05T10:00:00+00:00' },
        { turno_id: 'B', modificado_por: 'u-sup', campo: 'comentario_final', valor_anterior: null, valor_nuevo: 'x', motivo: 'anterior a la aceptación', created_at: '2026-10-30T10:00:00+00:00' },
        { turno_id: 'A', modificado_por: 'u-sup', campo: 'comentario_final', valor_anterior: null, valor_nuevo: 'y', motivo: 'no cambió horas', created_at: '2026-11-06T10:00:00+00:00' },
      ],
      turnos_auditoria: [],
      usuarios: [{ id: 'u-sup', nombre: 'Ana', apellido: 'Supervisora' }, { id: 'u-adm', nombre: 'Admin', apellido: 'Prueba' }],
    })
    return { db, admin }
  }

  it('diferencia por turno con quién/por qué, sólo de los turnos cambiados y desde la aceptación', async () => {
    const { db, admin } = arma()
    const r = await cambiosDeHoras(db as any, admin as any, { contratoId: 'k1', objetivoId: OBJ, mes: '2026-10' })
    expect(r.aceptada).toMatchObject({ aprobadoAt: ACEPTADO, aprobadoPor: 'Admin Prueba', minutosCubiertos: 960, facturaDescubiertas: false })
    expect(r.actual.minutosCubiertos).toBe(480 + 360 + 180)
    expect(r.turnos.map(t => [t.turnoId, t.tipo, t.diferencia])).toEqual([['B', 'cambiado', -120], ['U', 'nuevo', 180]])
    const b = r.turnos.find(t => t.turnoId === 'B')!
    expect(b.motivos).toEqual([expect.objectContaining({ quien: 'Ana Supervisora', campo: 'horas_liquidables', antes: '8', despues: '6', motivo: 'Se retiró antes', origen: 'registro' })])
    expect(r.turnos.find(t => t.turnoId === 'U')!.eventos.map(e => e.tipo)).toEqual(['turno_cargado', 'registro_cargado'])
    // La auditoría se pide sólo para los turnos cambiados (no A) y desde la aceptación.
    const aud = admin.log.filter(x => x.tabla.endsWith('_auditoria'))
    expect(aud.length).toBe(2)
    for (const x of aud) {
      expect(x.filtros).toContainEqual(['in', 'turno_id', ['B', 'U']])
      expect(x.filtros).toContainEqual(['gte', 'created_at', ACEPTADO])
    }
  })
  it('turnos y registros con la RLS de quien pide; service_role sólo para auditoría y nombres', async () => {
    const { db, admin } = arma()
    await cambiosDeHoras(db as any, admin as any, { contratoId: 'k1', objetivoId: OBJ, mes: '2026-10' })
    expect(new Set(admin.log.map(x => x.tabla))).toEqual(new Set(['turnos_auditoria', 'registros_asistencia_auditoria', 'usuarios']))
    expect(db.log.some(x => x.tabla.endsWith('_auditoria') || x.tabla === 'usuarios')).toBe(false)
  })
  it('aceptación sin detalle por turno: compara sólo el total (no marca todo como nuevo)', async () => {
    const db = cliente({ turnos: TURNOS, registros_asistencia: REGISTROS },
      { single: { fact_contratos: { id: 'k1', regla_periodo: 'mes_calendario' } }, maybe: { fact_horas_aprobaciones: { ...APROBACION, detalle: [] } } })
    const admin = cliente({ usuarios: [{ id: 'u-adm', nombre: 'Admin', apellido: 'Prueba' }] })
    const r = await cambiosDeHoras(db as any, admin as any, { contratoId: 'k1', objetivoId: OBJ, mes: '2026-10' })
    expect(r).toMatchObject({ sinFoto: true, turnos: [], aceptada: { minutosCubiertos: 960, aprobadoPor: 'Admin Prueba' } })
    expect(admin.log.some(x => x.tabla.endsWith('_auditoria'))).toBe(false)
  })
  it('sin horas aceptadas no hay nada que comparar', async () => {
    const db = cliente({ turnos: TURNOS, registros_asistencia: REGISTROS }, { single: { fact_contratos: { id: 'k1', regla_periodo: 'mes_calendario' } } })
    const admin = cliente({})
    const r = await cambiosDeHoras(db as any, admin as any, { contratoId: 'k1', objetivoId: OBJ, mes: '2026-10' })
    expect(r).toMatchObject({ aceptada: null, turnos: [] })
    expect(admin.log).toEqual([])
  })
})

describe('carteles de la pantalla de facturación', () => {
  const AVISO_PV = 'Falta configurar el punto de venta Web Service: se puede aprobar, pero no emitir por ARCA.'
  it('el aviso del punto de venta se oculta si ya está configurado y no manda a "Requiere revisión"', () => {
    expect(esAvisoPuntoVenta(AVISO_PV)).toBe(true)
    expect(esAvisoPuntoVenta('Sin tarifa vigente')).toBe(false)
    expect(avisosVigentes([AVISO_PV, 'Sin tarifa vigente'], true)).toEqual(['Sin tarifa vigente'])
    expect(avisosVigentes([AVISO_PV], false)).toEqual([AVISO_PV])
    expect(avisosVigentes(null, true)).toEqual([])
    expect(estadoVisible({ estado: 'lista_revision', avisos: [AVISO_PV] }).clave).toBe('lista_aprobar')
    expect(estadoVisible({ estado: 'lista_revision', avisos: [AVISO_PV, 'Sin tarifa vigente'] }).clave).toBe('requiere_revision')
    expect(estadoVisible(null).clave).toBe('pendiente_generar')
  })
  const src = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8')
  it('el servidor lee el punto de venta de producción con la clave nueva', () => {
    expect(src('lib/facturacion/servidor.ts')).toMatch(/cfg\?\.valor\?\.punto_venta_prod \?\? cfg\?\.valor\?\.punto_venta/)
  })
  it('las pruebas de homologación se ven aparte, con su PDF, y no se ofrece una segunda prueba', () => {
    const c = src('components/facturacion/Comprobantes.tsx')
    expect(c).toMatch(/eq\('ambiente', 'homologacion'\)/)
    expect(c).toMatch(/Facturas de prueba \(homologación\)/)
    const b = src('components/facturacion/Bandeja.tsx')
    expect(b).toMatch(/Ver PDF de la prueba/)
    expect(b).toMatch(/!pruebaHomo/)
    expect(b).toMatch(/<CambiosHoras /)
  })
  it('la emisión manual (Comprobantes en línea) no ofrece el punto Web Service', () => {
    const b = src('components/facturacion/Bandeja.tsx')
    const manual = b.slice(b.indexOf('function EmisionManual'), b.indexOf('function Detalle'))
    expect(manual).not.toMatch(/\?\.punto_venta_prod/)
    expect(manual).toMatch(/valor\?\.punto_venta_en_linea \?\? null/)
  })
  it('el aviso compara lo facturable: con descubiertas facturadas, las suma', () => {
    const c = src('components/facturacion/CambiosHoras.tsx')
    expect(c).toMatch(/minutosCubiertos \+ \(fd \? r\.aceptada\.minutosDescubiertos : 0\)/)
  })
})
