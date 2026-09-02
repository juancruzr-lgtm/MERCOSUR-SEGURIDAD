import { describe, it, expect } from 'vitest'
import {
  esAusencia, novedadDelDia, etiquetaDia, estadoFilaClasificada,
  planGuardarClasificacion, observacionReclasificacion, observacionQuitar,
  resumenClasificacionMes, labelNovedadDia, TIPOS_NOVEDAD_DIA,
} from '@/lib/clasificacion-dia'
import type { NovedadDia } from '@/lib/clasificacion-dia'
import { clasificarDia } from '@/lib/novedades-laborales'

const PEREZ = 'perez-uuid'
const OTRO = 'otro-uuid'

const nov = (over: Partial<NovedadDia> = {}): NovedadDia => ({
  id: 'n1', empleado_id: PEREZ, tipo: 'falta_injustificada',
  fecha_desde: '2026-08-14', fecha_hasta: '2026-08-14', estado: 'aprobada', ...over,
})

describe('qué es una ausencia', () => {
  it('sólo la falta injustificada', () => {
    expect(esAusencia('falta_injustificada')).toBe(true)
    for (const t of TIPOS_NOVEDAD_DIA.filter(t => t.value !== 'falta_injustificada')) {
      expect(esAusencia(t.value)).toBe(false)
    }
  })

  it('la etiqueta dice Ausencia sólo para la injustificada', () => {
    expect(etiquetaDia(nov())).toBe('Ausencia — Falta injustificada')
    expect(etiquetaDia(nov({ tipo: 'parte_medico' }))).toBe('Parte médico / Enfermedad')
  })
})

describe('la novedad que cubre un día', () => {
  it('encuentra la del día y no la de otra persona', () => {
    const novedades = [nov(), nov({ id: 'n2', empleado_id: OTRO, tipo: 'franco' })]
    expect(novedadDelDia(novedades, PEREZ, '2026-08-14')?.id).toBe('n1')
    expect(novedadDelDia(novedades, PEREZ, '2026-08-15')).toBeNull()
  })

  it('ignora las no aprobadas: una clasificación quitada deja el día sin clasificar', () => {
    expect(novedadDelDia([nov({ estado: 'anulada' })], PEREZ, '2026-08-14')).toBeNull()
  })

  it('prefiere la novedad de un solo día, que es la editable desde Reportes', () => {
    const rango = nov({ id: 'rango', tipo: 'vacaciones', fecha_desde: '2026-08-10', fecha_hasta: '2026-08-20' })
    expect(novedadDelDia([rango, nov()], PEREZ, '2026-08-14')?.id).toBe('n1')
  })
})

describe('cómo queda la fila del turno', () => {
  it('un turno sin fichaje clasificado muestra la ausencia, no "Sin fichar"', () => {
    expect(estadoFilaClasificada('Sin fichar', nov(), false)).toBe('Ausencia — Falta injustificada')
  })

  it('un turno descubierto clasificado también', () => {
    expect(estadoFilaClasificada('Descubierto', nov(), false)).toBe('Ausencia — Falta injustificada')
  })

  it('sin clasificación no cambia nada', () => {
    expect(estadoFilaClasificada('Sin fichar', null, false)).toBe('Sin fichar')
  })

  it('un día efectivamente trabajado gana sobre la novedad: no se disfraza de ausencia', () => {
    expect(estadoFilaClasificada('Cubierto', nov(), true)).toBe('Cubierto')
    expect(estadoFilaClasificada('Tarde', nov(), true)).toBe('Tarde')
  })

  it('anulado real y reemplazo siguen diferenciándose de la ausencia', () => {
    expect(estadoFilaClasificada('Anulado', nov(), false)).toBe('Anulado')
    expect(estadoFilaClasificada('Reemplazado', nov(), false)).toBe('Reemplazado')
    expect(estadoFilaClasificada('Cancelado', nov(), false)).toBe('Cancelado')
  })

  it('el turno con reemplazo no marca ausencia al titular', () => {
    // El titular fue reemplazado: su fila dice Reemplazado aunque alguien haya
    // cargado una novedad ese día. No es una falta suya.
    expect(estadoFilaClasificada('Reemplazado', nov(), false)).not.toContain('Ausencia')
  })
})

describe('reclasificar sin duplicar', () => {
  it('sin novedad previa, crea', () => {
    expect(planGuardarClasificacion(null)).toEqual({ accion: 'crear' })
  })

  it('con novedad de un día, actualiza esa misma fila', () => {
    expect(planGuardarClasificacion(nov())).toEqual({ accion: 'actualizar', id: 'n1' })
  })

  it('no parte una novedad de rango largo cargada desde otro lado', () => {
    const plan = planGuardarClasificacion(nov({ fecha_desde: '2026-08-10', fecha_hasta: '2026-08-20', tipo: 'vacaciones' }))
    expect(plan.accion).toBe('bloqueada')
    if (plan.accion === 'bloqueada') expect(plan.motivo).toContain('Novedades')
  })

  it('parte médico → falta injustificada actualiza, no inserta una segunda', () => {
    // Insertar otra dejaría ganando a la justificación (regla pro-empleado de
    // clasificarDia): la reclasificación no tendría efecto.
    const previa = nov({ tipo: 'parte_medico' })
    expect(planGuardarClasificacion(previa)).toEqual({ accion: 'actualizar', id: 'n1' })

    const dosFilas = [previa, nov({ id: 'n2', tipo: 'falta_injustificada' })]
    expect(clasificarDia(dosFilas, PEREZ, '2026-08-14')).toBe('justificada')

    const actualizada = [{ ...previa, tipo: 'falta_injustificada' }]
    expect(clasificarDia(actualizada, PEREZ, '2026-08-14')).toBe('injustificada')
  })

  it('falta injustificada → justificada queda justificada', () => {
    const actualizada = [nov({ tipo: 'falta_justificada' })]
    expect(clasificarDia(actualizada, PEREZ, '2026-08-14')).toBe('justificada')
  })

  it('la observación deja el rastro del cambio sin perder lo anterior', () => {
    const texto = observacionReclasificacion(
      nov({ tipo: 'parte_medico', observacion: 'dijo que traía certificado' }),
      'falta_injustificada', 'no presentó certificado', 'juancruzr', '2026-09-02T10:00:00Z')
    expect(texto).toContain('no presentó certificado')
    expect(texto).toContain('Parte médico / Enfermedad → Falta injustificada')
    expect(texto).toContain('juancruzr')
    expect(texto).toContain('dijo que traía certificado')
  })

  it('quitar deja constancia de qué se quitó', () => {
    const texto = observacionQuitar(nov(), 'juancruzr', '2026-09-02T10:00:00Z')
    expect(texto).toContain('Falta injustificada')
    expect(texto).toContain('juancruzr')
  })
})

describe('resumen mensual, como los feriados', () => {
  it('cuenta ausencias y justificados del mes', () => {
    const novedades = [
      nov({ id: 'a', fecha_desde: '2026-08-14', fecha_hasta: '2026-08-14' }),
      nov({ id: 'b', fecha_desde: '2026-08-15', fecha_hasta: '2026-08-15' }),
      nov({ id: 'c', tipo: 'franco', fecha_desde: '2026-08-20', fecha_hasta: '2026-08-20' }),
    ]
    expect(resumenClasificacionMes(novedades, PEREZ, '2026-08')).toEqual({ ausencias: 2, justificados: 1, total: 3 })
  })

  it('cuenta días, no filas: un rango de vacaciones son varios días', () => {
    const novedades = [nov({ tipo: 'vacaciones', fecha_desde: '2026-08-10', fecha_hasta: '2026-08-14' })]
    expect(resumenClasificacionMes(novedades, PEREZ, '2026-08').justificados).toBe(5)
  })

  it('no cuenta lo de otro mes ni lo de otra persona ni lo no aprobado', () => {
    const novedades = [
      nov({ id: 'x', fecha_desde: '2026-07-14', fecha_hasta: '2026-07-14' }),
      nov({ id: 'y', empleado_id: OTRO }),
      nov({ id: 'z', estado: 'anulada' }),
    ]
    expect(resumenClasificacionMes(novedades, PEREZ, '2026-08').total).toBe(0)
  })

  it('un rango a caballo de dos meses sólo aporta sus días del mes pedido', () => {
    const novedades = [nov({ tipo: 'licencia', fecha_desde: '2026-07-28', fecha_hasta: '2026-08-03' })]
    expect(resumenClasificacionMes(novedades, PEREZ, '2026-08').justificados).toBe(3)
  })

  it('una justificación sobre el mismo día no se cuenta además como ausencia', () => {
    const novedades = [nov({ id: 'a' }), nov({ id: 'b', tipo: 'parte_medico' })]
    const r = resumenClasificacionMes(novedades, PEREZ, '2026-08')
    expect(r.ausencias).toBe(0)
    expect(r.total).toBe(1)
  })

  it('el caso Pérez: 14, 15 y 16 sin certificado son 3 ausencias', () => {
    const novedades = ['2026-08-14', '2026-08-15', '2026-08-16'].map((f, i) =>
      nov({ id: `p${i}`, fecha_desde: f, fecha_hasta: f }))
    expect(resumenClasificacionMes(novedades, PEREZ, '2026-08').ausencias).toBe(3)
  })
})

describe('etiquetas', () => {
  it('traduce los tipos del menú', () => {
    expect(labelNovedadDia('falta_injustificada')).toBe('Falta injustificada')
    expect(labelNovedadDia('parte_medico')).toBe('Parte médico / Enfermedad')
  })

  it('un tipo desconocido se muestra tal cual en vez de romper', () => {
    expect(labelNovedadDia('inventado')).toBe('inventado')
  })
})
