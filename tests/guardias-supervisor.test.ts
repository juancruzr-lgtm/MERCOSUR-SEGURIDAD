import { describe, expect, it } from 'vitest'
import {
  MAX_DIAS_RANGO,
  MENSAJE_FECHAS_INCOMPLETAS,
  MENSAJE_RANGO_INVERTIDO,
  MENSAJE_RANGO_LARGO,
  MENSAJE_SIN_DIAS,
  MENSAJE_SIN_HORARIO,
  MENSAJE_SIN_REGLAS,
  MENSAJE_SIN_SUPERVISOR,
  MENSAJE_SIN_ZONA,
  MOTIVO_FUERA_DE_VIGENCIA,
  MOTIVO_REGLA_INACTIVA,
  MOTIVO_REGLA_INCOMPLETA,
  MOTIVO_TODO_EXISTE,
  claveGuardia,
  diaSemanaIso,
  diasDelRango,
  esNocturno,
  etiquetaDias,
  fechasEnRango,
  guardiaCubre,
  previsualizarDesdeReglas,
  previsualizarGeneracion,
  rangoDelMes,
  resumenGeneracion,
  resumenMes,
} from '@/lib/guardias-supervisor'
import type { GuardiaExistente, ParametrosGeneracion, ReglaSemanal } from '@/lib/guardias-supervisor'

// Generación por rango de guardias de supervisor.
// Todo lo de acá es puro: expansión de fechas, deduplicación contra lo que ya
// está cargado, nocturnos y validaciones. No toca la base.

const base: ParametrosGeneracion = {
  supervisor_id: 'sup-sergio',
  zona: 'Rosario',
  desde: '2026-08-01',
  hasta: '2026-08-31',
  dias_semana: [1, 2, 3, 4, 5, 6],
  hora_inicio: '07:00',
  hora_fin: '19:00',
  rol_operativo: 'supervisor',
  estado: 'activo',
  observacion: '',
}

const existente = (over: Partial<GuardiaExistente> = {}): GuardiaExistente => ({
  supervisor_id: 'sup-sergio',
  zona: 'Rosario',
  fecha: '2026-08-03',
  hora_inicio: '07:00:00',
  hora_fin: '19:00:00',
  ...over,
})

describe('diaSemanaIso', () => {
  it('devuelve 1 para lunes y 7 para domingo', () => {
    expect(diaSemanaIso('2026-08-03')).toBe(1) // lunes
    expect(diaSemanaIso('2026-08-08')).toBe(6) // sábado
    expect(diaSemanaIso('2026-08-09')).toBe(7) // domingo
  })
})

describe('fechasEnRango', () => {
  it('toma sólo los días de semana elegidos, extremos incluidos', () => {
    const fechas = fechasEnRango('2026-08-01', '2026-08-09', [6, 7])
    expect(fechas).toEqual(['2026-08-01', '2026-08-02', '2026-08-08', '2026-08-09'])
  })

  it('cruza el fin de mes sin saltarse días', () => {
    const fechas = fechasEnRango('2026-08-28', '2026-09-02', [1, 2, 3, 4, 5])
    expect(fechas).toEqual(['2026-08-28', '2026-08-31', '2026-09-01', '2026-09-02'])
  })

  it('incluye el 29 de febrero de un año bisiesto', () => {
    expect(fechasEnRango('2028-02-28', '2028-03-01', [1, 2, 3, 4, 5, 6, 7]))
      .toEqual(['2028-02-28', '2028-02-29', '2028-03-01'])
  })

  it('un solo día devuelve ese día si coincide, y nada si no', () => {
    expect(fechasEnRango('2026-08-05', '2026-08-05', [3])).toEqual(['2026-08-05'])
    expect(fechasEnRango('2026-08-05', '2026-08-05', [1])).toEqual([])
  })

  it('devuelve vacío con rango invertido, sin días o fecha mal formada', () => {
    expect(fechasEnRango('2026-08-10', '2026-08-01', [1])).toEqual([])
    expect(fechasEnRango('2026-08-01', '2026-08-10', [])).toEqual([])
    expect(fechasEnRango('2026-8-1', '2026-08-10', [1])).toEqual([])
  })
})

describe('diasDelRango', () => {
  it('cuenta ambos extremos', () => {
    expect(diasDelRango('2026-08-01', '2026-08-01')).toBe(1)
    expect(diasDelRango('2026-08-01', '2026-08-31')).toBe(31)
  })
})

describe('esNocturno', () => {
  it('detecta el cruce de medianoche', () => {
    expect(esNocturno('19:00', '07:00')).toBe(true)
    expect(esNocturno('18:00', '06:00')).toBe(true)
    expect(esNocturno('07:00', '19:00')).toBe(false)
  })

  it('un horario de 24 horas cerradas cuenta como nocturno', () => {
    expect(esNocturno('07:00', '07:00')).toBe(true)
  })
})

describe('claveGuardia', () => {
  it('normaliza la zona: rafaela y Rafaela son la misma fila', () => {
    const a = claveGuardia({ supervisor_id: 's1', zona: 'rafaela', fecha: '2026-08-01', hora_inicio: '07:00', hora_fin: '19:00' })
    const b = claveGuardia({ supervisor_id: 's1', zona: ' Rafaela ', fecha: '2026-08-01', hora_inicio: '07:00:00', hora_fin: '19:00:00' })
    expect(a).toBe(b)
  })

  it('distingue supervisor, fecha y horario', () => {
    const ref = claveGuardia(existente())
    expect(claveGuardia(existente({ supervisor_id: 'otro' }))).not.toBe(ref)
    expect(claveGuardia(existente({ fecha: '2026-08-04' }))).not.toBe(ref)
    expect(claveGuardia(existente({ hora_inicio: '08:00' }))).not.toBe(ref)
  })
})

describe('previsualizarGeneracion', () => {
  it('genera una fila por fecha con los datos del formulario', () => {
    const prevision = previsualizarGeneracion({ ...base, desde: '2026-08-03', hasta: '2026-08-08' })

    expect(prevision.errores).toEqual([])
    expect(prevision.aCrear).toHaveLength(6) // lunes a sábado
    expect(prevision.aCrear[0]).toEqual({
      supervisor_id: 'sup-sergio',
      fecha: '2026-08-03',
      hora_inicio: '07:00',
      hora_fin: '19:00',
      zona: 'Rosario',
      rol_operativo: 'supervisor',
      estado: 'activo',
      observacion: null,
    })
  })

  it('guarda la zona con el nombre canónico, no normalizado', () => {
    const prevision = previsualizarGeneracion({ ...base, zona: 'Rafaela', desde: '2026-08-03', hasta: '2026-08-03', dias_semana: [1] })
    expect(prevision.aCrear[0].zona).toBe('Rafaela')
  })

  it('omite las fechas que ya existen en la base', () => {
    const prevision = previsualizarGeneracion(
      { ...base, desde: '2026-08-03', hasta: '2026-08-05', dias_semana: [1, 2, 3] },
      [existente({ fecha: '2026-08-04' })],
    )

    expect(prevision.duplicadas).toEqual(['2026-08-04'])
    expect(prevision.aCrear.map(f => f.fecha)).toEqual(['2026-08-03', '2026-08-05'])
  })

  it('considera duplicada una fila existente cargada con otra grafía de zona', () => {
    const prevision = previsualizarGeneracion(
      { ...base, zona: 'Rafaela', desde: '2026-08-03', hasta: '2026-08-03', dias_semana: [1] },
      [existente({ zona: 'rafaela', fecha: '2026-08-03' })],
    )

    expect(prevision.duplicadas).toEqual(['2026-08-03'])
    expect(prevision.aCrear).toEqual([])
  })

  it('no considera duplicada una guardia del mismo día en otro horario', () => {
    const prevision = previsualizarGeneracion(
      { ...base, desde: '2026-08-03', hasta: '2026-08-03', dias_semana: [1] },
      [existente({ fecha: '2026-08-03', hora_inicio: '19:00:00', hora_fin: '07:00:00' })],
    )

    expect(prevision.duplicadas).toEqual([])
    expect(prevision.aCrear).toHaveLength(1)
  })

  it('el rol operativo no forma parte de la clave: misma franja distinto rol es duplicado', () => {
    const prevision = previsualizarGeneracion(
      { ...base, rol_operativo: 'jefe_operativo', desde: '2026-08-03', hasta: '2026-08-03', dias_semana: [1] },
      [existente({ fecha: '2026-08-03' })],
    )

    expect(prevision.aCrear).toEqual([])
    expect(prevision.duplicadas).toEqual(['2026-08-03'])
  })

  it('marca el nocturno y usa la fecha de inicio (viernes 19:00 a sábado 07:00)', () => {
    const prevision = previsualizarGeneracion({
      ...base,
      hora_inicio: '19:00',
      hora_fin: '07:00',
      desde: '2026-08-01',
      hasta: '2026-08-31',
      dias_semana: [5],
    })

    expect(prevision.nocturno).toBe(true)
    expect(prevision.aCrear.map(f => f.fecha)).toEqual(['2026-08-07', '2026-08-14', '2026-08-21', '2026-08-28'])
  })

  it('recorta la observación y la deja en null si queda vacía', () => {
    const conTexto = previsualizarGeneracion({ ...base, observacion: '  cobertura  ', desde: '2026-08-03', hasta: '2026-08-03', dias_semana: [1] })
    const sinTexto = previsualizarGeneracion({ ...base, observacion: '   ', desde: '2026-08-03', hasta: '2026-08-03', dias_semana: [1] })

    expect(conTexto.aCrear[0].observacion).toBe('cobertura')
    expect(sinTexto.aCrear[0].observacion).toBeNull()
  })

  it('devuelve error y nada para crear si falta supervisor, zona, días u horario', () => {
    const prevision = previsualizarGeneracion({
      ...base,
      supervisor_id: '',
      zona: '   ',
      dias_semana: [],
      hora_fin: '',
    })

    expect(prevision.aCrear).toEqual([])
    expect(prevision.errores).toContain(MENSAJE_SIN_SUPERVISOR)
    expect(prevision.errores).toContain(MENSAJE_SIN_ZONA)
    expect(prevision.errores).toContain(MENSAJE_SIN_DIAS)
    expect(prevision.errores).toContain(MENSAJE_SIN_HORARIO)
  })

  it('rechaza el rango invertido, el rango sin fechas y el rango de más de un año', () => {
    expect(previsualizarGeneracion({ ...base, desde: '2026-08-31', hasta: '2026-08-01' }).errores)
      .toContain(MENSAJE_RANGO_INVERTIDO)
    expect(previsualizarGeneracion({ ...base, desde: '', hasta: '' }).errores)
      .toContain(MENSAJE_FECHAS_INCOMPLETAS)
    expect(previsualizarGeneracion({ ...base, desde: '2026-01-01', hasta: '2027-06-01' }).errores)
      .toContain(MENSAJE_RANGO_LARGO)
  })

  it('un año entero al tope del rango genera una fila por día', () => {
    const prevision = previsualizarGeneracion({
      ...base,
      desde: '2026-01-01',
      hasta: '2026-12-31',
      dias_semana: [1, 2, 3, 4, 5, 6, 7],
    })

    expect(prevision.errores).toEqual([])
    expect(prevision.aCrear).toHaveLength(365)
    expect(diasDelRango('2026-01-01', '2026-12-31')).toBeLessThanOrEqual(MAX_DIAS_RANGO)
  })

  it('no muta los parámetros recibidos', () => {
    const params: ParametrosGeneracion = { ...base, dias_semana: [3, 1, 1, 2] }
    previsualizarGeneracion(params)
    expect(params.dias_semana).toEqual([3, 1, 1, 2])
  })

  it('ordena y deduplica los días de semana repetidos', () => {
    const prevision = previsualizarGeneracion({
      ...base,
      dias_semana: [3, 1, 1],
      desde: '2026-08-03',
      hasta: '2026-08-05',
    })

    expect(prevision.aCrear.map(f => f.fecha)).toEqual(['2026-08-03', '2026-08-05'])
  })
})

describe('resumenGeneracion', () => {
  it('cuenta lo que se crea y lo que se omite', () => {
    const prevision = previsualizarGeneracion(
      { ...base, desde: '2026-08-03', hasta: '2026-08-05', dias_semana: [1, 2, 3] },
      [existente({ fecha: '2026-08-04' })],
    )

    expect(resumenGeneracion(prevision)).toBe('Se van a crear 2 guardia(s) · 1 ya existen y se omiten.')
  })

  it('avisa que en el nocturno la fecha es la de inicio', () => {
    const prevision = previsualizarGeneracion({ ...base, hora_inicio: '19:00', hora_fin: '07:00', desde: '2026-08-07', hasta: '2026-08-07', dias_semana: [5] })
    expect(resumenGeneracion(prevision)).toContain('la fecha es la de inicio')
  })

  it('avisa cuando ningún día del rango coincide', () => {
    const prevision = previsualizarGeneracion({ ...base, desde: '2026-08-03', hasta: '2026-08-05', dias_semana: [7] })
    expect(resumenGeneracion(prevision)).toBe('Ningún día del rango coincide con los días elegidos.')
  })

  it('muestra los errores cuando la configuración no sirve', () => {
    const prevision = previsualizarGeneracion({ ...base, dias_semana: [] })
    expect(resumenGeneracion(prevision)).toContain(MENSAJE_SIN_DIAS)
  })
})

// ── Programación semanal ─────────────────────────────────────────────────────
// Las reglas de Rosario, tal como están en la operación real:
//   Sabino  · dom a jue 07-19 · vie 07-13 · vie 19-07 (nocturno)
//   Walter  · sáb a jue 19-07 (nocturno)
//   Sergio  · lun a sáb 07-19

const regla = (over: Partial<ReglaSemanal> = {}): ReglaSemanal => ({
  id: 'regla-1',
  supervisor_id: 'sup-sergio',
  zona_id: 'zona-rosario',
  zona_nombre: 'Rosario',
  dias_semana: [1, 2, 3, 4, 5, 6],
  hora_inicio: '07:00',
  hora_fin: '19:00',
  rol_operativo: 'supervisor',
  observacion: null,
  activo: true,
  vigencia_desde: null,
  vigencia_hasta: null,
  ...over,
})

const SABINO = [
  regla({ id: 'sabino-diurno', supervisor_id: 'sup-sabino', dias_semana: [7, 1, 2, 3, 4], hora_inicio: '07:00', hora_fin: '19:00' }),
  regla({ id: 'sabino-viernes', supervisor_id: 'sup-sabino', dias_semana: [5], hora_inicio: '07:00', hora_fin: '13:00' }),
  regla({ id: 'sabino-nocturno', supervisor_id: 'sup-sabino', dias_semana: [5], hora_inicio: '19:00', hora_fin: '07:00' }),
]

describe('previsualizarDesdeReglas', () => {
  it('genera septiembre completo desde una regla', () => {
    const prevision = previsualizarDesdeReglas([regla()], rangoDelMes('2026-09'))

    expect(prevision.errores).toEqual([])
    expect(prevision.desde).toBe('2026-09-01')
    expect(prevision.hasta).toBe('2026-09-30')
    // Septiembre 2026: 26 días de lunes a sábado.
    expect(prevision.aCrear).toHaveLength(26)
    expect(prevision.aCrear.every(f => f.regla_id === 'regla-1' && f.origen === 'regla' && f.tipo_evento === 'normal')).toBe(true)
  })

  it('las tres reglas de Sabino conviven, incluida la nocturna del viernes', () => {
    const prevision = previsualizarDesdeReglas(SABINO, { desde: '2026-09-04', hasta: '2026-09-04' }) // viernes

    expect(prevision.aCrear).toHaveLength(2)
    expect(prevision.aCrear.map(f => `${f.hora_inicio}-${f.hora_fin}`).sort())
      .toEqual(['07:00-13:00', '19:00-07:00'])
    // La nocturna se guarda con la fecha del viernes, no la del sábado.
    expect(prevision.aCrear.every(f => f.fecha === '2026-09-04')).toBe(true)
  })

  it('el mismo día, dos supervisores distintos generan dos filas', () => {
    const prevision = previsualizarDesdeReglas(
      [regla({ id: 'sergio', supervisor_id: 'sup-sergio' }), regla({ id: 'sabino', supervisor_id: 'sup-sabino', dias_semana: [1] })],
      { desde: '2026-09-07', hasta: '2026-09-07' }, // lunes
    )

    expect(prevision.aCrear).toHaveLength(2)
    expect(prevision.aCrear.map(f => f.supervisor_id).sort()).toEqual(['sup-sabino', 'sup-sergio'])
  })

  it('regenerar el mismo mes no crea nada', () => {
    const primera = previsualizarDesdeReglas([regla()], rangoDelMes('2026-09'))
    const yaEnBase = primera.aCrear.map(f => ({
      supervisor_id: f.supervisor_id, zona: f.zona, fecha: f.fecha,
      hora_inicio: f.hora_inicio, hora_fin: f.hora_fin, regla_id: f.regla_id,
    }))

    const segunda = previsualizarDesdeReglas([regla()], rangoDelMes('2026-09'), yaEnBase)

    expect(segunda.aCrear).toEqual([])
    expect(segunda.duplicadas).toBe(26)
    expect(segunda.porRegla[0].omitida).toBe(MOTIVO_TODO_EXISTE)
  })

  it('un día con el horario cambiado no se regenera: la clave es la regla, no el horario', () => {
    // El 10/09 se editó de 07:00-19:00 a 07:00-13:00. Sin regla_id volvería a
    // crearse la fila original y el día quedaría con las dos.
    const editada: GuardiaExistente = {
      supervisor_id: 'sup-sergio', zona: 'Rosario', fecha: '2026-09-10',
      hora_inicio: '07:00:00', hora_fin: '13:00:00', regla_id: 'regla-1',
    }

    const prevision = previsualizarDesdeReglas([regla()], rangoDelMes('2026-09'), [editada])

    expect(prevision.aCrear.some(f => f.fecha === '2026-09-10')).toBe(false)
    expect(prevision.porRegla[0].duplicadas).toContain('2026-09-10')
  })

  it('una guardia cargada a mano bloquea la fila equivalente de la regla', () => {
    const manual: GuardiaExistente = {
      supervisor_id: 'sup-sergio', zona: 'rosario', fecha: '2026-09-01',
      hora_inicio: '07:00:00', hora_fin: '19:00:00', regla_id: null,
    }

    const prevision = previsualizarDesdeReglas([regla()], rangoDelMes('2026-09'), [manual])

    expect(prevision.aCrear.some(f => f.fecha === '2026-09-01')).toBe(false)
    expect(prevision.duplicadas).toBe(1)
  })

  it('respeta la vigencia recortando el período pedido', () => {
    const prevision = previsualizarDesdeReglas(
      [regla({ vigencia_desde: '2026-09-15' })],
      rangoDelMes('2026-09'),
    )

    expect(prevision.aCrear[0].fecha).toBe('2026-09-15')
    expect(prevision.aCrear.every(f => f.fecha >= '2026-09-15')).toBe(true)
  })

  it('omite la regla inactiva, la vencida y la incompleta, con su motivo', () => {
    const prevision = previsualizarDesdeReglas(
      [
        regla({ id: 'r-inactiva', activo: false }),
        regla({ id: 'r-vencida', vigencia_hasta: '2026-08-31' }),
        regla({ id: 'r-incompleta', zona_nombre: '  ' }),
        regla({ id: 'r-sin-dias', dias_semana: [] }),
      ],
      rangoDelMes('2026-09'),
    )

    expect(prevision.aCrear).toEqual([])
    expect(prevision.porRegla.map(r => r.omitida)).toEqual([
      MOTIVO_REGLA_INACTIVA,
      MOTIVO_FUERA_DE_VIGENCIA,
      MOTIVO_REGLA_INCOMPLETA,
      MOTIVO_REGLA_INCOMPLETA,
    ])
  })

  it('dos reglas idénticas no duplican el día', () => {
    const prevision = previsualizarDesdeReglas(
      [regla({ id: 'r-1' }), regla({ id: 'r-2' })],
      { desde: '2026-09-07', hasta: '2026-09-07' },
    )

    expect(prevision.aCrear).toHaveLength(1)
    expect(prevision.duplicadas).toBe(1)
  })

  it('rechaza el rango invertido y la ausencia de reglas', () => {
    expect(previsualizarDesdeReglas([regla()], { desde: '2026-09-30', hasta: '2026-09-01' }).errores)
      .toContain(MENSAJE_RANGO_INVERTIDO)
    expect(previsualizarDesdeReglas([], rangoDelMes('2026-09')).errores)
      .toContain(MENSAJE_SIN_REGLAS)
  })

  it('la observación de la regla viaja a cada fila generada', () => {
    const prevision = previsualizarDesdeReglas(
      [regla({ observacion: '  turno base  ' })],
      { desde: '2026-09-07', hasta: '2026-09-07' },
    )
    expect(prevision.aCrear[0].observacion).toBe('turno base')
  })
})

describe('guardiaCubre', () => {
  it('el franco y la ausencia no cuentan como cobertura', () => {
    expect(guardiaCubre({ estado: 'activo', tipo_evento: 'normal' })).toBe(true)
    expect(guardiaCubre({ estado: 'activo', tipo_evento: 'reemplazo' })).toBe(true)
    expect(guardiaCubre({ estado: 'activo', tipo_evento: 'cobertura' })).toBe(true)
    expect(guardiaCubre({ estado: 'activo', tipo_evento: 'franco' })).toBe(false)
    expect(guardiaCubre({ estado: 'activo', tipo_evento: 'ausencia' })).toBe(false)
  })

  it('una guardia inactivada no cubre aunque sea normal', () => {
    expect(guardiaCubre({ estado: 'inactivo', tipo_evento: 'normal' })).toBe(false)
  })

  it('sin datos asume guardia normal activa', () => {
    expect(guardiaCubre({})).toBe(true)
  })
})

describe('rangoDelMes', () => {
  it('resuelve el último día real de cada mes', () => {
    expect(rangoDelMes('2026-09')).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' })
    expect(rangoDelMes('2026-02')).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' })
    expect(rangoDelMes('2028-02')).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' })
  })
})

describe('etiquetaDias', () => {
  it('usa rango sólo cuando los días son consecutivos', () => {
    expect(etiquetaDias([1, 2, 3, 4, 5, 6])).toBe('Lun a Sáb')
    expect(etiquetaDias([7, 1, 2, 3, 4])).toBe('Lun · Mar · Mié · Jue · Dom')
    expect(etiquetaDias([5])).toBe('Vie')
    expect(etiquetaDias([1, 2, 3, 4, 5, 6, 7])).toBe('Todos los días')
    expect(etiquetaDias([])).toBe('—')
  })
})

describe('resumenMes', () => {
  it('dice cuántas filas y desde cuántas reglas', () => {
    const prevision = previsualizarDesdeReglas(SABINO, { desde: '2026-09-04', hasta: '2026-09-04' })
    expect(resumenMes(prevision)).toBe('Se van a crear 2 guardia(s) desde 2 regla(s).')
  })

  it('avisa cuando ya estaba todo generado', () => {
    const primera = previsualizarDesdeReglas([regla()], rangoDelMes('2026-09'))
    const yaEnBase = primera.aCrear.map(f => ({ ...f, regla_id: f.regla_id }))
    const segunda = previsualizarDesdeReglas([regla()], rangoDelMes('2026-09'), yaEnBase)
    expect(resumenMes(segunda)).toBe('Se van a crear 0 guardia(s) desde 0 regla(s) · 26 ya existen y se omiten.')
  })
})
