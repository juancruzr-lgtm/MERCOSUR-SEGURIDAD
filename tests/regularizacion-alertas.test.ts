import { describe, expect, it } from 'vitest'
import {
  REGULARIZACION_MOTIVO_MINIMO,
  mensajeContextoRegularizacion,
  resumenPrevioRegularizacion,
  validarMotivoRegularizacion,
} from '@/lib/rondas'
import type { ResumenRegularizacion } from '@/lib/rondas'

// Regularización histórica de alertas de ronda. El cierre en si vive en la RPC
// cerrar_ronda_alertas_pendientes y no es ejecutable sin base: delega cada
// alerta en resolver_ronda_alerta, que ya escribe la intervencion con actor,
// motivo y fecha, y nunca borra. Lo que se cubre aca es el contrato del cliente.

const resumen = (over: Partial<ResumenRegularizacion> = {}): ResumenRegularizacion => ({
  contexto: 'vista_previa',
  hasta: '2026-08-01',
  total: 0,
  por_tipo: {},
  por_objetivo: {},
  regularizadas: 0,
  omitidas: 0,
  ...over,
})

describe('validarMotivoRegularizacion — el motivo es obligatorio', () => {
  it('vacío no alcanza', () => {
    expect(validarMotivoRegularizacion('')).toBe('El motivo es obligatorio.')
    expect(validarMotivoRegularizacion('   ')).toBe('El motivo es obligatorio.')
  })

  it('un "ok" no explica nada dentro de seis meses', () => {
    expect(validarMotivoRegularizacion('ok')).toContain(String(REGULARIZACION_MOTIVO_MINIMO))
  })

  it('un motivo real pasa', () => {
    expect(validarMotivoRegularizacion(
      'Alertas previas al encendido del monitoreo automatico',
    )).toBeNull()
  })

  it('no cuenta los espacios de los costados', () => {
    expect(validarMotivoRegularizacion('   corto   ')).not.toBeNull()
  })
})

describe('resumenPrevioRegularizacion — qué se va a cerrar, antes de cerrarlo', () => {
  it('sin nada que regularizar lo dice claro', () => {
    expect(resumenPrevioRegularizacion(resumen())).toBe(
      'No hay alertas pendientes anteriores a esa fecha.',
    )
  })

  it('cuenta alertas y objetivos', () => {
    const texto = resumenPrevioRegularizacion(resumen({
      total: 41,
      por_tipo: { no_iniciada: 38, no_finalizada: 3 },
      por_objetivo: { 'ACA ROSARIO': 20, 'CLUB UNI 2': 21 },
    }))
    expect(texto).toContain('41 alertas')
    expect(texto).toContain('2 objetivos')
    expect(texto).toContain('38')
    expect(texto).toContain('3')
  })

  it('singular cuando es una sola', () => {
    const texto = resumenPrevioRegularizacion(resumen({
      total: 1, por_tipo: { no_iniciada: 1 }, por_objetivo: { ACA: 1 },
    }))
    expect(texto).toContain('1 alerta ')
    expect(texto).toContain('1 objetivo ')
  })
})

describe('mensajeContextoRegularizacion', () => {
  it('vista previa y aplicado no son errores', () => {
    expect(mensajeContextoRegularizacion('vista_previa')).toBeNull()
    expect(mensajeContextoRegularizacion('aplicado')).toBeNull()
  })

  it('los contextos de error tienen texto para el usuario', () => {
    expect(mensajeContextoRegularizacion('sin_usuario')).toBeTruthy()
    expect(mensajeContextoRegularizacion('fecha_requerida')).toBeTruthy()
    expect(mensajeContextoRegularizacion('motivo_requerido')).toBeTruthy()
    expect(mensajeContextoRegularizacion('tipo_invalido')).toBeTruthy()
  })
})
