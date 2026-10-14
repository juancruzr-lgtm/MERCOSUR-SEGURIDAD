import { describe, expect, it } from 'vitest'
import { SCHEMA_CREDENCIAL, dniCoincide, interpretarLectura, orientacionPorTitulo, rectRecorte, resumenLectura } from '@/lib/credencial-lectura'

describe('interpretar lo que leyó la IA', () => {
  it('normaliza dígitos, fechas y caja', () => {
    const l = interpretarLectura({ es_credencial: true, cara: 'frente', apellido: ' SILVA ', nombre: 'IVAN MAXIMILIANO', dni: '40.786.900',
      numero: '32.722', emision: '2024-08-01', vencimiento: '2026-09-01', caja: [120.4, 80, 870, 950], rotacion: 90 })!
    expect(l).toMatchObject({ es_credencial: true, cara: 'frente', apellido: 'SILVA', dni: '40786900', numero: '32722', vencimiento: '2026-09-01', rotacion: 90 })
    expect(l.caja).toEqual([120, 80, 870, 950])
  })
  it('descarta fechas mal formadas o imposibles y no inventa', () => {
    const l = interpretarLectura({ es_credencial: true, emision: '01/08/2024', vencimiento: '2026-13-01', caja: [0, 0, 10, 10], rotacion: 45 })!
    expect(l.emision).toBeNull()
    expect(l.vencimiento).toBeNull()
    expect(l.caja).toBeNull()
    expect(l.rotacion).toBe(0)
    expect(l.dni).toBeNull()
  })
  it('una respuesta vacía no rompe', () => {
    expect(interpretarLectura(null)).toBeNull()
    expect(interpretarLectura({})!.es_credencial).toBe(false)
  })
  it('el schema pide lo necesario', () => {
    expect(Object.keys((SCHEMA_CREDENCIAL as any).properties)).toEqual(expect.arrayContaining(['vencimiento', 'dni', 'numero', 'caja', 'rotacion']))
  })
})

describe('giro según el encabezado', () => {
  const caja: [number, number, number, number] = [200, 200, 800, 800]
  it('encabezado arriba, derecha, abajo, izquierda', () => {
    expect(orientacionPorTitulo(caja, [210, 250, 280, 750])).toBe(0)
    expect(orientacionPorTitulo(caja, [250, 720, 750, 790])).toBe(90)
    expect(orientacionPorTitulo(caja, [720, 250, 790, 750])).toBe(180)
    expect(orientacionPorTitulo(caja, [250, 210, 750, 280])).toBe(270)
  })
  it('sin encabezado o en el centro: no decide', () => {
    expect(orientacionPorTitulo(caja, null)).toBeNull()
    expect(orientacionPorTitulo(caja, [480, 480, 520, 520])).toBeNull()
  })
  it('el encabezado manda sobre el número que dice el modelo', () => {
    const l = interpretarLectura({ es_credencial: true, caja: [200, 200, 800, 800], titulo: [250, 210, 750, 280], rotacion: 90 })!
    expect(l.rotacion).toBe(270)
  })
})

describe('DNI de la persona', () => {
  it('compara sólo dígitos', () => {
    expect(dniCoincide('40786900', '40.786.900')).toBe(true)
    expect(dniCoincide('40786901', '40786900')).toBe(false)
    expect(dniCoincide(null, '40786900')).toBeNull()
  })
})

describe('recorte', () => {
  it('recorta la tarjeta con margen', () => {
    const r = rectRecorte([200, 100, 700, 900], 1000, 2000)!
    expect(r.x).toBeLessThan(100); expect(r.y).toBeLessThan(400)
    expect(r.x + r.w).toBeLessThanOrEqual(1000); expect(r.y + r.h).toBeLessThanOrEqual(2000)
    expect(r.w).toBeGreaterThan(800)
  })
  it('no recorta si la tarjeta ocupa casi toda la foto o no hay caja', () => {
    expect(rectRecorte([0, 0, 1000, 1000], 1000, 1000)).toBeNull()
    expect(rectRecorte(null, 1000, 1000)).toBeNull()
  })
})

describe('resumen para Administración', () => {
  it('muestra lo leído y si el DNI no coincide', () => {
    expect(resumenLectura({ es_credencial: true, cara: 'frente', apellido: null, nombre: null, dni: '1', numero: '32722', emision: null,
      vencimiento: '2026-09-01', caja: null, rotacion: 0, dni_coincide: false }))
      .toBe('Leído por IA: N° 32722 · DNI 1 (no coincide) · vence 01/09/2026')
    expect(resumenLectura(null)).toBeNull()
  })
})
