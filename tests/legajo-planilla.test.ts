import { describe, expect, it } from 'vitest'
import { agruparPlanilla, resumirPlanilla } from '@/lib/legajo-planilla'
import type { DatoPlanilla } from '@/lib/legajo-planilla'

const dato = (empleado_id: string, estado: DatoPlanilla['estado'], campo = 'fecha_nacimiento'): DatoPlanilla => ({
  id: Math.random().toString(), empleado_id, campo, valor_anterior: null, valor_nuevo: '1980-01-01', estado,
  motivo: null, motivo_rechazo: null, creado_at: '2026-10-09T16:32:50Z', revisado_at: null, revisado_por: null,
})
const personas = new Map([
  ['a', { nombre: 'Juan', apellido: 'PÉREZ', legajo: '12' }],
  ['b', { nombre: 'Ana', apellido: 'ACOSTA', legajo: '7' }],
])

describe('Datos recuperados de la planilla', () => {
  const datos = [dato('a', 'pendiente_confirmacion'), dato('a', 'descartado', 'credencial_numero'), dato('b', 'pendiente'), dato('b', 'aprobado', 'lugar_nacimiento')]
  it('resume por estado y cuenta personas', () => {
    expect(resumirPlanilla(datos)).toMatchObject({ total: 4, personas: 2, pendiente_confirmacion: 1, descartado: 1, pendiente: 1, aprobado: 1, rechazado: 0 })
  })
  it('agrupa por persona en orden alfabético', () => {
    const g = agruparPlanilla(datos, personas)
    expect(g.map(x => x.apellido)).toEqual(['ACOSTA', 'PÉREZ'])
    expect(g[1].datos).toHaveLength(2)
  })
  it('filtra por estado y por persona (sin tildes) o legajo', () => {
    expect(agruparPlanilla(datos, personas, { estado: 'descartado' }).map(x => x.apellido)).toEqual(['PÉREZ'])
    expect(agruparPlanilla(datos, personas, { texto: 'perez' })).toHaveLength(1)
    expect(agruparPlanilla(datos, personas, { texto: '7' }).map(x => x.apellido)).toEqual(['ACOSTA'])
  })
})
