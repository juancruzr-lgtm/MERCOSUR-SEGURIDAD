import { describe, expect, it } from 'vitest'
import {
  armarProtocolo, distanciaMetros, faltantesProtocolo, PLANTILLA_RONDA_CONFIGURADA, radioPunto, separacionMinima,
  textoFrecuencia, textoProblema, validarPunto, variablesRondaConfigurada, vistaPrevia,
} from '@/lib/configuracion-guiada'

const OBJ = { lat: -32.95, lng: -60.65, radio_metros: 100 }
// ~0.0009° de latitud ≈ 100 m
const p = (dLat: number, precision = 6) => ({ lat: OBJ.lat + dLat, lng: OBJ.lng, precision })

describe('ronda guiada: validación de puntos', () => {
  it('distancia haversine', () => {
    expect(Math.round(distanciaMetros(OBJ, { lat: OBJ.lat + 0.0009, lng: OBJ.lng }))).toBe(100)
  })
  it('precisión máxima ±30 m', () => {
    expect(validarPunto(p(0, 30), OBJ)).toBeNull()
    expect(validarPunto(p(0, 31), OBJ)).toEqual({ tipo: 'impreciso', precision: 31 })
    expect(validarPunto(null, OBJ)).toEqual({ tipo: 'sin_gps' })
  })
  it('área del objetivo = radio + precisión + 25 m', () => {
    expect(validarPunto(p(0.0011, 6), OBJ)).toBeNull() // ~122 m < 131 m
    expect(validarPunto(p(0.0013, 6), OBJ)).toMatchObject({ tipo: 'fuera_del_objetivo' }) // ~144 m
    expect(validarPunto(p(0.0013, 6), { ...OBJ, radio_metros: 300 })).toBeNull() // objetivo grande: se respeta su radio
    expect(validarPunto(p(0.05), { lat: null, lng: null, radio_metros: null })).toBeNull() // sin coordenadas del objetivo no se controla el área
  })
  it('sin distancia fija: se exige superar la suma de las precisiones', () => {
    const primero = p(0, 7)
    expect(separacionMinima(primero, p(0, 6))).toBe(13)
    expect(validarPunto(p(0.0001, 6), OBJ, primero)).toMatchObject({ tipo: 'indistinguible', minimo: 13 }) // 11 m
    expect(validarPunto(p(0.000126, 6), OBJ, primero)).toBeNull() // 14 m
    expect(validarPunto(p(0.000126, 15), OBJ, p(0, 15))).toMatchObject({ tipo: 'indistinguible' }) // con GPS peor hace falta más
  })
  it('mensajes para el vigilador y radio del punto', () => {
    expect(textoProblema({ tipo: 'indistinguible', distancia: 11, minimo: 13 })).toMatch(/más de 13 m/)
    expect(radioPunto(6)).toBe(25)
    expect(radioPunto(20)).toBe(40)
  })
})

describe('protocolo guiado', () => {
  it('pide las obligatorias y arma el texto sólo con lo respondido', () => {
    expect(faltantesProtocolo({ horario: '24 h' })).toContain('Restricciones y prohibiciones')
    const r = armarProtocolo('Depósito', { horario: '24 h', accesos: 'Portón 1', obligaciones: 'Registrar camiones', prohibido: 'Abandonar el puesto', emergencias: '911', contactos: 'Encargado 341…' })
    expect(r.texto).toMatch(/^PROTOCOLO DEL PUESTO — DEPÓSITO/)
    expect(r.texto).toMatch(/6\. CONTACTOS Y TELÉFONOS IMPORTANTES/)
    expect(r.texto).not.toMatch(/INSTRUCCIONES PARTICULARES/)
  })
})

describe('aviso de ronda configurada (plantilla aprobada)', () => {
  it('seis variables en el orden de la plantilla', () => {
    const v = variablesRondaConfigurada({ destinatario: 'Juan Cruz', objetivo: 'Depósito Los Álamos', vigilador: 'Martín Ríos', activadaIso: '2026-11-19T17:37:00Z', distancia: 86.4, frecuenciaMin: 120 })
    expect(v).toEqual(['Juan Cruz', 'Depósito Los Álamos', 'Martín Ríos', '19/11/2026 14:37', '86', 'cada 2 horas'])
    const t = vistaPrevia(PLANTILLA_RONDA_CONFIGURADA.cuerpo, v)
    expect(t).toMatch(/Objetivo: Depósito Los Álamos\nConfiguró: Martín Ríos \(vigilador\)/)
    expect(t).toMatch(/Estado: RONDA ACTIVA/)
  })
  it('frecuencia en palabras', () => {
    expect(textoFrecuencia(60)).toBe('cada 1 hora')
    expect(textoFrecuencia(90)).toBe('cada 1 h 30 min')
  })
})
