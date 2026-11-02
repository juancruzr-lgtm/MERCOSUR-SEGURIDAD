import { describe, expect, it } from 'vitest'
import {
  coberturaRealTurno,
  detectarDobleLiquidacion,
  esReemplazoDe,
  horasEsperadasPorGuardiaDia,
  verificarConsistenciaHoras,
  type RegistroCobertura,
  type TurnoCobertura,
} from '@/lib/cobertura-turnos'

// Reconstrucción del caso Polideportivo Lotuf, 29/10/2026 15–23, con los datos
// de producción (horarios, created_at y registros leídos el 02/11/2026):
//   · turno de Eduardo Martínez, planificado el 01/10, terminó 'cubierto' por
//     una confirmación administrativa SIN fichaje ni evidencia (8 h);
//   · turno de Nicolás González creado el 29/10 a las 15:05 (hora AR) en el
//     mismo puesto, con fichaje 15:06–23:14 y fotos de ingreso.
// El puesto se estaba liquidando 16 h por un intervalo de 8 h.
const PUESTO = 'puesto-lotuf'
const LOTUF = 'obj-lotuf'
const EDU = 'edu'
const NICO = 'nico'

const tEdu: TurnoCobertura = {
  id: 't-edu', guardia_id: EDU, objetivo_id: LOTUF, puesto_id: PUESTO, fecha: '2026-10-29',
  hora_inicio: '15:00:00', hora_fin: '23:00:00', estado: 'cubierto', created_at: '2026-10-01T02:42:05Z',
}
const tNico: TurnoCobertura = {
  id: 't-nico', guardia_id: NICO, objetivo_id: LOTUF, puesto_id: PUESTO, fecha: '2026-10-29',
  hora_inicio: '15:00:00', hora_fin: '23:00:00', estado: 'programado', created_at: '2026-10-29T18:05:20Z',
}
const rEduManual: RegistroCobertura = {
  id: 'r-edu', turno_id: 't-edu', guardia_id: EDU, tipo_registro: 'carga_manual',
  origen_cobertura: 'confirmacion_supervisor', horas_liquidables: 8,
}
const rNicoGps: RegistroCobertura = {
  id: 'r-nico', turno_id: 't-nico', guardia_id: NICO, tipo_registro: 'fichaje_gps',
  hora_entrada_real: '15:06:37', hora_salida_real: '23:14:10', horas_trabajadas: 8.13,
}

describe('reemplazo que cubre efectivamente un puesto', () => {
  it('el turno creado sobre la marcha en el mismo puesto es reemplazo del planificado', () => {
    expect(esReemplazoDe(tNico, tEdu)).toBe(true)
    expect(esReemplazoDe(tEdu, tNico)).toBe(false)
  })

  it('con el titular sin registro, el reemplazo con fichaje cubre el puesto completo', () => {
    const c = coberturaRealTurno({ ...tEdu, estado: 'programado' }, [tEdu, tNico], [rNicoGps])
    expect(c.estado).toBe('cubierto_reemplazo')
    expect(c.horasCubiertasConEvidencia).toBe(8)
    expect(c.horasLiquidadas).toBe(8)
    expect(c.horasDobleLiquidacion).toBe(0)
    expect(c.coberturas.map(x => [x.rol, x.evidencia])).toEqual([['titular', 'sin_registro'], ['reemplazo', 'fichaje']])
  })

  it('el vínculo explícito reemplaza_turno_id manda aunque el turno se haya creado antes', () => {
    const anticipado = { ...tNico, created_at: '2026-09-30T00:00:00Z', reemplaza_turno_id: 't-edu' }
    expect(esReemplazoDe(anticipado, tEdu)).toBe(true)
    expect(esReemplazoDe({ ...tNico, reemplaza_turno_id: 'otro' }, tEdu)).toBe(false)
  })

  it('un puesto con dos posiciones planificadas a la vez NO se toma como reemplazo', () => {
    const segunda = { ...tNico, created_at: '2026-10-01T02:42:06Z' }
    expect(esReemplazoDe(segunda, tEdu)).toBe(false)
  })

  it('un relevo parcial se atribuye en proporción al solapamiento', () => {
    const relevo: TurnoCobertura = { ...tNico, id: 't-relevo', hora_inicio: '19:00:00', hora_fin: '23:00:00' }
    const rRelevo: RegistroCobertura = { id: 'rr', turno_id: 't-relevo', guardia_id: NICO, hora_entrada_real: '19:00', hora_salida_real: '23:00' }
    const rEduParcial: RegistroCobertura = { id: 're', turno_id: 't-edu', guardia_id: EDU, hora_entrada_real: '15:00', hora_salida_real: '19:00', hora_salida_final: '19:00', hora_entrada_final: '15:00' }
    const c = coberturaRealTurno(tEdu, [tEdu, relevo], [rEduParcial, rRelevo])
    expect(c.horasLiquidadas).toBe(8)
    expect(c.horasDobleLiquidacion).toBe(0)
    expect(c.estado).toBe('cubierto_titular')
  })
})

describe('no doble liquidación', () => {
  it('caso Lotuf: confirmación manual del titular + fichaje del reemplazo = 8 h pagadas dos veces', () => {
    const c = coberturaRealTurno(tEdu, [tEdu, tNico], [rEduManual, rNicoGps])
    expect(c.horasProgramadas).toBe(8)
    expect(c.horasLiquidadas).toBe(16)
    expect(c.horasDobleLiquidacion).toBe(8)
    expect(c.estado).toBe('doble_liquidacion')
    expect(c.coberturas[0].evidencia).toBe('sin_evidencia')
  })

  it('detectarDobleLiquidacion encuentra sólo el turno titular', () => {
    const r = detectarDobleLiquidacion([tEdu, tNico], [rEduManual, rNicoGps])
    expect(r.map(x => x.turnoId)).toEqual(['t-edu'])
  })

  it('tras anular la confirmación sin evidencia (horas 0) ya no hay doble liquidación', () => {
    const anulado = { ...rEduManual, cobertura_anulada_at: '2026-11-02T12:00:00Z', horas_liquidables: 0 }
    expect(detectarDobleLiquidacion([tEdu, tNico], [anulado, rNicoGps])).toEqual([])
  })

  it('un turno reemplazado/anulado no genera obligación ni doble liquidación', () => {
    expect(detectarDobleLiquidacion([{ ...tEdu, estado: 'reemplazado' }, tNico], [rEduManual, rNicoGps])).toEqual([])
  })

  it('la excepción autorizada se reconoce como evidencia, pero no habilita pagar dos veces', () => {
    const c = coberturaRealTurno(tEdu, [tEdu, tNico], [rEduManual, rNicoGps], { registrosConExcepcion: new Set(['r-edu']) })
    expect(c.coberturas[0].evidencia).toBe('excepcion_autorizada')
    expect(c.horasDobleLiquidacion).toBe(8)
  })
})

describe('turno nocturno que cruza medianoche pertenece al día de inicio', () => {
  const noche: TurnoCobertura = {
    id: 't-noche', guardia_id: NICO, objetivo_id: 'dep', puesto_id: 'p-dep', fecha: '2026-10-30',
    hora_inicio: '19:00:00', hora_fin: '07:00:00', estado: 'programado', created_at: '2026-10-01T02:14:07Z',
  }
  const rNoche: RegistroCobertura = { id: 'rn', turno_id: 't-noche', guardia_id: NICO, hora_entrada_real: '18:55:18', hora_salida_real: '07:01:20', horas_trabajadas: 12.1 }

  it('las 12 h se atribuyen al 30/10, nada al 31/10', () => {
    const m = horasEsperadasPorGuardiaDia([noche], [rNoche])
    expect(m.get(`${NICO}|2026-10-30`)).toBe(12)
    expect(m.has(`${NICO}|2026-10-31`)).toBe(false)
  })

  it('la cobertura del nocturno dura 12 h y se reporta con fecha de inicio', () => {
    const c = coberturaRealTurno(noche, [noche], [rNoche])
    expect(c.fecha).toBe('2026-10-30')
    expect(c.horasProgramadas).toBe(12)
    expect(c.estado).toBe('cubierto_titular')
  })
})

describe('consistencia Dashboard / Planillas / Reportes', () => {
  const turnos = [tEdu, tNico]
  const registros = [rEduManual, rNicoGps]

  it('si las tres fuentes dan lo mismo que la regla, no hay diferencias (pero sí doble liquidación)', () => {
    const esperado = horasEsperadasPorGuardiaDia(turnos, registros)
    const fuentes = ['dashboard', 'planilla', 'reporte'].map(nombre => ({ nombre, horas: new Map(esperado) }))
    const r = verificarConsistenciaHoras(turnos, registros, fuentes)
    expect(r.diferencias).toEqual([])
    expect(r.dobleLiquidacion.map(x => x.turnoId)).toEqual(['t-edu'])
    expect(r.consistente).toBe(false)
  })

  it('marca la clave en la que una fuente difiere', () => {
    const esperado = horasEsperadasPorGuardiaDia(turnos, registros)
    const planilla = new Map(esperado)
    planilla.set(`${EDU}|2026-10-29`, 0)
    const r = verificarConsistenciaHoras(turnos, registros, [
      { nombre: 'dashboard', horas: esperado },
      { nombre: 'planilla', horas: planilla },
    ])
    expect(r.diferencias).toEqual([{
      clave: `${EDU}|2026-10-29`, guardiaId: EDU, fecha: '2026-10-29', esperado: 8,
      porFuente: { dashboard: 8, planilla: 0 },
    }])
  })

  it('sin la confirmación sin evidencia, todo es consistente', () => {
    const r = verificarConsistenciaHoras(turnos, [rNicoGps], [
      { nombre: 'dashboard', horas: new Map([[`${NICO}|2026-10-29`, 8]]) },
    ])
    expect(r.consistente).toBe(true)
  })
})
