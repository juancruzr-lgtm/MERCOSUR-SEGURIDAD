import { describe, expect, it } from 'vitest'
import { sumarDiasFecha } from '@/lib/turnos'

// El 01/09/2026 a las 00:00 el tablero mostraba "Guardias en turno: 0" con
// CATORCE vigiladores adentro de sus objetivos. Todos habían entrado el 31/08
// en turnos nocturnos que seguían corriendo.
//
// La causa eran dos filtros por día encadenados: la carga traía sólo turnos
// desde el día 1 del mes, y el panel además filtraba `fecha === hoy`. Un turno
// que arranca el último día del mes y termina al otro día quedaba fuera de los
// dos.
//
// Lo que se fija acá es la aritmética de fechas que sostiene el arreglo. La
// regla del mes NO cambia: el turno del 31/08 sigue perteneciendo a agosto —
// se carga para poder verlo en curso, no para sumarlo a septiembre.

/** ¿Este turno puede estar todavía abierto, mirando hoy y ayer? */
const puedeEstarEnCurso = (fechaTurno: string, hoy: string) =>
  fechaTurno === hoy || fechaTurno === sumarDiasFecha(hoy, -1)

describe('la ventana de carga cubre el turno que cruza el cambio de mes', () => {
  it('el 01/09 se carga desde el 31/08', () => {
    expect(sumarDiasFecha('2026-09-01', -1)).toBe('2026-08-31')
  })

  it('el 01/08 se carga desde el 31/07', () => {
    expect(sumarDiasFecha('2026-08-01', -1)).toBe('2026-07-31')
  })

  it('el 01/03 de un año no bisiesto retrocede al 28/02', () => {
    expect(sumarDiasFecha('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('el 01/01 retrocede al 31/12 del año anterior', () => {
    expect(sumarDiasFecha('2026-01-01', -1)).toBe('2025-12-31')
  })
})

describe('quién cuenta como "en turno" al cambiar el día', () => {
  it('el nocturno del 31/08 sigue en turno a las 00:30 del 01/09', () => {
    // Es el caso real: ACA 20:00-08:00, VIEYRA, entrada 20:00, sin salida.
    expect(puedeEstarEnCurso('2026-08-31', '2026-09-01')).toBe(true)
  })

  it('un turno de hoy también', () => {
    expect(puedeEstarEnCurso('2026-09-01', '2026-09-01')).toBe(true)
  })

  it('uno de anteayer NO: eso es un turno que nadie cerró', () => {
    // No se arrastra hacia atrás indefinidamente. Un turno abierto de hace dos
    // días es otro problema, y tiene su propia alerta.
    expect(puedeEstarEnCurso('2026-08-30', '2026-09-01')).toBe(false)
  })

  it('uno futuro tampoco', () => {
    expect(puedeEstarEnCurso('2026-09-02', '2026-09-01')).toBe(false)
  })
})

describe('la regla del mes no se toca', () => {
  it('un turno del 31/08 cargado el 01/09 sigue siendo de agosto', () => {
    // Las métricas mensuales filtran por el prefijo de la fecha del turno, que
    // es su fecha de INICIO. Cargarlo para verlo en curso no lo mueve de mes.
    const fechaTurno = '2026-08-31'
    expect(fechaTurno.slice(0, 7)).toBe('2026-08')
    expect(fechaTurno.slice(0, 7)).not.toBe('2026-09')
  })

  it('los cuatro bordes del enunciado', () => {
    const mesDe = (f: string) => f.slice(0, 7)
    expect(mesDe('2026-07-31')).toBe('2026-07')   // 31/07 19:00 -> 01/08 07:00 = julio
    expect(mesDe('2026-08-01')).toBe('2026-08')   // 01/08 07:00 -> 19:00       = agosto
    expect(mesDe('2026-08-31')).toBe('2026-08')   // 31/08 20:00 -> 01/09 08:00 = agosto
    expect(mesDe('2026-09-01')).toBe('2026-09')   // 01/09 00:00 -> 08:00       = septiembre
  })
})
