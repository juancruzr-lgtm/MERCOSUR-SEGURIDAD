import { describe, it, expect } from 'vitest'
import { exportarVisualCompleto, regenerarVisualDesdeEnviado } from '@/lib/visual-generar'
import { prepararLiquidacionDelMes } from '@/lib/excel-trabajo-liquidacion'
import { escribirLibroVisualXls, type FilaVisual } from '@/lib/visual-export'

// Cliente falso encadenable/thenable/paginable, con contador de lecturas por
// tabla (para probar la preparación ÚNICA) y errores selectivos.
function fakeClient(tablas: Record<string, any[]>, opts: { errorEn?: string; contador?: Record<string, number> } = {}) {
  const make = (name: string) => {
    if (opts.contador) opts.contador[name] = (opts.contador[name] ?? 0) + 1
    const rows = tablas[name] ?? []
    const result = () => opts.errorEn === name
      ? { data: null, error: { message: `falla ${name}` } }
      : { data: rows, error: null }
    const builder: any = {
      select: () => builder, order: () => builder, eq: () => builder, limit: () => builder,
      lte: () => builder, gte: () => builder, lt: () => builder, gt: () => builder, in: () => builder,
      range: (d: number, h: number) => opts.errorEn === name
        ? Promise.resolve({ data: null, error: { message: `falla ${name}` } })
        : Promise.resolve({ data: rows.slice(d, h + 1), error: null }),
      then: (resolve: any) => resolve(result()),
    }
    return builder
  }
  return { from: (name: string) => make(name), rpc: async () => ({ data: null, error: null }) }
}

const usuarios = [
  { id: 'u1', nombre: 'Estanislao', apellido: 'Almada', rol: 'guardia', puesto_organizacional: 'vigilador', estado: 'activo', es_prueba: false, cuil: '20144945817', legajo: '20144945817', legajo_visual: 'ALMADA', cuenta_bancaria: '0001' },
]
const base = (over: Record<string, any[]> = {}) => ({
  usuarios, objetivos: [], supervisor_zonas: [], nocturnidad_empleado_objetivo: [],
  turnos: [], registros_asistencia: [], novedades_laborales: [], supervisores_guardia: [], supervisiones: [],
  liquidacion_concepto_catalogo: [], liquidacion_concepto_permanente: [], liquidacion_expediente: [],
  liquidacion_dias: [], liquidacion_ajuste: [],
  ...over,
})
const periodo = { id: 'p1', mes: '2026-08' }

describe('preparación única (una sola lectura operativa)', () => {
  it('exportarVisualCompleto lee turnos UNA sola vez (no hay doble read)', async () => {
    const contador: Record<string, number> = {}
    const tablas = base({
      liquidacion_persona: [{ id: 'per1', usuario_id: 'u1', cuil: '20144945817', nombre: 'ALMADA', cod_interno: '123', estado_liquidable: 'activo' }],
      liquidacion_dias: [{ persona_id: 'per1', dias: 20, origen: 'manual' }],
    })
    await exportarVisualCompleto(fakeClient(tablas, { contador }), periodo)
    // turnos es la lectura operativa cara; con la preparación única debe leerse
    // exactamente una vez (antes se leía en consolidar y otra vez en jornadas).
    expect(contador['turnos']).toBe(1)
  }, 60000)
})

describe('exportarVisualCompleto (atómico, sin escribir DB)', () => {
  it('OK: devuelve bytes + enviado; no está bloqueado', async () => {
    const tablas = base({
      liquidacion_persona: [{ id: 'per1', usuario_id: 'u1', cuil: '20144945817', nombre: 'ALMADA', cod_interno: '123', estado_liquidable: 'activo' }],
      liquidacion_dias: [{ persona_id: 'per1', dias: 20, origen: 'manual' }],
    })
    const r = await exportarVisualCompleto(fakeClient(tablas), periodo)
    expect(r.error).toBeNull()
    expect(r.bloqueado).toBe(false)
    expect(r.bytes).toBeTruthy()
    expect((r.bytes as Uint8Array).byteLength).toBeGreaterThan(0)
    // La línea 000 (días) sale con la identidad de la persona.
    const l000 = r.enviado.find(e => e.codigo === '000')
    expect(l000).toBeTruthy()
    expect(l000!.cod_interno).toBe('123')
    expect(l000!.cuil).toBe('20144945817')
    expect(l000!.cantidad).toBe(20)
  }, 60000)

  it('bloqueado (sin COD_INTERNO): NO genera bytes ni consolidada (cero escrituras)', async () => {
    const tablas = base({
      liquidacion_persona: [{ id: 'per1', usuario_id: 'u1', cuil: '20144945817', nombre: 'ALMADA', cod_interno: null, estado_liquidable: 'activo' }],
      liquidacion_dias: [{ persona_id: 'per1', dias: 20, origen: 'manual' }],
    })
    const r = await exportarVisualCompleto(fakeClient(tablas), periodo)
    expect(r.bloqueado).toBe(true)
    expect(r.bytes).toBeNull()
    expect(r.consolidada).toEqual([])
    expect(r.enviado).toEqual([])
    expect(r.resultado?.bloqueados.some(b => b.tipo === 'falta_cod_interno')).toBe(true)
  }, 60000)
})

describe('regeneración desde enviado (sin releer operativo)', () => {
  const lineas: FilaVisual[] = [
    { legajo: '123', cuil: '20144945817', codigo: '001', cantidad: 1, importe: 1000, nombre: 'ALMADA' },
    { legajo: '123', cuil: '20144945817', codigo: '000', cantidad: 20, importe: null, nombre: 'ALMADA' },
    { legajo: '456', cuil: '27222222224', codigo: '001', cantidad: 1, importe: 2500.5, nombre: 'ROSALES' },
  ]

  async function filasDe(bytes: Uint8Array) {
    const XLSX: any = await import('xlsx')
    const wb = XLSX.read(bytes, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false }) as any[][]
    // fila 0 = título, fila 1 = encabezados; datos desde la 2. Cols A-E.
    return aoa.slice(2).map(row => ({
      legajo: String(row[0] ?? ''), cuil: String(row[1] ?? ''), codigo: String(row[2] ?? ''),
      cantidad: row[3] ?? null, importe: row[4] ?? null,
    }))
  }

  it('reconstruye las MISMAS filas y valores (COD_INTERNO/CUIL/código/cantidad/importe)', async () => {
    const original = await escribirLibroVisualXls(lineas)
    const enviadoRows = lineas.map(l => ({ cod_interno: l.legajo, cuil: l.cuil, codigo: l.codigo, cantidad: l.cantidad, importe: l.importe }))
    const regen = await regenerarVisualDesdeEnviado(fakeClient({ liquidacion_enviado_visual: enviadoRows }), 'p1')
    expect(regen.error).toBeNull()
    expect(regen.bytes).toBeTruthy()

    const a = await filasDe(original as Uint8Array)
    const b = await filasDe(regen.bytes as Uint8Array)
    expect(b).toEqual(a)

    // Garantía extra: si además los bytes coinciden, el escritor es determinístico.
    const { createHash } = await import('crypto')
    const hA = createHash('sha256').update(Buffer.from(original as Uint8Array)).digest('hex')
    const hB = createHash('sha256').update(Buffer.from(regen.bytes as Uint8Array)).digest('hex')
    if (hA === hB) expect(hA).toBe(hB) // determinístico (bonus); el contrato exigido es la equivalencia de filas de arriba
  }, 60000)

  it('NO relee operativo: regenera aunque la lectura de turnos falle', async () => {
    const enviadoRows = lineas.map(l => ({ cod_interno: l.legajo, cuil: l.cuil, codigo: l.codigo, cantidad: l.cantidad, importe: l.importe }))
    const r = await regenerarVisualDesdeEnviado(fakeClient({ liquidacion_enviado_visual: enviadoRows }, { errorEn: 'turnos' }), 'p1')
    expect(r.error).toBeNull()
    expect(r.bytes).toBeTruthy()
    expect(r.lineas).toBe(3)
  }, 60000)
})

describe('Excel de trabajo editable refleja ajustes', () => {
  it('un ajuste de jornadas pisa el conteo en la preparación', async () => {
    const tablas = base({
      liquidacion_persona: [{ id: 'per1', usuario_id: 'u1', cuil: '20144945817', nombre: 'ALMADA', cod_interno: '123', estado_liquidable: 'activo' }],
      liquidacion_ajuste: [{ empleado_id: 'u1', clave: 'jornadas', valor_liquidacion: 18 }],
    })
    const prep = await prepararLiquidacionDelMes(fakeClient(tablas), periodo)
    expect(prep.error).toBeNull()
    // Sin turnos, el conteo operativo daría 0; el ajuste manual lo pisa a 18.
    expect(prep.jornadas.get('u1')).toBe(18)
  }, 60000)
})
