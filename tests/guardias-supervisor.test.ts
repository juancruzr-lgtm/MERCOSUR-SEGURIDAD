import { describe, expect, it } from 'vitest'
import {
  MAX_DIAS_RANGO,
  MENSAJE_FECHAS_INCOMPLETAS,
  MENSAJE_RANGO_INVERTIDO,
  MENSAJE_RANGO_LARGO,
  MENSAJE_SIN_DIAS,
  MENSAJE_SIN_HORARIO,
  MENSAJE_SIN_SUPERVISOR,
  MENSAJE_SIN_ZONA,
  claveGuardia,
  diaSemanaIso,
  diasDelRango,
  esNocturno,
  fechasEnRango,
  previsualizarGeneracion,
  resumenGeneracion,
} from '@/lib/guardias-supervisor'
import type { GuardiaExistente, ParametrosGeneracion } from '@/lib/guardias-supervisor'

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
