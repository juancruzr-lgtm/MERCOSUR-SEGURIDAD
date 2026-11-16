import { describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => new Proxy({}, { get: () => () => ({ data: { subscription: { unsubscribe() {} } } }) }),
}))

import { casosDesdeFuentes, finTurnoMs, instanteAr, type Fuentes } from '@/lib/tablero-gerencia/fuentes'
import { CATALOGO_REGLAS, reglasQueDetectan } from '@/lib/tablero-gerencia/reglas'
import { rangoMes, mesAnterior } from '@/lib/tablero-gerencia/cargar'

const EXISTENTES = new Set(reglasQueDetectan(CATALOGO_REGLAS, new Set()).map(r => r.codigo))
const AHORA = '2026-11-16T15:00:00.000Z' // 12:00 hora argentina

function base(p: Partial<Fuentes> = {}): Fuentes {
  return {
    ahoraIso: AHORA,
    turnos: [],
    registros: [],
    objetivos: [
      { id: 'o1', nombre: 'RANDSTAD', cliente: 'Randstad', zona_id: 'z1', estado: 'activo', radio_metros: 100, lat: -32.9, lng: -60.6, frecuencia_supervision_horas: 168 },
      { id: 'o2', nombre: 'Radio chico', cliente: 'X', zona_id: 'z1', estado: 'activo', radio_metros: 10, lat: -32.9, lng: -60.6, frecuencia_supervision_horas: 168 },
      { id: 'op', nombre: 'Prueba', es_prueba: true, estado: 'activo' },
    ],
    intervenciones: [],
    rondaAlertas: [],
    salidas: [],
    ultimaSupervision: new Map([['o1', '2026-11-15T12:00:00.000Z'], ['o2', '2026-11-15T12:00:00.000Z']]),
    ...p,
  }
}

describe('hora argentina', () => {
  it('convierte fecha+hora local a UTC y cruza medianoche', () => {
    expect(new Date(instanteAr('2026-11-10', '06:00')).toISOString()).toBe('2026-11-10T09:00:00.000Z')
    expect(new Date(finTurnoMs({ fecha: '2026-11-10', hora_inicio: '22:00', hora_fin: '06:00' })).toISOString()).toBe('2026-11-11T09:00:00.000Z')
  })
  it('rangos de mes', () => {
    expect(rangoMes('2026-12')).toEqual({ desde: '2026-12-01', hastaExcl: '2027-01-01' })
    expect(mesAnterior('2026-01')).toBe('2025-12')
  })
})

describe('casos desde las fuentes existentes', () => {
  it('turno terminado sin entrada = sin fichaje; con ausencia no', () => {
    const c = casosDesdeFuentes(base({
      turnos: [
        { id: 't1', objetivo_id: 'o1', guardia_id: 'e1', fecha: '2026-11-10', hora_inicio: '06:00', hora_fin: '18:00', estado: 'programado' },
        { id: 't2', objetivo_id: 'o1', guardia_id: 'e2', fecha: '2026-11-10', hora_inicio: '06:00', hora_fin: '18:00', estado: 'programado' },
        { id: 't3', objetivo_id: 'o1', guardia_id: 'e3', fecha: '2026-11-10', hora_inicio: '06:00', hora_fin: '18:00', estado: 'anulado' },
        { id: 't4', objetivo_id: 'op', guardia_id: 'e4', fecha: '2026-11-10', hora_inicio: '06:00', hora_fin: '18:00', estado: 'programado' },
      ],
      registros: [{ id: 'r2', turno_id: 't2', guardia_id: 'e2', tipo_registro: 'ausencia' }],
    }), EXISTENTES)
    expect(c.filter(x => x.tipo === 'sin_fichaje').map(x => x.turnoId)).toEqual(['t1'])
    expect(c[0].clave).toBe('ASI-01|t1')
    expect(c[0].estado).toBe('detectado')
  })

  it('fuera de radio en objetivo con radio de 10 m es causa de configuración', () => {
    const c = casosDesdeFuentes(base({
      turnos: [{ id: 't1', objetivo_id: 'o2', guardia_id: 'e1', fecha: '2026-11-10', hora_inicio: '06:00', hora_fin: '18:00', estado: 'programado' }],
      registros: [{ id: 'r1', turno_id: 't1', guardia_id: 'e1', hora_entrada_real: '06:00', hora_salida_real: '18:00', gps_ingreso_estado: 'fuera_radio' }],
    }), EXISTENTES)
    const gps = c.find(x => x.tipo === 'gps_fuera_radio')!
    expect(gps.clave).toBe('ASI-05|r1')
    expect(gps.causa).toBe('configuracion')
  })

  it('una intervención existente pasa el caso a revisión y queda en el historial', () => {
    const c = casosDesdeFuentes(base({
      turnos: [{ id: 't1', objetivo_id: 'o1', guardia_id: 'e1', fecha: '2026-11-10', hora_inicio: '06:00', hora_fin: '18:00', estado: 'programado' }],
      registros: [{ id: 'r1', turno_id: 't1', guardia_id: 'e1', hora_entrada_real: '06:40', hora_salida_real: '18:00', alerta_entrada: 'tarde', gps_ingreso_estado: 'dentro_radio' }],
      intervenciones: [{ id: 'i1', turno_id: 't1', registro_asistencia_id: 'r1', tipo_alerta: 'tardanza', accion: 'alerta_revisada', comentario: 'Avisó por colectivo', supervisor_id: 's1', created_at: '2026-11-10T10:00:00.000Z' }],
    }), EXISTENTES)
    const t = c.find(x => x.tipo === 'ingreso_tardio')!
    expect(t.estado).toBe('en_revision')
    expect(t.eventos).toHaveLength(1)
    expect(t.eventos[0].comentario).toContain('Avisó por colectivo')
  })

  it('sin salida es regla propuesta: no aparece hasta aprobarla', () => {
    const f = base({
      turnos: [{ id: 't1', objetivo_id: 'o1', guardia_id: 'e1', fecha: '2026-11-10', hora_inicio: '06:00', hora_fin: '18:00', estado: 'programado' }],
      registros: [{ id: 'r1', turno_id: 't1', guardia_id: 'e1', hora_entrada_real: '06:00', gps_ingreso_estado: 'dentro_radio' }],
    })
    expect(casosDesdeFuentes(f, EXISTENTES).some(x => x.tipo === 'sin_salida')).toBe(false)
    expect(casosDesdeFuentes(f, new Set(Array.from(EXISTENTES).concat('ASI-04'))).some(x => x.tipo === 'sin_salida')).toBe(true)
  })

  it('rondas, salidas y supervisiones vencidas', () => {
    const c = casosDesdeFuentes(base({
      turnos: [{ id: 't1', objetivo_id: 'o1', guardia_id: 'e1', fecha: '2026-11-10', hora_inicio: '06:00', hora_fin: '18:00', estado: 'programado' }],
      registros: [{ id: 'r1', turno_id: 't1', guardia_id: 'e1', hora_entrada_real: '06:00', hora_salida_real: '17:00' }],
      rondaAlertas: [
        { id: 'a1', objetivo_id: 'o1', turno_id: 't1', guardia_id: 'e1', tipo: 'no_iniciada', ventana_inicio: '2026-11-10T12:00:00Z', estado: 'pendiente', detectada_at: '2026-11-10T12:30:00Z' },
        { id: 'a2', objetivo_id: 'o1', turno_id: 't1', guardia_id: 'e1', tipo: 'no_iniciada', ventana_inicio: '2026-11-10T14:00:00Z', estado: 'resuelta', accion: 'cierre_administrativo', detectada_at: '2026-11-10T14:30:00Z', resuelta_at: '2026-11-10T15:00:00Z' },
      ],
      salidas: [{ id: 's1', registro_id: 'r1', turno_id: 't1', empleado_id: 'e1', objetivo_id: 'o1', fecha: '2026-11-10', minutos_antes: 60, estado: 'detectada', detectada_at: '2026-11-10T20:00:00Z' }],
      ultimaSupervision: new Map([['o1', '2026-10-01T12:00:00.000Z']]),
    }), EXISTENTES)
    const rondas = c.filter(x => x.tipo === 'ronda_incumplida')
    expect(rondas.map(r => r.estado)).toEqual(['detectado', 'descartado'])
    expect(rondas[1].causa).toBe('administrativa')
    expect(c.find(x => x.tipo === 'salida_anticipada')!.estado).toBe('detectado')
    const sup = c.filter(x => x.tipo === 'supervision_vencida').map(x => x.objetivoId).sort()
    expect(sup).toEqual(['o1', 'o2']) // o1 vencida, o2 nunca supervisado; el objetivo de prueba no cuenta
  })

  it('el caso guardado manda sobre el derivado (misma clave)', () => {
    const c = casosDesdeFuentes(base({
      turnos: [{ id: 't1', objetivo_id: 'o1', guardia_id: 'e1', fecha: '2026-11-10', hora_inicio: '06:00', hora_fin: '18:00', estado: 'programado' }],
      casosGuardados: [{ id: 'g1', clave: 'ASI-01|t1', estado: 'comunicado', responsableId: 's1', causa: 'indeterminada', plazoAt: null, eventos: [] } as never],
    }), EXISTENTES)
    const s = c.find(x => x.clave === 'ASI-01|t1')!
    expect(s).toMatchObject({ id: 'g1', estado: 'comunicado', responsableId: 's1' })
  })
})
