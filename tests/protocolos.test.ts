import { describe, expect, it } from 'vitest'
import {
  VIGENCIA_CACHE_MS, accionesDeVersion, aplicarAperturasLocales, armarCache, documentoParaAviso,
  documentosDeTurno, encolarApertura, leerCache, leerCola, separarLecturas,
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

  it('las acciones dependen del estado y de los permisos de la base', () => {
    const admin = { ver: true, preparar: true, publicar: false, registrar_diferencias: true }
    const gerencia = { ver: true, preparar: true, publicar: true, registrar_diferencias: true }
    const sup = { ver: true, preparar: false, publicar: false, registrar_diferencias: true }
    const borrador = { estado: 'borrador' as const, asociacion: 'confirmada' as const, fuente_tipo: 'whatsapp' as const }
    const pendiente = { ...borrador, estado: 'pendiente_aprobacion' as const }
    expect(accionesDeVersion(borrador, admin)).toMatchObject({ enviar: true, publicar: false, descartar: false })
    expect(accionesDeVersion(pendiente, admin)).toMatchObject({ publicar: false, devolver: false })
    expect(accionesDeVersion(pendiente, gerencia)).toMatchObject({ publicar: true, devolver: true, descartar: true })
    expect(accionesDeVersion({ ...pendiente, asociacion: 'pendiente_validacion' }, gerencia))
      .toMatchObject({ publicar: false, confirmarAsociacion: true })
    expect(Object.values(accionesDeVersion(borrador, sup)).some(Boolean)).toBe(false)
    expect(Object.values(accionesDeVersion({ ...borrador, estado: 'vigente' }, gerencia)).some(Boolean)).toBe(false)
  })
})
