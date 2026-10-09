import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { ESTADOS_VISUALES, estadoVisual, filtrarHistorico, motivoFueraDeLote, nivelHistorico, nivelIdentificacion, validarRangos } from '@/lib/legajo-historico'
import type { PropuestaHistorica, TipoBandeja } from '@/lib/legajo-historico'

const ref = (x: { tipo?: string | null; tipo_sugerido?: string | null; empleado_id?: string | null; sugerido?: boolean }) => ({
  tipo: x.tipo ?? null, tipo_sugerido: x.tipo_sugerido ?? null, empleado_id: x.empleado_id ?? null,
  sugerido: x.sugerido ? { id: 'e', nombre: 'A', apellido: 'B', legajo: null, estado: 'activo' } : null,
})

describe('Archivo histórico: filtros de la bandeja', () => {
  const lista = [ref({ tipo_sugerido: 'dni', sugerido: true }), ref({ tipo: 'cuil', tipo_sugerido: 'dni', empleado_id: 'x' }), ref({}), ref({ tipo_sugerido: 'dni' })]
  it('por categoría: asignada pisa a sugerida; "(sin)" = sin categoría', () => {
    expect(filtrarHistorico(lista, { categoria: 'dni' })).toHaveLength(2)
    expect(filtrarHistorico(lista, { categoria: 'cuil' })).toHaveLength(1)
    expect(filtrarHistorico(lista, { categoria: '(sin)' })).toHaveLength(1)
  })
  it('sólo sin persona asociada', () => {
    expect(filtrarHistorico(lista, { soloSinPersona: true })).toHaveLength(2)
  })
})

describe('Archivo histórico: localizar o asociar no es validar', () => {
  it('ningún nivel previo a Documentación dice "válido", "vigente" ni "aprobado"', () => {
    for (const e of ['pendiente', 'conflicto', 'aceptada', 'importada', 'descartada', 'separada'] as const) {
      expect(nivelHistorico(e).texto).not.toMatch(/v[áa]lid[oa]\b|vigente|aprobad/i)
    }
    expect(nivelHistorico('aceptada').texto).toMatch(/sin validar/)
  })
  it('la situación documental y los indicadores no usan referencias históricas (sólo documentos del legajo)', () => {
    for (const a of ['documentacion.ts', 'documentacion-situacion.ts']) {
      expect(readFileSync(join(__dirname, '..', 'lib', a), 'utf8')).not.toMatch(/legajo_historico|legajo-historico|PistaHistorica/)
    }
    // En la matriz, la referencia histórica es una marca aparte: no entra en celdaDe ni en indicadoresMatriz.
    const matriz = readFileSync(join(__dirname, '..', 'components', 'documentacion', 'MatrizDocumentacion.tsx'), 'utf8')
    expect(matriz).toMatch(/indicadoresMatriz\(filas\)/)
    expect(matriz).not.toMatch(/celdaDe\([^)]*pista/)
  })
  it('ningún estado visual previo a la revisión dice validado', () => {
    for (const e of ['pendiente', 'conflicto', 'aceptada', 'descartada', 'separada'] as const) {
      expect(estadoVisual({ estado: e, empleado_id: null, sugerido: null }).texto).not.toMatch(/\bvalidado|vigente|aprobad/i)
    }
    expect(estadoVisual({ estado: 'importada', empleado_id: 'x', sugerido: null, documento_estado: 'pendiente_revision' }).clave).toBe('pendiente_validacion')
    expect(estadoVisual({ estado: 'importada', empleado_id: 'x', sugerido: null, documento_estado: 'aprobado' }).clave).toBe('documento_validado')
  })
})

describe('Archivo histórico: categoría fuera del catálogo vigente', () => {
  it('se puede filtrar y no se confunde con «sin categoría»', () => {
    const lista = [ref({ tipo_sugerido: 'alta_art' }), ref({ tipo_sugerido: 'dni' }), ref({})]
    expect(filtrarHistorico(lista, { categoria: '(fuera)', activas: ['dni'] }).map(p => p.tipo_sugerido)).toEqual(['alta_art'])
    expect(filtrarHistorico(lista, { categoria: '(sin)', activas: ['dni'] })).toHaveLength(1)
  })
})

const prop = (x: Partial<PropuestaHistorica>): PropuestaHistorica => ({
  id: 'p', padre_id: null, lote: 'l', ruta_origen: 'A/b.pdf', indexado: true, bytes: null, paginas: 1, pagina_desde: null, pagina_hasta: null,
  tipo_sugerido: 'dni', confianza: 'alta', criterio: null, senales: {}, estado: 'pendiente', motivo_conflicto: null,
  sugerido: { id: 'e', nombre: 'A', apellido: 'B', legajo: null, estado: 'activo' }, empleado_id: null, tipo: null, motivo: null, ...x,
})
const tipo = (codigo: string, x: Partial<TipoBandeja> = {}): TipoBandeja => ({ codigo, nombre: codigo, campo_fecha: 'no', campo_vencimiento: 'no', etiqueta_detalle: null, multiple: false, ...x })

describe('Archivo histórico: los 7 estados visuales', () => {
  it('salen de los estados de la base', () => {
    expect(ESTADOS_VISUALES).toHaveLength(7)
    expect(estadoVisual(prop({ sugerido: null })).clave).toBe('localizado')
    expect(estadoVisual(prop({})).clave).toBe('identificacion_propuesta')
    expect(estadoVisual(prop({ estado: 'aceptada' })).clave).toBe('asociacion_confirmada')
    expect(estadoVisual(prop({ estado: 'conflicto', sugerido: null })).clave).toBe('conflicto')
    expect(estadoVisual(prop({ estado: 'descartada' })).clave).toBe('descartado')
  })
})

describe('Archivo histórico: nivel de identificación', () => {
  it('usa el nivel del índice; si no, DNI único = inequívoca; conflicto con DNI = dudosa', () => {
    expect(nivelIdentificacion(prop({ senales: { nivel: 'probable' } }))).toBe('probable')
    expect(nivelIdentificacion(prop({}))).toBe('inequivoca')
    expect(nivelIdentificacion(prop({ estado: 'conflicto', sugerido: null, dni_sugerido: '30111222' }))).toBe('dudosa')
    expect(nivelIdentificacion(prop({ sugerido: null }))).toBe('sin_identificar')
  })
  it('se puede filtrar por nivel y por conflictivos', () => {
    const l = [prop({}), prop({ senales: { nivel: 'probable' } }), prop({ estado: 'conflicto', sugerido: null })]
    expect(filtrarHistorico(l, { nivel: 'probable' })).toHaveLength(1)
    expect(filtrarHistorico(l, { soloConflictos: true })).toHaveLength(1)
    expect(filtrarHistorico(l, { estadoVisual: 'identificacion_propuesta' })).toHaveLength(2)
  })
})

describe('Archivo histórico: confirmación en lote', () => {
  const tipos = [tipo('dni'), tipo('cuil', { campo_fecha: 'obligatoria' }), tipo('cursos', { etiqueta_detalle: 'Curso', multiple: true }), tipo('cred', { campo_vencimiento: 'declarado' })]
  it('sólo inequívocas sin datos que completar', () => {
    expect(motivoFueraDeLote(prop({}), tipos)).toBeNull()
    expect(motivoFueraDeLote(prop({ estado: 'conflicto' }), tipos)).toMatch(/conflicto/)
    expect(motivoFueraDeLote(prop({ motivo_conflicto: 'x' }), tipos)).toMatch(/conflicto/)
    expect(motivoFueraDeLote(prop({ sugerido: null }), tipos)).toMatch(/sin persona/)
    expect(motivoFueraDeLote(prop({ senales: { nivel: 'probable' } }), tipos)).toMatch(/inequívoca/)
    expect(motivoFueraDeLote(prop({ indexado: false }), tipos)).toMatch(/índice/)
    expect(motivoFueraDeLote(prop({ confianza: 'media' }), tipos)).toMatch(/confianza/)
    expect(motivoFueraDeLote(prop({ tipo_sugerido: 'alta_art' }), tipos)).toMatch(/no se exige/)
    expect(motivoFueraDeLote(prop({ tipo_sugerido: null }), tipos)).toMatch(/sin categoría/)
    expect(motivoFueraDeLote(prop({ tipo_sugerido: 'cuil' }), tipos)).toMatch(/fecha/)
    expect(motivoFueraDeLote(prop({ tipo_sugerido: 'cursos' }), tipos)).toMatch(/curso/)
    expect(motivoFueraDeLote(prop({ tipo_sugerido: 'cred' }), tipos)).toMatch(/vencimiento/)
    expect(motivoFueraDeLote(prop({ senales: { revisar: ['compilado_varios_documentos'] } }), tipos)).toMatch(/señales/)
  })
})

describe('Archivo histórico: asignar páginas de un PDF compilado', () => {
  it('rangos válidos, sin superposición, dentro del PDF y con categoría', () => {
    expect(validarRangos([{ desde: 1, hasta: 2, tipo: 'dni' }, { desde: 3, hasta: 3, tipo: 'cuil' }], 3)).toBeNull()
    expect(validarRangos([], 3)).toMatch(/al menos/)
    expect(validarRangos([{ desde: 1, hasta: 2, tipo: 'dni' }, { desde: 2, hasta: 3, tipo: 'cuil' }], 3)).toMatch(/dos rangos/)
    expect(validarRangos([{ desde: 1, hasta: 4, tipo: 'dni' }], 3)).toMatch(/3 páginas/)
    expect(validarRangos([{ desde: 2, hasta: 1, tipo: 'dni' }], 3)).toMatch(/inválido/)
    expect(validarRangos([{ desde: 1, hasta: 1, tipo: null }], 3)).toMatch(/categoría/)
  })
})

describe('Archivo histórico: documento rechazado', () => {
  it('copiado y rechazado en Documentación no figura como pendiente ni validado', () => {
    const e = estadoVisual({ estado: 'importada', empleado_id: 'x', sugerido: null, documento_estado: 'rechazado' })
    expect(e.clave).toBe('descartado')
    expect(e.texto).toMatch(/rechazado/)
  })
})
