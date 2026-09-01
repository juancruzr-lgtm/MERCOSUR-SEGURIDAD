import { describe, expect, it } from 'vitest'
import {
  NIVEL_RONDA, PLANTILLA_RONDA, claveDedupRonda, datosDeRonda, decidirRonda,
  horarioVentana, textoMensajeRonda, variablesRondaParaPlantilla,
} from '@/lib/escalamiento-ronda'
import type { RondaAlertaEscalable } from '@/lib/escalamiento-ronda'

// El detector NO está acá: evaluar_ronda_alertas() decide en la base qué
// ventana quedó incumplida y ya excluye rondas pausadas (cualquier causa:
// técnica, capacitación, no aplica), objetivos pausados y de prueba, turnos
// anulados y ausencias — esas alertas directamente NO EXISTEN como pendientes,
// y una ronda iniciada no genera alerta. Estos tests cubren lo que este módulo
// sí decide: qué alertas ya persistidas escalan por WhatsApp, con qué clave de
// deduplicación y con qué mensaje.

const alerta = (o: Partial<RondaAlertaEscalable> = {}): RondaAlertaEscalable => ({
  id: 'alerta-1',
  tipo: 'no_iniciada',
  estado: 'pendiente',
  objetivo_id: 'obj-1',
  puesto_id: 'puesto-1',
  turno_id: 'turno-1',
  guardia_id: 'guardia-1',
  // 23:00Z = 20:00 en Argentina (UTC-3).
  ventana_inicio: '2026-09-01T23:00:00Z',
  ventana_fin: '2026-09-02T00:00:00Z',
  ...o,
})

describe('qué alerta escala', () => {
  it('alerta pendiente de ronda no iniciada en objetivo activo → escala', () => {
    expect(decidirRonda(alerta(), { objetivo: { estado: 'activo' } })).toEqual({ escala: true })
  })

  it('alerta resuelta → no (la atendió un supervisor, no hay nada que escalar)', () => {
    const d = decidirRonda(alerta({ estado: 'resuelta' }), { objetivo: { estado: 'activo' } })
    expect(d).toEqual({ escala: false, motivo: 'alerta_resuelta' })
  })

  it('objetivo de prueba → no, aunque la alerta haya quedado pendiente', () => {
    const d = decidirRonda(alerta(), { objetivo: { estado: 'activo', es_prueba: true } })
    expect(d).toEqual({ escala: false, motivo: 'objetivo_es_prueba' })
  })

  it('objetivo pausado o inactivo después de creada la alerta → no', () => {
    for (const estado of ['pausado', 'inactivo']) {
      const d = decidirRonda(alerta(), { objetivo: { estado } })
      expect(d).toEqual({ escala: false, motivo: 'objetivo_no_operativo' })
    }
  })

  it('sólo escala no_iniciada: suspendida y no_finalizada tienen su push y no son de esta fase', () => {
    for (const tipo of ['suspendida', 'no_finalizada']) {
      const d = decidirRonda(alerta({ tipo }), { objetivo: { estado: 'activo' } })
      expect(d).toEqual({ escala: false, motivo: 'tipo_no_escalable' })
    }
  })

  it('sin dato de objetivo se asume operativo: no se silencia una alerta por las dudas', () => {
    expect(decidirRonda(alerta(), { objetivo: null })).toEqual({ escala: true })
  })
})

describe('deduplicación ligada a la alerta real', () => {
  it('la misma alerta produce siempre la misma clave: la próxima corrida no repite', () => {
    expect(claveDedupRonda(alerta())).toBe(claveDedupRonda(alerta()))
    expect(claveDedupRonda(alerta())).toBe('escalamiento_wa_ronda_no_iniciada:alerta-1')
  })

  it('una alerta distinta (otra ventana, otro día) tiene otra clave y se avisa normalmente', () => {
    expect(claveDedupRonda(alerta({ id: 'alerta-2' }))).not.toBe(claveDedupRonda(alerta()))
  })

  it('la clave embebe el nivel: no choca con la deduplicación del push de rondas', () => {
    // El push usa 'supervisor_ronda_no_iniciada:<id>' sobre la misma tabla:
    // ambos canales conviven sin taparse mutuamente.
    expect(claveDedupRonda(alerta()).startsWith(NIVEL_RONDA)).toBe(true)
    expect(NIVEL_RONDA).not.toContain('supervisor_ronda')
  })
})

describe('la ventana programada, en hora de la operación', () => {
  it('convierte el timestamptz a hora argentina', () => {
    expect(horarioVentana('2026-09-01T23:00:00Z', '2026-09-02T00:00:00Z')).toBe('20:00–21:00')
  })

  it('una ventana nocturna que cruza medianoche local se muestra tal cual', () => {
    // 02:30Z = 23:30 del día anterior en Argentina.
    expect(horarioVentana('2026-09-02T02:30:00Z', '2026-09-02T03:30:00Z')).toBe('23:30–00:30')
  })

  it('sin datos no inventa un horario', () => {
    expect(horarioVentana(null, null)).toBe('Sin horario')
    expect(horarioVentana('no es una fecha', null)).toBe('Sin horario')
  })
})

describe('el mensaje y sus variables', () => {
  const datos = datosDeRonda({
    objetivo: 'NACION ENTRE RIOS', ronda: 'Ronda perimetral',
    horario: '20:00–21:00', vigilador: 'PEREZ, JUAN',
  })

  it('la plantilla recibe exactamente 4 variables, en el orden {{1}} objetivo, {{2}} ronda, {{3}} horario, {{4}} vigilador', () => {
    expect(variablesRondaParaPlantilla(datos)).toEqual([
      'NACION ENTRE RIOS', 'Ronda perimetral', '20:00–21:00', 'PEREZ, JUAN',
    ])
  })

  it('la plantilla tiene el nombre que se va a pedir en Meta', () => {
    expect(PLANTILLA_RONDA).toBe('ronda_no_iniciada')
  })

  it('el texto dice el hecho y usa las mismas 4 variables', () => {
    const t = textoMensajeRonda(datos)
    expect(t).toContain('NACION ENTRE RIOS')
    expect(t).toContain('Ronda perimetral')
    expect(t).toContain('20:00–21:00')
    expect(t).toContain('PEREZ, JUAN')
    expect(t).toContain('no fue iniciada')
    expect(t).not.toMatch(/abandon|negligen|sanci/i)
  })

  it('lo que falta no se inventa: se dice que falta', () => {
    const d = datosDeRonda({})
    expect(variablesRondaParaPlantilla(d)).toEqual([
      'Objetivo sin nombre', 'Ronda sin nombre', 'Sin horario', 'Sin vigilador asignado',
    ])
  })
})
