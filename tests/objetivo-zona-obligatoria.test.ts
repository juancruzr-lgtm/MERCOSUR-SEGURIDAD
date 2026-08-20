/**
 * Zona operativa obligatoria en el alta de objetivos.
 *
 * Regresión que cubre: LAROMET FUNES quedó activo sin zona y por eso no
 * aparecía en el ranking operativo de supervisores. Se creó por la vía de
 * aprobación de solicitudes, cuyo payload no incluía `zona_id` en absoluto —
 * una validación sólo en el modal de Objetivos no lo habría evitado.
 */
import { describe, it, expect } from 'vitest'
import {
  faltaZonaOperativa,
  MOTIVO_ZONA_OBLIGATORIA,
  MOTIVO_ZONA_OBLIGATORIA_SOLICITUD,
  ERROR_ZONA_OBLIGATORIA_SOLICITUD,
} from '../lib/objetivos'

describe('zona operativa obligatoria', () => {
  it('falta cuando no hay zona elegida', () => {
    expect(faltaZonaOperativa(undefined)).toBe(true)
    expect(faltaZonaOperativa(null)).toBe(true)
    expect(faltaZonaOperativa('')).toBe(true)
  })

  it('no falta cuando hay una zona', () => {
    expect(faltaZonaOperativa('c7af2ffe-3861-4ff1-ac55-b481f39c1415')).toBe(false)
  })

  it('el select vacío del formulario cuenta como falta', () => {
    // Ambos formularios usan '' como valor de la opción "— Elegí zona —".
    const form = { nombre: 'LAROMET FUNES', zona_id: '' }
    expect(faltaZonaOperativa(form.zona_id)).toBe(true)
  })

  it('los motivos explican la consecuencia, no repiten la regla', () => {
    for (const motivo of [MOTIVO_ZONA_OBLIGATORIA, MOTIVO_ZONA_OBLIGATORIA_SOLICITUD]) {
      expect(motivo).toMatch(/ranking/i)
      expect(motivo).toMatch(/bandeja/i)
    }
    expect(ERROR_ZONA_OBLIGATORIA_SOLICITUD).toMatch(/antes de aprobar/i)
  })
})
