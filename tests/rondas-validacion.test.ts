import { describe, expect, it } from 'vitest'
import {
  analisisVigente, estadoFotoPunto, resultadoRonda, veredictoAnalisis, veredictoPunto,
  type AnalisisFoto,
} from '@/lib/rondas-validacion'

// Regla aprobada por Gerencia: una evidencia válida alcanza. Estos casos son
// los mismos que prueba la migración 20261120120000 contra PostgreSQL.

const completado = (clase: string, extra: Partial<AnalisisFoto> = {}): AnalisisFoto => ({
  estado: 'completado', clasificacion_efectiva: clase, clasificacion_ia: clase,
  revision_estado: 'PENDIENTE', analizado_at: '2026-10-10T10:00:00Z', ...extra,
})

describe('veredicto de un análisis', () => {
  it('SIN_OBSERVACIONES de la IA acepta la foto', () => {
    expect(veredictoAnalisis(completado('SIN_OBSERVACIONES'))).toBe('aceptada_ia')
  })
  it('REVISAR o EVIDENCIA_INSUFICIENTE la rechazan', () => {
    expect(veredictoAnalisis(completado('REVISAR'))).toBe('rechazada')
    expect(veredictoAnalisis(completado('EVIDENCIA_INSUFICIENTE'))).toBe('rechazada')
  })
  it('la persona manda sobre la IA', () => {
    expect(veredictoAnalisis(completado('REVISAR', { revision_estado: 'CORRECTO' }))).toBe('aceptada_revision')
    expect(veredictoAnalisis(completado('SIN_OBSERVACIONES', { revision_estado: 'INCORRECTO' }))).toBe('rechazada')
  })
  it('SANEADO no es decisión de nadie: vale la IA', () => {
    expect(veredictoAnalisis(completado('SIN_OBSERVACIONES', { revision_estado: 'SANEADO' }))).toBe('aceptada_ia')
  })
  it('sin análisis completado la foto está pendiente, no rechazada', () => {
    for (const estado of ['pendiente', 'procesando', 'error', 'error_definitivo']) {
      expect(veredictoAnalisis({ estado })).toBe('pendiente')
    }
  })
})

describe('análisis vigente de una foto', () => {
  it('prefiere la decisión humana aunque sea más vieja', () => {
    const humano = completado('REVISAR', { revision_estado: 'CORRECTO', revisado_at: '2026-10-01T00:00:00Z', analizado_at: '2026-10-01T00:00:00Z' })
    const nuevo = completado('REVISAR', { analizado_at: '2026-10-20T00:00:00Z' })
    expect(analisisVigente([nuevo, humano])).toBe(humano)
  })
  it('entre automáticos, el completado más reciente', () => {
    const viejo = completado('REVISAR', { analizado_at: '2026-10-01T00:00:00Z' })
    const nuevo = completado('SIN_OBSERVACIONES', { analizado_at: '2026-10-20T00:00:00Z' })
    const enError: AnalisisFoto = { estado: 'error', created_at: '2026-10-30T00:00:00Z' }
    expect(analisisVigente([viejo, enError, nuevo])).toBe(nuevo)
  })
})

describe('estado de la foto del punto', () => {
  it('sin fotos', () => expect(estadoFotoPunto([])).toBe('sin_foto'))
  it('foto sin ningún análisis está pendiente', () => expect(estadoFotoPunto([[]])).toBe('pendiente'))
  it('una aceptada alcanza', () => {
    expect(estadoFotoPunto([[completado('REVISAR')], [completado('SIN_OBSERVACIONES')]])).toBe('aceptada_ia')
  })
})

describe('veredicto del punto: una evidencia válida alcanza', () => {
  const base = { exigeControl: true, dentroRadio: false as boolean | null, qrVerificado: false, foto: 'sin_foto' as const }

  it('GPS dentro del radio', () => {
    expect(veredictoPunto({ ...base, dentroRadio: true })).toEqual({ estado: 'cumplido', validadoPor: 'gps' })
  })
  it('el GPS fuera de radio no invalida un QR verificado', () => {
    expect(veredictoPunto({ ...base, qrVerificado: true })).toEqual({ estado: 'cumplido', validadoPor: 'qr' })
  })
  it('el GPS fuera de radio no invalida una foto aceptada', () => {
    expect(veredictoPunto({ ...base, foto: 'aceptada_ia' })).toEqual({ estado: 'cumplido', validadoPor: 'foto_ia' })
    expect(veredictoPunto({ ...base, foto: 'aceptada_revision' })).toEqual({ estado: 'cumplido', validadoPor: 'revision' })
  })
  it('prioridad al registrar: GPS, después QR, después foto', () => {
    expect(veredictoPunto({ ...base, dentroRadio: true, qrVerificado: true, foto: 'aceptada_ia' }).validadoPor).toBe('gps')
    expect(veredictoPunto({ ...base, qrVerificado: true, foto: 'aceptada_ia' }).validadoPor).toBe('qr')
  })
  it('foto pendiente de IA: ni cumplido ni incumplido', () => {
    expect(veredictoPunto({ ...base, foto: 'pendiente' })).toEqual({ estado: 'pendiente_validacion', validadoPor: null })
  })
  it('foto rechazada y sin otra evidencia: incumplido', () => {
    expect(veredictoPunto({ ...base, foto: 'rechazada' }).estado).toBe('incumplido')
    expect(veredictoPunto({ ...base, dentroRadio: null }).estado).toBe('incumplido')
  })
  it('sin ningún control exigido el registro alcanza, como antes', () => {
    expect(veredictoPunto({ ...base, exigeControl: false, foto: 'rechazada' })).toEqual({ estado: 'cumplido', validadoPor: null })
  })
})

describe('resultado de la ronda', () => {
  it('completa si todos cumplidos', () => expect(resultadoRonda(['cumplido', 'cumplido'])).toBe('completa'))
  it('incompleta con un incumplido u omitido, aunque haya pendientes', () => {
    expect(resultadoRonda(['cumplido', 'incumplido', 'pendiente_validacion'])).toBe('incompleta')
    expect(resultadoRonda(['omitido'])).toBe('incompleta')
  })
  it('sólo pendientes de validación: no es incompleta todavía', () => {
    expect(resultadoRonda(['cumplido', 'pendiente_validacion'])).toBe('pendiente_validacion')
  })
})
