import { describe, expect, it } from 'vitest'
import { parsearCoordenadasPegadas } from '@/lib/rondas'

// Cargar puntos desde la oficina en vez de ir hasta el portón: se pega el par
// que devuelve cualquier mapa y se completan los dos campos que ya existían.
// No es un circuito nuevo — escribe en latitud/longitud como la carga manual.

describe('parsearCoordenadasPegadas', () => {
  it('el formato que copia Google Maps', () => {
    expect(parsearCoordenadasPegadas('-32.9468, -60.6393')).toEqual({ lat: -32.9468, lng: -60.6393 })
  })

  it('sin espacio después de la coma', () => {
    expect(parsearCoordenadasPegadas('-32.9468,-60.6393')).toEqual({ lat: -32.9468, lng: -60.6393 })
  })

  it('separado por espacios', () => {
    expect(parsearCoordenadasPegadas('-32.9468 -60.6393')).toEqual({ lat: -32.9468, lng: -60.6393 })
  })

  it('con paréntesis, como pegan algunas apps', () => {
    expect(parsearCoordenadasPegadas('(-32.9468, -60.6393)')).toEqual({ lat: -32.9468, lng: -60.6393 })
  })

  it('con espacios de sobra alrededor', () => {
    expect(parsearCoordenadasPegadas('   -32.9468 ,  -60.6393  ')).toEqual({ lat: -32.9468, lng: -60.6393 })
  })

  it('coordenadas positivas', () => {
    expect(parsearCoordenadasPegadas('40.4168, -3.7038')).toEqual({ lat: 40.4168, lng: -3.7038 })
  })
})

describe('parsearCoordenadasPegadas — lo que rechaza', () => {
  it('texto vacío', () => {
    expect(parsearCoordenadasPegadas('')).toBeNull()
    expect(parsearCoordenadasPegadas('   ')).toBeNull()
  })

  it('un solo número', () => {
    expect(parsearCoordenadasPegadas('-32.9468')).toBeNull()
  })

  it('tres números: no se adivina cuáles dos son', () => {
    expect(parsearCoordenadasPegadas('-32.9468, -60.6393, 15')).toBeNull()
  })

  it('texto que no son números', () => {
    expect(parsearCoordenadasPegadas('Rosario, Santa Fe')).toBeNull()
  })

  it('latitud fuera de rango', () => {
    // Invertir lat y lng es el error clásico al pegar; acá se detecta.
    expect(parsearCoordenadasPegadas('-160.6393, -32.9468')).toBeNull()
  })

  it('longitud fuera de rango', () => {
    expect(parsearCoordenadasPegadas('-32.9468, -260.6393')).toBeNull()
  })

  it('una URL de mapa no se interpreta', () => {
    // Preferible rechazar a guardar una coordenada mal leída.
    expect(parsearCoordenadasPegadas('https://maps.google.com/?q=-32.9468,-60.6393')).toBeNull()
  })
})
