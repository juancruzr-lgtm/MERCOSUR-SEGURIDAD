import { describe, expect, it } from 'vitest'
import { evaluarSinFichar } from '@/lib/revision-operativa'
import { cubreElTurno, requiereRevision } from '@/lib/bandeja-planillas'
import { pendienteTurno, turnosOperativosDelMes } from '@/lib/liquidacion'

// El MISMO turno se resuelve en dos momentos distintos, con las mismas dos
// acciones y la misma RPC:
//
//   en curso   → Vista Supervisor, alerta sin_fichar
//   terminado  → Revisión de planillas, fila sin fichaje
//
// La bisagra es evaluarSinFichar: mientras el turno corre la alerta está
// vigente; cuando termina pasa a 'vencida' y la decisión se toma en la otra
// pantalla. Estos tests fijan que no queda un hueco entre los dos momentos —
// que fue exactamente lo que dejó agosto sin resolver.

const T = (over: any = {}) => ({
  id: 't1', objetivo_id: 'o1', guardia_id: 'g1',
  fecha: '2026-08-13', hora_inicio: '23:00:00', hora_fin: '07:00:00',
  estado: 'programado', ...over,
}) as any

const en = (iso: string) => new Date(Date.parse(iso))
const enCurso = en('2026-08-14T02:00:00-03:00')
const terminado = en('2026-08-14T09:00:00-03:00')

const filaBandeja = (over: any = {}) => ({
  turnoId: 't1', empleadoId: 'g1', registroId: null,
  vigilador: 'ROSÓN, JUAN RAMÓN', fecha: '2026-08-13',
  objetivoId: 'o1', objetivo: 'CLUB', puestoId: null, puesto: 'Principal',
  horario: '23:00–07:00', horaInicioProg: '23:00', horaFinProg: '07:00',
  entrada: null, salida: null, horas: 0,
  caracteristica: 'Normal', salidaAutomatica: false, tieneFichaje: false,
  estadoControl: 'pendiente' as const,
  solicitudId: null, solicitudTexto: null, solicitudEstado: null,
  revisado: false, derivado: false, observaciones: 0,
  ...over,
})

describe('momento 1 — turno en curso: la alerta decide', () => {
  it('sin fichaje y en curso: la alerta está vigente', () => {
    expect(evaluarSinFichar(T(), { tieneEntrada: false, ahora: enCurso })).toBe('vigente')
  })

  it('confirmada la asistencia, la alerta deja de corresponder', () => {
    expect(evaluarSinFichar(T({ estado: 'cubierto' }), { tieneEntrada: true, ahora: enCurso })).toBe('no_corresponde')
  })

  it('marcado ausente, la alerta también se cierra', () => {
    expect(evaluarSinFichar(T({ estado: 'ausente' }), { tieneEntrada: false, ahora: enCurso })).toBe('no_corresponde')
  })
})

describe('momento 2 — turno terminado: decide Revisión de planillas', () => {
  it('la alerta ya no es operativa', () => {
    // No se reabre: PR #24 se mantiene. El turno se resuelve en la bandeja.
    expect(evaluarSinFichar(T(), { tieneEntrada: false, ahora: terminado })).toBe('vencida')
  })

  it('y la fila aparece en la bandeja pidiendo decisión', () => {
    const f = filaBandeja()
    expect(f.tieneFichaje).toBe(false)
    expect(cubreElTurno(f as any)).toBe(false)
    expect(requiereRevision(f as any)).toBe(true)
  })

  it('confirmada desde la bandeja: el turno queda cubierto y sale del pendiente', () => {
    const f = filaBandeja({ tieneFichaje: true, registroId: 'r1', entrada: '23:00', salida: '07:00', horas: 8 })
    expect(cubreElTurno(f as any)).toBe(true)
    expect(requiereRevision(f as any)).toBe(false)
    expect(pendienteTurno(T({ estado: 'cubierto' }), { horas_liquidables: 8 } as any)).toBe(0)
  })

  it('ausente sin reemplazo: sigue en diferencia pendiente', () => {
    const t = T({ estado: 'ausente' })
    expect(turnosOperativosDelMes([t], { esObjetivoPrueba: () => false })).toHaveLength(1)
    expect(pendienteTurno(t, null)).toBe(8)
    const f = filaBandeja({ esAusencia: true, ausenciaVigilador: 'ROSÓN, JUAN RAMÓN' })
    expect(requiereRevision(f as any)).toBe(true)
  })

  it('ausente + reemplazo completo: pendiente cero y la ausencia sigue visible', () => {
    const t = T({ estado: 'ausente' })
    expect(pendienteTurno(t, { horas_liquidables: 8 } as any)).toBe(0)
    const f = filaBandeja({
      esAusencia: true, ausenciaVigilador: 'ROSÓN, JUAN RAMÓN',
      empleadoId: 'g2', vigilador: 'SANCHEZ, CÉSAR LUIS',
      tieneFichaje: true, registroId: 'r-cob', entrada: '23:00', salida: '07:00', horas: 8,
    })
    expect(f.ausenciaVigilador).toBe('ROSÓN, JUAN RAMÓN')
    expect(f.vigilador).toBe('SANCHEZ, CÉSAR LUIS')
    expect(requiereRevision(f as any)).toBe(false)
  })

  it('sin doble liquidación: el turno suma una vez', () => {
    // La ausencia aporta 0 y la cobertura 8. No hay forma de que sumen 16:
    // pendienteTurno se calcula contra las horas programadas del turno.
    expect(pendienteTurno(T({ estado: 'ausente' }), { horas_liquidables: 8 } as any)).toBe(0)
    expect(pendienteTurno(T({ estado: 'ausente' }), { horas_liquidables: 16 } as any)).toBe(0)
  })
})

describe('modificar turno no crea ausencia', () => {
  it('cambiar el vigilador deja el turno operativo, sin ausencia', () => {
    // La edición del turno es otro circuito: no toca registros_asistencia.
    const t = T({ guardia_id: 'g2', estado: 'programado' })
    expect(evaluarSinFichar(t, { tieneEntrada: false, ahora: enCurso })).toBe('vigente')
    expect(turnosOperativosDelMes([t], { esObjetivoPrueba: () => false })).toHaveLength(1)
  })
})
