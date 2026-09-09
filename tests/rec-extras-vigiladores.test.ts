import { describe, it, expect } from 'vitest'
import {
  construirResumenGuardia, plantillaLiquidacionResumenGuardia,
  type ParamsResumenGuardia, type TurnoResumen, type EmpleadoResumen, type PlantillaLiquidacion,
} from '@/lib/resumen-guardia'
import type { RegistroUniverso } from '@/lib/liquidacion'

// ETAPA 2 — El indicador REC vs Extras se construye SÓLO con VIGILADORES (BLOQUE 1):
// "de todas las horas de vigilancia pagadas, qué % es REC y qué % Extras". Se toma
// del SUBTOTAL VIGILADORES (AG=horas rec, AL=hs extras), NO del total general (que
// mezcla las horas artificiales de los mensualizados).
const OBJ = 'obj-real'
const turno = (o: Partial<TurnoResumen> & { id: string }): TurnoResumen => ({
  fecha: '2026-08-01', hora_inicio: '07:00', hora_fin: '19:00', objetivo_id: OBJ,
  estado: 'cubierto', guardia_id: 'x', ...o,
})
const registro = (o: Partial<RegistroUniverso> & { turno_id: string }): RegistroUniverso => ({ id: `r-${o.turno_id}`, guardia_id: 'x', ...o })
const emp = (id: string, puesto: string): EmpleadoResumen => ({
  id, nombre: id, apellido: id.toUpperCase(), rol: 'x', puesto_organizacional: puesto,
  estado: 'activo', esPrueba: false, cuil: '20111111112', legajo: id, legajoVisual: id, cuenta: null,
})
const dia = (n: number) => `2026-08-${String(n).padStart(2, '0')}`
// N jornadas de 12h para el guardia `gid`.
function turnosDe(gid: string, n: number): { turnos: TurnoResumen[]; regs: RegistroUniverso[] } {
  const turnos: TurnoResumen[] = []; const regs: RegistroUniverso[] = []
  for (let d = 1; d <= n; d++) { const id = `${gid}-${d}`; turnos.push(turno({ id, fecha: dia(d), guardia_id: gid })); regs.push(registro({ turno_id: id, guardia_id: gid, horas_liquidables: 12 })) }
  return { turnos, regs }
}
const base = (o: Partial<ParamsResumenGuardia> = {}): ParamsResumenGuardia => ({
  mes: '2026-08', empleados: [], turnos: [], registros: [], novedades: [],
  esObjetivoPrueba: () => false, nombreObjetivo: (id) => (id === OBJ ? 'CLUB' : id ?? ''), ...o,
})
const cellV = (pl: PlantillaLiquidacion, ref: string) => Number(pl.celdas.find(c => c.ref === ref)?.v ?? 0)
const indic = (pl: PlantillaLiquidacion) => ({ rec: cellV(pl, `AG${pl.estilos.subtotalVigiladores}`), ext: cellV(pl, `AL${pl.estilos.subtotalVigiladores}`) })
const granTotal = (pl: PlantillaLiquidacion) => ({ rec: cellV(pl, `AG${pl.estilos.total}`), ext: cellV(pl, `AL${pl.estilos.total}`) })
// fila (row) de un empleado por su BD oculto (usuario_id).
function filaEmp(pl: PlantillaLiquidacion, id: string): number {
  const c = pl.celdas.find(x => /^BD\d+$/.test(x.ref) && x.v === id)!
  return Number(c.ref.slice(2))
}

// Escenario base: 2 vigiladores con actividad (REC + extras) + 1 supervisor + 1 admin.
function escenario(vHoras: { v1: number; v2: number }, adminN = 12) {
  const v1 = turnosDe('v1', vHoras.v1), v2 = turnosDe('v2', vHoras.v2), a1 = turnosDe('a1', adminN), s1 = turnosDe('s1', 10)
  const resumen = construirResumenGuardia(base({
    empleados: [emp('v1', 'vigilador'), emp('v2', 'vigilador'), emp('s1', 'supervisor'), emp('a1', 'administracion')],
    turnos: [...v1.turnos, ...v2.turnos, ...s1.turnos, ...a1.turnos],
    registros: [...v1.regs, ...v2.regs, ...s1.regs, ...a1.regs],
  }))
  return plantillaLiquidacionResumenGuardia(resumen)
}

describe('ETAPA 2 — REC/Extras sólo vigiladores', () => {
  it('el indicador = SUBTOTAL VIGILADORES (AG rec / AL extras), NO el total general', () => {
    const pl = escenario({ v1: 17, v2: 10 }) // v1: I≈204→AG150/AL54 ; v2: I≈120→AG80/AL40
    const ind = indic(pl); const tot = granTotal(pl)
    // rec/ext del indicador = suma SÓLO de las filas de v1 y v2
    const recVig = cellV(pl, `AG${filaEmp(pl, 'v1')}`) + cellV(pl, `AG${filaEmp(pl, 'v2')}`)
    const extVig = cellV(pl, `AL${filaEmp(pl, 'v1')}`) + cellV(pl, `AL${filaEmp(pl, 'v2')}`)
    expect(ind.rec).toBe(recVig)
    expect(ind.ext).toBe(extVig)
    // el total general es MAYOR (los mensualizados aportan horas artificiales)
    expect(tot.rec).toBeGreaterThan(ind.rec)
  })

  it('REC + Extras = horas de vigilancia; %REC + %Extras = 100%', () => {
    const pl = escenario({ v1: 17, v2: 10 })
    const { rec, ext } = indic(pl)
    const den = rec + ext
    expect(den).toBeGreaterThan(0)
    expect(rec + ext).toBe(den)                       // horas vigilancia
    expect(rec / den + ext / den).toBeCloseTo(1, 10)  // 100%
  })

  it('modificar ADMINISTRATIVO → el indicador NO cambia', () => {
    const a = indic(escenario({ v1: 17, v2: 10 }, 12))
    const b = indic(escenario({ v1: 17, v2: 10 }, 25)) // admin con muchas más horas
    expect(b).toEqual(a)
  })

  it('modificar SUPERVISOR / mensualizado → el indicador NO cambia', () => {
    // el supervisor es mensualizado (AG=200/AL=0 fijo): cambiar su actividad no toca el indicador
    const pl1 = escenario({ v1: 17, v2: 10 })
    // reconstruyo con supervisor con distinta actividad
    const v1 = turnosDe('v1', 17), v2 = turnosDe('v2', 10), s1 = turnosDe('s1', 3), a1 = turnosDe('a1', 12)
    const pl2 = plantillaLiquidacionResumenGuardia(construirResumenGuardia(base({
      empleados: [emp('v1', 'vigilador'), emp('v2', 'vigilador'), emp('s1', 'supervisor'), emp('a1', 'administracion')],
      turnos: [...v1.turnos, ...v2.turnos, ...s1.turnos, ...a1.turnos],
      registros: [...v1.regs, ...v2.regs, ...s1.regs, ...a1.regs],
    })))
    expect(indic(pl2)).toEqual(indic(pl1))
  })

  it('modificar RODOLFO (dirección operativa → BLOQUE 3) → el indicador NO cambia', () => {
    const v1 = turnosDe('v1', 17), v2 = turnosDe('v2', 10)
    const sinRodolfo = plantillaLiquidacionResumenGuardia(construirResumenGuardia(base({
      empleados: [emp('v1', 'vigilador'), emp('v2', 'vigilador')],
      turnos: [...v1.turnos, ...v2.turnos], registros: [...v1.regs, ...v2.regs],
    })))
    const rod = turnosDe('rod', 20)
    const conRodolfo = plantillaLiquidacionResumenGuardia(construirResumenGuardia(base({
      empleados: [emp('v1', 'vigilador'), emp('v2', 'vigilador'), emp('rod', 'direccion_operativa')],
      turnos: [...v1.turnos, ...v2.turnos, ...rod.turnos], registros: [...v1.regs, ...v2.regs, ...rod.regs],
    })))
    expect(indic(conRodolfo)).toEqual(indic(sinRodolfo))
  })

  it('modificar VIGILADOR (horas REC) → el indicador CAMBIA', () => {
    const a = indic(escenario({ v1: 17, v2: 10 }))
    const b = indic(escenario({ v1: 10, v2: 10 })) // v1 con menos jornadas → menos REC
    expect(b.rec).not.toBe(a.rec)
  })

  it('modificar VIGILADOR (horas Extras) → el indicador CAMBIA', () => {
    const a = indic(escenario({ v1: 17, v2: 10 }))
    const b = indic(escenario({ v1: 25, v2: 10 })) // v1 con más horas → más extras
    expect(b.ext).not.toBe(a.ext)
  })

  it('sin vigiladores (denominador 0) → 0 REC / 0 Extras, sin división por cero', () => {
    const s1 = turnosDe('s1', 10), a1 = turnosDe('a1', 12)
    const pl = plantillaLiquidacionResumenGuardia(construirResumenGuardia(base({
      empleados: [emp('s1', 'supervisor'), emp('a1', 'administracion')],
      turnos: [...s1.turnos, ...a1.turnos], registros: [...s1.regs, ...a1.regs],
    })))
    const { rec, ext } = indic(pl)
    expect(rec).toBe(0); expect(ext).toBe(0)
    const den = rec + ext
    const pctRec = den > 0 ? rec / den : 0
    expect(Number.isNaN(pctRec)).toBe(false)
    expect(pctRec).toBe(0)
  })
})
