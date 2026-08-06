import { describe, expect, it } from 'vitest'
import {
  ETIQUETA_ORIGEN_TURNO,
  ETIQUETA_SIN_ASIGNAR,
  filtrarProgramacionMensual,
  origenTurno,
  rangoMesLegajo,
} from '@/lib/legajo-objetivo'

// Programación mensual en el legajo del objetivo (Bloque E).
// La carga real consulta turnos por objetivo y rango de mes; acá se prueban
// el rango del selector de mes, el filtro puro (posición y con/sin
// vigilador) y la identificación de origen por servicio_base_id.

const t = (over: Partial<{ puesto_id: string | null; guardia_id: string | null }> = {}) => ({
  puesto_id: 'pv1' as string | null,
  guardia_id: null as string | null,
  ...over,
})

// Mes de NACION ENTRE RIOS: 78 de programación (Vigilador 1/2/3, sin
// vigilador) + históricos manuales bajo Principal con guardia.
const MES = [
  ...Array.from({ length: 26 }, () => t({ puesto_id: 'pv1' })),
  ...Array.from({ length: 26 }, () => t({ puesto_id: 'pv2' })),
  ...Array.from({ length: 26 }, () => t({ puesto_id: 'pv3' })),
  ...Array.from({ length: 15 }, () => t({ puesto_id: 'p-principal', guardia_id: 'g1' })),
]

describe('rangoMesLegajo (selector de mes)', () => {
  it('agosto: 01 → 31', () => {
    expect(rangoMesLegajo('2026-08')).toEqual({ desde: '2026-08-01', hasta: '2026-08-31' })
  })
  it('febrero no bisiesto: 01 → 28', () => {
    expect(rangoMesLegajo('2026-02')).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' })
  })
  it('febrero bisiesto: 01 → 29', () => {
    expect(rangoMesLegajo('2028-02').hasta).toBe('2028-02-29')
  })
})

describe('filtrarProgramacionMensual', () => {
  it('sin filtros muestra todos los turnos del mes, incluidos los sin vigilador', () => {
    expect(filtrarProgramacionMensual(MES, {})).toHaveLength(93)
    expect(filtrarProgramacionMensual(MES, { asignacion: 'todos' })).toHaveLength(93)
  })

  it('filtro por posición operativa', () => {
    expect(filtrarProgramacionMensual(MES, { puestoId: 'pv1' })).toHaveLength(26)
    expect(filtrarProgramacionMensual(MES, { puestoId: 'pv3' })).toHaveLength(26)
  })

  it('compatibilidad con la posición histórica Principal', () => {
    const principal = filtrarProgramacionMensual(MES, { puestoId: 'p-principal' })
    expect(principal).toHaveLength(15)
    expect(principal.every(x => x.guardia_id === 'g1')).toBe(true)
  })

  it('filtro con/sin vigilador', () => {
    expect(filtrarProgramacionMensual(MES, { asignacion: 'sin' })).toHaveLength(78)
    expect(filtrarProgramacionMensual(MES, { asignacion: 'con' })).toHaveLength(15)
  })

  it('filtros combinados: posición + sin vigilador', () => {
    expect(filtrarProgramacionMensual(MES, { puestoId: 'pv2', asignacion: 'sin' })).toHaveLength(26)
    expect(filtrarProgramacionMensual(MES, { puestoId: 'p-principal', asignacion: 'sin' })).toHaveLength(0)
  })

  it('es puro: no muta la lista (la vista re-filtra en memoria, sin F5)', () => {
    const copia = MES.map(x => ({ ...x }))
    filtrarProgramacionMensual(MES, { puestoId: 'pv1', asignacion: 'sin' })
    expect(MES).toEqual(copia)
  })
})

describe('origenTurno', () => {
  it('con servicio_base_id: Programación mensual', () => {
    expect(origenTurno({ servicio_base_id: 'srv-1' })).toBe(ETIQUETA_ORIGEN_TURNO.programacion)
    expect(origenTurno({ servicio_base_id: 'srv-1' })).toBe('Programación mensual')
  })
  it('sin servicio_base_id: Manual', () => {
    expect(origenTurno({ servicio_base_id: null })).toBe(ETIQUETA_ORIGEN_TURNO.manual)
  })
  it('etiqueta de sin asignar centralizada', () => {
    expect(ETIQUETA_SIN_ASIGNAR).toBe('Sin asignar')
  })
})
