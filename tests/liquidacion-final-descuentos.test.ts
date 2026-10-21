import { describe, expect, it } from 'vitest'
import { descuentosDeFinal, type FinalFila } from '@/lib/liquidacion-final-datos'

// Descuentos en la exportación de la liquidación final, igual que el mensual (JC 21/10).

function cliente(t: Record<string, any[]>) {
  const make = (name: string) => {
    let rows = [...(t[name] ?? [])]
    const b: any = {
      select: () => b, order: () => b, in: () => b, lte: () => b, gte: () => b, limit: () => b,
      eq: (col: string, v: any) => { rows = rows.filter(r => r[col] === v); return b },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: any) => resolve({ data: rows, error: null }),
    }
    return b
  }
  return { from: (n: string) => make(n) }
}

const catalogo = [
  ...['011', '050', '101', '102', '103', '133'].map(c => ({ codigo_visual: c, politica: 'linea_cero', entrada: 'CALCULADO', categoria: c === '011' ? 'aporte' : 'otro' })),
  { codigo_visual: '104', politica: 'calculado', entrada: 'CALCULADO', categoria: 'descuento' },
  { codigo_visual: '48410', politica: 'calculado', entrada: 'CALCULADO', categoria: 'descuento' },
  { codigo_visual: '111', politica: 'valor', entrada: 'CANIMP', categoria: 'descuento' },
  { codigo_visual: '993', politica: 'valor', entrada: 'CANIMP', categoria: 'descuento' },
  ...['000', '001', '006', '120003', '203', '204', '212', '214'].map(c => ({ codigo_visual: c, politica: 'valor', entrada: c === '000' ? 'CAN' : 'IMP', categoria: ['001', '006', '120003', '204', '212'].includes(c) ? 'imponible' : 'asignacion' })),
]
const final = (over: Partial<FinalFila['baja']> = {}): FinalFila => ({
  id: 'f1', baja_id: 'b1', mes: '2026-10', estado: 'lista', version: 2, requiere_recalculo: false, entradas: {}, calculo: { ya_liquidado: [] } as any,
  faltantes: [], advertencias: [], calculado_at: null, exportada_at: null, export_archivo: null, conciliada_at: null,
  baja: { id: 'b1', empleado_id: 'u1', cuil: '20111111112', fecha_baja: '2026-10-18', ...over } as any,
})
const persona = { cuil: '20111111112', legajoVisual: '002 Bis', nombre: 'PEREZ JUAN', empleadoId: 'u1' }
const propias = [
  { codigo: '000', cantidad: 8, importe: null }, { codigo: '001', cantidad: 1, importe: 400000 },
  { codigo: '120003', cantidad: 1, importe: 20000 }, { codigo: '204', cantidad: 1, importe: 50000 },
]

describe('descuentos de la liquidación final (como el mensual)', () => {
  it('eventual sin permanentes: las líneas 0/0 que Visual calcula (011, 050, 101, 102, 103, 133)', async () => {
    const r = await descuentosDeFinal(cliente({ liquidacion_concepto_catalogo: catalogo }), final(), persona, propias)
    expect(r.error).toBeNull()
    expect(r.filas.map(f => [f.codigo, f.cantidad, f.importe])).toEqual(['011', '050', '101', '102', '103', '133'].map(c => [c, 0, 0]))
    expect(r.filas.every(f => f.legajo === '002 Bis' && f.cuil === '20111111112')).toBe(true)
  })

  it('permanentes vigentes en el mes de la baja (0/0) y expedientes en 111/993 con su importe', async () => {
    const t = {
      liquidacion_concepto_catalogo: catalogo,
      liquidacion_persona: [{ id: 'p1', cuil: '20111111112' }],
      liquidacion_concepto_permanente: [
        { empleado_id: 'u1', persona_id: null, importe: null, activo: true, vigencia_desde: '2026-01-01', vigencia_hasta: null, concepto: { codigo_visual: '104' } },
        { empleado_id: null, persona_id: 'p1', importe: null, activo: true, vigencia_desde: '2026-11-01', vigencia_hasta: null, concepto: { codigo_visual: '48410' } }, // empieza después
        { empleado_id: 'otro', persona_id: null, importe: null, activo: true, vigencia_desde: '2026-01-01', vigencia_hasta: null, concepto: { codigo_visual: '48410' } }, // de otra persona
      ],
      liquidacion_expediente: [{ persona_id: 'p1', referencia: 'Exp 1', importe: 15000, slot_preferido: '993', estado: 'activo', vigencia_desde: '2026-09-01', vigencia_hasta: null }],
    }
    const r = await descuentosDeFinal(cliente(t), final(), persona, propias)
    expect(r.error).toBeNull()
    const cods = r.filas.map(f => f.codigo)
    expect(cods).toContain('104')
    expect(cods).not.toContain('48410')
    expect(r.filas.find(f => f.codigo === '993')).toMatchObject({ cantidad: 1, importe: 15000 })
  })

  it('no repite lo que ya está en la final', async () => {
    const r = await descuentosDeFinal(cliente({ liquidacion_concepto_catalogo: catalogo }), final(), persona, [...propias, { codigo: '011', cantidad: 0, importe: 0 }])
    expect(r.filas.filter(f => f.codigo === '011')).toEqual([])
  })
})
