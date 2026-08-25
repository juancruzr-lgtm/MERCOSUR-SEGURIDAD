import { describe, expect, it } from 'vitest'
import {
  cuentaParaAprendizajeIA, esDecisionHumana, esSaneada, esperaRevision,
  salioDeLaBandeja,
  MOTIVO_SANEAMIENTO_IA,
} from '@/lib/ia/revision'
import {
  mensajeContextoSaneamiento, resumenPrevioSaneamiento, validarMotivoSaneamiento,
} from '@/lib/ia/saneamiento'
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

// ── El lote de saneamiento ───────────────────────────────────────────────────

describe('resumen previo del saneamiento', () => {
  const r = (porTipo: Record<string, number>, total: number) => ({
    contexto: 'vista_previa' as const, corte: null, total, porTipo, saneadas: 0,
  })

  it('nombra los tres tipos en castellano y de mayor a menor', () => {
    expect(resumenPrevioSaneamiento(r({ punto_control: 83, uniforme: 65, libro_guardia: 20 }, 168)))
      .toBe('168 observaciones — 83 de ronda · 65 de uniforme · 20 de libro de guardia')
  })

  it('sin nada que sanear lo dice sin números', () => {
    expect(resumenPrevioSaneamiento(r({}, 0)))
      .toBe('No quedan observaciones anteriores al criterio vigente.')
  })

  it('una sola no se pluraliza', () => {
    expect(resumenPrevioSaneamiento(r({ uniforme: 1 }, 1))).toContain('1 observación —')
  })
})

describe('el motivo es obligatorio y tiene que explicar', () => {
  it('vacío no sirve', () => {
    expect(validarMotivoSaneamiento('   ')).toBe('El motivo es obligatorio.')
  })

  it('un "ok" tampoco: dentro de seis meses no explica nada', () => {
    expect(validarMotivoSaneamiento('ok')).toContain('al menos')
  })

  it('el motivo acordado pasa', () => {
    expect(validarMotivoSaneamiento(MOTIVO_SANEAMIENTO_IA)).toBeNull()
  })

  it('el motivo acordado dice explícitamente que no valida ni acusa', () => {
    // Es lo que va a quedar escrito en 168 filas de historial.
    expect(MOTIVO_SANEAMIENTO_IA).toContain('No implica validación de la evidencia')
    expect(MOTIVO_SANEAMIENTO_IA).toContain('ni incumplimiento del vigilador')
  })
})

describe('los contextos de la RPC se traducen a algo accionable', () => {
  it('sin admin explica por qué', () => {
    expect(mensajeContextoSaneamiento('requiere_admin')).toContain('todos los objetivos')
  })

  it('sin criterio activo no se inventa un corte', () => {
    expect(mensajeContextoSaneamiento('sin_corte')).toContain('no se puede saber')
  })

  it('vista previa y aplicado no son errores', () => {
    expect(mensajeContextoSaneamiento('vista_previa')).toBeNull()
    expect(mensajeContextoSaneamiento('aplicado')).toBeNull()
  })
})
