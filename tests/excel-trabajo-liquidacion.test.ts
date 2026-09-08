import { describe, it, expect } from 'vitest'
import { generarExcelTrabajoLiquidacion } from '@/lib/excel-trabajo-liquidacion'

// Cliente Supabase falso: cada método de filtro/orden devuelve el mismo builder
// (encadenable); el builder es thenable (consultas directas) y además expone
// .range() (consultas paginadas vía fetchPaginadoResult). Devuelve las filas
// del `tabla` pedido; .range(d,h) pagina en memoria.
function fakeClient(tablas: Record<string, any[]>, opts: { errorEn?: string } = {}) {
  const make = (name: string) => {
    const rows = tablas[name] ?? []
    const result = () => opts.errorEn === name
      ? { data: null, error: { message: `falla ${name}` } }
      : { data: rows, error: null }
    const builder: any = {
      select: () => builder, order: () => builder, eq: () => builder,
      lte: () => builder, gte: () => builder, lt: () => builder, gt: () => builder,
      in: () => builder,
      range: (d: number, h: number) => {
        if (opts.errorEn === name) return Promise.resolve({ data: null, error: { message: `falla ${name}` } })
        return Promise.resolve({ data: rows.slice(d, h + 1), error: null })
      },
      then: (resolve: any) => resolve(result()),
    }
    return builder
  }
  return { from: (name: string) => make(name) }
}

const empleadosBase = [
  { id: 'u1', nombre: 'Estanislao', apellido: 'Almada', rol: 'guardia', puesto_organizacional: 'vigilador', estado: 'activo', es_prueba: false, cuil: '20144945817', legajo: '20144945817', legajo_visual: 'ALMADA', cuenta_bancaria: '0001234567' },
  { id: 'u2', nombre: 'Sergio', apellido: 'Rosales', rol: 'admin', puesto_organizacional: 'supervisor', estado: 'activo', es_prueba: false, cuil: '20295393522', legajo: '20295393522', legajo_visual: 'ROSALES', cuenta_bancaria: '0007654321' },
]

const tablasVacias = {
  usuarios: empleadosBase, objetivos: [], supervisor_zonas: [], nocturnidad_empleado_objetivo: [],
  turnos: [], registros_asistencia: [], novedades_laborales: [], supervisores_guardia: [], supervisiones: [],
}

async function leerHoja(buf: ArrayBuffer) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf)
  return wb.getWorksheet('Liquidación')!
}

describe('generarExcelTrabajoLiquidacion (LIQ2A)', () => {
  it('genera el Excel de trabajo del mes con todos los activos (regla dura: sin datos igual entran)', async () => {
    const r = await generarExcelTrabajoLiquidacion(fakeClient(tablasVacias), '2026-08')
    expect(r.error).toBeNull()
    // exceljs devuelve ArrayBuffer en el navegador y Buffer en Node; Blob acepta
    // ambos. Alcanza con verificar que es un buffer binario no vacío.
    expect(r.buf).toBeTruthy()
    expect((r.buf as any).byteLength).toBeGreaterThan(0)
    expect(r.filas).toBe(2) // los dos activos, aunque no haya turnos
  }, 60000)

  it('el archivo lleva el título de Visual y la identidad técnica oculta (usuario_id/periodo) para el reimport', async () => {
    const r = await generarExcelTrabajoLiquidacion(fakeClient(tablasVacias), '2026-08')
    const ws = await leerHoja(r.buf!)
    expect(String(ws.getCell('A1').value)).toContain('VisualSueldos')
    // Encabezados de identidad oculta en fila 6.
    expect(String(ws.getCell('BD6').value)).toBe('usuario_id')
    expect(String(ws.getCell('BE6').value)).toBe('periodo')
    // Alguna fila de datos debe traer el período y un usuario_id real.
    let hayPeriodo = false, hayUsuario = false
    ws.eachRow((row) => {
      if (String(row.getCell('BE').value) === '2026-08') hayPeriodo = true
      const bd = String(row.getCell('BD').value)
      if (bd === 'u1' || bd === 'u2') hayUsuario = true
    })
    expect(hayPeriodo).toBe(true)
    expect(hayUsuario).toBe(true)
  }, 60000)

  it('rechaza un mes con formato inválido', async () => {
    const r = await generarExcelTrabajoLiquidacion(fakeClient(tablasVacias), '2026/08')
    expect(r.buf).toBeNull()
    expect(r.error).toMatch(/Mes inválido/)
  })

  it('padrón vacío (sin activos) → error claro, sin archivo', async () => {
    const soloPrueba = { ...tablasVacias, usuarios: [{ ...empleadosBase[0], es_prueba: true }] }
    const r = await generarExcelTrabajoLiquidacion(fakeClient(soloPrueba), '2026-08')
    expect(r.buf).toBeNull()
    expect(r.error).toMatch(/padrón vacío|activos/i)
  }, 60000)

  it('propaga un error de consulta (turnos) sin romper', async () => {
    const r = await generarExcelTrabajoLiquidacion(fakeClient(tablasVacias, { errorEn: 'turnos' }), '2026-08')
    expect(r.buf).toBeNull()
    expect(r.error).toMatch(/falla turnos/)
  }, 60000)
})
