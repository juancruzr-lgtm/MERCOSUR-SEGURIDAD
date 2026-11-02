import { describe, expect, it } from 'vitest'
import { etiquetaOrigenVentana } from '@/lib/rondas'

// La obligación de una ronda puede salir de la foto tomada al vencer
// (20261122120000) o de un recálculo con la configuración de hoy. El detalle
// tiene que decirlo: si no, una ronda editada después cambia el historial sin
// que nadie lo note.
describe('etiquetaOrigenVentana', () => {
  it('foto al vencer, con la frecuencia de ese momento', () => {
    expect(etiquetaOrigenVentana({ origen_ventana: 'capturada', intervalo_minutos: 30 }))
      .toBe('Registrada al vencer (cada 30 min)')
  })

  it('historial sin foto: avisa que es un recálculo con la configuración actual', () => {
    expect(etiquetaOrigenVentana({ origen_ventana: 'recalculada', intervalo_minutos: 120 }))
      .toBe('Recalculada con la configuración actual (cada 120 min)')
  })

  it('ventana que todavía no venció', () => {
    expect(etiquetaOrigenVentana({ origen_ventana: 'programada', intervalo_minutos: 120 })).toBe('Programada (cada 120 min)')
  })

  it('servidor sin la migración: no muestra nada', () => {
    expect(etiquetaOrigenVentana({})).toBeNull()
    expect(etiquetaOrigenVentana({ origen_ventana: 'capturada' })).toBe('Registrada al vencer')
  })
})
