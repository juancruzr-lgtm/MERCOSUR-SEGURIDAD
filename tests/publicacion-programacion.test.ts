import { describe, expect, it } from 'vitest'
import {
  ETIQUETA_MOTIVO_OMISION_PUBLICACION,
  esTurnoPublicable,
  etiquetaAlcancePublicacion,
  planificarPublicacion,
  puedePublicarProgramacion,
} from '@/lib/publicacion-programacion'
import type { TurnoGrilla } from '@/lib/asignacion-mensual'

// Estado Publicado para la programación mensual (Bloque E). Puro: arma el
// plan de publicación (qué turnos quedan válidos, ya publicados u omitidos
// con motivo) para que el usuario lo revise antes de confirmar. La escritura
// real vive en la RPC publicar_turnos_programacion.

const t = (over: Partial<TurnoGrilla> & Pick<TurnoGrilla, 'id' | 'fecha'>): TurnoGrilla => ({
  puesto_id: 'pv1', puesto_nombre: 'Vigilador 1', guardia_id: null, guardia_nombre: null,
  hora_inicio: '07:00', hora_fin: '19:00', estado: 'programado', tipo_evento: 'normal', publicado: false,
  ...over,
})

describe('esTurnoPublicable', () => {
  it('turno programado normal: publicable', () => {
    expect(esTurnoPublicable(t({ id: 'a', fecha: '2026-08-10' }))).toEqual({ publicable: true, yaPublicado: false, motivo: null })
  })

  it('turno ya publicado: no se reenvía, se informa aparte (no es un omitido)', () => {
    const ev = esTurnoPublicable(t({ id: 'a', fecha: '2026-08-10', publicado: true }))
    expect(ev.publicable).toBe(false)
    expect(ev.yaPublicado).toBe(true)
    expect(ev.motivo).toBeNull()
  })

  it('turno reemplazado: omitido por sin_obligacion', () => {
    const ev = esTurnoPublicable(t({ id: 'a', fecha: '2026-08-10', estado: 'reemplazado' }))
    expect(ev.publicable).toBe(false)
    expect(ev.motivo).toBe('sin_obligacion')
  })

  it('turno anulado o cancelado: omitido por sin_obligacion (defensivo, aunque hoy no sean valores reales de estado)', () => {
    expect(esTurnoPublicable(t({ id: 'a', fecha: '2026-08-10', estado: 'anulado' })).motivo).toBe('sin_obligacion')
    expect(esTurnoPublicable(t({ id: 'b', fecha: '2026-08-10', estado: 'cancelado' })).motivo).toBe('sin_obligacion')
  })

  it('turno sin posición operativa: omitido por sin_posicion', () => {
    const ev = esTurnoPublicable(t({ id: 'a', fecha: '2026-08-10', puesto_id: null }))
    expect(ev.motivo).toBe('sin_posicion')
  })

  it('turno con datos inconsistentes (horario cero, fecha vacía): omitido por inconsistente', () => {
    expect(esTurnoPublicable(t({ id: 'a', fecha: '2026-08-10', hora_inicio: '08:00', hora_fin: '08:00' })).motivo).toBe('inconsistente')
    expect(esTurnoPublicable(t({ id: 'b', fecha: '' })).motivo).toBe('inconsistente')
  })

  it('turno cubierto, descubierto o ausente: publicable (no están en la lista de exclusión)', () => {
    expect(esTurnoPublicable(t({ id: 'a', fecha: '2026-08-10', estado: 'cubierto' })).publicable).toBe(true)
    expect(esTurnoPublicable(t({ id: 'b', fecha: '2026-08-10', estado: 'descubierto' })).publicable).toBe(true)
    expect(esTurnoPublicable(t({ id: 'c', fecha: '2026-08-10', estado: 'ausente' })).publicable).toBe(true)
  })

  it('turno nocturno que cruza medianoche (hora_fin < hora_inicio): publicable, no es inconsistente', () => {
    expect(esTurnoPublicable(t({ id: 'a', fecha: '2026-08-10', hora_inicio: '19:00', hora_fin: '07:00' })).publicable).toBe(true)
  })
})

describe('planificarPublicacion — modo rango', () => {
  const turnos: TurnoGrilla[] = [
    t({ id: 'a', fecha: '2026-08-05', puesto_id: 'pv1' }),
    t({ id: 'b', fecha: '2026-08-10', puesto_id: 'pv1' }),
    t({ id: 'c', fecha: '2026-08-15', puesto_id: 'pv2', puesto_nombre: 'Vigilador 2' }),
    t({ id: 'd', fecha: '2026-08-20', puesto_id: 'pv1', estado: 'reemplazado' }),
    t({ id: 'e', fecha: '2026-08-25', puesto_id: 'pv1', publicado: true }),
  ]

  it('todo el mes: incluye todos los turnos del rango, clasificados', () => {
    const plan = planificarPublicacion(turnos, { modo: 'rango', desde: '2026-08-01', hasta: '2026-08-31' })
    expect(plan.resumen.total).toBe(5)
    expect(plan.resumen.validos).toBe(3) // a, b, c
    expect(plan.resumen.ya_publicados).toBe(1) // e
    expect(plan.resumen.omitidos).toBe(1) // d (reemplazado)
    expect(plan.turno_ids.sort()).toEqual(['a', 'b', 'c'])
  })

  it('rango de fechas: excluye turnos fuera del rango', () => {
    const plan = planificarPublicacion(turnos, { modo: 'rango', desde: '2026-08-01', hasta: '2026-08-12' })
    expect(plan.turno_ids.sort()).toEqual(['a', 'b'])
  })

  it('posiciones seleccionadas: filtra por puesto_id dentro del rango', () => {
    const plan = planificarPublicacion(turnos, { modo: 'rango', desde: '2026-08-01', hasta: '2026-08-31', puestoIds: ['pv2'] })
    expect(plan.turno_ids).toEqual(['c'])
  })

  it('omitidos_por_motivo agrupa correctamente', () => {
    const conMasOmitidos = [...turnos, t({ id: 'f', fecha: '2026-08-06', puesto_id: null })]
    const plan = planificarPublicacion(conMasOmitidos, { modo: 'rango', desde: '2026-08-01', hasta: '2026-08-31' })
    expect(plan.resumen.omitidos_por_motivo.sin_obligacion).toBe(1)
    expect(plan.resumen.omitidos_por_motivo.sin_posicion).toBe(1)
    expect(plan.resumen.omitidos_por_motivo.inconsistente).toBe(0)
  })
})

describe('planificarPublicacion — modo turnos (selección manual)', () => {
  it('ignora rango y posiciones: usa exactamente los ids elegidos', () => {
    const turnos: TurnoGrilla[] = [
      t({ id: 'a', fecha: '2026-08-05' }),
      t({ id: 'b', fecha: '2026-08-10' }),
      t({ id: 'c', fecha: '2026-08-15' }),
    ]
    const plan = planificarPublicacion(turnos, { modo: 'turnos', turnoIds: ['a', 'c'] })
    expect(plan.turno_ids.sort()).toEqual(['a', 'c'])
    expect(plan.resumen.total).toBe(2)
  })
})

describe('etiquetaAlcancePublicacion', () => {
  it('modo turnos', () => {
    expect(etiquetaAlcancePublicacion({ modo: 'turnos', turnoIds: ['a', 'b', 'c'] })).toBe('3 turno(s) seleccionado(s) manualmente')
  })

  it('modo rango sin posiciones (todo el rango)', () => {
    expect(etiquetaAlcancePublicacion({ modo: 'rango', desde: '2026-08-01', hasta: '2026-08-31' }))
      .toBe('2026-08-01 a 2026-08-31 · Todas las posiciones')
  })

  it('modo rango con un solo día', () => {
    expect(etiquetaAlcancePublicacion({ modo: 'rango', desde: '2026-08-10', hasta: '2026-08-10' }))
      .toBe('2026-08-10 · Todas las posiciones')
  })

  it('modo rango con posiciones: usa los nombres cuando se proveen', () => {
    expect(etiquetaAlcancePublicacion(
      { modo: 'rango', desde: '2026-08-01', hasta: '2026-08-31', puestoIds: ['pv1', 'pv2'] },
      ['Vigilador 1', 'Vigilador 2'],
    )).toBe('2026-08-01 a 2026-08-31 · Posiciones: Vigilador 1, Vigilador 2')
  })

  it('modo rango con posiciones sin nombres: cuenta cuántas', () => {
    expect(etiquetaAlcancePublicacion({ modo: 'rango', desde: '2026-08-01', hasta: '2026-08-31', puestoIds: ['pv1', 'pv2'] }))
      .toBe('2026-08-01 a 2026-08-31 · Posiciones: 2 posición(es)')
  })
})

describe('puedePublicarProgramacion', () => {
  it('admin y supervisor pueden; el resto no (mismo modelo que asignar_vigilador_turnos)', () => {
    expect(puedePublicarProgramacion('admin')).toBe(true)
    expect(puedePublicarProgramacion('supervisor')).toBe(true)
    expect(puedePublicarProgramacion('guardia')).toBe(false)
    expect(puedePublicarProgramacion(null)).toBe(false)
    expect(puedePublicarProgramacion(undefined)).toBe(false)
  })
})

describe('etiquetas de motivo', () => {
  it('las 3 etiquetas de omisión existen y son legibles', () => {
    expect(ETIQUETA_MOTIVO_OMISION_PUBLICACION.sin_obligacion).toBeTruthy()
    expect(ETIQUETA_MOTIVO_OMISION_PUBLICACION.sin_posicion).toBeTruthy()
    expect(ETIQUETA_MOTIVO_OMISION_PUBLICACION.inconsistente).toBeTruthy()
  })
})

describe('pureza', () => {
  it('no muta las entradas ni escribe nada — solo produce el plan', () => {
    const turnos: TurnoGrilla[] = [t({ id: 'a', fecha: '2026-08-10' })]
    const congelar = (v: unknown) => { if (v && typeof v === 'object') { Object.freeze(v); Object.values(v as object).forEach(congelar) } }
    congelar(turnos)
    const antes = JSON.stringify(turnos)
    expect(() => planificarPublicacion(turnos, { modo: 'rango', desde: '2026-08-01', hasta: '2026-08-31' })).not.toThrow()
    expect(JSON.stringify(turnos)).toBe(antes)
  })
})
