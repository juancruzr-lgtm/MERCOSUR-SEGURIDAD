import { describe, expect, it } from 'vitest'
import {
  ESTADOS_REVISION, ETIQUETA_ESTADO_REVISION,
  cubreElTurno, esPendienteDeAccion, estadoRevision, etiquetaResumenMes,
  filtrarFilasBandeja, nombreMes, objetivoEnAlcance, requiereRevision,
  opcionesObjetivo, opcionesPuesto, opcionesVigilador,
  resumenBandejaMensual,
} from '@/lib/bandeja-planillas'
import type { FilaBandejaMensual } from '@/lib/bandeja-planillas'

// Bandeja mensual de revisión de planillas. La escritura (marcar revisado,
// observación, derivar) sigue viviendo en la RPC revisar_primer_control y no es
// ejecutable acá sin base de datos: esto cubre la clasificación, el filtrado y
// el resumen del mes.

const fila = (over: Partial<FilaBandejaMensual> = {}): FilaBandejaMensual => ({
  turnoId: 't1', empleadoId: 'e1', vigilador: 'ROMERO, FACUNDO',
  fecha: '2026-08-10',
  objetivoId: 'o1', objetivo: 'CLUB',
  puestoId: 'p1', puesto: 'Principal',
  horario: '07:00–19:00',
  horaInicioProg: '07:00', horaFinProg: '19:00',
  entrada: '07:00', salida: '19:00', horas: 12,
  caracteristica: 'Normal',
  salidaAutomatica: false, tieneFichaje: true,
  estadoControl: 'pendiente',
  solicitudId: null, solicitudTexto: null, solicitudEstado: null,
  revisado: false, derivado: false, observaciones: 0,
  ...over,
})

describe('estadoRevision — un estado por fila', () => {
  it('sin respuesta del vigilador: pendiente', () => {
    expect(estadoRevision(fila())).toBe('pendiente')
  })

  it('el vigilador aceptó', () => {
    expect(estadoRevision(fila({ estadoControl: 'aceptado' }))).toBe('aceptado')
  })

  it('el vigilador pidió modificación', () => {
    expect(estadoRevision(fila({ estadoControl: 'modificacion_solicitada' }))).toBe('modificacion_solicitada')
  })

  it('el supervisor marcó revisado', () => {
    expect(estadoRevision(fila({ revisado: true }))).toBe('revisado_supervisor')
  })

  it('la solicitud quedó revisada por el supervisor', () => {
    expect(estadoRevision(fila({ solicitudEstado: 'revisada' }))).toBe('revisado_supervisor')
  })

  it('derivado a administración', () => {
    expect(estadoRevision(fila({ derivado: true }))).toBe('pendiente_regularizacion')
  })

  it('la solicitud requiere regularización', () => {
    expect(estadoRevision(fila({ solicitudEstado: 'requiere_regularizacion' }))).toBe('pendiente_regularizacion')
  })

  it('resuelto por administración', () => {
    expect(estadoRevision(fila({ solicitudEstado: 'resuelta' }))).toBe('resuelto')
  })

  it('hay una etiqueta por estado', () => {
    for (const e of ESTADOS_REVISION) expect(ETIQUETA_ESTADO_REVISION[e]).toBeTruthy()
  })
})

describe('estadoRevision — precedencia: gana lo más avanzado del ciclo', () => {
  it('revisado pesa más que la solicitud del vigilador', () => {
    expect(estadoRevision(fila({ estadoControl: 'modificacion_solicitada', revisado: true })))
      .toBe('revisado_supervisor')
  })

  it('derivado pesa más que revisado', () => {
    expect(estadoRevision(fila({ revisado: true, derivado: true }))).toBe('pendiente_regularizacion')
  })

  it('resuelto pesa más que todo lo anterior', () => {
    expect(estadoRevision(fila({
      estadoControl: 'modificacion_solicitada', revisado: true, derivado: true, solicitudEstado: 'resuelta',
    }))).toBe('resuelto')
  })

  it('una fila revisada no vuelve a la bandeja como pendiente', () => {
    expect(esPendienteDeAccion(estadoRevision(fila({ estadoControl: 'pendiente', revisado: true })))).toBe(false)
  })
})

describe('esPendienteDeAccion', () => {
  it('esperan acción: pendiente, modificación solicitada, regularización', () => {
    expect(esPendienteDeAccion('pendiente')).toBe(true)
    expect(esPendienteDeAccion('modificacion_solicitada')).toBe(true)
    expect(esPendienteDeAccion('pendiente_regularizacion')).toBe(true)
  })

  it('no esperan acción: aceptado, revisado, resuelto', () => {
    expect(esPendienteDeAccion('aceptado')).toBe(false)
    expect(esPendienteDeAccion('revisado_supervisor')).toBe(false)
    expect(esPendienteDeAccion('resuelto')).toBe(false)
  })
})

// El turno es el que manda: trabajar de más no lo agranda, así que entrar antes
// o salir después NO requiere que el supervisor mire nada. Lo que sí requiere
// decisión es entrar tarde o irse antes.
describe('cubreElTurno — turno de 07:00 a 19:00', () => {
  const con = (entrada: string | null, salida: string | null) =>
    cubreElTurno(fila({ entrada, salida }))

  it('ficha justo', () => expect(con('07:00', '19:00')).toBe(true))
  it('entra antes y sale después', () => expect(con('06:30', '19:30')).toBe(true))
  it('se queda 3 horas de más', () => expect(con('07:00', '22:00')).toBe(true))
  it('entra 30 minutos tarde', () => expect(con('07:30', '19:00')).toBe(false))
  it('entra tarde y sale tarde: igual no cubre', () => expect(con('07:30', '19:30')).toBe(false))
  it('se va una hora antes', () => expect(con('07:00', '18:00')).toBe(false))
  it('sin fichaje no cubre', () => expect(con(null, null)).toBe(false))

  it('unos minutos de margen no cuentan como tardanza', () => {
    expect(con('07:04', '18:56')).toBe(true)
  })
})

describe('cubreElTurno — turno nocturno 22:00 a 06:00', () => {
  const nocturno = (entrada: string, salida: string) =>
    cubreElTurno(fila({ horaInicioProg: '22:00', horaFinProg: '06:00', entrada, salida }))

  it('ficha justo cruzando medianoche', () => expect(nocturno('22:00', '06:00')).toBe(true))
  it('entra antes y sale después', () => expect(nocturno('21:45', '06:20')).toBe(true))
  it('entra tarde', () => expect(nocturno('22:40', '06:00')).toBe(false))
  it('se va antes de terminar', () => expect(nocturno('22:00', '05:00')).toBe(false))
})

describe('requiereRevision — la conformidad del vigilador no siempre alcanza', () => {
  it('aceptado y cubriendo el turno: no se revisa', () => {
    expect(requiereRevision(fila({ estadoControl: 'aceptado' }))).toBe(false)
  })

  it('aceptado habiéndose quedado de más: tampoco se revisa', () => {
    expect(requiereRevision(fila({ estadoControl: 'aceptado', entrada: '06:30', salida: '22:00' }))).toBe(false)
  })

  it('aceptado pero entró tarde: sí se revisa', () => {
    expect(requiereRevision(fila({ estadoControl: 'aceptado', entrada: '07:30' }))).toBe(true)
  })

  it('el caso que se escapaba: entra tarde y sale tarde, mismas horas', () => {
    // 12 h reales = 12 h programadas, así que hoy cobraba completo y nadie lo miraba.
    expect(requiereRevision(fila({ estadoControl: 'aceptado', entrada: '07:30', salida: '19:30' }))).toBe(true)
  })

  it('aceptado pero se fue antes: sí se revisa', () => {
    expect(requiereRevision(fila({ estadoControl: 'aceptado', salida: '18:00' }))).toBe(true)
  })

  it('los estados abiertos siempre se revisan, cubran o no', () => {
    expect(requiereRevision(fila())).toBe(true)
    expect(requiereRevision(fila({ estadoControl: 'modificacion_solicitada' }))).toBe(true)
    expect(requiereRevision(fila({ derivado: true }))).toBe(true)
  })

  it('ya revisado o resuelto no vuelve, aunque el fichaje no cubra', () => {
    expect(requiereRevision(fila({ revisado: true, entrada: '07:30' }))).toBe(false)
    expect(requiereRevision(fila({ solicitudEstado: 'resuelta', entrada: '07:30' }))).toBe(false)
  })
})

describe('filtrarFilasBandeja', () => {
  const filas = [
    fila({ turnoId: 'a', empleadoId: 'e1', objetivoId: 'o1', puestoId: 'p1' }),
    fila({ turnoId: 'b', empleadoId: 'e2', objetivoId: 'o2', puestoId: 'p2', estadoControl: 'aceptado' }),
    fila({ turnoId: 'c', empleadoId: 'e1', objetivoId: 'o2', puestoId: 'p2', tieneFichaje: false }),
    fila({ turnoId: 'd', empleadoId: 'e3', objetivoId: 'o1', puestoId: 'p1', salidaAutomatica: true }),
    fila({ turnoId: 'e', empleadoId: 'e1', objetivoId: 'o1', puestoId: 'p1', revisado: true }),
  ]
  const ids = (f: Parameters<typeof filtrarFilasBandeja>[1]) =>
    filtrarFilasBandeja(filas, f).map(x => x.turnoId)

  it('sin filtros: todas', () => {
    expect(ids({})).toHaveLength(5)
  })

  it('por vigilador', () => {
    expect(ids({ empleadoId: 'e1' })).toEqual(['a', 'c', 'e'])
  })

  it('por objetivo', () => {
    expect(ids({ objetivoId: 'o2' })).toEqual(['b', 'c'])
  })

  it('por posición operativa', () => {
    expect(ids({ puestoId: 'p2' })).toEqual(['b', 'c'])
  })

  it('por estado', () => {
    expect(ids({ estado: 'aceptado' })).toEqual(['b'])
    expect(ids({ estado: 'revisado_supervisor' })).toEqual(['e'])
  })

  it('estado "todos" no filtra', () => {
    expect(ids({ estado: 'todos' })).toHaveLength(5)
  })

  it('con y sin fichaje', () => {
    expect(ids({ conFichaje: 'no' })).toEqual(['c'])
    expect(ids({ conFichaje: 'si' })).toEqual(['a', 'b', 'd', 'e'])
  })

  it('salida automática', () => {
    expect(ids({ salidaAutomatica: 'si' })).toEqual(['d'])
  })

  it('solo pendientes deja fuera aceptados y revisados', () => {
    expect(ids({ soloPendientes: true })).toEqual(['a', 'c', 'd'])
  })

  it('los filtros se combinan', () => {
    expect(ids({ empleadoId: 'e1', objetivoId: 'o1', soloPendientes: true })).toEqual(['a'])
  })
})

describe('resumenBandejaMensual', () => {
  it('cuenta el total y los pendientes', () => {
    const r = resumenBandejaMensual([
      fila(), fila({ estadoControl: 'aceptado' }), fila({ estadoControl: 'modificacion_solicitada' }),
      fila({ revisado: true }), fila({ derivado: true }),
    ])
    expect(r.total).toBe(5)
    expect(r.pendientes).toBe(3) // pendiente + modificacion_solicitada + regularizacion
    expect(r.porEstado.aceptado).toBe(1)
    expect(r.porEstado.revisado_supervisor).toBe(1)
  })

  it('un mes sin nada pendiente queda cerrado', () => {
    const r = resumenBandejaMensual([fila({ estadoControl: 'aceptado' }), fila({ revisado: true })])
    expect(r.pendientes).toBe(0)
    expect(r.cerrado).toBe(true)
  })

  it('un mes sin registros NO se considera cerrado', () => {
    const r = resumenBandejaMensual([])
    expect(r.total).toBe(0)
    expect(r.cerrado).toBe(false)
  })

  it('todos los estados arrancan en cero', () => {
    const r = resumenBandejaMensual([])
    for (const e of ESTADOS_REVISION) expect(r.porEstado[e]).toBe(0)
  })
})

describe('etiquetaResumenMes', () => {
  it('formato pedido: mes, pendientes y total', () => {
    const r = resumenBandejaMensual([
      ...Array.from({ length: 12 }, (_, i) => fila({ turnoId: `p${i}` })),
      ...Array.from({ length: 328 }, (_, i) => fila({ turnoId: `a${i}`, estadoControl: 'aceptado' })),
    ])
    expect(etiquetaResumenMes('2026-08', r)).toBe('Agosto 2026 — 12 pendientes de 340 registros')
  })

  it('mes al día', () => {
    expect(etiquetaResumenMes('2026-08', resumenBandejaMensual([fila({ revisado: true })])))
      .toBe('Agosto 2026 — al día · 1 registro')
  })

  it('mes sin registros', () => {
    expect(etiquetaResumenMes('2026-07', resumenBandejaMensual([])))
      .toBe('Julio 2026 — sin registros para revisar')
  })

  it('singular en un solo pendiente', () => {
    expect(etiquetaResumenMes('2026-08', resumenBandejaMensual([fila()])))
      .toBe('Agosto 2026 — 1 pendiente de 1 registro')
  })

  it('nombreMes traduce el mes', () => {
    expect(nombreMes('2026-01')).toBe('Enero 2026')
    expect(nombreMes('2026-12')).toBe('Diciembre 2026')
  })
})

describe('opciones de los desplegables', () => {
  const filas = [
    fila({ empleadoId: 'e2', vigilador: 'ZAPATA, ANA', objetivoId: 'o2', objetivo: 'CIRSE', puestoId: 'p2', puesto: 'Vigilador 2' }),
    fila({ empleadoId: 'e1', vigilador: 'ALVAREZ, BETO', objetivoId: 'o1', objetivo: 'ACA', puestoId: 'p1', puesto: 'Principal' }),
    fila({ empleadoId: 'e1', vigilador: 'ALVAREZ, BETO', objetivoId: 'o1', objetivo: 'ACA', puestoId: 'p1', puesto: 'Principal' }),
  ]

  it('vigiladores sin repetir y ordenados', () => {
    expect(opcionesVigilador(filas).map(o => o.nombre)).toEqual(['ALVAREZ, BETO', 'ZAPATA, ANA'])
  })

  it('objetivos sin repetir', () => {
    expect(opcionesObjetivo(filas).map(o => o.nombre)).toEqual(['ACA', 'CIRSE'])
  })

  it('posiciones sin repetir', () => {
    expect(opcionesPuesto(filas).map(o => o.nombre)).toEqual(['Principal', 'Vigilador 2'])
  })

  it('una posición nula no genera opción', () => {
    expect(opcionesPuesto([fila({ puestoId: null })])).toEqual([])
  })
})

describe('objetivoEnAlcance', () => {
  it('administración ve todo, tenga o no zona el objetivo', () => {
    expect(objetivoEnAlcance('z1', true, new Set(['z9']))).toBe(true)
    expect(objetivoEnAlcance(null, true, null)).toBe(true)
  })

  it('supervisor con zonas: solo las suyas', () => {
    expect(objetivoEnAlcance('z1', false, new Set(['z1', 'z2']))).toBe(true)
    expect(objetivoEnAlcance('z3', false, new Set(['z1', 'z2']))).toBe(false)
  })

  it('supervisor con zonas: un objetivo sin zona queda fuera', () => {
    expect(objetivoEnAlcance(null, false, new Set(['z1']))).toBe(false)
  })

  it('supervisor sin zonas asignadas: alcance total (regla existente)', () => {
    expect(objetivoEnAlcance('z5', false, new Set())).toBe(true)
    expect(objetivoEnAlcance('z5', false, null)).toBe(true)
  })
})
