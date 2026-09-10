import { describe, it, expect } from 'vitest'
import { construirResumenGuardia, plantillaLiquidacionResumenGuardia, PARAMETROS_PLANTILLA } from '@/lib/resumen-guardia'

// SUELDO MENSUAL (grupo A · mensualizados fijos): concepto 001 individual, sin
// 203/204/212 de convención. Grupo B (supervisores operativos) y C (vigiladores)
// no cambian. La VIGENCIA (arrastre mes a mes) se prueba en el .sql de verificación.

const basico = PARAMETROS_PLANTILLA.basico
const hora = basico / 200

function plantilla(empleados: any[], sueldoMensual?: Map<string, number>) {
  const resumen = construirResumenGuardia({
    mes: '2026-08', empleados, turnos: [], registros: [], novedades: [],
    esObjetivoPrueba: () => false, nombreObjetivo: () => '',
  } as any)
  const pl = plantillaLiquidacionResumenGuardia(resumen, undefined, sueldoMensual)
  const m = new Map(pl.celdas.map(c => [c.ref, c]))
  const filaDe = (empId: string) => {
    const bd = pl.celdas.find(c => /^BD\d+$/.test(c.ref) && c.v === empId)
    return bd ? bd.ref.slice(2) : ''
  }
  return { m, filaDe }
}

const VIG = { id: 'v1', apellido: 'ALMADA', nombre: '', rol: 'guardia', puesto_organizacional: 'vigilador', cuil: '20144945817', legajoVisual: 'ALMADA' }
const SUP = { id: 's1', apellido: 'MARTINEZ', nombre: '', rol: 'admin', puesto_organizacional: 'jefe_supervisores', cuil: '20295393522', legajoVisual: 'MARTINEZ' }
const ADM = { id: 'a1', apellido: 'ROMERO', nombre: '', rol: 'admin', puesto_organizacional: 'direccion_operativa', cuil: '20111111111', legajoVisual: 'ROD' }
const GER = { id: 'g1', apellido: 'GERENTE', nombre: '', rol: 'admin', puesto_organizacional: 'gerencia', cuil: '20222222229', legajoVisual: 'GER' }

describe('SUELDO MENSUAL — grupo A (mensualizados fijos)', () => {
  it('administrativo con SUELDO MENSUAL → usa el importe individual en 001; sin 203/204/212; SIN 25/150 inventado', () => {
    const sm = new Map([['a1', 777000]])
    const { m, filaDe } = plantilla([ADM], sm)
    const r = filaDe('a1')
    expect(m.get(`AJ${r}`)?.v).toBe(777000)      // 001 = SUELDO MENSUAL
    expect(m.get(`AJ${r}`)?.f).toBe(`BF${r}`)    // 001 sigue la columna editable
    expect(m.get(`BF${r}`)?.v).toBe(777000)      // columna SUELDO MENSUAL
    expect(m.get(`AG${r}`)?.v).toBe(0)           // sin "horas rec" (así 001 = AG+AJ = SM)
    expect(m.get(`AC${r}`)?.v).toBe(0)           // sin viáticos 203
    expect(m.get(`AD${r}`)?.v).toBe(0)           // sin presentismo 204
    expect(m.get(`AE${r}`)?.v).toBe(0)           // sin 212
    expect(m.get(`AH${r}`)).toBeUndefined()      // sin adicional de convención
    // NO se inventan jornadas/horas: G, H, I quedan VACÍAS (regresión del bug #211).
    expect(m.get(`G${r}`)).toBeUndefined()
    expect(m.get(`H${r}`)).toBeUndefined()
    expect(m.get(`I${r}`)).toBeUndefined()
  })

  it('gerencia con SUELDO MENSUAL → usa el importe individual', () => {
    const sm = new Map([['g1', 1500000]])
    const { m, filaDe } = plantilla([GER], sm)
    const r = filaDe('g1')
    expect(m.get(`AJ${r}`)?.v).toBe(1500000)
    expect(m.get(`BF${r}`)?.v).toBe(1500000)
    expect(m.get(`AD${r}`)?.v).toBe(0)
  })

  it('grupo A SIN valor cargado → cae al básico general (fallback), nunca a la convención', () => {
    const { m, filaDe } = plantilla([ADM])   // sin mapa de sueldo
    const r = filaDe('a1')
    expect(m.get(`AJ${r}`)?.v).toBe(basico)   // 001 = básico (fallback)
    expect(m.get(`BF${r}`)?.v).toBe(basico)
    expect(m.get(`AC${r}`)?.v).toBe(0)        // sigue sin viáticos/presentismo
  })

  it('el AO (total) del grupo A = SUELDO MENSUAL (no se infla con conceptos de convención)', () => {
    const sm = new Map([['a1', 500000]])
    const { m, filaDe } = plantilla([ADM], sm)
    const r = filaDe('a1')
    expect(m.get(`AO${r}`)?.v).toBe(500000)   // sin viáticos/presentismo/adicional sumados
  })
})

describe('SUELDO MENSUAL — grupos B y C no cambian', () => {
  it('supervisor operativo (Martínez, jefe_supervisores) → 25 días + convención, SIN SUELDO MENSUAL', () => {
    const sm = new Map([['s1', 999999]])  // aunque haya un valor, a grupo B NO se le aplica
    const { m, filaDe } = plantilla([SUP], sm)
    const r = filaDe('s1')
    expect(m.get(`G${r}`)?.v).toBe(25)
    expect(m.get(`AH${r}`)?.v).toBe(50)                 // adicional de convención
    expect(m.get(`AC${r}`)?.v).toBe(PARAMETROS_PLANTILLA.viatico)  // viáticos por convención
    expect(m.get(`AJ${r}`)?.f).toBe(`AG${r}*$F$1`)      // 001 por fórmula de horas rec
    expect(m.get(`BF${r}`)).toBeUndefined()             // NO lleva columna SUELDO MENSUAL
  })

  it('vigilador → por horas reales, sin SUELDO MENSUAL', () => {
    const { m, filaDe } = plantilla([VIG])
    const r = filaDe('v1')
    expect(m.get(`AH${r}`)).toBeUndefined()   // vigilador: adicional manual
    expect(m.get(`BF${r}`)).toBeUndefined()   // sin SUELDO MENSUAL
    expect(m.get(`AJ${r}`)?.f).toBe(`AG${r}*$F$1`)
  })

  it('los tres grupos conviven en la misma plantilla con su modelo propio', () => {
    const sm = new Map([['a1', 600000]])
    const { m, filaDe } = plantilla([VIG, SUP, ADM], sm)
    // A: SUELDO MENSUAL
    expect(m.get(`AJ${filaDe('a1')}`)?.v).toBe(600000)
    expect(m.get(`BF${filaDe('a1')}`)?.v).toBe(600000)
    // B: convención
    expect(m.get(`AH${filaDe('s1')}`)?.v).toBe(50)
    expect(m.get(`BF${filaDe('s1')}`)).toBeUndefined()
    // C: por horas, sin BF
    expect(m.get(`BF${filaDe('v1')}`)).toBeUndefined()
  })
})
