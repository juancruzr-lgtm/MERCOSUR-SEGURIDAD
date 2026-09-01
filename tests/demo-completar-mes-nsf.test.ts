import { describe, expect, it } from 'vitest'
import {
  logicaHabitualDeclarada, payloadSeleccionServicios, previsionPorServicio,
  resumenCompletarMes, seleccionInicialCompletar, totalesDeSeleccion,
} from '@/lib/completar-mes'
import { clasificarPuestos } from '@/lib/puestos'

/**
 * Simulación de "Completar septiembre" para NACIÓN SANTA FE desde SU grilla,
 * con el snapshot REAL de producción del 01/09/2026 (estructura declarada ese
 * día vía Lógica detectada + los 2 turnos del 01/09 cargados a mano).
 * Reproduce exactamente el cálculo del bloque de la grilla; no escribe nada.
 */

const OBJETIVO = { id: '946a50ec-e6cf-4995-80dc-6586178f9e3a', nombre: 'NACION SANTA FE', estado: 'activo', es_prueba: false }
const PUESTO = 'd71d4c99-6574-4f41-92d0-1f5cc2e0f07c'

const SERVICIOS = [
  { id: 'd8c2c11c-0ac5-4ceb-8db9-07404de73c81', objetivo_id: OBJETIVO.id, puesto_id: PUESTO, dias_semana: [1, 2, 3, 4, 5, 6, 7], activo: true, turno_base: { nombre: 'DIURNO 07-19', hora_inicio: '07:00', hora_fin: '19:00', activo: true }, puesto: { nombre: 'Principal' } },
  { id: '735ca10f-518d-4169-b6ab-2a97c5d3c39a', objetivo_id: OBJETIVO.id, puesto_id: PUESTO, dias_semana: [1, 2, 3, 4, 5, 6, 7], activo: true, turno_base: { nombre: 'NOCTURNO 19-07', hora_inicio: '19:00', hora_fin: '07:00', activo: true }, puesto: { nombre: 'Principal' } },
]

const TURNOS_SEP = [
  { id: 'e7861d99-0d8e-4930-b803-6e1d898f59eb', objetivo_id: OBJETIVO.id, puesto_id: PUESTO, guardia_id: '5988ff80-29cd-4b89-b42c-7cf0abb0d976', servicio_base_id: null, fecha: '2026-09-01', hora_inicio: '07:00', hora_fin: '19:00', estado: 'programado', tipo_evento: 'normal' },
  { id: '23f53590-a337-4777-8cd7-8f4410398925', objetivo_id: OBJETIVO.id, puesto_id: PUESTO, guardia_id: 'bc59dade-0cb5-4bd2-b954-7adf495221da', servicio_base_id: null, fecha: '2026-09-01', hora_inicio: '19:00', hora_fin: '07:00', estado: 'programado', tipo_evento: 'normal' },
]

describe('demo: Completar septiembre de NACIÓN SANTA FE desde su grilla (datos reales)', () => {
  it('58 faltantes, 2 existentes, sin conflictos, nocturno del 30/09 completo', () => {
    const { bloqueo, logica, resumen } = resumenCompletarMes({
      objetivo: OBJETIVO, mes: '2026-09', servicios: SERVICIOS,
      puestos: clasificarPuestos([{ id: PUESTO, objetivo_id: OBJETIVO.id, nombre: 'Principal', orden: 1 }]),
      turnosExistentes: TURNOS_SEP, fechaActual: '2026-09-01', horaActual: '20:00',
    })
    expect(bloqueo).toBeNull()
    expect(logica.map(l => `${l.puesto} ${l.hora_inicio}-${l.hora_fin} ${l.etiqueta_dias}`)).toEqual([
      'Principal 07:00-19:00 Todos los días',
      'Principal 19:00-07:00 Todos los días',
    ])
    expect(resumen!.prevision.resumen.total_esperado).toBe(60)
    expect(resumen!.existentes).toBe(2)     // los dos turnos de hoy, cargados a mano
    expect(resumen!.faltantes).toBe(58)
    expect(resumen!.conflictos).toBe(0)
    expect(resumen!.fechas_pasadas).toBe(0)
    expect(resumen!.nocturnos_a_crear).toBe(29)
    expect(resumen!.horas_a_crear).toBe(58 * 12) // 696 h

    // ESCENARIO A — estructura completa (selección por defecto del modal).
    const seleccionCompleta = seleccionInicialCompletar(logicaHabitualDeclarada(SERVICIOS))
    expect(seleccionCompleta).toEqual(new Set(SERVICIOS.map(s => s.id)))
    const payloadA = payloadSeleccionServicios(resumen!.prevision.filas, seleccionCompleta)
    expect(payloadA).toHaveLength(58)
    expect(payloadA.filter(p => p.fecha === '2026-09-30')).toHaveLength(2) // diurno + nocturno del último día
    expect(totalesDeSeleccion(resumen!.prevision.filas, seleccionCompleta)).toEqual({
      a_crear: 58, existentes: 2, conflictos: 0, fechas_pasadas: 0,
      nocturnos_a_crear: 29, horas_a_crear: 696,
    })

    // Desglose por servicio, como lo muestra el selector del modal.
    expect(previsionPorServicio(resumen!.prevision.filas)).toEqual([
      { servicio_id: 'd8c2c11c-0ac5-4ceb-8db9-07404de73c81', puesto: 'Principal', hora_inicio: '07:00', hora_fin: '19:00', nocturno: false, a_crear: 29, existentes: 1, fechas_pasadas: 0, conflictos: 0, horas: 348 },
      { servicio_id: '735ca10f-518d-4169-b6ab-2a97c5d3c39a', puesto: 'Principal', hora_inicio: '19:00', hora_fin: '07:00', nocturno: true, a_crear: 29, existentes: 1, fechas_pasadas: 0, conflictos: 0, horas: 348 },
    ])

    // ESCENARIO B — septiembre SIN el nocturno: se desmarca esa línea.
    // La estructura habitual (SERVICIOS) no se toca: octubre la ofrece entera.
    const antes = JSON.stringify(SERVICIOS)
    const sinNocturno = new Set(seleccionCompleta)
    sinNocturno.delete('735ca10f-518d-4169-b6ab-2a97c5d3c39a')
    const payloadB = payloadSeleccionServicios(resumen!.prevision.filas, sinNocturno)
    expect(payloadB).toHaveLength(29)
    expect(payloadB.every(p => p.servicio_id === 'd8c2c11c-0ac5-4ceb-8db9-07404de73c81')).toBe(true)
    expect(totalesDeSeleccion(resumen!.prevision.filas, sinNocturno)).toEqual({
      a_crear: 29, existentes: 1, conflictos: 0, fechas_pasadas: 0,
      nocturnos_a_crear: 0, horas_a_crear: 348,
    })
    expect(JSON.stringify(SERVICIOS)).toBe(antes) // nada re-declarado ni desactivado
  })
})
