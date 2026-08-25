import { describe, expect, it } from 'vitest'
import {
  cuentaParaAprendizajeIA, esDecisionHumana, esSaneada, esperaRevision,
  salioDeLaBandeja,
} from '@/lib/ia/revision'
import { itemsDeFotosIA } from '@/lib/cierre-datos'
import { resumirCierre } from '@/lib/cierre-operativo'

// SANEADO: el estado que hizo falta para cerrar el backlog viejo sin mentir.
//
// CORRECTO habría inventado un incumplimiento del vigilador. INCORRECTO habría
// afirmado que la foto estaba bien. Las dos, además, habrían contaminado la
// medición de precisión con juicios que nadie emitió.

describe('qué significa cada estado', () => {
  it('sólo PENDIENTE espera una decisión', () => {
    expect(esperaRevision('PENDIENTE')).toBe(true)
    expect(esperaRevision('CORRECTO')).toBe(false)
    expect(esperaRevision('SANEADO')).toBe(false)
  })

  it('sin estado se asume pendiente: no se da por cerrado lo que no se sabe', () => {
    expect(esperaRevision(null)).toBe(true)
    expect(esperaRevision(undefined)).toBe(true)
  })

  it('decisión humana son dos, y saneado no es una de ellas', () => {
    expect(esDecisionHumana('CORRECTO')).toBe(true)
    expect(esDecisionHumana('INCORRECTO')).toBe(true)
    expect(esDecisionHumana('SANEADO')).toBe(false)
    expect(esDecisionHumana('PENDIENTE')).toBe(false)
  })

  it('saneada sale de la bandeja pero no es una revisión', () => {
    expect(esSaneada('SANEADO')).toBe(true)
    expect(salioDeLaBandeja('SANEADO')).toBe(true)
    expect(esDecisionHumana('SANEADO')).toBe(false)
  })
})

describe('el aprendizaje de la IA sólo ve juicios reales', () => {
  it('una saneada no entra: nadie la miró', () => {
    // Es el punto entero de que exista SANEADO. Contarla como acierto o como
    // error sería medir la precisión con una respuesta que nadie dio.
    expect(cuentaParaAprendizajeIA('SANEADO')).toBe(false)
  })

  it('las dos decisiones humanas sí entran', () => {
    expect(cuentaParaAprendizajeIA('CORRECTO')).toBe(true)
    expect(cuentaParaAprendizajeIA('INCORRECTO')).toBe(true)
  })

  it('una pendiente tampoco: todavía no hay juicio', () => {
    expect(cuentaParaAprendizajeIA('PENDIENTE')).toBe(false)
  })
})

describe('el Cierre Operativo trata la saneada como resuelta', () => {
  const ev = (revision_estado: string) => ({
    id: 'i1', analisis_tipo: 'uniforme', objetivo_id: 'o1',
    objetivo_nombre: 'ACA', guardia_nombre: 'GOMEZ, LUCAS',
    revision_estado, clasificacion_efectiva: 'REVISAR',
    evidencia_created_at: '2026-08-20T13:00:00Z',
  })

  it('una saneada no le queda pendiente a nadie', () => {
    const items = itemsDeFotosIA([ev('SANEADO')])
    expect(items[0].resueltoPorSupervisor).toBe(true)
    expect(resumirCierre(items).total).toBe(0)
  })

  it('y una pendiente sigue estando', () => {
    expect(resumirCierre(itemsDeFotosIA([ev('PENDIENTE')])).total).toBe(1)
  })
})
