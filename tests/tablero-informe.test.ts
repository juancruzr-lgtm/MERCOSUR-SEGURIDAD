import { describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => new Proxy({}, { get: () => () => ({ data: { subscription: { unsubscribe() {} } } }) }),
}))
import { armarInformeMensual, huellaInforme, jsonCanonico } from '@/lib/tablero-gerencia/informe'
import { resumirHorasMes, compararMeses } from '@/lib/tablero-gerencia/horas'
import { resumirCasos } from '@/lib/tablero-gerencia/casos'
import { indicadoresCalidad } from '@/lib/tablero-gerencia/calidad'
import { coberturaPreventiva } from '@/lib/tablero-gerencia/supervision-preventiva'

const base = () => armarInformeMensual({
  mes: '2026-10', ahoraIso: '2026-11-01T12:00:00Z', mesCerrado: true,
  horas: resumirHorasMes([]), comparacion: compararMeses(0, 0), casos: resumirCasos([], '2026-11-01T12:00:00Z'),
  calidad: indicadoresCalidad([], [], '2026-11-01T12:00:00Z'),
  supervision: coberturaPreventiva({ desdeIso: '2026-10-01T03:00:00Z', hastaIso: '2026-11-01T03:00:00Z', objetivos: [], supervisiones: [] }),
  facturacion: null,
})

describe('informe mensual', () => {
  it('no inventa rentabilidad ni facturación sin datos', () => {
    const i = base()
    expect(i.rentabilidad.disponible).toBe(false)
    expect(i.facturacion.prefacturado).toBeNull()
    expect(i.advertencias).toEqual([])
  })
  it('mes en curso queda marcado como parcial', () => {
    const i = armarInformeMensual({ ...({} as any), ...{
      mes: '2026-11', ahoraIso: '2026-11-17T12:00:00Z', mesCerrado: false, horas: resumirHorasMes([]), comparacion: compararMeses(0, 0),
      casos: resumirCasos([], '2026-11-17T12:00:00Z'), calidad: indicadoresCalidad([], [], '2026-11-17T12:00:00Z'),
      supervision: coberturaPreventiva({ desdeIso: '2026-11-01T03:00:00Z', hastaIso: '2026-11-17T03:00:00Z', objetivos: [], supervisiones: [] }),
      facturacion: [{ cliente: 'A', total: 100.5 }, { cliente: 'A', total: 50 }] } })
    expect(i.advertencias[0]).toMatch(/parciales/)
    expect(i.facturacion).toMatchObject({ prefacturado: 150.5, clientes: 1 })
  })
  it('huella estable aunque cambie el orden de las claves', async () => {
    expect(jsonCanonico({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}')
    const i = base()
    const reordenado = JSON.parse(JSON.stringify(i, Object.keys(i).reverse()))
    expect(await huellaInforme({ ...i })).toBe(await huellaInforme({ ...reordenado, ...i }))
    expect(await huellaInforme(i)).toMatch(/^[0-9a-f]{64}$/)
  })
})
