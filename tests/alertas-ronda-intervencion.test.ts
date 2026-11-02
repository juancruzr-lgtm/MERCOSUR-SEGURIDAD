import { describe, expect, it } from 'vitest'
import {
  alertaEsperaIntervencion, clavesRondaTurnoSilenciadas, etiquetaSeguimiento, faltaParaRegistrar,
  motivosParaResultado, seguimientoVencido, type AlertaRondaTurno,
} from '@/lib/alertas-ronda-intervencion'
import { seleccionarCandidatosRondaVigilador, minutosAbs } from '@/lib/ronda-vigilador-wa'
import { mensajeContextoResolverAlerta } from '@/lib/rondas'

const AHORA = Date.parse('2026-10-07T15:00:00Z')

describe('formulario de intervención', () => {
  const base = { comentario: '', accion: 'llamada_vigilador', seguimientoMin: 120 }
  it('exige resultado y motivo', () => {
    expect(faltaParaRegistrar({ ...base, resultado: null, motivo: null })).toMatch(/resultado/)
    expect(faltaParaRegistrar({ ...base, resultado: 'resuelto', motivo: null })).toMatch(/motivo/)
    expect(faltaParaRegistrar({ ...base, resultado: 'resuelto', motivo: 'ronda_realizada' })).toBeNull()
  })
  it('mismas combinaciones que el servidor', () => {
    expect(faltaParaRegistrar({ ...base, resultado: 'no_resuelto', motivo: 'ronda_realizada' })).not.toBeNull()
    expect(faltaParaRegistrar({ ...base, resultado: 'resuelto', motivo: 'incumplimiento' })).not.toBeNull()
    expect(faltaParaRegistrar({ ...base, accion: 'justificacion', resultado: 'no_resuelto', motivo: 'incumplimiento' })).not.toBeNull()
    expect(faltaParaRegistrar({ ...base, accion: 'cierre_administrativo', resultado: 'seguimiento', motivo: 'error_tecnico' })).not.toBeNull()
    expect(faltaParaRegistrar({ ...base, accion: 'cierre_administrativo', resultado: 'resuelto', motivo: 'error_tecnico', comentario: 'corto' })).toMatch(/10/)
    expect(faltaParaRegistrar({ ...base, resultado: 'resuelto', motivo: 'otro' })).toMatch(/Otro/)
    expect(faltaParaRegistrar({ ...base, resultado: 'seguimiento', motivo: 'error_tecnico', seguimientoMin: 300 })).toMatch(/4 horas/)
  })
  it('los motivos ofrecidos son siempre válidos para su resultado', () => {
    for (const r of ['resuelto', 'seguimiento', 'no_resuelto'] as const) {
      for (const m of motivosParaResultado(r)) {
        expect(faltaParaRegistrar({ ...base, resultado: r, motivo: m, comentario: m === 'otro' ? 'x' : '' })).toBeNull()
      }
    }
  })
})

describe('cartel: qué espera intervención', () => {
  it('pendiente sin intervención → sí', () => {
    expect(alertaEsperaIntervencion({ estado: 'pendiente', intervenciones: 0 }, AHORA)).toBe(true)
  })
  it('resuelta → no', () => {
    expect(alertaEsperaIntervencion({ estado: 'resuelta', resultado_intervencion: 'no_resuelto' }, AHORA)).toBe(false)
  })
  it('en seguimiento vigente → no; vencido → sí', () => {
    const vigente = { estado: 'pendiente', resultado_intervencion: 'seguimiento' as const, seguimiento_hasta: new Date(AHORA + 60000).toISOString() }
    const vencido = { ...vigente, seguimiento_hasta: new Date(AHORA - 60000).toISOString() }
    expect(alertaEsperaIntervencion(vigente, AHORA)).toBe(false)
    expect(alertaEsperaIntervencion(vencido, AHORA)).toBe(true)
    expect(seguimientoVencido(vencido, AHORA)).toBe(true)
  })
  it('el servidor manda: seguimiento_vencido explícito gana', () => {
    expect(seguimientoVencido({ estado: 'pendiente', resultado_intervencion: 'seguimiento', seguimiento_vencido: true, seguimiento_hasta: new Date(AHORA + 1e6).toISOString() }, AHORA)).toBe(true)
  })
  it('etiqueta del seguimiento', () => {
    const a = { estado: 'pendiente', resultado_intervencion: 'seguimiento' as const, seguimiento_hasta: new Date(AHORA + 60000).toISOString() }
    expect(etiquetaSeguimiento(a, () => '12:01', AHORA)).toBe('En seguimiento hasta las 12:01')
    expect(etiquetaSeguimiento({ ...a, seguimiento_hasta: new Date(AHORA - 1).toISOString() }, () => '', AHORA)).toMatch(/vencido/)
  })
})

describe('recordatorios al vigilador: se callan con intervención', () => {
  const al = (x: Partial<AlertaRondaTurno>): AlertaRondaTurno => ({ ronda_base_id: 'r', turno_id: 't', tipo: 'no_iniciada', estado: 'pendiente', ...x })
  it('pendiente sin intervención no silencia', () => {
    expect(clavesRondaTurnoSilenciadas([al({})]).size).toBe(0)
  })
  it('pendiente con acción (llamada, seguimiento) silencia', () => {
    expect(clavesRondaTurnoSilenciadas([al({ accion: 'llamada_vigilador' })]).has('r:t')).toBe(true)
  })
  it('no resuelto o resuelto que cubre el turno silencia; resuelto por ronda realizada no', () => {
    expect(clavesRondaTurnoSilenciadas([al({ estado: 'resuelta', resultado_intervencion: 'no_resuelto' })]).has('r:t')).toBe(true)
    expect(clavesRondaTurnoSilenciadas([al({ estado: 'resuelta', resultado_intervencion: 'resuelto', motivo_intervencion: 'error_tecnico' })]).has('r:t')).toBe(true)
    expect(clavesRondaTurnoSilenciadas([al({ estado: 'resuelta', resultado_intervencion: 'resuelto', motivo_intervencion: 'ronda_realizada' })]).size).toBe(0)
  })
  it('suspendida no entra (tiene su propia regla)', () => {
    expect(clavesRondaTurnoSilenciadas([al({ tipo: 'suspendida', accion: 'llamada_vigilador' })]).size).toBe(0)
  })
  it('WhatsApp +10: una ronda silenciada no es candidata', () => {
    const p = {
      ahoraMin: minutosAbs('2026-10-07', '10:15'),
      turnosVigentes: [{ id: 't', guardia_id: 'g', puesto_id: 'p', objetivo_id: 'o', fecha: '2026-10-07', hora_inicio: '06:00', hora_fin: '18:00' }],
      rondasBase: [{ id: 'r', puesto_id: 'p', nombre: 'R', hora_inicio: null, intervalo_minutos: 60 }],
      ejecuciones: [], pausas: [], objetivos: [{ id: 'o', nombre: 'O' }], avisoMin: 10,
    }
    expect(seleccionarCandidatosRondaVigilador(p)).toHaveLength(1)
    expect(seleccionarCandidatosRondaVigilador({ ...p, silenciadasClaves: new Set(['r:t']) })).toHaveLength(0)
  })
})

describe('mensajes de contexto nuevos', () => {
  it('conflicto, duplicada y seguimiento', () => {
    expect(mensajeContextoResolverAlerta('duplicada')).toBeNull()
    expect(mensajeContextoResolverAlerta('seguimiento')).toBeNull()
    expect(mensajeContextoResolverAlerta('conflicto')).toMatch(/otra persona|cambió/)
    expect(mensajeContextoResolverAlerta('requiere_resultado_definitivo')).toMatch(/definitivo/)
  })
})
