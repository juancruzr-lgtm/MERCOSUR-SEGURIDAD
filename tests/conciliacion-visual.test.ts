import { describe, it, expect } from 'vitest'
import { conciliarResultado, resumenConciliacion } from '@/lib/conciliacion-visual'

describe('conciliarResultado (LIQ3/F3)', () => {
  const enviado = [
    { cuil: '20144945817', codigo: '203', importe: 514500 }, // haber enviado
    { cuil: '20144945817', codigo: '101', importe: 0 },      // 0/0 calculado por Visual
    { cuil: '20144945817', codigo: '204', importe: 180000 }, // Visual lo modifica
    { cuil: '20144945817', codigo: '006', importe: 40812 },  // falta en resultado
  ]
  const resultado = [
    { cuil: '20144945817', codigo: '203', importe: 514500 }, // igual
    { cuil: '20144945817', codigo: '101', importe: 91750 },  // Visual calculó
    { cuil: '20144945817', codigo: '204', importe: 200000 }, // modificado
    { cuil: '20144945817', codigo: '977', importe: 50000 },  // nuevo en Visual
  ]

  it('clasifica cada caso', () => {
    const f = conciliarResultado(enviado, resultado)
    const de = (cod: string) => f.find(x => x.codigo === cod)!
    expect(de('203').estado).toBe('SIN_DIFERENCIA')
    expect(de('101').estado).toBe('CALCULADO_POR_VISUAL')   // 0/0 → importe = OK
    expect(de('204').estado).toBe('MODIFICADO_EN_VISUAL')
    expect(de('006').estado).toBe('FALTANTE_EN_RESULTADO')
    expect(de('977').estado).toBe('NUEVO_EN_VISUAL')
  })

  it('Visual anula un valor enviado → requiere revisión', () => {
    const f = conciliarResultado([{ cuil: '1', codigo: '203', importe: 100 }], [{ cuil: '1', codigo: '203', importe: 0 }])
    expect(f[0].estado).toBe('REQUIERE_REVISION')
  })

  it('resumen cuenta por estado', () => {
    const r = resumenConciliacion(conciliarResultado(enviado, resultado))
    expect(r.SIN_DIFERENCIA).toBe(1)
    expect(r.CALCULADO_POR_VISUAL).toBe(1)
    expect(r.MODIFICADO_EN_VISUAL).toBe(1)
    expect(r.FALTANTE_EN_RESULTADO).toBe(1)
    expect(r.NUEVO_EN_VISUAL).toBe(1)
  })
})
