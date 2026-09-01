import { describe, expect, it } from 'vitest'
import {
  AVISO_DIVERGENCIA_MES_ANTERIOR,
  MENSAJE_SELECCION_VACIA,
  avisoDivergenciaMesAnterior,
  bloqueoCompletarMes,
  horasDeFranja,
  logicaHabitualDeclarada,
  motivoBloqueoConfirmar,
  payloadSeleccionServicios,
  previsionPorServicio,
  resumenCompletarMes,
  seleccionInicialCompletar,
  totalesDeSeleccion,
} from '@/lib/completar-mes'
import { payloadCreacionParcial, clavePrevision } from '@/lib/programacion'
import type { ServicioPrevision, TurnoExistentePrevision } from '@/lib/programacion'
import { clasificarPuestos } from '@/lib/puestos'
import { analizarCoberturaHistorica } from '@/lib/cobertura-historica'

// ── Fixture: NACIÓN SANTA FE sintético, septiembre 2026 ─────────────────────

const OBJ = { id: 'obj-nsf', nombre: 'NACION SANTA FE', estado: 'activo', es_prueba: false }
const OTRO = { id: 'obj-otro', nombre: 'OTRO', estado: 'activo', es_prueba: false }
const PUESTOS = clasificarPuestos([{ id: 'p-1', objetivo_id: OBJ.id, nombre: 'Principal', orden: 1 }])

const servicio = (id: string, hi: string, hf: string, dias: number[] = [1, 2, 3, 4, 5, 6, 7]): ServicioPrevision => ({
  id, objetivo_id: OBJ.id, puesto_id: 'p-1', dias_semana: dias, activo: true,
  turno_base: { nombre: `${hi}-${hf}`, hora_inicio: hi, hora_fin: hf, activo: true },
  puesto: { nombre: 'Principal' },
})

const SERVICIOS = [servicio('srv-d', '07:00', '19:00'), servicio('srv-n', '19:00', '07:00')]

const turnoExistente = (fecha: string, hi: string, hf: string, extra: Partial<TurnoExistentePrevision> = {}): TurnoExistentePrevision => ({
  id: `t-${fecha}-${hi}`, objetivo_id: OBJ.id, puesto_id: 'p-1', guardia_id: null,
  servicio_base_id: null, fecha, hora_inicio: hi, hora_fin: hf, estado: 'programado', tipo_evento: 'normal',
  ...extra,
})

const armar = (turnosExistentes: TurnoExistentePrevision[] = [], extra: Partial<Parameters<typeof resumenCompletarMes>[0]> = {}) =>
  resumenCompletarMes({
    objetivo: OBJ, mes: '2026-09', servicios: SERVICIOS, puestos: PUESTOS,
    turnosExistentes, fechaActual: '2026-09-01', horaActual: '12:00', ...extra,
  })

// ── Resumen: existentes vs faltantes ─────────────────────────────────────────

describe('resumenCompletarMes', () => {
  it('mes vacío: 60 esperados, el diurno de hoy ya comenzó (fecha pasada)', () => {
    const { bloqueo, resumen } = armar()
    expect(bloqueo).toBeNull()
    // 30 días × 2 franjas; a las 12:00 del 01/09 el diurno de hoy ya empezó.
    expect(resumen!.prevision.resumen.total_esperado).toBe(60)
    expect(resumen!.fechas_pasadas).toBe(1)
    expect(resumen!.faltantes).toBe(59)
    expect(resumen!.existentes).toBe(0)
    expect(resumen!.conflictos).toBe(0)
  })

  it('representa existentes vs faltantes: lo cargado se descuenta, nunca se duplica', () => {
    const { resumen } = armar([
      turnoExistente('2026-09-01', '07:00', '19:00'),
      turnoExistente('2026-09-01', '19:00', '07:00'),
      turnoExistente('2026-09-02', '07:00', '19:00'),
    ])
    expect(resumen!.existentes).toBe(3)
    expect(resumen!.faltantes).toBe(57) // 60 − 3 existentes; el diurno de hoy ya existe
    expect(resumen!.fechas_pasadas).toBe(0)
    // Idempotencia de la vista: mismas entradas, mismo resultado.
    const otra = armar([
      turnoExistente('2026-09-01', '07:00', '19:00'),
      turnoExistente('2026-09-01', '19:00', '07:00'),
      turnoExistente('2026-09-02', '07:00', '19:00'),
    ])
    expect(otra.resumen!.faltantes).toBe(57)
    expect(otra.resumen!.prevision.filas).toEqual(resumen!.prevision.filas)
  })

  it('un turno de OTRO objetivo no cuenta como existente acá', () => {
    const { resumen } = armar([
      turnoExistente('2026-09-02', '07:00', '19:00', { objetivo_id: OTRO.id, id: 't-ajeno' }),
    ])
    expect(resumen!.existentes).toBe(0)
    expect(resumen!.faltantes).toBe(59)
  })

  it('el nocturno del 30/09 se genera completo como turno de septiembre', () => {
    const { resumen } = armar()
    const ultimo = resumen!.prevision.filas.filter(f => f.fecha === '2026-09-30')
    expect(ultimo.map(f => `${f.hora_inicio}-${f.hora_fin}:${f.estado}`).sort()).toEqual([
      '07:00-19:00:valido', '19:00-07:00:valido',
    ])
    // No existe ninguna fila del 01/10: el nocturno pertenece a su día de inicio.
    expect(resumen!.prevision.filas.some(f => f.fecha > '2026-09-30')).toBe(false)
    expect(resumen!.nocturnos_a_crear).toBe(30)
  })

  it('horas a crear: 59 turnos de 12 h', () => {
    const { resumen } = armar()
    expect(resumen!.horas_a_crear).toBe(59 * 12)
  })
})

// ── Payload de creación: solo este objetivo ──────────────────────────────────

describe('payload hacia la RPC', () => {
  it('solo lleva filas válidas de este objetivo', () => {
    const { resumen } = armar([turnoExistente('2026-09-02', '07:00', '19:00')])
    const filas = resumen!.prevision.filas
    const payload = payloadCreacionParcial(filas, new Set(filas.map(clavePrevision)))
    expect(payload).toHaveLength(resumen!.faltantes)
    expect(payload.every(p => ['srv-d', 'srv-n'].includes(p.servicio_id))).toBe(true)
    // La fila ya existente y la fecha pasada no viajan.
    expect(payload.some(p => p.fecha === '2026-09-02' && p.servicio_id === 'srv-d')).toBe(false)
  })
})

// ── Bloqueos ─────────────────────────────────────────────────────────────────

describe('bloqueoCompletarMes', () => {
  it('sin estructura declarada no ofrece completar', () => {
    const r = resumenCompletarMes({
      objetivo: OBJ, mes: '2026-09', servicios: [], puestos: PUESTOS,
      turnosExistentes: [], fechaActual: '2026-09-01', horaActual: '12:00',
    })
    expect(r.bloqueo).toBe('sin_estructura')
    expect(r.resumen).toBeNull()
    expect(r.logica).toEqual([])
  })

  it('servicios inactivos no cuentan como estructura', () => {
    const inactivo = { ...servicio('srv-x', '07:00', '19:00'), activo: false }
    expect(bloqueoCompletarMes(OBJ, [inactivo].filter(s => s.activo))).toBe('sin_estructura')
  })

  it('objetivo inactivo o de prueba queda bloqueado', () => {
    expect(bloqueoCompletarMes({ estado: 'inactivo', es_prueba: false }, SERVICIOS)).toBe('objetivo_inactivo')
    expect(bloqueoCompletarMes({ estado: 'activo', es_prueba: true }, SERVICIOS)).toBe('objetivo_prueba')
    const r = armar([], { objetivo: { ...OBJ, es_prueba: true } })
    expect(r.bloqueo).toBe('objetivo_prueba')
    expect(r.resumen).toBeNull()
  })
})

// ── Lógica habitual y franjas ────────────────────────────────────────────────

describe('logicaHabitualDeclarada y previsionPorFranja', () => {
  it('describe la estructura declarada en líneas legibles', () => {
    expect(logicaHabitualDeclarada(SERVICIOS)).toEqual([
      { servicio_id: 'srv-d', puesto: 'Principal', hora_inicio: '07:00', hora_fin: '19:00', etiqueta_dias: 'Todos los días', nocturno: false },
      { servicio_id: 'srv-n', puesto: 'Principal', hora_inicio: '19:00', hora_fin: '07:00', etiqueta_dias: 'Todos los días', nocturno: true },
    ])
  })

  it('agrupa la vista previa por servicio con horas', () => {
    const { resumen } = armar([turnoExistente('2026-09-02', '19:00', '07:00')])
    const lineas = previsionPorServicio(resumen!.prevision.filas)
    expect(lineas).toEqual([
      { servicio_id: 'srv-d', puesto: 'Principal', hora_inicio: '07:00', hora_fin: '19:00', nocturno: false, a_crear: 29, existentes: 0, fechas_pasadas: 1, conflictos: 0, horas: 29 * 12 },
      { servicio_id: 'srv-n', puesto: 'Principal', hora_inicio: '19:00', hora_fin: '07:00', nocturno: true, a_crear: 29, existentes: 1, fechas_pasadas: 0, conflictos: 0, horas: 29 * 12 },
    ])
  })
})

// ── Selección por servicio: qué completar ESTE mes ──────────────────────────

describe('selección de patrones del mes', () => {
  it('excluir el nocturno genera solo el diurno, con totales recalculados', () => {
    const { resumen } = armar()
    const filas = resumen!.prevision.filas
    const soloDiurno = new Set(['srv-d'])
    const totales = totalesDeSeleccion(filas, soloDiurno)
    expect(totales).toEqual({
      a_crear: 29, existentes: 0, conflictos: 0, fechas_pasadas: 1,
      nocturnos_a_crear: 0, horas_a_crear: 29 * 12,
    })
    const payload = payloadSeleccionServicios(filas, soloDiurno)
    expect(payload).toHaveLength(29)
    expect(payload.every(p => p.servicio_id === 'srv-d')).toBe(true)
  })

  it('excluir un patrón no modifica los servicios declarados', () => {
    const antes = JSON.stringify(SERVICIOS)
    const { resumen } = armar()
    totalesDeSeleccion(resumen!.prevision.filas, new Set(['srv-d']))
    payloadSeleccionServicios(resumen!.prevision.filas, new Set(['srv-d']))
    expect(JSON.stringify(SERVICIOS)).toBe(antes)
  })

  it('otro mes arranca de nuevo con toda la estructura habitual marcada', () => {
    // La selección no persiste: se rearma desde la lógica declarada al abrir.
    const inicial = seleccionInicialCompletar(logicaHabitualDeclarada(SERVICIOS))
    expect(inicial).toEqual(new Set(['srv-d', 'srv-n']))
    // Y octubre previsualiza ambos servicios completos otra vez.
    const octubre = resumenCompletarMes({
      objetivo: OBJ, mes: '2026-10', servicios: SERVICIOS, puestos: PUESTOS,
      turnosExistentes: [], fechaActual: '2026-09-01', horaActual: '12:00',
    })
    const porServicio = previsionPorServicio(octubre.resumen!.prevision.filas)
    expect(porServicio.map(l => [l.servicio_id, l.a_crear])).toEqual([
      ['srv-d', 31], ['srv-n', 31],
    ])
  })

  it('dos puestos con el mismo horario: excluir uno no excluye el otro', () => {
    const PUESTOS2 = clasificarPuestos([
      { id: 'p-1', objetivo_id: OBJ.id, nombre: 'Vigilador 1', orden: 1 },
      { id: 'p-2', objetivo_id: OBJ.id, nombre: 'Vigilador 2', orden: 2 },
    ])
    const dosPuestos = [
      { ...servicio('srv-p1', '07:00', '19:00'), puesto_id: 'p-1', puesto: { nombre: 'Vigilador 1' } },
      { ...servicio('srv-p2', '07:00', '19:00'), puesto_id: 'p-2', puesto: { nombre: 'Vigilador 2' } },
    ]
    const { resumen } = resumenCompletarMes({
      objetivo: OBJ, mes: '2026-09', servicios: dosPuestos, puestos: PUESTOS2,
      turnosExistentes: [], fechaActual: '2026-09-01', horaActual: '06:00',
    })
    expect(previsionPorServicio(resumen!.prevision.filas)).toHaveLength(2)
    const soloP2 = payloadSeleccionServicios(resumen!.prevision.filas, new Set(['srv-p2']))
    expect(soloP2).toHaveLength(30)
    expect(soloP2.every(p => p.servicio_id === 'srv-p2')).toBe(true)
  })

  it('desmarcar todo bloquea la confirmación con el mensaje pedido', () => {
    const { resumen } = armar()
    expect(motivoBloqueoConfirmar(resumen!.prevision.filas, new Set())).toBe(MENSAJE_SELECCION_VACIA)
    expect(motivoBloqueoConfirmar(resumen!.prevision.filas, new Set(['srv-d']))).toBeNull()
  })

  it('una selección sin faltantes tampoco permite confirmar', () => {
    // Todo septiembre del diurno ya está cargado: nada que crear en esa línea.
    const cargados = [] as ReturnType<typeof turnoExistente>[]
    for (let d = 1; d <= 30; d++) cargados.push(turnoExistente(`2026-09-${String(d).padStart(2, '0')}`, '07:00', '19:00'))
    const { resumen } = armar(cargados)
    expect(motivoBloqueoConfirmar(resumen!.prevision.filas, new Set(['srv-d'])))
      .toBe('Las líneas seleccionadas no tienen turnos faltantes.')
  })

  it('idempotencia con selección: lo existente se excluye del payload y el recálculo es estable', () => {
    const cargados = [
      turnoExistente('2026-09-05', '19:00', '07:00'),
      turnoExistente('2026-09-06', '19:00', '07:00'),
    ]
    const a = armar(cargados)
    const b = armar(cargados)
    const sel = new Set(['srv-n'])
    expect(totalesDeSeleccion(a.resumen!.prevision.filas, sel))
      .toEqual(totalesDeSeleccion(b.resumen!.prevision.filas, sel))
    const payload = payloadSeleccionServicios(a.resumen!.prevision.filas, sel)
    expect(payload).toHaveLength(28) // 30 − 2 ya cargados
    expect(payload.some(p => p.fecha === '2026-09-05' || p.fecha === '2026-09-06')).toBe(false)
  })
})

describe('horasDeFranja', () => {
  it('diurnas, nocturnas y bordes', () => {
    expect(horasDeFranja('07:00', '19:00')).toBe(12)
    expect(horasDeFranja('19:00', '07:00')).toBe(12) // cruza medianoche
    expect(horasDeFranja('08:45', '16:45')).toBe(8)
    expect(horasDeFranja('12:00', '19:00')).toBe(7)
    expect(horasDeFranja('22:00', '06:00')).toBe(8)
  })
})

// ── Aviso de divergencia contra el mes anterior ─────────────────────────────

describe('avisoDivergenciaMesAnterior', () => {
  const agosto = (dows: number[], desde = 1, hasta = 31) => {
    const fechas: string[] = []
    for (let d = desde; d <= hasta; d++) {
      let dow = new Date(2026, 7, d).getDay()
      if (dow === 0) dow = 7
      if (dows.includes(dow)) fechas.push(`2026-08-${String(d).padStart(2, '0')}`)
    }
    return fechas.map(fecha => ({
      objetivo_id: OBJ.id, puesto_id: 'p-1', guardia_id: 'g-1', fecha,
      hora_inicio: '07:00', hora_fin: '19:00', estado: 'programado', tipo_evento: 'normal',
    }))
  }
  const analizar = (turnos: any[], servicios: any[]) =>
    analizarCoberturaHistorica({ anio: 2026, mes: 8, turnos, objetivos: [OBJ], servicios }).objetivos[0] ?? null

  it('coincidencia: sin aviso', () => {
    const analisis = analizar(agosto([1, 2, 3, 4, 5, 6, 7]), [
      { objetivo_id: OBJ.id, activo: true, dias_semana: [1, 2, 3, 4, 5, 6, 7], turno_base: { hora_inicio: '07:00', hora_fin: '19:00' } },
    ])
    expect(avisoDivergenciaMesAnterior(analisis)).toBeNull()
  })

  it('el mes pasado el turno se corrió de días: avisa, no cambia nada', () => {
    // Declarado todos los días; el mes anterior solo se programó L–V.
    const analisis = analizar(agosto([1, 2, 3, 4, 5]), [
      { objetivo_id: OBJ.id, activo: true, dias_semana: [1, 2, 3, 4, 5, 6, 7], turno_base: { hora_inicio: '07:00', hora_fin: '19:00' } },
    ])
    expect(avisoDivergenciaMesAnterior(analisis)).toBe(AVISO_DIVERGENCIA_MES_ANTERIOR)
  })

  it('sin datos del mes anterior: sin aviso', () => {
    expect(avisoDivergenciaMesAnterior(null)).toBeNull()
  })
})
