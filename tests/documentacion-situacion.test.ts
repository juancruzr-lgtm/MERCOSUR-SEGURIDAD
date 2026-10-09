import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { celdaDe, filtrarMatriz, indicadoresMatriz } from '@/lib/documentacion-situacion'
import { situacionDeTipo } from '@/lib/documentacion'
import type { DocumentoLegajo, SituacionMarcada, TipoDocumento } from '@/lib/documentacion'

const tipo = (t: Partial<TipoDocumento> = {}): TipoDocumento => ({
  codigo: 'x', nombre: 'X', ayuda: null, orden: 1, requisito: 'obligatorio', etapa: 'ingreso', caras: null, multiple: false,
  campo_fecha: 'opcional', etiqueta_fecha: 'Fecha', campo_vencimiento: 'no', vigencia_meses: null, etiqueta_detalle: null,
  sube_vigilador: true, sensibilidad: 'comun', constancia: 'conformidad', texto_constancia: 'ok', referencia: null, ...t,
})
const doc = (d: Partial<DocumentoLegajo>): DocumentoLegajo => ({ id: Math.random().toString(), tipo: 'x', detalle: null,
  fecha_emision: null, vence_el: null, origen: 'vigilador', estado: 'aprobado', confirmado_at: '2026-10-01T00:00:00Z', ...d })
const HOY = '2026-10-09'
const celda = (docs: Partial<DocumentoLegajo>[], t: Partial<TipoDocumento> = {}, marcas: SituacionMarcada[] = []) =>
  celdaDe(situacionDeTipo(tipo(t), docs.map(doc), HOY, marcas)).corto

describe('Situación documental por categoría', () => {
  it('validado, en revisión, rechazado, para confirmar', () => {
    expect(celda([{}])).toBe('OK')
    expect(celda([{ estado: 'pendiente_revision' }])).toBe('Rev')
    expect(celda([{ estado: 'rechazado' }])).toBe('Rech')
    expect(celda([{ estado: 'pendiente_aceptacion', origen: 'administracion' }])).toBe('Conf')
  })
  it('vencido y por vencer sólo si el documento tiene vencimiento', () => {
    expect(celda([{ vence_el: '2026-09-01' }])).toBe('Venc')
    expect(celda([{ vence_el: '2026-10-20' }])).toBe('xVen')
    expect(celda([{ vence_el: null }])).toBe('OK') // sin vencimiento: no se inventa
  })
  it('faltante, solicitado y no corresponde', () => {
    expect(celda([])).toBe('Falta')
    expect(celda([], {}, [{ tipo: 'x', situacion: 'solicitado', motivo: null }])).toBe('Sol')
    expect(celda([], {}, [{ tipo: 'x', situacion: 'no_corresponde', motivo: 'x' }])).toBe('N/C')
    expect(celda([], { requisito: 'si_corresponde' })).toBe('·')
  })
  it('un documento validado con un reemplazo en revisión muestra la revisión', () => {
    expect(celda([{}, { estado: 'pendiente_revision', confirmado_at: '2026-10-08T00:00:00Z' }])).toBe('Rev')
  })
})

describe('Catálogo: reglas de vencimiento', () => {
  const sql = readFileSync(join(__dirname, '..', 'supabase', 'migrations', '20261009140000_documentacion_legajo.sql'), 'utf8')
  it('el RNR (antecedentes nacionales) se renueva cada 6 meses', () => {
    expect(/\('antecedentes_rnr'[\s\S]*?'calculado', 6,/.test(sql)).toBe(true)
  })
  it('la credencial lleva el vencimiento que figura en el documento', () => {
    expect(/\('credencial'[\s\S]*?'declarado', null,/.test(sql)).toBe(true)
  })
  it('ningún otro documento tiene vencimiento inventado', () => {
    const conVencimiento = Array.from(sql.matchAll(/\('([a-z_0-9]+)', '[^']+',[^\n]*\n[^\n]*'(calculado|declarado)'/g), m => m[1])
    expect(conVencimiento.sort()).toEqual(['antecedentes_rnr', 'credencial'])
  })
})

describe('Tablero y filtros de la matriz', () => {
  const persona = (apellido: string, legajo: string) =>
    ({ empleado_id: apellido, nombre: 'X', apellido, legajo, rol: null, puesto: null, situaciones: [], documentos: [] })
  const fila = (apellido: string, legajo: string, estados: Partial<DocumentoLegajo>[][], tipos = ['dni', 'cuil']) => {
    const celdas = tipos.map((codigo, i) => {
      const t = tipo({ codigo })
      return { t, s: situacionDeTipo(t, (estados[i] ?? []).map(d => doc({ tipo: codigo, ...d })), HOY, []) }
    })
    const obligatorias = celdas.filter(c => c.s.base !== 'no_corresponde')
    const validadas = obligatorias.filter(c => c.s.base === 'validado' || c.s.base === 'por_vencer').length
    return { p: persona(apellido, legajo), celdas, validadas, obligatorias: obligatorias.length }
  }
  const filas = [
    fila('GÓMEZ', 'L1', [[{}], [{}]]),                                  // completo
    fila('PÉREZ', 'L2', [[{ estado: 'pendiente_revision' }], []]),      // en revisión + falta
    fila('SOSA', 'L3', [[{ estado: 'rechazado' }], [{ vence_el: '2026-09-01' }]]), // rechazado + vencido
  ]
  it('indicadores del total', () => {
    expect(indicadoresMatriz(filas)).toMatchObject({
      empleados: 3, completos: 1, incompletos: 2, enRevision: 1, rechazados: 1, vencidos: 1, pendientesPresentacion: 1,
    })
  })
  it('filtra por persona sin importar tildes ni mayúsculas, y por legajo', () => {
    expect(filtrarMatriz(filas, { texto: 'gomez' }).map(f => f.p.apellido)).toEqual(['GÓMEZ'])
    expect(filtrarMatriz(filas, { texto: 'l3' }).map(f => f.p.apellido)).toEqual(['SOSA'])
  })
  it('filtra por estado y por categoría', () => {
    expect(filtrarMatriz(filas, { estado: 'Rech' }).map(f => f.p.apellido)).toEqual(['SOSA'])
    expect(filtrarMatriz(filas, { estado: 'Falta' }).map(f => f.p.apellido)).toEqual(['PÉREZ'])
    // Con categoría, el estado se busca sólo en esa columna
    expect(filtrarMatriz(filas, { tipo: 'cuil', estado: 'Rech' })).toEqual([])
    expect(filtrarMatriz(filas, { tipo: 'cuil' })[0].celdas.map(c => c.t.codigo)).toEqual(['cuil'])
  })
  it('sólo incompletos', () => {
    expect(filtrarMatriz(filas, { soloIncompletos: true }).map(f => f.p.apellido)).toEqual(['PÉREZ', 'SOSA'])
  })
})
