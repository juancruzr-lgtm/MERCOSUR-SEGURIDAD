import { describe, it, expect } from 'vitest'
import { exportarVisualDeEmpleado } from '@/lib/visual-generar'

// EDITOR POR EMPLEADO — exportarVisualDeEmpleado: mismo pipeline que el archivo
// completo, pero quedándose SÓLO con las líneas del empleado pedido (por CUIL o
// COD_INTERNO) y reflejando en vivo los expedientes vigentes. No persiste nada.
//
// Nota: el cliente falso no aplica `.eq('estado','activo')` (lo hace Postgres),
// así que la exclusión de expedientes dados de baja se valida en producción; acá
// se cubre el filtro por persona, el filtro de VIGENCIA (que corre en JS) y que el
// archivo del otro empleado NO se mezcla.

function fakeClient(tablas: Record<string, any[]>) {
  const make = (name: string) => {
    const rows = tablas[name] ?? []
    const builder: any = {
      select: () => builder, order: () => builder, eq: () => builder, limit: () => builder,
      lte: () => builder, gte: () => builder, lt: () => builder, gt: () => builder, in: () => builder,
      range: (d: number, h: number) => Promise.resolve({ data: rows.slice(d, h + 1), error: null }),
      then: (resolve: any) => resolve({ data: rows, error: null }),
    }
    return builder
  }
  return { from: (name: string) => make(name), rpc: async () => ({ data: null, error: null }) }
}

const usuarios = [
  { id: 'u1', nombre: 'Estanislao', apellido: 'Almada', rol: 'guardia', puesto_organizacional: 'vigilador', estado: 'activo', es_prueba: false, cuil: '20144945817', legajo: '20144945817', legajo_visual: 'ALMADA', cuenta_bancaria: '0001' },
  { id: 'u2', nombre: 'Rosa', apellido: 'Rosales', rol: 'guardia', puesto_organizacional: 'vigilador', estado: 'activo', es_prueba: false, cuil: '27222222224', legajo: '27222222224', legajo_visual: 'ROSALES', cuenta_bancaria: '0002' },
]
const periodo = { id: 'p1', mes: '2026-08' }

function base(over: Record<string, any[]> = {}) {
  return {
    usuarios, objetivos: [], supervisor_zonas: [], nocturnidad_empleado_objetivo: [],
    turnos: [], registros_asistencia: [], novedades_laborales: [], supervisores_guardia: [], supervisiones: [],
    liquidacion_concepto_catalogo: [], liquidacion_concepto_permanente: [], liquidacion_expediente: [],
    liquidacion_ajuste: [],
    liquidacion_persona: [
      { id: 'per1', usuario_id: 'u1', cuil: '20144945817', nombre: 'ALMADA', cod_interno: '123', estado_liquidable: 'activo' },
      { id: 'per2', usuario_id: 'u2', cuil: '27222222224', nombre: 'ROSALES', cod_interno: '456', estado_liquidable: 'activo' },
    ],
    liquidacion_dias: [
      { persona_id: 'per1', dias: 20, origen: 'manual' },
      { persona_id: 'per2', dias: 15, origen: 'manual' },
    ],
    ...over,
  }
}

describe('exportarVisualDeEmpleado', () => {
  it('devuelve SÓLO las líneas del empleado pedido (por CUIL); no mezcla al resto', async () => {
    const tablas = base({
      liquidacion_expediente: [
        // Embargo vigente de ALMADA → debe salir como slot 111 con su importe.
        { persona_id: 'per1', referencia: 'Embargo', importe: 50000, slot_preferido: '111', estado: 'activo', vigencia_desde: '2026-01-01', vigencia_hasta: null },
        // Expediente de ALMADA YA VENCIDO en agosto (vigencia hasta julio) → se excluye por vigencia.
        { persona_id: 'per1', referencia: 'Viejo', importe: 9999, slot_preferido: '993', estado: 'activo', vigencia_desde: '2026-01-01', vigencia_hasta: '2026-07-31' },
      ],
    })
    const r = await exportarVisualDeEmpleado(fakeClient(tablas), periodo, { cuil: '20-14494581-7' })
    expect(r.error).toBeNull()
    expect(r.bloqueado).toBe(false)
    expect(r.bytes).toBeTruthy()
    expect((r.bytes as Uint8Array).byteLength).toBeGreaterThan(0)
    expect(r.nombre).toBe('ALMADA')
    // Todas las líneas son del CUIL pedido (el CUIL entró con guiones: se normaliza).
    expect(r.lineas.length).toBeGreaterThan(0)
    expect(r.lineas.every(l => l.cuil === '20144945817')).toBe(true)
    // ROSALES no aparece.
    expect(r.lineas.some(l => l.cuil === '27222222224')).toBe(false)
    // El embargo vigente sale como slot 111 con su importe…
    expect(r.lineas.some(l => l.codigo === '111' && l.importe === 50000)).toBe(true)
    // …y el vencido NO (filtro de vigencia en JS).
    expect(r.lineas.some(l => l.importe === 9999)).toBe(false)
  }, 60000)

  it('filtra también por COD_INTERNO', async () => {
    const r = await exportarVisualDeEmpleado(fakeClient(base()), periodo, { codInterno: '123' })
    expect(r.error).toBeNull()
    expect(r.lineas.length).toBeGreaterThan(0)
    expect(r.lineas.every(l => l.legajo === '123')).toBe(true)
  }, 60000)

  it('empleado sin identificar → error, sin bytes', async () => {
    const r = await exportarVisualDeEmpleado(fakeClient(base()), periodo, { cuil: null, codInterno: null })
    expect(r.bytes).toBeNull()
    expect(r.error).toBeTruthy()
  }, 60000)

  it('CUIL inexistente en el padrón → sin líneas, sin bytes', async () => {
    const r = await exportarVisualDeEmpleado(fakeClient(base()), periodo, { cuil: '20999999993' })
    expect(r.bytes).toBeNull()
    expect(r.lineas).toEqual([])
    expect(r.error).toBeTruthy()
  }, 60000)
})
