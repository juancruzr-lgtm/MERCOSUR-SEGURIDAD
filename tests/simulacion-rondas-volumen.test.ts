import { describe, expect, it } from 'vitest'
import {
  compararModelos, detalleConVolumen, modeloA, modeloB, modeloC, modeloD, porcentaje,
} from '@/lib/simulacion-rondas-volumen'
import type { MuestraRondas } from '@/lib/simulacion-rondas-volumen'

// SIMULACIÓN — nada de esto toca la evaluación productiva.
//
// Los casos son los REALES de agosto 2026, medidos con la misma definición que
// usa `cumplimiento_rondas_por_empleado`: universo de rondas_ventanas_programadas
// vencidas, menos saneadas y pausadas. Los nombres se usan sólo como etiqueta
// del caso: la lógica no conoce a ninguno.

const m = (
  atribuibles: number, cumplidas: number,
  turnosConObligacion: number, turnosConIncumplimiento: number,
): MuestraRondas => ({ atribuibles, cumplidas, turnosConObligacion, turnosConIncumplimiento })

// ── Los casos de agosto ─────────────────────────────────────────────────────
// atribuibles = cumplidas + incumplidas (sin las excluidas)
const CASOS = {
  // 0 de 9 en UN turno. 23 turnos trabajados en el mes.
  oyola: m(9, 0, 1, 1),
  // 0 de 33 en CUATRO turnos, los cuatro incumplidos, sin ninguna exclusión.
  gomez: m(33, 0, 4, 4),
  // 19 de 52. 16 turnos con obligación, incumple en 3.
  pinero: m(52, 19, 16, 3),
  // 59 de 74. 25 turnos, incumple en 8.
  almada: m(74, 59, 25, 8),
  // 115 de 131 en 24 turnos, incumple en 6.
  bustamante: m(131, 115, 24, 6),
  // 46 de 61 en 11 turnos, incumple en 5.
  teran: m(61, 46, 11, 5),
}

describe('el hecho que motivó la revisión', () => {
  it('OYOLA y GOMEZ dan los dos 0 % — el porcentaje solo no los distingue', () => {
    expect(porcentaje(CASOS.oyola)).toBe(0)
    expect(porcentaje(CASOS.gomez)).toBe(0)
  })

  it('pero no son el mismo historial: 1 turno contra 4', () => {
    expect(CASOS.oyola.turnosConIncumplimiento).toBe(1)
    expect(CASOS.gomez.turnosConIncumplimiento).toBe(4)
  })

  it('el modelo productivo de hoy les aplica EXACTAMENTE la misma falta crítica', () => {
    expect(modeloA(CASOS.oyola).tope).toBe(4)
    expect(modeloA(CASOS.gomez).tope).toBe(4)
  })
})

describe('modelo A — porcentaje puro (productivo)', () => {
  it('bajo 50 % topea en 4', () => {
    expect(modeloA(CASOS.pinero).tope).toBe(4)
  })

  it('sobre 60 % no hay falta crítica', () => {
    expect(modeloA(CASOS.almada).tope).toBeNull()
    expect(modeloA(CASOS.bustamante).tope).toBeNull()
    expect(modeloA(CASOS.teran).tope).toBeNull()
  })

  it('con menos de 8 rondas atribuibles no se exige nada', () => {
    expect(modeloA(m(6, 0, 1, 1)).tope).toBeNull()
    expect(modeloA(m(6, 0, 1, 1)).hecho).toContain('insuficiente')
  })

  it('entre 50 y 60 el tope es 6', () => {
    expect(modeloA(m(100, 55, 10, 5)).tope).toBe(6)
  })

  it('sin nada atribuible el porcentaje es null y no hay falta', () => {
    const vacio = modeloA(m(0, 0, 3, 0))
    expect(vacio.porcentaje).toBeNull()
    expect(vacio.tope).toBeNull()
  })
})

describe('modelo B — mínimo de turnos con obligación', () => {
  it('saca a OYOLA de la falta crítica: tuvo obligación en un solo turno', () => {
    expect(modeloB(CASOS.oyola).tope).toBeNull()
  })

  it('deja a GOMEZ adentro', () => {
    expect(modeloB(CASOS.gomez).tope).toBe(4)
  })

  it('SU PROBLEMA: un turno largo con todo incumplido queda impune', () => {
    // 16 rondas exigibles en un solo turno, ninguna hecha. Existe en agosto:
    // los turnos de 15:00-23:00 con ronda cada media hora.
    const unTurnoLargo = m(16, 0, 1, 1)
    expect(modeloA(unTurnoLargo).tope).toBe(4)
    expect(modeloB(unTurnoLargo).tope).toBeNull()
    // El modelo D lo trata igual que B acá, y es el mismo reparo. Se documenta
    // en la recomendación: ninguno de los dos castiga el turno único.
  })
})

describe('modelo C — severidad por porcentaje y reincidencia', () => {
  it('a OYOLA le baja el tope de 4 a 6 en vez de sacárselo', () => {
    expect(modeloC(CASOS.oyola).tope).toBe(6)
  })

  it('GOMEZ, con 4 turnos incumplidos, se queda en 4', () => {
    expect(modeloC(CASOS.gomez).tope).toBe(4)
  })

  it('PIÑERO, 36 % en 3 turnos, también se queda en 4', () => {
    expect(modeloC(CASOS.pinero).tope).toBe(4)
  })

  it('nombra si es patrón o episodio, que es lo que se quería poder leer', () => {
    expect(modeloC(CASOS.gomez).hecho).toContain('patrón reiterado')
    expect(modeloC(CASOS.oyola).hecho).toContain('incumplimiento concentrado')
  })
})

describe('modelo D — la falta crítica exige reincidencia (propuesta)', () => {
  it('OYOLA: sin falta crítica, pero la nota de Rondas sigue siendo 0 %', () => {
    const r = modeloD(CASOS.oyola)
    expect(r.tope).toBeNull()
    expect(r.porcentaje).toBe(0)
    expect(r.hecho).toContain('no alcanza para topear el mes')
  })

  it('GOMEZ: falta crítica con tope 4 — cuatro turnos distintos son un patrón', () => {
    expect(modeloD(CASOS.gomez).tope).toBe(4)
  })

  it('PIÑERO: falta crítica — 3 turnos incumplidos', () => {
    expect(modeloD(CASOS.pinero).tope).toBe(4)
  })

  it('dos turnos ya alcanzan: no hace falta media quincena', () => {
    expect(modeloD(m(20, 0, 2, 2)).tope).toBe(4)
  })

  it('no premia tener pocos turnos: con 1 turno y 0 % el porcentaje sigue en 0', () => {
    expect(modeloD(m(16, 0, 1, 1)).porcentaje).toBe(0)
  })
})

describe('lo que NINGÚN modelo debe hacer', () => {
  it('ninguno convierte un 0 % en un buen resultado', () => {
    const r = compararModelos(CASOS.oyola)
    for (const clave of ['A', 'B', 'C', 'D'] as const) {
      expect(r[clave].porcentaje).toBe(0)
    }
  })

  it('ninguno le saca la falta crítica a quien incumple en varios turnos', () => {
    const r = compararModelos(CASOS.gomez)
    for (const clave of ['A', 'B', 'C', 'D'] as const) {
      expect(r[clave].tope).not.toBeNull()
    }
  })

  it('ninguno inventa una falta donde el porcentaje es bueno', () => {
    const r = compararModelos(CASOS.bustamante)
    for (const clave of ['A', 'B', 'C', 'D'] as const) {
      expect(r[clave].tope).toBeNull()
    }
  })
})

describe('la línea que pide la orden de trabajo', () => {
  it('muestra el volumen además del porcentaje', () => {
    expect(detalleConVolumen(CASOS.oyola)).toBe(
      '0/9 realizadas · 0 %\n'
      + 'Obligación distribuida en 1 turno.\n'
      + 'Incumplimiento en 1 de 1 turno evaluados.',
    )
  })

  it('el mismo 0 % con 4 turnos se lee distinto', () => {
    expect(detalleConVolumen(CASOS.gomez)).toContain('Obligación distribuida en 4 turnos.')
    expect(detalleConVolumen(CASOS.gomez)).toContain('Incumplimiento en 4 de 4 turnos')
  })
})
