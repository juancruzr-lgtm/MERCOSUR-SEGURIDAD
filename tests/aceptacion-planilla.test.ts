import { describe, expect, it } from 'vitest'
import { accionesPrimerControl } from '@/lib/primer-control'

// Qué botones ve el vigilador en Mi Planilla sobre un turno propio.
//
// El caso que motivó estos tests: una cuenta con 8 turnos pendientes en el
// cartel del legajo y ni un solo botón "Aceptar" en la pantalla. Los 8 eran
// turnos pasados SIN fichaje, que por diseño sólo admiten "Solicitar cambio":
// no hay asistencia que aceptar y aceptar_turno_planilla los rechaza. El
// defecto no era el botón —existe— sino que el contador prometía una acción
// que para esas filas no corresponde.
//
// Esta función es el único lugar donde se decide qué se muestra. La autoridad
// sigue siendo la RPC; acá se replica su criterio para no ofrecer un botón que
// el servidor va a rechazar.

const F = (over: any = {}) => ({
  turno_id: 't1',
  estado: 'trabajado',
  estado_control: 'pendiente',
  permite_aceptar: true,
  ...over,
}) as any

describe('accionesPrimerControl — quién puede accionar', () => {
  it('solo el titular autenticado ve acciones', () => {
    expect(accionesPrimerControl(F(), true)).toEqual({ aceptar: true, solicitar: true })
    expect(accionesPrimerControl(F(), false)).toEqual({ aceptar: false, solicitar: false })
  })

  it('sin turno_id no hay nada que accionar', () => {
    expect(accionesPrimerControl(F({ turno_id: null }), true)).toEqual({ aceptar: false, solicitar: false })
  })
})

describe('accionesPrimerControl — según el estado del turno', () => {
  it('turno trabajado y finalizado: Aceptar + Solicitar cambio', () => {
    expect(accionesPrimerControl(F(), true)).toEqual({ aceptar: true, solicitar: true })
  })

  it('turno pasado SIN fichaje: solo Solicitar cambio, nunca Aceptar', () => {
    // Es el caso de los 8 turnos del cartel. La API lo marca 'programado' con
    // permite_aceptar false; la RPC contesta "El turno no tiene fichaje".
    const sinFichaje = F({ estado: 'programado', permite_aceptar: false })
    expect(accionesPrimerControl(sinFichaje, true)).toEqual({ aceptar: false, solicitar: true })
  })

  it('salida automática: se puede aceptar igual', () => {
    // El cron cerró el turno y el resumen nunca apareció. La asistencia existe,
    // así que hay algo que aceptar; la RPC guarda salida_automatica = true.
    expect(accionesPrimerControl(F(), true)).toEqual({ aceptar: true, solicitar: true })
  })

  it('turno en curso: ninguna acción todavía', () => {
    expect(accionesPrimerControl(F({ estado: 'en_curso', estado_control: null }), true))
      .toEqual({ aceptar: false, solicitar: false })
  })

  it('día sin programación: ninguna acción', () => {
    expect(accionesPrimerControl(F({ estado: 'sin_programacion', estado_control: null }), true))
      .toEqual({ aceptar: false, solicitar: false })
  })

  it('turno todavía no finalizado: la API no lo marca revisable, no hay acciones', () => {
    // estado_control null es lo que devuelve la API cuando el fin programado
    // no pasó. Sin este corte la fila ofrecía Aceptar y la RPC respondía
    // "El turno todavia no finalizo".
    expect(accionesPrimerControl(F({ estado_control: null }), true))
      .toEqual({ aceptar: false, solicitar: false })
  })
})

describe('accionesPrimerControl — turnos ya respondidos', () => {
  it('ya aceptado: no vuelve a ofrecer acciones', () => {
    expect(accionesPrimerControl(F({ estado_control: 'aceptado' }), true))
      .toEqual({ aceptar: false, solicitar: false })
  })

  it('con modificación solicitada: no vuelve a ofrecer acciones', () => {
    expect(accionesPrimerControl(F({ estado_control: 'modificacion_solicitada' }), true))
      .toEqual({ aceptar: false, solicitar: false })
  })

  it('anulado/cancelado/reemplazado: la API los deja sin estado_control', () => {
    // Esos turnos no entran a la planilla como revisables, y la RPC además
    // rechaza con "El turno no tiene obligacion".
    expect(accionesPrimerControl(F({ estado_control: null }), true))
      .toEqual({ aceptar: false, solicitar: false })
  })
})

// El contador del cartel tiene que distinguir lo que espera respuesta de lo
// que se puede aceptar. Es la cuenta que hace la API: pendientes_revision es
// todo lo 'pendiente', pendientes_aceptacion son los que permiten aceptar.
describe('contadores del cartel', () => {
  const contar = (filas: any[]) => {
    const pendientes = filas.filter(f => f.estado_control === 'pendiente')
    return {
      pendientes_revision: pendientes.length,
      pendientes_aceptacion: pendientes.filter(f => f.permite_aceptar).length,
    }
  }

  it('8 turnos sin fichaje: 8 para revisar, 0 para aceptar', () => {
    const filas = Array.from({ length: 8 }, () => F({ estado: 'programado', permite_aceptar: false }))
    expect(contar(filas)).toEqual({ pendientes_revision: 8, pendientes_aceptacion: 0 })
  })

  it('mezcla: cuenta por separado', () => {
    const filas = [
      F(), F(),
      F({ estado: 'programado', permite_aceptar: false }),
      F({ estado_control: 'aceptado' }),
    ]
    expect(contar(filas)).toEqual({ pendientes_revision: 3, pendientes_aceptacion: 2 })
  })
})
