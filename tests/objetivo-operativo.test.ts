import { describe, expect, it } from 'vitest'
import {
  objetivoEstaOperativo,
  turnoSinCoberturaOperativa,
  turnoSinCoberturaEnObjetivoOperativo,
} from '@/lib/turnos'

// Criterio ÚNICO de objetivo operativo. El espejo SQL es `o.estado = 'activo'`
// en rondas_ventanas_programadas y en asignar_vigilador_turnos. Si cambia acá,
// tiene que cambiar allá.

const turnoSinGuardia = { id: 't1', fecha: '2026-08-12', hora_inicio: '08:00', hora_fin: '16:00', guardia_id: null, estado: 'programado' }
const activo = { estado: 'activo' }
const pausado = { estado: 'inactivo' }

describe('objetivoEstaOperativo', () => {
  it('activo es operativo', () => expect(objetivoEstaOperativo(activo)).toBe(true))
  it('inactivo no lo es', () => expect(objetivoEstaOperativo(pausado)).toBe(false))

  it('sin dato de objetivo se asume operativo: no silenciar alertas por las dudas', () => {
    expect(objetivoEstaOperativo(undefined)).toBe(true)
    expect(objetivoEstaOperativo(null)).toBe(true)
    expect(objetivoEstaOperativo({})).toBe(true)
  })

  it('cualquier estado distinto de activo queda fuera de operacion', () => {
    expect(objetivoEstaOperativo({ estado: 'suspendido' })).toBe(false)
  })
})

describe('turnoSinCoberturaEnObjetivoOperativo', () => {
  it('objetivo activo + turno sin guardia = puesto descubierto', () => {
    expect(turnoSinCoberturaEnObjetivoOperativo(turnoSinGuardia as any, activo)).toBe(true)
  })

  it('objetivo pausado: el turno se conserva pero NO es puesto descubierto', () => {
    expect(turnoSinCoberturaEnObjetivoOperativo(turnoSinGuardia as any, pausado)).toBe(false)
  })

  it('no rompe la regla de estados sin obligacion que ya existia', () => {
    const anulado = { ...turnoSinGuardia, estado: 'anulado' }
    expect(turnoSinCoberturaOperativa(anulado as any)).toBe(false)
    expect(turnoSinCoberturaEnObjetivoOperativo(anulado as any, activo)).toBe(false)
    // Doble motivo para no ser descubierto: sigue sin serlo.
    expect(turnoSinCoberturaEnObjetivoOperativo(anulado as any, pausado)).toBe(false)
  })

  it('turno con guardia nunca es descubierto, este el objetivo como este', () => {
    const conGuardia = { ...turnoSinGuardia, guardia_id: 'g1' }
    expect(turnoSinCoberturaEnObjetivoOperativo(conGuardia as any, activo)).toBe(false)
    expect(turnoSinCoberturaEnObjetivoOperativo(conGuardia as any, pausado)).toBe(false)
  })
})

// El detector compartido de alertas operativas: una sola fuente para los cuatro
// paneles del panel de administracion (descubierto, sin fichar, tardanza, fuera
// de radio). El estado del objetivo se aplica aca, no en cada panel.
import { detectarAlertasOperativas } from '@/lib/revision-operativa'

const ayer = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10)
const turnoDescubierto = {
  id: 't1', objetivo_id: 'o1', puesto_id: null, guardia_id: null,
  fecha: ayer, hora_inicio: '08:00', hora_fin: '16:00', estado: 'programado',
}

describe('detectarAlertasOperativas y el estado del objetivo', () => {
  it('objetivo activo: detecta el turno descubierto', () => {
    const a = detectarAlertasOperativas({
      turnos: [turnoDescubierto as any], registros: [],
      objetivos: [{ id: 'o1', estado: 'activo' }],
    })
    expect(a.some(x => x.tipo_alerta === 'descubierto')).toBe(true)
  })

  it('objetivo pausado: no detecta nada', () => {
    const a = detectarAlertasOperativas({
      turnos: [turnoDescubierto as any], registros: [],
      objetivos: [{ id: 'o1', estado: 'inactivo' }],
    })
    expect(a).toHaveLength(0)
  })

  it('sin pasar objetivos se comporta como antes: no silencia nada', () => {
    const a = detectarAlertasOperativas({ turnos: [turnoDescubierto as any], registros: [] })
    expect(a.some(x => x.tipo_alerta === 'descubierto')).toBe(true)
  })

  it('un objetivo pausado no silencia los turnos de otro objetivo activo', () => {
    const otro = { ...turnoDescubierto, id: 't2', objetivo_id: 'o2' }
    const a = detectarAlertasOperativas({
      turnos: [turnoDescubierto as any, otro as any], registros: [],
      objetivos: [{ id: 'o1', estado: 'inactivo' }, { id: 'o2', estado: 'activo' }],
    })
    expect(a.map(x => x.turno_id)).toEqual(['t2'])
  })
})

// Superposición: un turno en un objetivo pausado NO ocupa al vigilador. Es la
// comprobación previa del cliente; la autoridad sigue siendo
// asignar_vigilador_turnos, que aplica el mismo criterio con o2.estado.
import { tieneTurnoSuperpuesto, idsObjetivosPausados } from '@/lib/turnos'

const enCasaJuan = {
  id: 'tA', guardia_id: 'g1', objetivo_id: 'pausado',
  fecha: '2026-08-13', hora_inicio: '08:00', hora_fin: '16:00',
}
const candidatoMismoHorario = {
  guardia_id: 'g1', objetivo_id: 'activo',
  fecha: '2026-08-13', hora_inicio: '08:00', hora_fin: '16:00',
}
const pausados = idsObjetivosPausados([
  { id: 'pausado', estado: 'inactivo' },
  { id: 'activo', estado: 'activo' },
])

describe('tieneTurnoSuperpuesto y objetivos pausados', () => {
  it('sin el set se comporta como antes: bloquea', () => {
    expect(tieneTurnoSuperpuesto([enCasaJuan], candidatoMismoHorario)).toBe(true)
  })

  it('el turno de un objetivo pausado no bloquea el mismo horario en uno activo', () => {
    expect(tieneTurnoSuperpuesto([enCasaJuan], candidatoMismoHorario, null, pausados)).toBe(false)
  })

  it('el turno de un objetivo activo sigue bloqueando', () => {
    const enActivo = { ...enCasaJuan, objetivo_id: 'activo' }
    expect(tieneTurnoSuperpuesto([enActivo], candidatoMismoHorario, null, pausados)).toBe(true)
  })

  it('un turno sin objetivo_id no se descarta: sin el dato se prefiere advertir', () => {
    const sinObjetivo = { ...enCasaJuan, objetivo_id: null }
    expect(tieneTurnoSuperpuesto([sinObjetivo], candidatoMismoHorario, null, pausados)).toBe(true)
  })

  it('excluirTurnoId sigue funcionando', () => {
    expect(tieneTurnoSuperpuesto([enCasaJuan], candidatoMismoHorario, 'tA', null)).toBe(false)
  })
})
