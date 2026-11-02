import { describe, expect, it } from 'vitest'
import {
  CONFIG_VALIDACION_TURNOS,
  duracionHorasTurno,
  esErrorTurnoSuperpuesto,
  intervaloTurno,
  textoConfirmacionAdvertencias,
  validarCargaTurno,
  type TurnoCarga,
} from '@/lib/validacion-turnos'

// Caso real auditado (29/10/2026): Eduardo Martínez tenía SRT 07–15 y, a
// continuación, Polideportivo Lotuf 15–23. Son 0 minutos entre objetivos que
// están a ~2,7 km y una jornada de 16 h. La app no advirtió nada: el único
// control existente era la superposición estricta.
const EDU = 'edu'
const SRT = 'obj-srt'
const LOTUF = 'obj-lotuf'

const turno = (p: Partial<TurnoCarga> & Pick<TurnoCarga, 'fecha' | 'hora_inicio' | 'hora_fin'>): TurnoCarga => ({
  id: `${p.objetivo_id ?? 'x'}-${p.fecha}-${p.hora_inicio}`,
  guardia_id: EDU,
  objetivo_id: SRT,
  estado: 'programado',
  ...p,
})

const codigos = (hs: { codigo: string }[]) => hs.map(h => h.codigo).sort()

describe('validarCargaTurno — turnos consecutivos en objetivos distintos', () => {
  const srt = turno({ id: 'srt', objetivo_id: SRT, fecha: '2026-10-29', hora_inicio: '07:00', hora_fin: '15:00' })
  const lotuf = turno({ id: 'lotuf', objetivo_id: LOTUF, fecha: '2026-10-29', hora_inicio: '15:00', hora_fin: '23:00' })

  it('caso Eduardo: advierte traslado, doble turno y horas del día, sin bloquear', () => {
    const r = validarCargaTurno(lotuf, [srt])
    expect(r.errores).toEqual([])
    expect(codigos(r.advertencias)).toEqual(['horas_diarias_excedidas', 'jornada_excedida', 'traslado_insuficiente'])
    const traslado = r.advertencias.find(a => a.codigo === 'traslado_insuficiente')!
    expect(traslado.minutos).toBe(0)
    expect(traslado.turnoId).toBe('srt')
    expect(r.advertencias.find(a => a.codigo === 'jornada_excedida')!.horas).toBe(16)
  })

  it('el traslado es configurable: con 45 min entre turnos y 30 configurados no advierte; con 60 sí', () => {
    const tarde = turno({ id: 'l2', objetivo_id: LOTUF, fecha: '2026-10-29', hora_inicio: '15:45', hora_fin: '19:00' })
    const corta = turno({ id: 's2', objetivo_id: SRT, fecha: '2026-10-29', hora_inicio: '08:00', hora_fin: '15:00' })
    expect(validarCargaTurno(tarde, [corta]).advertencias.map(a => a.codigo)).not.toContain('traslado_insuficiente')
    const r = validarCargaTurno(tarde, [corta], { config: { minutosTraslado: 60 } })
    expect(r.advertencias.find(a => a.codigo === 'traslado_insuficiente')?.minutos).toBe(45)
  })

  it('mismo objetivo seguido no es traslado (pero sí doble turno si excede)', () => {
    const otro = turno({ id: 'srt2', objetivo_id: SRT, fecha: '2026-10-29', hora_inicio: '15:00', hora_fin: '23:00' })
    const r = validarCargaTurno(otro, [srt])
    expect(codigos(r.advertencias)).toEqual(['horas_diarias_excedidas', 'jornada_excedida'])
  })

  it('el turno anterior en otro objetivo también se detecta (sentido inverso)', () => {
    const r = validarCargaTurno(srt, [lotuf])
    expect(r.advertencias.map(a => a.codigo)).toContain('traslado_insuficiente')
  })
})

describe('validarCargaTurno — superposición (único bloqueo)', () => {
  it('rechaza el mismo vigilador en dos turnos simultáneos', () => {
    const a = turno({ id: 'a', fecha: '2026-10-29', hora_inicio: '07:00', hora_fin: '15:00' })
    const b = turno({ id: 'b', objetivo_id: LOTUF, fecha: '2026-10-29', hora_inicio: '14:00', hora_fin: '22:00' })
    const r = validarCargaTurno(b, [a])
    expect(r.errores.map(e => e.codigo)).toEqual(['superposicion'])
    expect(r.errores[0].turnoId).toBe('a')
  })

  it('turnos contiguos [07–15) y [15–23) no se superponen', () => {
    const a = turno({ id: 'a', fecha: '2026-10-29', hora_inicio: '07:00', hora_fin: '15:00' })
    const b = turno({ id: 'b', fecha: '2026-10-29', hora_inicio: '15:00', hora_fin: '23:00' })
    expect(validarCargaTurno(b, [a]).errores).toEqual([])
  })

  it('un nocturno del día anterior que sigue corriendo se superpone con uno temprano', () => {
    const noche = turno({ id: 'n', fecha: '2026-10-28', hora_inicio: '22:00', hora_fin: '06:00' })
    const temprano = turno({ id: 't', objetivo_id: LOTUF, fecha: '2026-10-29', hora_inicio: '05:00', hora_fin: '13:00' })
    expect(validarCargaTurno(temprano, [noche]).errores.map(e => e.codigo)).toEqual(['superposicion'])
  })

  it('ignora turnos reemplazados/anulados/cancelados, de otros vigiladores y de objetivos pausados', () => {
    const base = turno({ id: 'c', fecha: '2026-10-29', hora_inicio: '07:00', hora_fin: '15:00' })
    const existentes = [
      turno({ id: 'r', fecha: '2026-10-29', hora_inicio: '08:00', hora_fin: '12:00', estado: 'reemplazado' }),
      turno({ id: 'an', fecha: '2026-10-29', hora_inicio: '08:00', hora_fin: '12:00', estado: 'anulado' }),
      turno({ id: 'ca', fecha: '2026-10-29', hora_inicio: '08:00', hora_fin: '12:00', estado: 'cancelado' }),
      turno({ id: 'otro', guardia_id: 'otro', fecha: '2026-10-29', hora_inicio: '08:00', hora_fin: '12:00' }),
      turno({ id: 'p', objetivo_id: 'pausado', fecha: '2026-10-29', hora_inicio: '08:00', hora_fin: '12:00' }),
    ]
    expect(validarCargaTurno(base, existentes, { objetivosPausados: new Set(['pausado']) }).errores).toEqual([])
  })

  it('al editar se excluye el propio turno', () => {
    const a = turno({ id: 'a', fecha: '2026-10-29', hora_inicio: '07:00', hora_fin: '15:00' })
    const editado = { ...a, hora_fin: '16:00' }
    expect(validarCargaTurno(editado, [a], { excluirTurnoId: 'a' }).errores).toEqual([])
  })

  it('sin vigilador no hay nada que validar', () => {
    const libre = turno({ guardia_id: null, fecha: '2026-10-29', hora_inicio: '07:00', hora_fin: '15:00' })
    expect(validarCargaTurno(libre, [turno({ fecha: '2026-10-29', hora_inicio: '07:00', hora_fin: '15:00' })])).toEqual({ errores: [], advertencias: [] })
  })
})

describe('validarCargaTurno — descanso y horas del día', () => {
  it('descanso menor al mínimo entre jornadas', () => {
    const noche = turno({ id: 'n', fecha: '2026-10-29', hora_inicio: '15:00', hora_fin: '23:00' })
    const madrugada = turno({ id: 'm', fecha: '2026-10-30', hora_inicio: '07:00', hora_fin: '15:00' })
    const r = validarCargaTurno(madrugada, [noche])
    expect(r.advertencias.map(a => a.codigo)).toEqual(['descanso_insuficiente'])
    expect(r.advertencias[0].minutos).toBe(8 * 60)
  })

  it('con 12 h de descanso no advierte', () => {
    const a = turno({ id: 'a', fecha: '2026-10-29', hora_inicio: '07:00', hora_fin: '19:00' })
    const b = turno({ id: 'b', fecha: '2026-10-30', hora_inicio: '07:00', hora_fin: '19:00' })
    expect(validarCargaTurno(b, [a]).advertencias).toEqual([])
  })

  it('un 12 h nocturno pertenece entero al día de inicio y no excede el máximo', () => {
    const n = turno({ id: 'n', fecha: '2026-10-30', hora_inicio: '19:00', hora_fin: '07:00' })
    expect(validarCargaTurno(n, []).advertencias).toEqual([])
    expect(duracionHorasTurno(n)).toBe(12)
  })

  it('los umbrales son configurables (advertencias, nunca bloqueo)', () => {
    const a = turno({ id: 'a', fecha: '2026-10-29', hora_inicio: '07:00', hora_fin: '17:00' })
    const r = validarCargaTurno(a, [], { config: { maxHorasDia: 8 } })
    expect(r.errores).toEqual([])
    expect(r.advertencias.map(x => x.codigo)).toEqual(['horas_diarias_excedidas'])
    expect(CONFIG_VALIDACION_TURNOS.minutosTraslado).toBe(30)
  })
})

describe('intervaloTurno — medianoche y zona horaria', () => {
  it('19:00–07:00 termina al día siguiente y dura 12 h', () => {
    const r = intervaloTurno({ fecha: '2026-10-31', hora_inicio: '19:00', hora_fin: '07:00' })!
    expect((r.fin - r.inicio) / 60).toBe(12)
  })
  it('00:00–00:00 se toma como 24 h (mismo criterio que las RPC)', () => {
    expect(duracionHorasTurno({ fecha: '2026-10-31', hora_inicio: '00:00', hora_fin: '00:00' })).toBe(24)
  })
  it('no depende de la zona horaria del proceso', () => {
    const r = intervaloTurno({ fecha: '2026-10-29', hora_inicio: '15:00', hora_fin: '23:00' })!
    expect(r.inicio % 1440).toBe(15 * 60)
  })
})

describe('mensajes', () => {
  it('reconoce el error del trigger de base', () => {
    expect(esErrorTurnoSuperpuesto({ code: '23P01', message: 'x' })).toBe(true)
    expect(esErrorTurnoSuperpuesto({ message: 'TURNO_SUPERPUESTO: ...' })).toBe(true)
    expect(esErrorTurnoSuperpuesto({ message: 'otra cosa' })).toBe(false)
    expect(esErrorTurnoSuperpuesto(null)).toBe(false)
  })
  it('arma el texto de confirmación', () => {
    expect(textoConfirmacionAdvertencias([{ codigo: 'traslado_insuficiente', mensaje: 'M' }])).toContain('• M')
  })
})
