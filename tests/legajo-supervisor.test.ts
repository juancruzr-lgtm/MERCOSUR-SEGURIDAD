import { describe, expect, it } from 'vitest'
import {
  cargarLegajoSupervisores, cargarRecorridoGuardia, distribucionHoraria, franjasSinSupervision,
  horaYDiaArgentina, matrizDiaHora, objetivosVisitados, posicionEnTurno, puedeVerLegajoSupervisores,
  resumenLegajo, situacionTurno, tramosConEvidencia,
} from '@/lib/legajo-supervisor'
import type { GuardiaLegajo, PuntoRecorrido, SupervisionLegajo } from '@/lib/legajo-supervisor'

// Rosario, guardia diurna 07-19 del martes 13/10/2026 (UTC-3 → 10:00Z a 22:00Z).
function guardia(p: Partial<GuardiaLegajo> = {}): GuardiaLegajo {
  return {
    guardia_id: 'g1', supervisor_id: 'sup', supervisor: 'Sup', fecha: '2026-10-13', zona: 'Rosario',
    tipo_evento: 'normal', estado: 'activo', cubre: true,
    inicio: '2026-10-13T10:00:00Z', fin: '2026-10-13T22:00:00Z', horas_programadas: 12,
    gps_desde: null, gps_hasta: null, gps_puntos: 0, supervisiones: 0, objetivos_visitados: 0, ...p,
  }
}
function sup(created_at: string, p: Partial<SupervisionLegajo> = {}): SupervisionLegajo {
  return {
    supervision_id: created_at, supervisor_id: 'sup', supervisor: 'Sup', created_at,
    objetivo_id: 'o1', objetivo: 'Objetivo 1', zona_id: 'z', zona: 'Rosario', estado: 'ok',
    observaciones: null, items_total: 5, items_observados: 0, novedades_items: null, fotos: 1,
    lat: -32.9, lng: -60.6, distancia_objetivo_m: 10, radio_m: 100,
    guardia_id: 'g1', hay_guardia_cerca: true, ...p,
  }
}

describe('quién ve el legajo operativo', () => {
  it('Dirección, Gerencia, delegación y Jefe de supervisores (Aldo), sí', () => {
    expect(puedeVerLegajoSupervisores({ puesto_organizacional: 'direccion_operativa' })).toBe(true)
    expect(puedeVerLegajoSupervisores({ puesto_organizacional: 'gerencia' })).toBe(true)
    expect(puedeVerLegajoSupervisores({ puesto_organizacional: 'administracion', acceso_gerencia_delegado: true })).toBe(true)
    expect(puedeVerLegajoSupervisores({ puesto_organizacional: 'jefe_supervisores', rol: 'supervisor' })).toBe(true)
  })
  it('supervisor, administración y vigilador, NO', () => {
    expect(puedeVerLegajoSupervisores({ puesto_organizacional: 'supervisor' })).toBe(false)
    expect(puedeVerLegajoSupervisores({ puesto_organizacional: 'administracion', rol: 'admin' })).toBe(false)
    expect(puedeVerLegajoSupervisores({ puesto_organizacional: 'vigilador' })).toBe(false)
    expect(puedeVerLegajoSupervisores(null)).toBe(false)
  })
})

describe('situación respecto del turno', () => {
  it('con guardia = en turno; sin guardia pero con calendario ese día = fuera; sin calendario = sin guardia cargada', () => {
    expect(situacionTurno({ guardia_id: 'g', hay_guardia_cerca: true })).toBe('en_turno')
    expect(situacionTurno({ guardia_id: null, hay_guardia_cerca: true })).toBe('fuera_turno')
    expect(situacionTurno({ guardia_id: null, hay_guardia_cerca: false })).toBe('sin_calendario')
  })
})

describe('hora argentina (no la del proceso)', () => {
  it('03:30Z del martes 13 es 00 h del martes; 02:00Z del miércoles 14 es martes 23 h', () => {
    expect(horaYDiaArgentina('2026-10-13T03:30:00Z')).toEqual({ hora: 0, dia: 1 })
    expect(horaYDiaArgentina('2026-10-14T02:00:00Z')).toEqual({ hora: 23, dia: 1 })
    expect(horaYDiaArgentina('2026-10-12T15:00:00Z')).toEqual({ hora: 12, dia: 0 }) // lunes 12
  })
})

describe('distribución horaria', () => {
  it('cuenta supervisiones por hora y situación, con los minutos de servicio al lado', () => {
    const f = distribucionHoraria(
      [sup('2026-10-13T11:15:00Z'), sup('2026-10-13T11:45:00Z', { guardia_id: null }), sup('2026-10-13T05:00:00Z', { guardia_id: null, hay_guardia_cerca: false })],
      [guardia()],
    )
    expect(f[8]).toMatchObject({ enTurno: 1, fueraTurno: 1, minutosServicio: 60 })
    expect(f[2]).toMatchObject({ sinCalendario: 1, minutosServicio: 0 })
    expect(f.reduce((a, x) => a + x.minutosServicio, 0)).toBe(12 * 60)
    expect(f[19].minutosServicio).toBe(0)
  })
  it('una guardia nocturna 19→07 reparte servicio en 12 horas que cruzan la medianoche', () => {
    const f = distribucionHoraria([], [guardia({ inicio: '2026-10-13T22:00:00Z', fin: '2026-10-14T10:00:00Z' })])
    expect(f.filter(x => x.minutosServicio === 60).map(x => x.hora)).toEqual([0, 1, 2, 3, 4, 5, 6, 19, 20, 21, 22, 23])
  })
  it('un franco no suma horas de servicio', () => {
    const f = distribucionHoraria([], [guardia({ cubre: false, tipo_evento: 'franco' })])
    expect(f.every(x => x.minutosServicio === 0)).toBe(true)
  })
  it('guardia que no empieza en hora en punto: minutos parciales', () => {
    const f = distribucionHoraria([], [guardia({ inicio: '2026-10-13T10:30:00Z', fin: '2026-10-13T11:10:00Z' })])
    expect(f[7].minutosServicio).toBe(30)
    expect(f[8].minutosServicio).toBe(10)
  })
})

describe('matriz día × hora', () => {
  it('lunes primero, hora argentina', () => {
    const m = matrizDiaHora([sup('2026-10-13T11:15:00Z'), sup('2026-10-18T23:00:00Z')])
    expect(m[1][8]).toBe(1) // martes 08 h
    expect(m[6][20]).toBe(1) // domingo 20 h
  })
})

describe('posición dentro del turno', () => {
  it('primer 20 %, medio y último 20 % de la guardia; fuera de turno no cuenta', () => {
    const r = posicionEnTurno(
      [sup('2026-10-13T10:30:00Z'), sup('2026-10-13T16:00:00Z'), sup('2026-10-13T21:30:00Z'), sup('2026-10-13T23:00:00Z', { guardia_id: null })],
      [guardia()],
    )
    expect(r).toEqual({ inicio: 1, medio: 1, final: 1 })
  })
})

describe('franjas de servicio sin supervisiones', () => {
  const despues = new Date('2026-10-14T12:00:00Z')
  it('huecos de 2 h o más dentro de la guardia', () => {
    const h = franjasSinSupervision(guardia(), [sup('2026-10-13T11:00:00Z'), sup('2026-10-13T12:00:00Z'), sup('2026-10-13T19:00:00Z')], 120, despues)
    expect(h.map(x => x.minutos)).toEqual([420, 180])
  })
  it('sin supervisiones: toda la guardia es un hueco', () => {
    expect(franjasSinSupervision(guardia(), [], 120, despues)).toEqual([
      { desde: '2026-10-13T10:00:00.000Z', hasta: '2026-10-13T22:00:00.000Z', minutos: 720 },
    ])
  })
  it('NO se reclama fuera del servicio: franco o guardia futura no tienen huecos', () => {
    expect(franjasSinSupervision(guardia({ cubre: false }), [], 120, despues)).toEqual([])
    expect(franjasSinSupervision(guardia(), [], 120, new Date('2026-10-13T09:00:00Z'))).toEqual([])
  })
  it('guardia en curso: se mide sólo hasta ahora', () => {
    const h = franjasSinSupervision(guardia(), [], 120, new Date('2026-10-13T13:00:00Z'))
    expect(h).toHaveLength(1)
    expect(h[0].minutos).toBe(180)
  })
  it('supervisiones de otro supervisor no tapan el hueco', () => {
    const h = franjasSinSupervision(guardia(), [sup('2026-10-13T16:00:00Z', { supervisor_id: 'otro' })], 120, despues)
    expect(h[0].minutos).toBe(720)
  })
})

describe('objetivos visitados', () => {
  it('de menos a más visitas, con cuántas en turno', () => {
    const o = objetivosVisitados([
      sup('2026-10-13T11:00:00Z'), sup('2026-10-13T12:00:00Z', { guardia_id: null }),
      sup('2026-10-13T13:00:00Z', { objetivo_id: 'o2', objetivo: 'Objetivo 2' }),
    ])
    expect(o.map(x => [x.objetivo, x.visitas, x.enTurno])).toEqual([['Objetivo 2', 1, 1], ['Objetivo 1', 2, 1]])
  })
})

describe('recorrido: sólo se une lo que tiene evidencia', () => {
  const p = (ts: string, lat: number, lng: number, precision_m: number | null = 10): PuntoRecorrido =>
    ({ ts, lat, lng, precision_m, tipo_punto: 'moving', estado_movimiento: null, supervision_id: null })
  it('puntos cercanos en el tiempo forman un tramo', () => {
    const r = tramosConEvidencia([p('2026-10-13T10:00:00Z', -32.9, -60.6), p('2026-10-13T10:01:00Z', -32.901, -60.6), p('2026-10-13T10:02:00Z', -32.902, -60.6)])
    expect(r.tramos).toHaveLength(1)
    expect(r.tramos[0]).toHaveLength(3)
    expect(r.cortes).toBe(0)
  })
  it('un hueco de más de 5 min corta el tramo (no se inventa el trayecto)', () => {
    const r = tramosConEvidencia([
      p('2026-10-13T10:00:00Z', -32.9, -60.6), p('2026-10-13T10:01:00Z', -32.901, -60.6),
      p('2026-10-13T11:30:00Z', -32.95, -60.65), p('2026-10-13T11:31:00Z', -32.951, -60.65),
    ])
    expect(r.tramos).toHaveLength(2)
    expect(r.cortes).toBe(1)
  })
  it('un salto imposible (GPS loco) corta; un punto impreciso queda suelto', () => {
    const r = tramosConEvidencia([
      p('2026-10-13T10:00:00Z', -32.9, -60.6), p('2026-10-13T10:00:30Z', -31.6, -60.7),
      p('2026-10-13T10:01:00Z', -32.901, -60.6, 900),
    ])
    expect(r.tramos).toHaveLength(0)
    expect(r.sueltos).toHaveLength(3)
  })
  it('ordena por hora aunque lleguen desordenados', () => {
    const r = tramosConEvidencia([p('2026-10-13T10:01:00Z', -32.901, -60.6), p('2026-10-13T10:00:00Z', -32.9, -60.6)])
    expect(r.tramos[0][0]).toEqual([-32.9, -60.6])
  })
})

describe('resumen', () => {
  it('horas de servicio sin francos, y supervisiones en turno por hora de servicio', () => {
    const r = resumenLegajo(
      [guardia({ gps_puntos: 30 }), guardia({ guardia_id: 'g2', cubre: false, horas_programadas: 12 })],
      [sup('2026-10-13T11:00:00Z'), sup('2026-10-13T12:00:00Z'), sup('2026-10-13T23:00:00Z', { guardia_id: null }), sup('2026-10-12T23:00:00Z', { guardia_id: null, hay_guardia_cerca: false, items_observados: 1 })],
    )
    expect(r).toMatchObject({
      guardiasServicio: 1, horasProgramadas: 12, guardiasConGps: 1, supervisiones: 4,
      enTurno: 2, fueraTurno: 1, sinCalendario: 1, conItemsObservados: 1, porHoraServicio: 0.17,
    })
  })
  it('sin guardias de servicio no hay tasa (null, no 0)', () => {
    expect(resumenLegajo([], [sup('2026-10-13T11:00:00Z')]).porHoraServicio).toBeNull()
  })
})

describe('carga: errores propagados', () => {
  it('junta los errores de guardias y supervisiones', async () => {
    const db = { rpc: async (fn: string) => (fn.endsWith('guardias') ? { data: null, error: { message: 'sin permiso' } } : { data: [], error: null }) }
    const r = await cargarLegajoSupervisores(db, 's', '2026-10-01', '2026-10-19')
    expect(r.error).toBe('guardias: sin permiso')
  })
  it('normaliza numeric que llega como string', async () => {
    const db = { rpc: async () => ({ data: [{ ts: '2026-10-13T10:00:00Z', lat: '-32.9', lng: '-60.6', precision_m: 8 }], error: null }) }
    const r = await cargarRecorridoGuardia(db, 'g')
    expect(r.puntos[0]).toMatchObject({ lat: -32.9, lng: -60.6, precision_m: 8, supervision_id: null })
  })
})
