import { describe, it, expect } from 'vitest'
import {
  normalizarClaveSeccion,
  leerSeccionDeUrl,
  evaluarSeccion,
  resolverSeccion,
  urlParaSeccion,
  seccionQueRepresentaLaUrl,
} from '@/lib/navegacion-seccion-url'

const permitidas = new Set(['dashboard', 'guardias', 'objetivos', 'revision_planillas', 'liquidacion'])
const opciones = { permitidas, porDefecto: 'dashboard' }

describe('normalizarClaveSeccion', () => {
  it('acepta claves del menú', () => {
    expect(normalizarClaveSeccion('revision_planillas')).toBe('revision_planillas')
    expect(normalizarClaveSeccion('  Guardias ')).toBe('guardias')
  })
  it('rechaza vacíos, nulos y caracteres raros', () => {
    expect(normalizarClaveSeccion(null)).toBeNull()
    expect(normalizarClaveSeccion(undefined)).toBeNull()
    expect(normalizarClaveSeccion('')).toBeNull()
    expect(normalizarClaveSeccion('../admin')).toBeNull()
    expect(normalizarClaveSeccion('<script>')).toBeNull()
    expect(normalizarClaveSeccion('a b')).toBeNull()
    expect(normalizarClaveSeccion('x'.repeat(65))).toBeNull()
  })
})

describe('leerSeccionDeUrl', () => {
  it('lee el parámetro pedido', () => {
    expect(leerSeccionDeUrl('?page=guardias', ['page'])).toBe('guardias')
    expect(leerSeccionDeUrl('page=guardias', ['page'])).toBe('guardias')
  })
  it('respeta los enlaces existentes con filtros (legajo → bandeja de planillas)', () => {
    expect(leerSeccionDeUrl('?page=revision_planillas&empleado=abc&mes=2026-10', ['page'])).toBe('revision_planillas')
  })
  it('no confunde el enlace de ronda del vigilador con una sección', () => {
    expect(leerSeccionDeUrl('?ronda=1&turno=2&objetivo=3&ventana=0', ['page'])).toBeNull()
  })
  it('prueba los parámetros en orden (Supervisor: tab y después page de WhatsApp)', () => {
    expect(leerSeccionDeUrl('?page=rondas', ['tab', 'page'])).toBe('rondas')
    expect(leerSeccionDeUrl('?page=rondas&tab=turnos', ['tab', 'page'])).toBe('turnos')
    expect(leerSeccionDeUrl('?tab=%3Cx%3E&page=rondas', ['tab', 'page'])).toBe('rondas')
  })
  it('sin parámetro o con valor inválido devuelve null', () => {
    expect(leerSeccionDeUrl('', ['page'])).toBeNull()
    expect(leerSeccionDeUrl('?page=', ['page'])).toBeNull()
    expect(leerSeccionDeUrl('?page=..%2Fx', ['page'])).toBeNull()
  })
})

describe('evaluarSeccion / resolverSeccion: nunca abrir por URL una sección no permitida', () => {
  it('permitida si está en el menú de la persona', () => {
    expect(evaluarSeccion('guardias', opciones)).toBe('permitida')
    expect(resolverSeccion('liquidacion', opciones)).toBe('liquidacion')
  })
  it('la sección por defecto siempre está permitida', () => {
    expect(evaluarSeccion('dashboard', { permitidas: new Set(), porDefecto: 'dashboard' })).toBe('permitida')
  })
  it('una sección que no está en su menú cae en la sección por defecto', () => {
    const supervisorEnAdmin = new Set(['dashboard', 'guardias'])
    expect(evaluarSeccion('liquidacion', { permitidas: supervisorEnAdmin, porDefecto: 'dashboard' })).toBe('no_permitida')
    expect(resolverSeccion('liquidacion', { permitidas: supervisorEnAdmin, porDefecto: 'dashboard' })).toBe('dashboard')
    expect(resolverSeccion('facturacion', opciones)).toBe('dashboard')
    expect(resolverSeccion('no_existe', opciones)).toBe('dashboard')
  })
  it('sin sección pedida → por defecto', () => {
    expect(resolverSeccion(null, opciones)).toBe('dashboard')
  })
  it('pendiente: permiso que todavía se está consultando a la base', () => {
    const pendientes = new Set(['evaluacion_supervisores'])
    expect(evaluarSeccion('evaluacion_supervisores', { ...opciones, pendientes })).toBe('pendiente')
    expect(resolverSeccion('evaluacion_supervisores', { ...opciones, pendientes })).toBe('evaluacion_supervisores')
    // Una vez resuelto sin permiso (ya no pendiente, no permitida) → por defecto.
    expect(resolverSeccion('evaluacion_supervisores', opciones)).toBe('dashboard')
  })
})

describe('urlParaSeccion', () => {
  it('la sección por defecto deja la URL limpia', () => {
    expect(urlParaSeccion('/dashboard', 'page', 'dashboard', 'dashboard')).toBe('/dashboard')
  })
  it('otra sección va en el parámetro y no arrastra filtros viejos', () => {
    expect(urlParaSeccion('/dashboard', 'page', 'guardias', 'dashboard')).toBe('/dashboard?page=guardias')
    expect(urlParaSeccion('/dashboard', 'tab', 'rondas', 'inicio')).toBe('/dashboard?tab=rondas')
  })
  it('ida y vuelta: lo que se escribe se vuelve a leer igual', () => {
    for (const s of ['dashboard', 'guardias', 'revision_planillas']) {
      const url = urlParaSeccion('/dashboard', 'page', s, 'dashboard')
      const search = url.includes('?') ? url.slice(url.indexOf('?')) : ''
      expect(seccionQueRepresentaLaUrl(search, ['page'], 'dashboard')).toBe(s)
    }
  })
})

describe('seccionQueRepresentaLaUrl', () => {
  it('sin parámetro representa la sección por defecto (no hace falta reescribir la URL)', () => {
    expect(seccionQueRepresentaLaUrl('', ['page'], 'dashboard')).toBe('dashboard')
    expect(seccionQueRepresentaLaUrl('?ronda=5', ['page'], 'dashboard')).toBe('dashboard')
  })
})
