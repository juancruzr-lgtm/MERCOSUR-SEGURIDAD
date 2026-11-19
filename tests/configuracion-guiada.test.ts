import { describe, expect, it } from 'vitest'
import { armarProtocolo, distanciaMetros, faltaParaActivar, faltantesProtocolo, textoProblema, validarPunto } from '@/lib/configuracion-guiada'

const CENTRO = { lat: -32.9500, lng: -60.6500 }
// ~0.0009° de latitud ≈ 100 m
const p = (dLat: number, precision = 8) => ({ lat: CENTRO.lat + dLat, lng: CENTRO.lng, precision })

describe('ronda guiada: dos puntos', () => {
  it('distancia haversine', () => {
    expect(Math.round(distanciaMetros(CENTRO, { lat: CENTRO.lat + 0.0009, lng: CENTRO.lng }))).toBe(100)
  })
  it('valida precisión, cercanía al objetivo y separación entre puntos', () => {
    expect(validarPunto(null, CENTRO)).toEqual({ tipo: 'sin_gps' })
    expect(validarPunto(p(0, 40), CENTRO)).toEqual({ tipo: 'impreciso', precision: 40 })
    expect(validarPunto(p(0.009), CENTRO)).toMatchObject({ tipo: 'lejos_del_objetivo' })
    const primero = p(0)
    expect(validarPunto(p(0.0001), CENTRO, primero)).toMatchObject({ tipo: 'muy_cerca' })
    expect(validarPunto(p(0.0036), CENTRO, primero)).toMatchObject({ tipo: 'muy_lejos' })
    expect(validarPunto(p(0.0009), CENTRO, primero)).toBeNull()
    expect(validarPunto(p(0), null)).toBeNull()
  })
  it('mensajes claros para el vigilador', () => {
    expect(textoProblema({ tipo: 'muy_cerca', distancia: 8 })).toMatch(/otro extremo/)
  })
})

describe('protocolo guiado', () => {
  it('pide las obligatorias y arma el texto sólo con lo respondido', () => {
    expect(faltantesProtocolo({ horario: '24 h' })).toContain('Qué está prohibido')
    const r = armarProtocolo('Planta Norte', { horario: '24 h', tareas: 'Control de accesos', prohibido: 'Abandonar el puesto', emergencias: 'Llamar al 911', contactos: 'Encargado: 341…' })
    expect(r.titulo).toBe('Protocolo del puesto — Planta Norte')
    expect(r.texto).toMatch(/^PROTOCOLO DEL PUESTO — PLANTA NORTE/)
    expect(r.texto).toMatch(/1\. HORARIO Y MODALIDAD DEL SERVICIO\n24 h/)
    expect(r.texto).not.toMatch(/CONTROL DE ACCESOS\n/)
  })
  it('cuenta regresiva de activación', () => {
    expect(faltaParaActivar('2026-11-20T15:00:00Z', '2026-11-19T15:00:00Z')).toBe('se activa en 24 h')
    expect(faltaParaActivar('2026-11-19T15:00:00Z', '2026-11-19T16:00:00Z')).toBe('se activa en la próxima revisión')
  })
})
