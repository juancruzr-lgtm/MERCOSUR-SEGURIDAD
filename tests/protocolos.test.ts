import { describe, expect, it } from 'vitest'
import {
  VIGENCIA_CACHE_MS, aplicarAperturasLocales, armarCache, compararLineas, documentoParaAviso,
  documentosDeTurno, encolarApertura, leerCache, leerCola, separarLecturas, vistaProtocolo,
} from '@/lib/protocolos'
import type { DocumentoVigilador, LecturaProtocolo } from '@/lib/protocolos'

const doc = (p: Partial<DocumentoVigilador>): DocumentoVigilador => ({
  version_id: 'v1', objetivo_id: 'o1', objetivo_nombre: 'RANDSTAD', puesto_id: null, puesto_nombre: null,
  numero: 1, titulo: 't', texto: 'texto', texto_sha256: 'a'.repeat(64), aprobado_at: null,
  turnos: ['t1'], abierto_at: null, confirmado_at: null, ...p,
})
const AHORA = Date.UTC(2026, 9, 15, 12, 0, 0)

describe('copia local para leer sin señal', () => {
  it('devuelve la copia sólo a la misma sesión', () => {
    const raw = JSON.stringify(armarCache('auth-A', [doc({})], AHORA))
    expect(leerCache(raw, 'auth-A', AHORA + 1000).documentos).toHaveLength(1)
  })

  it('dispositivo compartido: otra persona no ve la copia y se ordena borrarla', () => {
    const raw = JSON.stringify(armarCache('auth-A', [doc({})], AHORA))
    const r = leerCache(raw, 'auth-B', AHORA)
    expect(r.documentos).toBeNull()
    expect(r.borrar).toBe(true)
  })

  it('sin sesión no muestra nada', () => {
    const raw = JSON.stringify(armarCache('auth-A', [doc({})], AHORA))
    expect(leerCache(raw, null, AHORA)).toMatchObject({ documentos: null, borrar: true })
  })

  it('vence a las 36 h aunque no haya red', () => {
    const raw = JSON.stringify(armarCache('auth-A', [doc({})], AHORA))
    expect(leerCache(raw, 'auth-A', AHORA + VIGENCIA_CACHE_MS - 1).documentos).not.toBeNull()
    expect(leerCache(raw, 'auth-A', AHORA + VIGENCIA_CACHE_MS + 1)).toMatchObject({ documentos: null, borrar: true })
  })

  it('una copia corrupta o con fecha futura se borra', () => {
    expect(leerCache('{no es json', 'auth-A', AHORA).borrar).toBe(true)
    expect(leerCache(JSON.stringify({ authUserId: 'auth-A', guardadoAt: 'x', documentos: [] }), 'auth-A', AHORA).borrar).toBe(true)
    const futura = JSON.stringify(armarCache('auth-A', [doc({})], AHORA + 24 * 3600e3))
    expect(leerCache(futura, 'auth-A', AHORA).borrar).toBe(true)
  })

  it('cada respuesta reemplaza la copia entera (no acumula protocolos viejos)', () => {
    const c = armarCache('auth-A', [doc({ version_id: 'v2' })], AHORA)
    expect(c.documentos.map(d => d.version_id)).toEqual(['v2'])
  })
})

describe('aperturas hechas sin señal', () => {
  it('encola una por versión y sólo de la sesión', () => {
    let raw: string | null = null
    raw = JSON.stringify(encolarApertura(raw, 'auth-A', { version_id: 'v1', turno_id: 't1', abierto_cliente_at: 'x' }))
    raw = JSON.stringify(encolarApertura(raw, 'auth-A', { version_id: 'v1', turno_id: 't1', abierto_cliente_at: 'y' }))
    expect(leerCola(raw, 'auth-A')).toHaveLength(1)
    expect(leerCola(raw, 'auth-A')[0].abierto_cliente_at).toBe('x')
    expect(leerCola(raw, 'auth-B')).toHaveLength(0)
  })

  it('la cola de otra persona se descarta al encolar', () => {
    const ajena = JSON.stringify({ authUserId: 'auth-A', items: [{ version_id: 'v1', turno_id: null, abierto_cliente_at: 'x' }] })
    expect(encolarApertura(ajena, 'auth-B', { version_id: 'v9', turno_id: null, abierto_cliente_at: 'z' }).items.map(i => i.version_id)).toEqual(['v9'])
  })

  it('marca como abierto en pantalla lo leído sin señal', () => {
    const docs = aplicarAperturasLocales([doc({}), doc({ version_id: 'v2' })], [{ version_id: 'v2', turno_id: null, abierto_cliente_at: '2026-10-15T10:00:00Z' }])
    expect(docs[0].abierto_at).toBeNull()
    expect(docs[1].abierto_at).toBe('2026-10-15T10:00:00Z')
  })
})

describe('selección por turno y aviso posterior al ingreso', () => {
  const docs = [
    doc({ version_id: 'puesto', puesto_id: 'p1', puesto_nombre: 'Vigilador 1', turnos: ['t1'] }),
    doc({ version_id: 'general', turnos: ['t1', 't2'] }),
    doc({ version_id: 'otro', objetivo_id: 'o2', turnos: ['t3'] }),
  ]

  it('un turno recibe el general primero y después el de su puesto', () => {
    expect(documentosDeTurno(docs, 't1').map(d => d.version_id)).toEqual(['general', 'puesto'])
    expect(documentosDeTurno(docs, 't2').map(d => d.version_id)).toEqual(['general'])
    expect(documentosDeTurno(docs, 'ninguno')).toEqual([])
  })

  it('avisa por el primero sin confirmar y no repite lo pospuesto en la sesión', () => {
    expect(documentoParaAviso(docs, 't1', [])?.version_id).toBe('general')
    expect(documentoParaAviso(docs, 't1', ['general'])?.version_id).toBe('puesto')
    expect(documentoParaAviso(docs, 't1', ['general', 'puesto'])).toBeNull()
  })

  it('no avisa si ya confirmó', () => {
    const confirmados = docs.map(d => ({ ...d, confirmado_at: '2026-10-15T10:00:00Z' }))
    expect(documentoParaAviso(confirmados, 't1', [])).toBeNull()
  })
})

describe('administración', () => {
  it('separa confirmaron / abrieron / sin abrir por versión', () => {
    const l = (p: Partial<LecturaProtocolo>): LecturaProtocolo => ({
      version_id: 'v1', empleado_id: 'e', nombre: null, apellido: null, legajo: null, ultimo_turno: null,
      abierto_at: null, confirmado_at: null, ...p,
    })
    const r = separarLecturas([
      l({ empleado_id: 'a', confirmado_at: 'x', abierto_at: 'x' }), l({ empleado_id: 'b', abierto_at: 'x' }),
      l({ empleado_id: 'c' }), l({ empleado_id: 'd', version_id: 'v2' }),
    ], 'v1')
    expect([r.confirmaron.length, r.abrieronSinConfirmar.length, r.sinAbrir.length]).toEqual([1, 1, 1])
  })

})

describe('vista principal: el protocolo primero', () => {
  const base = {
    objetivo_id: 'o1', puesto_id: null, puesto_nombre: null, titulo: 't', texto: 'x', texto_sha256: 'a'.repeat(64),
    fuente_tipo: 'whatsapp' as const, fuente_descripcion: 'f', fuente_fecha: null, fuente_archivo: null, fuente_archivo_sha256: null,
    asociacion: 'confirmada' as const, asociacion_nota: null, asociacion_confirmada_at: null,
    enviado_aprobacion_at: null, aprobado_at: null, aprobado_por_nombre: null, reemplazado_at: null, descartado_at: null,
    motivo_descarte: null, devuelto_motivo: null, notas: null, aperturas: 0, confirmaciones: 0,
  }
  const v = (id: string, numero: number, estado: any, creado_at: string, extra: any = {}) =>
    ({ ...base, id, numero, estado, creado_at, ...extra })

  it('sólo borrador: la última escrita es el borrador y no hay vigente', () => {
    const [a] = vistaProtocolo([v('b1', 1, 'borrador', '2026-10-14T10:00:00Z')])
    expect(a.vigente).toBeNull()
    expect(a.ultima?.id).toBe('b1')
  })

  it('vigente + borrador más nuevo: muestra el borrador de entrada sin confundirlo con la vigente', () => {
    const [a] = vistaProtocolo([
      v('vig', 1, 'vigente', '2026-10-14T10:00:00Z'),
      v('b2', 2, 'borrador', '2026-10-20T10:00:00Z'),
      v('old', 0, 'reemplazado', '2026-10-01T10:00:00Z'),
      v('desc', 3, 'descartado', '2026-10-21T10:00:00Z'),
    ])
    expect(a.vigente?.id).toBe('vig')
    expect(a.ultima?.id).toBe('b2')
    expect(a.trabajo.map(x => x.id)).toEqual(['b2'])
  })

  it('dos borradores con la misma fecha (Rapsodia): el de número mayor primero, ambos en trabajo', () => {
    const [a] = vistaProtocolo([v('r1', 1, 'borrador', '2026-10-14T10:00:00Z'), v('r2', 2, 'borrador', '2026-10-14T10:00:00Z')])
    expect(a.trabajo.map(x => x.id)).toEqual(['r2', 'r1'])
  })

  it('separa por puesto, con todo el objetivo primero', () => {
    const al = vistaProtocolo([
      v('p', 1, 'borrador', '2026-10-14T10:00:00Z', { puesto_id: 'pu1', puesto_nombre: 'Vigilador 1' }),
      v('g', 1, 'vigente', '2026-10-14T10:00:00Z'),
    ])
    expect(al.map(a => a.clave)).toEqual(['objetivo', 'pu1'])
  })
})

describe('comparar versiones', () => {
  it('marca líneas agregadas y quitadas, conserva las iguales', () => {
    const r = compararLineas('A\nB\nC', 'A\nB2\nC\nD')!
    expect(r).toEqual([
      { tipo: 'igual', texto: 'A' },
      { tipo: 'quitada', texto: 'B' },
      { tipo: 'agregada', texto: 'B2' },
      { tipo: 'igual', texto: 'C' },
      { tipo: 'agregada', texto: 'D' },
    ])
  })
  it('textos iguales: todo igual', () => {
    expect(compararLineas('x\ny', 'x\ny')!.every(l => l.tipo === 'igual')).toBe(true)
  })
  it('no compara textos enormes', () => {
    expect(compararLineas('a\n'.repeat(2500), 'b')).toBeNull()
  })
})
