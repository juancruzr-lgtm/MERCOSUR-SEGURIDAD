import { describe, expect, it } from 'vitest'
import {
  esHostDeMapaPermitido,
  extraerCoordenadasDeUrl,
  parsearCoordenadasPegadas,
  parsearGradosMinutosSegundos,
} from '@/lib/coordenadas-mapa'

const cerca = (a: { lat: number; lng: number } | null, lat: number, lng: number) => {
  expect(a).not.toBeNull()
  expect(Math.abs(a!.lat - lat)).toBeLessThan(1e-5)
  expect(Math.abs(a!.lng - lng)).toBeLessThan(1e-5)
}

describe('grados/minutos/segundos', () => {
  it('formato de Google Maps', () => {
    cerca(parsearGradosMinutosSegundos(`30°56'35.0"S 61°32'28.1"W`), -30.9430556, -61.5411389)
  })
  it('lo acepta también el parser de pegado', () => {
    cerca(parsearCoordenadasPegadas(`30°56'35.0"S 61°32'28.1"W`), -30.9430556, -61.5411389)
  })
  it('comillas tipográficas, coma decimal y O de oeste', () => {
    cerca(parsearGradosMinutosSegundos('30° 56′ 35,0″ S, 61° 32′ 28,1″ O'), -30.9430556, -61.5411389)
  })
  it('norte/este positivos', () => {
    cerca(parsearGradosMinutosSegundos(`40°25'0.5"N 3°42'13.7"E`), 40.4168056, 3.7038056)
  })
  it('rechaza dos latitudes o minutos inválidos', () => {
    expect(parsearGradosMinutosSegundos(`30°56'35"S 31°0'0"S`)).toBeNull()
    expect(parsearGradosMinutosSegundos(`30°76'35"S 61°32'28"W`)).toBeNull()
  })
})

describe('extraerCoordenadasDeUrl', () => {
  it('link expandido de maps.app.goo.gl (pin !3d!4d)', () => {
    cerca(
      extraerCoordenadasDeUrl('https://www.google.com/maps/place/-30.943067,-61.541142/data=!4m6!3m5!1s0!7e2!8m2!3d-30.943067!4d-61.5411423!18m1!1e1?utm_source=mstt_1'),
      -30.943067, -61.5411423,
    )
  })
  it('?q=lat,lng', () => {
    cerca(extraerCoordenadasDeUrl('https://maps.google.com/?q=-32.9468,-60.6393'), -32.9468, -60.6393)
  })
  it('@lat,lng como último recurso', () => {
    cerca(extraerCoordenadasDeUrl('https://www.google.com/maps/@-32.9468,-60.6393,17z'), -32.9468, -60.6393)
  })
  it('link corto sin coordenadas', () => {
    expect(extraerCoordenadasDeUrl('https://maps.app.goo.gl/MGMLHzWe3ZPFstny7')).toBeNull()
  })
})

describe('esHostDeMapaPermitido', () => {
  it('acepta Google y sus acortadores', () => {
    expect(esHostDeMapaPermitido('maps.app.goo.gl')).toBe(true)
    expect(esHostDeMapaPermitido('www.google.com')).toBe(true)
    expect(esHostDeMapaPermitido('www.google.com.ar')).toBe(true)
  })
  it('rechaza otros hosts', () => {
    expect(esHostDeMapaPermitido('evil.com')).toBe(false)
    expect(esHostDeMapaPermitido('google.com.evil.com')).toBe(false)
    expect(esHostDeMapaPermitido('localhost')).toBe(false)
  })
})
