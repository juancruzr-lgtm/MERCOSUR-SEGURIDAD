import { describe, expect, it } from 'vitest'
import {
  ETIQUETA_PREVISION,
  MENSAJE_SERVICIO_SIN_PUESTO,
  fechasDelMes,
  previsualizarMes,
} from '@/lib/programacion'
import type {
  ObjetivoPrevision,
  ServicioPrevision,
  TurnoExistentePrevision,
} from '@/lib/programacion'
import type { EstadoPuestos, PuestoActivo } from '@/lib/puestos'

// Vista previa mensual de la programación (Bloque E, commit 3).
// previsualizarMes es pura: acá se comprueba la expansión de fechas, la
// clasificación por fila, la deduplicación sin depender del guardia y que
// no haya efectos sobre las entradas.

const TODOS = [1, 2, 3, 4, 5, 6, 7]

const puesto = (id: string, objetivoId = 'obj-1', nombre = 'Principal'): PuestoActivo =>
  ({ id, objetivo_id: objetivoId, nombre, orden: null })

// EstadoPuestos armado a mano para no importar valores de lib/puestos
// (ese módulo instancia el cliente supabase al cargarse).
const estadoPuestos = (puestos: PuestoActivo[]): EstadoPuestos => ({
  caso: puestos.length === 0 ? 'sin_puestos' : puestos.length === 1 ? 'unico' : 'multiple',
  puestos,
  puestoUnicoId: puestos.length === 1 ? puestos[0].id : null,
})

const objetivoBase: ObjetivoPrevision = { id: 'obj-1', nombre: 'Objetivo Uno', estado: 'activo', es_prueba: false }

const servicioBase = (over: Partial<ServicioPrevision> = {}): ServicioPrevision => ({
  id: 'srv-1',
  objetivo_id: 'obj-1',
  puesto_id: 'p1',
  dias_semana: TODOS,
  guardia_habitual_id: null,
  activo: true,
  turno_base: { nombre: 'Diurno', hora_inicio: '08:00', hora_fin: '16:00', activo: true },
  guardia: null,
  puesto: { nombre: 'Principal' },
  ...over,
})

const prever = (over: {
  anio?: number
  mes?: number
  servicios?: ServicioPrevision[]
  objetivos?: ObjetivoPrevision[]
  puestosPorObjetivo?: Map<string, EstadoPuestos>
  turnosExistentes?: TurnoExistentePrevision[]
} = {}) =>
  previsualizarMes({
    anio: over.anio ?? 2026,
    mes: over.mes ?? 8,
    servicios: over.servicios ?? [servicioBase()],
    objetivos: over.objetivos ?? [objetivoBase],
    puestosPorObjetivo: over.puestosPorObjetivo ?? new Map([['obj-1', estadoPuestos([puesto('p1')])]]),
    turnosExistentes: over.turnosExistentes ?? [],
  })

describe('fechasDelMes', () => {
  it('mes de 28 días (febrero no bisiesto)', () => {
    expect(fechasDelMes(2026, 2, TODOS)).toHaveLength(28)
  })

  it('mes de 29 días (febrero bisiesto)', () => {
    const fechas = fechasDelMes(2028, 2, TODOS)
    expect(fechas).toHaveLength(29)
    expect(fechas.at(-1)).toBe('2028-02-29')
  })

  it('mes de 30 días', () => {
    expect(fechasDelMes(2026, 4, TODOS)).toHaveLength(30)
  })

  it('mes de 31 días', () => {
    expect(fechasDelMes(2026, 8, TODOS)).toHaveLength(31)
  })

  it('selección por días de semana', () => {
    // Agosto 2026 arranca sábado: lunes a viernes son 21 fechas.
    const fechas = fechasDelMes(2026, 8, [1, 2, 3, 4, 5])
    expect(fechas).toHaveLength(21)
    expect(fechas).not.toContain('2026-08-01') // sábado
    expect(fechas).not.toContain('2026-08-02') // domingo
    expect(fechas).toContain('2026-08-03')     // lunes
  })
})

describe('previsualizarMes', () => {
  it('turno nocturno: la superposición cruza la medianoche', () => {
    // Servicio nocturno de los lunes; el guardia sugerido ya tiene un turno
    // el martes 04/08 a las 05:00, que se superpone con el nocturno del 03/08.
    const r = prever({
      servicios: [servicioBase({
        dias_semana: [1],
        guardia_habitual_id: 'g1',
        turno_base: { nombre: 'Nocturno', hora_inicio: '22:00', hora_fin: '06:00', activo: true },
      })],
      turnosExistentes: [{
        id: 't-x', objetivo_id: 'obj-otro', guardia_id: 'g1',
        fecha: '2026-08-04', hora_inicio: '05:00:00', hora_fin: '13:00:00', estado: 'programado',
      }],
    })
    const porFecha = Object.fromEntries(r.filas.map(f => [f.fecha, f.estado]))
    expect(porFecha['2026-08-03']).toBe('conflicto_horario')
    expect(porFecha['2026-08-10']).toBe('valido')
  })

  it('servicio sin guardia habitual se previsualiza igual', () => {
    const r = prever({ servicios: [servicioBase({ dias_semana: [6] })] })
    expect(r.filas).toHaveLength(5) // sábados de agosto 2026
    expect(r.filas.every(f => f.estado === 'valido')).toBe(true)
    expect(r.filas[0].guardia_sugerido_id).toBeNull()
    expect(r.filas[0].caracteristica).toBe('Normal')
  })

  it('guardia habitual aparece solo como sugerido', () => {
    const r = prever({
      servicios: [servicioBase({
        dias_semana: [6],
        guardia_habitual_id: 'g1',
        guardia: { nombre: 'Juan', apellido: 'Pérez' },
      })],
    })
    expect(r.filas[0].guardia_sugerido_id).toBe('g1')
    expect(r.filas[0].guardia_sugerido_nombre).toBe('Pérez, Juan')
    expect(r.filas[0].estado).toBe('valido')
  })

  it('servicio sin puesto_id: advertencia, sin filas', () => {
    const r = prever({ servicios: [servicioBase({ puesto_id: null })] })
    expect(r.filas).toHaveLength(0)
    expect(r.advertencias).toHaveLength(1)
    expect(r.advertencias[0].estado).toBe('sin_puesto')
    expect(r.advertencias[0].detalle).toBe(MENSAJE_SERVICIO_SIN_PUESTO)
    expect(r.resumen.servicios_sin_puesto).toBe(1)
  })

  it('objetivo de prueba queda excluido', () => {
    const r = prever({ objetivos: [{ ...objetivoBase, es_prueba: true }] })
    expect(r.filas).toHaveLength(0)
    expect(r.advertencias[0].estado).toBe('objetivo_prueba')
    expect(r.resumen.servicios_excluidos).toBe(1)
  })

  it('turno ya generado desde el servicio: ya_existe aunque cambie el guardia', () => {
    const r = prever({
      servicios: [servicioBase({ dias_semana: [6], guardia_habitual_id: 'g1' })],
      turnosExistentes: [{
        id: 't-1', objetivo_id: 'obj-1', puesto_id: 'p1', servicio_base_id: 'srv-1',
        guardia_id: 'g-distinto', // la deduplicación no depende del guardia
        fecha: '2026-08-01', hora_inicio: '08:00:00', hora_fin: '16:00:00', estado: 'programado',
      }],
    })
    const sabado1 = r.filas.find(f => f.fecha === '2026-08-01')
    expect(sabado1?.estado).toBe('ya_existe')
    expect(r.filas.filter(f => f.estado === 'valido')).toHaveLength(4)
    expect(r.resumen.existentes).toBe(1)
  })

  it('turno manual existente: fallback por objetivo + puesto + fecha + horario', () => {
    const r = prever({
      servicios: [servicioBase({ dias_semana: [6] })],
      turnosExistentes: [{
        id: 't-manual', objetivo_id: 'obj-1', puesto_id: 'p1', servicio_base_id: null,
        guardia_id: 'g9',
        fecha: '2026-08-08', hora_inicio: '08:00:00', hora_fin: '16:00:00', estado: 'cubierto',
      }],
    })
    expect(r.filas.find(f => f.fecha === '2026-08-08')?.estado).toBe('ya_existe')
  })

  it('turno en ESTADOS_SIN_OBLIGACION no cuenta como existente', () => {
    const r = prever({
      servicios: [servicioBase({ dias_semana: [6] })],
      turnosExistentes: [{
        id: 't-anulado', objetivo_id: 'obj-1', puesto_id: 'p1', servicio_base_id: 'srv-1',
        fecha: '2026-08-01', hora_inicio: '08:00:00', hora_fin: '16:00:00', estado: 'anulado',
      }],
    })
    expect(r.filas.find(f => f.fecha === '2026-08-01')?.estado).toBe('valido')
  })

  it('un conflicto en una fila no aborta el resto del mes', () => {
    const r = prever({
      servicios: [servicioBase({ dias_semana: [6], guardia_habitual_id: 'g1' })],
      turnosExistentes: [{
        id: 't-b', objetivo_id: 'obj-otro', guardia_id: 'g1',
        fecha: '2026-08-15', hora_inicio: '10:00:00', hora_fin: '12:00:00', estado: 'programado',
      }],
    })
    expect(r.filas).toHaveLength(5)
    expect(r.filas.find(f => f.fecha === '2026-08-15')?.estado).toBe('conflicto_horario')
    expect(r.filas.filter(f => f.estado === 'valido')).toHaveLength(4)
    expect(r.resumen.conflictos).toBe(1)
    expect(r.resumen.validos).toBe(4)
  })

  it('ejecución repetida: mismo resultado', () => {
    const entrada = {
      servicios: [servicioBase({ dias_semana: [1, 3, 5], guardia_habitual_id: 'g1' })],
      turnosExistentes: [{
        id: 't-1', objetivo_id: 'obj-1', puesto_id: 'p1', servicio_base_id: 'srv-1',
        fecha: '2026-08-03', hora_inicio: '08:00:00', hora_fin: '16:00:00', estado: 'programado',
      }] as TurnoExistentePrevision[],
    }
    expect(prever(entrada)).toEqual(prever(entrada))
  })

  it('no escribe: no muta ninguna entrada', () => {
    const servicios = [servicioBase({ dias_semana: [6], guardia_habitual_id: 'g1' })]
    const objetivos = [objetivoBase]
    const turnos: TurnoExistentePrevision[] = [{
      id: 't-1', objetivo_id: 'obj-1', puesto_id: 'p1', servicio_base_id: 'srv-1',
      guardia_id: 'g1', fecha: '2026-08-01', hora_inicio: '08:00:00', hora_fin: '16:00:00', estado: 'programado',
    }]
    const mapa = new Map([['obj-1', estadoPuestos([puesto('p1')])]])

    const congelar = (v: unknown) => {
      if (v && typeof v === 'object') {
        Object.freeze(v)
        Object.values(v as object).forEach(congelar)
      }
    }
    ;[servicios, objetivos, turnos].forEach(congelar)

    const antes = JSON.stringify({ servicios, objetivos, turnos })
    // Con las entradas congeladas, cualquier intento de escritura lanzaría.
    expect(() => prever({ servicios, objetivos, turnosExistentes: turnos, puestosPorObjetivo: mapa })).not.toThrow()
    expect(JSON.stringify({ servicios, objetivos, turnos })).toBe(antes)
  })

  it('clasificaciones centralizadas con etiqueta para cada estado', () => {
    expect(ETIQUETA_PREVISION.valido).toBe('Válido para crear')
    expect(ETIQUETA_PREVISION.ya_existe).toBe('Ya existe')
    expect(ETIQUETA_PREVISION.conflicto_horario).toBe('Conflicto de horario')
    expect(ETIQUETA_PREVISION.sin_puesto).toBe('Servicio sin puesto')
    expect(ETIQUETA_PREVISION.turno_base_inactivo).toBe('Turno base inactivo')
    expect(ETIQUETA_PREVISION.objetivo_inactivo).toBe('Objetivo inactivo')
    expect(ETIQUETA_PREVISION.objetivo_prueba).toBe('Objetivo de prueba excluido')
    expect(ETIQUETA_PREVISION.config_invalida).toBe('Configuración inválida')
  })
})
