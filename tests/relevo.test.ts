import { describe, expect, it } from 'vitest'
import {
  buscarRelevo, duracionLegible, evaluarCambioDeFin, mensajeImpacto, tramoTurno,
} from '@/lib/relevo'
import type { TurnoRelevo } from '@/lib/relevo'

// Lo que se fija acá es que correr la hora de fin de un turno NO deje una
// doble cobertura ni un hueco sin que nadie lo vea. El módulo no bloquea nada:
// describe. Los tests comprueban que describa el hecho correcto.

const PUESTO_A = 'puesto-a'
const PUESTO_B = 'puesto-b'
const OBJ = 'obj-1'

const turno = (over: Partial<TurnoRelevo> = {}): TurnoRelevo => ({
  id: 't1', objetivo_id: OBJ, puesto_id: PUESTO_A,
  fecha: '2026-08-31', hora_inicio: '07:00', hora_fin: '19:00',
  guardia_id: 'g-a', estado: 'programado',
  ...over,
})

/** El relevo clásico: B entra a las 19:00 y sigue toda la noche. */
const relevoNocturno = turno({
  id: 't2', hora_inicio: '19:00', hora_fin: '07:00', guardia_id: 'g-b',
})

const nombre = (id?: string | null) => (id === 'g-b' ? 'BENITEZ, LUIS' : 'Otro')

describe('el turno A termina 19:00 y el relevo B entra 19:00', () => {
  it('sin tocar nada, empalma', () => {
    const i = evaluarCambioDeFin(turno(), '19:00', [relevoNocturno])!
    expect(i.clase).toBe('empalme')
    expect(i.empeora).toBe(false)
    expect(mensajeImpacto(i, nombre)).toBeNull()
  })

  it('extender a 20:00 solapa una hora con B — el caso de la orden', () => {
    const i = evaluarCambioDeFin(turno(), '20:00', [relevoNocturno])!
    expect(i.clase).toBe('solapamiento')
    expect(i.minutos).toBe(60)
    expect(i.empeora).toBe(true)
    expect(i.relevo?.id).toBe('t2')
    expect(mensajeImpacto(i, nombre)).toContain('se superpone 1 h con el turno de BENITEZ, LUIS 19:00–07:00')
  })

  it('recortar a 18:00 deja un hueco de 60 minutos', () => {
    const i = evaluarCambioDeFin(turno(), '18:00', [relevoNocturno])!
    expect(i.clase).toBe('hueco')
    expect(i.minutos).toBe(60)
    expect(i.empeora).toBe(true)
    expect(mensajeImpacto(i, nombre)).toContain('hueco de cobertura de 1 h')
  })

  it('el aviso nombra el hueco aunque el relevo no tenga vigilador asignado', () => {
    const sinGuardia = { ...relevoNocturno, guardia_id: null }
    const i = evaluarCambioDeFin(turno(), '18:00', [sinGuardia])!
    expect(mensajeImpacto(i, nombre)).toContain('un turno sin vigilador asignado')
  })
})

describe('turnos nocturnos', () => {
  it('19:00-07:00 extendido a 08:00 solapa con el diurno que entra 07:00', () => {
    const nocturno = turno({ hora_inicio: '19:00', hora_fin: '07:00' })
    // El relevo entra al día siguiente a las 07:00.
    const diurno = turno({ id: 't3', fecha: '2026-09-01', hora_inicio: '07:00', hora_fin: '19:00', guardia_id: 'g-b' })
    const i = evaluarCambioDeFin(nocturno, '08:00', [diurno])!
    expect(i.clase).toBe('solapamiento')
    expect(i.minutos).toBe(60)
  })

  it('el tramo de un nocturno cruza la medianoche y dura 12 h', () => {
    const t = tramoTurno({ fecha: '2026-08-31', hora_inicio: '19:00', hora_fin: '07:00' })!
    expect(t.fin - t.inicio).toBe(720)
  })

  it('un turno de 24 h no se colapsa a cero', () => {
    const t = tramoTurno({ fecha: '2026-08-31', hora_inicio: '07:00', hora_fin: '07:00' })!
    expect(t.fin - t.inicio).toBe(1440)
  })

  it('acepta el formato con segundos que viene de la base', () => {
    const t = tramoTurno({ fecha: '2026-08-31', hora_inicio: '07:00:00', hora_fin: '19:00:00' })!
    expect(t.fin - t.inicio).toBe(720)
  })
})

describe('a quién se considera relevo', () => {
  it('otro PUESTO del mismo objetivo no releva: son coberturas paralelas', () => {
    const otroPuesto = turno({ id: 't4', puesto_id: PUESTO_B, hora_inicio: '19:00', hora_fin: '07:00' })
    expect(buscarRelevo(turno(), [otroPuesto])).toBeNull()
    const i = evaluarCambioDeFin(turno(), '20:00', [otroPuesto])!
    expect(i.clase).toBe('sin_relevo')
    expect(i.empeora).toBe(false)
  })

  it('sin puesto asignado se compara por objetivo: mejor advertir de más', () => {
    const a = turno({ puesto_id: null })
    const b = turno({ id: 't5', puesto_id: null, hora_inicio: '19:00', hora_fin: '07:00' })
    expect(buscarRelevo(a, [b])?.id).toBe('t5')
  })

  it('otro objetivo nunca releva', () => {
    const ajeno = turno({ id: 't6', objetivo_id: 'obj-2', puesto_id: null, hora_inicio: '19:00', hora_fin: '07:00' })
    expect(buscarRelevo(turno({ puesto_id: null }), [ajeno])).toBeNull()
  })

  it('un turno ANULADO no cuenta como relevo: ya no cubre nada', () => {
    const anulado = { ...relevoNocturno, estado: 'anulado' }
    expect(buscarRelevo(turno(), [anulado])).toBeNull()
    const i = evaluarCambioDeFin(turno(), '20:00', [anulado])!
    expect(i.clase).toBe('sin_relevo')
  })

  it('con varios turnos posteriores toma el más próximo', () => {
    const tarde = turno({ id: 't7', hora_inicio: '23:00', hora_fin: '07:00' })
    expect(buscarRelevo(turno(), [tarde, relevoNocturno])?.id).toBe('t2')
  })

  it('un turno anterior no es relevo', () => {
    const anterior = turno({ id: 't8', hora_inicio: '00:00', hora_fin: '07:00' })
    expect(buscarRelevo(turno(), [anterior])).toBeNull()
  })

  it('el propio turno nunca se releva a sí mismo', () => {
    expect(buscarRelevo(turno(), [turno()])).toBeNull()
  })
})

describe('lo que YA estaba mal no se le carga a quien corrige', () => {
  it('un hueco preexistente que se achica no cuenta como empeorar', () => {
    // A termina 17:00 y B entra 19:00: ya había 2 h de hueco.
    const a = turno({ hora_fin: '17:00' })
    const i = evaluarCambioDeFin(a, '18:00', [relevoNocturno])!
    expect(i.previo).toEqual({ clase: 'hueco', minutos: 120 })
    expect(i.clase).toBe('hueco')
    expect(i.minutos).toBe(60)
    expect(i.empeora).toBe(false)
  })

  it('pero agrandarlo sí', () => {
    const a = turno({ hora_fin: '17:00' })
    const i = evaluarCambioDeFin(a, '16:00', [relevoNocturno])!
    expect(i.minutos).toBe(180)
    expect(i.empeora).toBe(true)
  })

  it('cerrar el hueco del todo no avisa nada', () => {
    const a = turno({ hora_fin: '17:00' })
    const i = evaluarCambioDeFin(a, '19:00', [relevoNocturno])!
    expect(i.clase).toBe('empalme')
    expect(i.empeora).toBe(false)
    expect(mensajeImpacto(i, nombre)).toBeNull()
  })

  it('pasar de hueco a solapamiento empeora aunque sean menos minutos', () => {
    // 2 h de hueco -> 30 min de solapamiento. Son dos defectos distintos.
    const a = turno({ hora_fin: '17:00' })
    const i = evaluarCambioDeFin(a, '19:30', [relevoNocturno])!
    expect(i.previo.minutos).toBe(120)
    expect(i.clase).toBe('solapamiento')
    expect(i.minutos).toBe(30)
    expect(i.empeora).toBe(true)
  })
})

describe('sin relevo programado', () => {
  it('extender no superpone a nadie', () => {
    const i = evaluarCambioDeFin(turno(), '22:00', [])!
    expect(i.clase).toBe('sin_relevo')
    expect(mensajeImpacto(i, nombre)).toBeNull()
  })
})

describe('datos que no se pueden leer', () => {
  it('una fecha rota no rompe la pantalla', () => {
    expect(tramoTurno({ fecha: 'x', hora_inicio: '07:00', hora_fin: '19:00' })).toBeNull()
    expect(evaluarCambioDeFin(turno({ fecha: 'x' }), '20:00', [relevoNocturno])).toBeNull()
  })

  it('una hora rota tampoco', () => {
    expect(evaluarCambioDeFin(turno(), 'xx:yy', [relevoNocturno])).toBeNull()
  })

  it('un relevo con horario ilegible se descarta en vez de mentir', () => {
    const roto = { ...relevoNocturno, hora_inicio: '' }
    expect(buscarRelevo(turno(), [roto])).toBeNull()
  })
})

describe('duracionLegible', () => {
  it('minutos sueltos', () => expect(duracionLegible(45)).toBe('45 min'))
  it('horas exactas', () => expect(duracionLegible(120)).toBe('2 h'))
  it('horas y minutos', () => expect(duracionLegible(75)).toBe('1 h 15 min'))
})
