import { describe, expect, it } from 'vitest'
import { PARAMETROS_PLANTILLA, plantillaLiquidacionResumenGuardia, type FilaResumenGuardia } from '@/lib/resumen-guardia'
import { extrasDePlantilla, filasConsolidadasDePlantilla } from '@/lib/excel-trabajo-liquidacion'

// Excel de trabajo del mes con las bajas que ya tienen liquidación final (JC 21/10):
// salen todos los que trabajaron, las bajas juntas en un bloque, y suman horas y días.

const fila = (id: string, nombre: string, x: Partial<FilaResumenGuardia> = {}): FilaResumenGuardia => ({
  empleadoId: id, grupo: 'vigiladores', nombre, cuil: '20111111112', legajo: null, legajoVisual: null, cuenta: null,
  objetivos: [], jornadas: 10, jornadasReales: 10, fechasConActividad: 10, horasReales: 200, horasLiquidables: 200,
  feriadosTrabajados: 0, horasEnFeriado: 0, horasNocturnas: 0, horasNocturnasCalculadas: 0, nocturnidadOrigen: null,
  licencias: null, art: null, vacaciones: null, parteMedico: null, ausenciasSuspensiones: null, notas: [],
  supervisiones: 0, horasSupervision: 0, jornadasSupervision: 0, hsVigilanciaZona: 0, observaciones: [],
  origen: { turnoIds: [], registroIds: [], novedadIds: [] }, ...x,
} as FilaResumenGuardia)

const resumen = (filas: FilaResumenGuardia[]) => ({ mes: '2026-10', filas, totales: { empleados: filas.length, jornadas: 0, horasReales: 0, horasLiquidables: 0, horasNocturnas: 0, feriadosTrabajados: 0 } })

describe('Excel de trabajo del mes: bajas con liquidación final', () => {
  const pl = plantillaLiquidacionResumenGuardia(resumen([
    fila('v1', 'ACTIVO, UNO'),
    fila('b1', 'BAJA, UNO', { bajaConFinal: true, jornadas: 11, horasLiquidables: 132 }),
    fila('b2', 'BAJA, DOS', { bajaConFinal: true, jornadas: 9, horasLiquidables: 180 }),
  ]), undefined, undefined, undefined, PARAMETROS_PLANTILLA)
  const v = new Map(pl.celdas.map(c => [c.ref, c]))
  const filaDe = (uid: string) => Number(pl.celdas.find(c => /^BD\d+$/.test(c.ref) && c.v === uid)!.ref.slice(2))

  it('las bajas salen juntas en el BLOQUE 4 y el activo queda en su bloque', () => {
    const titulo = pl.estilos.titulos[pl.estilos.titulos.length - 1]
    expect(String(v.get(`A${titulo}`)?.v)).toMatch(/^BLOQUE 4 - BAJAS CON LIQUIDACIÓN FINAL/)
    expect(filaDe('b1')).toBeGreaterThan(titulo)
    expect(filaDe('b2')).toBeGreaterThan(titulo)
    expect(filaDe('v1')).toBeLessThan(pl.estilos.titulos[1])
    expect(pl.estilos.filasBajaFinal).toEqual([filaDe('b1'), filaDe('b2')])
  })

  it('el TOTAL GENERAL suma los días y las horas de todos (incluidas las bajas)', () => {
    const t = pl.estilos.total
    expect(v.get(`G${t}`)?.v).toBe(10 + 11 + 9)
    expect(v.get(`I${t}`)?.v).toBe(200 + 132 + 180)
    const sub = pl.estilos.subtotales[pl.estilos.subtotales.length - 1]
    expect(String(v.get(`A${sub}`)?.v)).toBe('SUBTOTAL BAJAS')
    expect(v.get(`G${sub}`)).toMatchObject({ v: 20, f: `SUM(G${filaDe('b1')}:G${filaDe('b2')})` })
    expect(String(v.get(`G${t}`)?.f)).toContain(`G${sub}`)
  })

  it('sus conceptos y extras no se consolidan ni se pagan en el mensual (los paga la final)', () => {
    const consolidadas = filasConsolidadasDePlantilla(pl)
    expect(new Set(consolidadas.map(c => c.empleado_id))).toEqual(new Set(['v1']))
    const extras = extrasDePlantilla(pl)
    expect(extras.has('v1')).toBe(true)
    expect(extras.has('b2')).toBe(false)
  })

  it('sin bajas el Excel no cambia (no aparece el bloque 4)', () => {
    const sin = plantillaLiquidacionResumenGuardia(resumen([fila('v1', 'ACTIVO, UNO')]), undefined, undefined, undefined, PARAMETROS_PLANTILLA)
    expect(sin.estilos.titulos).toHaveLength(3)
    expect(sin.estilos.filasBajaFinal).toBeUndefined()
  })
})
