import { describe, expect, it } from 'vitest'
import {
  clasificarUniversoSupervision,
  exigibilidadSupervision,
  fechasTurnosPorObjetivo,
  objetivoExigeSupervision,
  sugerirObjetivoConTurno,
  suspensionVigenteEn,
  type ContextoExigibilidad,
} from '@/lib/supervisiones'
import {
  cargarUltimaSupervisionPorObjetivo,
  filasDesdeIndice,
  objetivosConTurnoEn,
} from '@/lib/supervision-universo'

// 2026-11-02 12:00 ART
const AHORA = new Date('2026-11-02T15:00:00Z')

const ctx = (over: Partial<ContextoExigibilidad> = {}): ContextoExigibilidad => ({
  fechasTurnos: new Map(),
  yaOperaron: new Set(),
  suspensiones: [],
  ...over,
})

const O = (over: any = {}) => ({ id: 'o1', nombre: 'OBJ', estado: 'activo', es_prueba: false, ...over })

describe('exigibilidad de supervisión — criterio único', () => {
  it('activo con turnos recientes exige', () => {
    const c = ctx({ fechasTurnos: new Map([['o1', ['2026-10-30']]]) })
    expect(objetivoExigeSupervision(O(), c, AHORA)).toBe(true)
  })

  it('activo sin turnos recientes NO exige y va a "confirmar estado"', () => {
    const c = ctx({ fechasTurnos: new Map([['o1', ['2026-09-01']]]) })
    expect(exigibilidadSupervision(O(), c, AHORA)).toEqual({ exige: false, motivo: 'sin_turnos_recientes' })
    const u = clasificarUniversoSupervision([O()], c, AHORA)
    expect(u.exigibles).toHaveLength(0)
    expect(u.sinTurnosRecientes.map(o => o.id)).toEqual(['o1'])
  })

  it('sin poder leer turnos (fechasTurnos null) no descarta a nadie', () => {
    expect(objetivoExigeSupervision(O(), ctx({ fechasTurnos: null }), AHORA)).toBe(true)
  })

  it('inactivo y de prueba quedan fuera de todas las listas', () => {
    const c = ctx({ fechasTurnos: new Map([['a', ['2026-11-01']], ['b', ['2026-11-01']]]) })
    const u = clasificarUniversoSupervision([O({ id: 'a', estado: 'inactivo' }), O({ id: 'b', es_prueba: true })], c, AHORA)
    expect(u.exigibles.length + u.sinTurnosRecientes.length + u.porComenzar.length + u.fueraDeServicio.length).toBe(0)
  })

  it('fecha de fin de servicio pasada → servicio_finalizado, aunque tenga turnos', () => {
    const c = ctx({ fechasTurnos: new Map([['o1', ['2026-11-01']]]) })
    expect(exigibilidadSupervision(O({ fecha_fin_servicio: '2026-11-01' }), c, AHORA).motivo).toBe('servicio_finalizado')
    // El día de fin todavía exige (inclusivo).
    expect(objetivoExigeSupervision(O({ fecha_fin_servicio: '2026-11-02' }), c, AHORA)).toBe(true)
  })

  it('fecha de inicio futura → antes_de_inicio', () => {
    const c = ctx({ fechasTurnos: new Map([['o1', ['2026-11-01']]]) })
    expect(exigibilidadSupervision(O({ fecha_inicio_servicio: '2026-11-03' }), c, AHORA).motivo).toBe('antes_de_inicio')
  })

  it('suspensión vigente (inclusiva, abierta o anulada)', () => {
    const turnos = new Map([['o1', ['2026-11-01']]])
    const susp = (s: any) => ctx({ fechasTurnos: turnos, suspensiones: [{ objetivo_id: 'o1', ...s }] })
    expect(exigibilidadSupervision(O(), susp({ desde: '2026-11-02', hasta: '2026-11-02' }), AHORA).motivo).toBe('suspendido')
    expect(exigibilidadSupervision(O(), susp({ desde: '2026-10-20', hasta: null }), AHORA).motivo).toBe('suspendido')
    expect(objetivoExigeSupervision(O(), susp({ desde: '2026-10-20', hasta: '2026-11-01' }), AHORA)).toBe(true)
    expect(objetivoExigeSupervision(O(), susp({ desde: '2026-10-20', hasta: null, anulada_at: '2026-10-21T00:00:00Z' }), AHORA)).toBe(true)
    expect(suspensionVigenteEn('otro', [{ objetivo_id: 'o1', desde: '2026-01-01' }], '2026-11-02')).toBeNull()
  })

  it('sólo turnos futuros y nunca operó → por_comenzar; si ya operó → exige', () => {
    const turnos = new Map([['o1', ['2026-11-10']]])
    expect(exigibilidadSupervision(O(), ctx({ fechasTurnos: turnos }), AHORA).motivo).toBe('por_comenzar')
    expect(objetivoExigeSupervision(O(), ctx({ fechasTurnos: turnos, yaOperaron: new Set(['o1']) }), AHORA)).toBe(true)
  })

  it('turnos anulados, cancelados o reemplazados no prueban servicio', () => {
    const m = fechasTurnosPorObjetivo([
      { objetivo_id: 'o1', fecha: '2026-11-01', estado: 'anulado' },
      { objetivo_id: 'o1', fecha: '2026-11-01', estado: 'cancelado' },
      { objetivo_id: 'o1', fecha: '2026-11-01', estado: 'reemplazado' },
      { objetivo_id: 'o2', fecha: '2026-11-01', estado: 'cubierto' },
    ])
    expect(m.has('o1')).toBe(false)
    expect(m.get('o2')).toEqual(['2026-11-01'])
  })

  it('caso real: 17 activos, 3 sin turnos → 14 exigibles en TODAS las pantallas', () => {
    const objetivos = Array.from({ length: 17 }, (_, i) => O({ id: `o${i}` }))
    const turnos = new Map(objetivos.slice(0, 14).map(o => [o.id, ['2026-11-01']] as [string, string[]]))
    turnos.set('o14', ['2026-09-15'])
    const u = clasificarUniversoSupervision(objetivos, ctx({ fechasTurnos: turnos }), AHORA)
    expect(u.exigibles).toHaveLength(14)
    expect(u.sinTurnosRecientes).toHaveLength(3)
  })
})

describe('aviso de objetivo equivocado (<100 m con turno hoy)', () => {
  const rosario = { id: 'r', nombre: 'LAROMET ROSARIO', lat: -32.95, lng: -60.65 }
  const rosario2 = { id: 'r2', nombre: 'LAROMET ROSARIO 2', lat: -32.9503, lng: -60.6502 } // ~38 m
  const lejos = { id: 'x', nombre: 'LEJOS', lat: -32.96, lng: -60.65 } // ~1,1 km

  it('sugiere el cercano con turno', () => {
    const s = sugerirObjetivoConTurno(rosario, [rosario, rosario2, lejos], new Set(['r2', 'x']))
    expect(s?.objetivo.id).toBe('r2')
    expect(s!.distanciaM).toBeLessThan(100)
  })

  it('no avisa si el elegido tiene turno, si el cercano no lo tiene o si faltan coordenadas', () => {
    expect(sugerirObjetivoConTurno(rosario, [rosario2], new Set(['r', 'r2']))).toBeNull()
    expect(sugerirObjetivoConTurno(rosario, [rosario2, lejos], new Set(['x']))).toBeNull()
    expect(sugerirObjetivoConTurno({ id: 'r', lat: null, lng: null }, [rosario2], new Set(['r2']))).toBeNull()
  })

  it('objetivosConTurnoEn usa las fechas del contexto', () => {
    const c = ctx({ fechasTurnos: new Map([['a', ['2026-11-02']], ['b', ['2026-11-01']]]) })
    expect(Array.from(objetivosConTurnoEn(c, '2026-11-02'))).toEqual(['a'])
    expect(objetivosConTurnoEn(ctx({ fechasTurnos: null }), '2026-11-02').size).toBe(0)
  })
})

// Cliente falso mínimo: registra la cadena de llamadas.
function clienteFalso(opts: { rpc?: { data: any; error: any }; paginas?: any[][] }) {
  const llamadas: string[] = []
  let pagina = 0
  const builder: any = {
    select: () => builder,
    neq: (c: string, v: string) => { llamadas.push(`neq:${c}:${v}`); return builder },
    order: () => builder,
    range: () => {
      const data = opts.paginas?.[pagina++] ?? []
      return Promise.resolve({ data, error: null })
    },
  }
  return {
    llamadas,
    rpc: async (nombre: string) => { llamadas.push(`rpc:${nombre}`); return opts.rpc ?? { data: null, error: { code: 'PGRST202' } } },
    from: (t: string) => { llamadas.push(`from:${t}`); return builder },
  }
}

describe('última supervisión por objetivo (RPC + respaldo paginado)', () => {
  it('usa la RPC cuando existe', async () => {
    const c = clienteFalso({ rpc: { data: [{ objetivo_id: 'a', ultima_at: '2026-11-01T10:00:00Z' }], error: null } })
    const r = await cargarUltimaSupervisionPorObjetivo(c as any)
    expect(r.fuente).toBe('rpc')
    expect(r.indice.get('a')).toBe('2026-11-01T10:00:00Z')
    expect(c.llamadas).not.toContain('from:supervisiones')
  })

  it('sin RPC pagina, excluye incompleta y se queda con la más nueva', async () => {
    const pagina1 = Array.from({ length: 1000 }, (_, i) => ({
      id: `s${i}`, objetivo_id: i === 0 ? 'a' : 'b', created_at: new Date(Date.UTC(2026, 10, 1) - i * 60000).toISOString(),
    }))
    const pagina2 = [{ id: 'z', objetivo_id: 'c', created_at: '2026-01-01T00:00:00Z' }]
    const c = clienteFalso({ paginas: [pagina1, pagina2] })
    const r = await cargarUltimaSupervisionPorObjetivo(c as any)
    expect(r.fuente).toBe('paginado')
    expect(c.llamadas).toContain('neq:estado:incompleta')
    expect(r.indice.get('a')).toBe(pagina1[0].created_at)
    expect(r.indice.get('b')).toBe(pagina1[1].created_at)
    // La segunda página (más allá del corte de 1000) también entra.
    expect(r.indice.get('c')).toBe('2026-01-01T00:00:00Z')
    expect(filasDesdeIndice(r.indice)).toHaveLength(3)
  })
})
