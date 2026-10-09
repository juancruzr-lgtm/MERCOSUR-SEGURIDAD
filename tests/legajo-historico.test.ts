import { createHash } from 'crypto'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import { leerRangos } from '@/lib/legajo-historico'
import { armarPropuestas, resumen } from '@/scripts/legajo-historico/cargar-propuestas.mjs'
import { prepararImportacion } from '@/scripts/legajo-historico/importar.mjs'
import { fechaSegura, leerHoja } from '@/scripts/legajo-historico/cargar-planillas.mjs'

// Datos ficticios. La clasificación real vive fuera del repositorio.
const H = (t: string) => createHash('sha256').update(t).digest('hex')
const doc = (x: Record<string, unknown>) => ({
  ruta: 'EMPLEADOS/X/a.pdf', sha256: H(String(Math.random())), ext: '.pdf', bytes: 10, paginas: 1, area: 'legajo',
  tipos: ['dni'], tipos_por_pagina: null, confianza: 'contenido', persona: '30111222', criterio: 'ocr', revisar: [], duplicado_de: null, ...x,
})

describe('Carga de propuestas (simulación)', () => {
  it('sólo el área legajo, sin duplicados, sin recibos ni Word/Excel', () => {
    const { propuestas, descartes } = armarPropuestas([
      doc({}), doc({ area: 'CLIENTES' }), doc({ duplicado_de: 'x' }), doc({ tipos: ['recibo'] }), doc({ ext: '.xlsx' }),
    ], { lote: 'prueba' })
    expect(propuestas).toHaveLength(1)
    expect(descartes).toEqual({ fuera_del_area_legajo: 1, duplicado_exacto: 1, recibos_contratos_homologaciones: 1, formato_no_admitido: 1 })
  })
  it('compilados, varias personas y DNI distinto a la carpeta entran como conflicto', () => {
    const { propuestas } = armarPropuestas([
      doc({ tipos_por_pagina: [['dni'], ['cuil']], tipos: ['dni', 'cuil'] }),
      doc({ revisar: ['varias_personas'] }),
      doc({ revisar: ['persona_distinta_a_carpeta'] }),
    ], { lote: 'prueba' })
    expect(propuestas.every((p: { conflicto: string | null }) => p.conflicto)).toBe(true)
    expect(propuestas[0].tipo_sugerido).toBeNull()
  })
  it('un DNI excluido nunca se asocia automáticamente', () => {
    const { propuestas } = armarPropuestas([doc({ persona: '30999888' })], { lote: 'p', excluirDni: new Set(['30999888']) })
    expect(propuestas[0].conflicto).toMatch(/excluido/)
  })
  it('mapea tipos del clasificador al catálogo; "legal" es reservado de Gerencia', () => {
    const { propuestas } = armarPropuestas([doc({ tipos: ['legal'] }), doc({ tipos: ['epp'] })], { lote: 'p' })
    expect(propuestas.map((p: { tipo_sugerido: string }) => p.tipo_sugerido)).toEqual(['actuaciones_legales', 'entrega_epp'])
    expect(resumen(propuestas).total).toBe(2)
  })
})

describe('Importación (preparación, sin escribir)', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'mega-'))
  afterAll(() => rmSync(raiz, { recursive: true, force: true }))
  mkdirSync(join(raiz, 'EMPLEADOS'), { recursive: true })
  const pdf = Buffer.from('%PDF-1.4\n% ficticio\n')
  writeFileSync(join(raiz, 'EMPLEADOS', 'dni.pdf'), pdf)
  writeFileSync(join(raiz, 'EMPLEADOS', 'planilla.xlsx'), 'no')
  const antes = statSync(join(raiz, 'EMPLEADOS', 'dni.pdf')).mtimeMs
  const P = (x: Record<string, unknown>) => ({ id: 'p', ruta_origen: 'EMPLEADOS/dni.pdf', hash_origen: H(pdf.toString('latin1')), pagina_desde: null, pagina_hasta: null, ...x })

  it('verifica el hash del archivo de MEGA y arma la copia', async () => {
    const r = await prepararImportacion(P({ hash_origen: createHash('sha256').update(pdf).digest('hex') }), raiz)
    expect(r.ok).toBe(true)
    expect(r.archivo.mime).toBe('application/pdf')
  })
  it('si el archivo cambió, no se importa', async () => {
    expect((await prepararImportacion(P({ hash_origen: '0'.repeat(64) }), raiz)).motivo).toMatch(/hash distinto/)
  })
  it('no sale de la carpeta raíz ni importa formatos no admitidos', async () => {
    expect((await prepararImportacion(P({ ruta_origen: '../x.pdf' }), raiz)).motivo).toMatch(/fuera de la carpeta/)
    const x = readFileSync(join(raiz, 'EMPLEADOS', 'planilla.xlsx'))
    expect((await prepararImportacion(P({ ruta_origen: 'EMPLEADOS/planilla.xlsx', hash_origen: createHash('sha256').update(x).digest('hex') }), raiz)).motivo).toMatch(/formato/)
  })
  it('no modifica el archivo de origen', () => {
    expect(statSync(join(raiz, 'EMPLEADOS', 'dni.pdf')).mtimeMs).toBe(antes)
  })
})

describe('Separar páginas', () => {
  it('lee rangos con tipo', () => {
    expect(leerRangos('1-2 dni, 3 cuil', 4)).toEqual({ rangos: [{ desde: 1, hasta: 2, tipo: 'dni' }, { desde: 3, hasta: 3, tipo: 'cuil' }], error: null })
  })
  it('rechaza rangos fuera del PDF o mal escritos', () => {
    expect(leerRangos('3-9', 4).error).toMatch(/inválido/)
    expect(leerRangos('dni 1', 4).error).toMatch(/No se entiende/)
    expect(leerRangos('', 4).error).toMatch(/al menos/)
  })
})


describe('Planillas viejas', () => {
  it('fechas: sólo lo inequívoco (celda de fecha o dd-mm-aaaa)', () => {
    expect(fechaSegura(new Date(Date.UTC(2025, 4, 10)))).toBe('2025-05-10')
    expect(fechaSegura('10-05-2025')).toBe('2025-05-10')
    expect(fechaSegura('5/10/25')).toBeNull()
    expect(fechaSegura('10/05')).toBeNull()
    expect(fechaSegura('OK')).toBeNull()
  })
  const filas = [
    ['NOMBRE', 'DNI', 'N° DE CUENTA.', 'CUIL', 'TELEFONO', 'NACIMIENTO', 'DOMICILIO', 'ART.51', 'REINC.'],
    ['FICTICIO', '30.111.222', '999999', '20301112229', '341', '02-05-1980', 'Calle 1', 'OK', 'FALTA'],
    ['SIN DNI', 'SI', '1', '2', '3', '01-01-1990', 'x', 'OK', 'OK'],
  ]
  it('datos: nunca lee cuenta bancaria, CUIL ni teléfono', () => {
    const r = leerHoja(filas, 'datos')
    expect(r.map((x: { campo: string }) => x.campo).sort()).toEqual(['domicilio_calle', 'fecha_nacimiento'])
    expect(JSON.stringify(r)).not.toMatch(/999999|20301112229/)
  })
  it('indicios: "FALTA" no es un indicio; sin DNI numérico no hay fila', () => {
    const r = leerHoja(filas, 'indicios')
    expect(r).toEqual([{ dni: '30111222', tipo: 'art51', dato: 'art51', valor: 'OK', fecha: null }])
  })
})
