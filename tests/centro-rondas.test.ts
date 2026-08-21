import { describe, expect, it } from 'vitest'
import { etiquetaHoraInicioRonda, ordenarFilasCentroRondas } from '@/lib/rondas'
import type { FilaCentroRondas } from '@/lib/rondas'

// Centro de Rondas: la lista transversal que evita entrar objetivo por objetivo.
// La consulta vive en listarCentroRondas y no es ejecutable sin base; lo que se
// cubre aca es como se lee y como se ordena, que es lo que decide si el
// supervisor encuentra lo que reclama atencion.

const fila = (over: Partial<FilaCentroRondas> = {}): FilaCentroRondas => ({
  rondaId: 'r1',
  objetivoId: 'o1', objetivoNombre: 'ACA ROSARIO',
  puestoId: 'p1', puestoNombre: 'Principal',
  nombre: 'Guardia',
  activo: true,
  cantidadPuntos: 3,
  intervaloMinutos: 120,
  horaInicio: null,
  ultimaEjecucion: null,
  alertasPendientes: 0,
  ...over,
})

describe('etiquetaHoraInicioRonda — el ancla del ciclo', () => {
  it('sin hora fija lo dice con todas las letras', () => {
    expect(etiquetaHoraInicioRonda(null)).toBe(
      'Arranca con cada turno / mientras exista turno activo',
    )
  })

  it('con hora fija muestra HH:MM, sin los segundos de Postgres', () => {
    expect(etiquetaHoraInicioRonda('20:00:00')).toBe('Desde 20:00')
  })
})

describe('ordenarFilasCentroRondas — primero lo que reclama atención', () => {
  it('las alertas pendientes van arriba', () => {
    const filas = ordenarFilasCentroRondas([
      fila({ rondaId: 'sin', alertasPendientes: 0 }),
      fila({ rondaId: 'con', alertasPendientes: 4 }),
    ])
    expect(filas[0].rondaId).toBe('con')
  })

  it('a igual alerta, las inactivas van después de las activas', () => {
    const filas = ordenarFilasCentroRondas([
      fila({ rondaId: 'inactiva', activo: false }),
      fila({ rondaId: 'activa', activo: true }),
    ])
    expect(filas[0].rondaId).toBe('activa')
  })

  it('a igual estado, ordena por objetivo y después por nombre', () => {
    const filas = ordenarFilasCentroRondas([
      fila({ rondaId: '3', objetivoNombre: 'CLUB', nombre: 'Nocturna' }),
      fila({ rondaId: '1', objetivoNombre: 'ACA', nombre: 'Diurna' }),
      fila({ rondaId: '2', objetivoNombre: 'ACA', nombre: 'Nocturna' }),
    ])
    expect(filas.map(f => f.rondaId)).toEqual(['1', '2', '3'])
  })

  it('una inactiva con alertas sigue estando arriba de una activa sin alertas', () => {
    const filas = ordenarFilasCentroRondas([
      fila({ rondaId: 'activa-limpia', activo: true, alertasPendientes: 0 }),
      fila({ rondaId: 'inactiva-con-deuda', activo: false, alertasPendientes: 2 }),
    ])
    expect(filas[0].rondaId).toBe('inactiva-con-deuda')
  })

  it('no muta el arreglo original', () => {
    const original = [fila({ rondaId: 'a' }), fila({ rondaId: 'b', alertasPendientes: 9 })]
    ordenarFilasCentroRondas(original)
    expect(original.map(f => f.rondaId)).toEqual(['a', 'b'])
  })
})
