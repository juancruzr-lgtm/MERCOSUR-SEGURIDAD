import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  AGRUPAR_EVENTOS_MS,
  INTERVALO_REFRESCO_MS,
  crearDisparadorPrimerPlano,
  debeRecargarPorPrimerPlano,
} from '@/lib/refresco-movil'
import {
  COLUMNAS_REGISTRO_VIGILADOR,
  catalogoDesactualizado,
  leerCatalogoTurnos,
} from '@/lib/catalogo-vigilador'
import { formatearBytes, textoDiagnostico } from '@/lib/diagnostico-dispositivo'
import { modeloDesdeUserAgent } from '@/lib/telemetry'

const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')

function entornoFalso() {
  const oyentes = new Map<string, Set<() => void>>()
  const target = (prefijo: string) => ({
    addEventListener: (t: string, f: any) => {
      const k = `${prefijo}:${t}`
      if (!oyentes.has(k)) oyentes.set(k, new Set())
      oyentes.get(k)!.add(f)
    },
    removeEventListener: (t: string, f: any) => { oyentes.get(`${prefijo}:${t}`)?.delete(f) },
  })
  const doc: any = { ...target('doc'), visibilityState: 'visible' }
  const win: any = target('win')
  const emitir = (k: string) => oyentes.get(k)?.forEach(f => f())
  const activos = () => Array.from(oyentes.values()).reduce((n, s) => n + s.size, 0)
  return { doc, win, emitir, activos }
}

describe('refresco móvil — política única', () => {
  it('intervalo de 3 minutos', () => {
    expect(INTERVALO_REFRESCO_MS).toBe(180_000)
  })

  it('primer plano respeta ≥30 s; reconexión dispara siempre', () => {
    expect(debeRecargarPorPrimerPlano(100_000, 80_000, 'visible')).toBe(false)
    expect(debeRecargarPorPrimerPlano(110_000, 80_000, 'visible')).toBe(true)
    expect(debeRecargarPorPrimerPlano(100_000, 99_000, 'online')).toBe(true)
    expect(debeRecargarPorPrimerPlano(1, null, 'visible')).toBe(true)
  })

  it('visibilitychange + focus + pageshow juntos disparan UNA vez para todos los suscriptores', () => {
    vi.useFakeTimers()
    const e = entornoFalso()
    const d = crearDisparadorPrimerPlano({
      doc: e.doc, win: e.win,
      programar: (fn, ms) => setTimeout(fn, ms),
      cancelar: id => clearTimeout(id as any),
    })
    const a = vi.fn()
    const b = vi.fn()
    const sa = d.suscribir(a)
    const sb = d.suscribir(b)
    e.emitir('doc:visibilitychange')
    e.emitir('win:focus')
    e.emitir('win:pageshow')
    vi.advanceTimersByTime(AGRUPAR_EVENTOS_MS + 1)
    expect(a).toHaveBeenCalledTimes(1)
    expect(a).toHaveBeenCalledWith('visible')
    expect(b).toHaveBeenCalledTimes(1)

    // Con la pantalla oculta no se agenda nada.
    e.doc.visibilityState = 'hidden'
    e.emitir('doc:visibilitychange')
    vi.advanceTimersByTime(AGRUPAR_EVENTOS_MS + 1)
    expect(a).toHaveBeenCalledTimes(1)

    // `online` gana como motivo aunque llegue junto a un focus.
    e.doc.visibilityState = 'visible'
    e.emitir('win:focus')
    e.emitir('win:online')
    vi.advanceTimersByTime(AGRUPAR_EVENTOS_MS + 1)
    expect(a).toHaveBeenLastCalledWith('online')

    // El último en irse suelta los oyentes del DOM.
    sa(); sb()
    expect(e.activos()).toBe(0)
    vi.useRealTimers()
  })
})

describe('catálogo del vigilador (objetivos/puestos en memoria)', () => {
  const cache = { cargadoMs: 0, objetivos: [{ id: 'o1' }], puestos: [{ id: 'p1' }] }

  it('se renueva por antigüedad (30 min) o por un id nuevo', () => {
    expect(catalogoDesactualizado(null, [], [], 0)).toBe(true)
    expect(catalogoDesactualizado(cache, ['o1'], ['p1', null], 29 * 60_000)).toBe(false)
    expect(catalogoDesactualizado(cache, ['o1'], ['p1'], 30 * 60_000)).toBe(true)
    expect(catalogoDesactualizado(cache, ['o2'], ['p1'], 1000)).toBe(true)
    expect(catalogoDesactualizado(cache, ['o1'], ['p9'], 1000)).toBe(true)
  })

  it('pide sólo los ids de los turnos y no consulta si no hay', async () => {
    const pedidos: Array<{ t: string; ids: string[] }> = []
    const cliente: any = {
      from: (t: string) => ({
        select: () => ({ in: (_c: string, ids: string[]) => { pedidos.push({ t, ids }); return Promise.resolve({ data: ids.map(id => ({ id })), error: null }) } }),
      }),
    }
    const r = await leerCatalogoTurnos(cliente, ['o1', 'o1', null], [], 5)
    expect(pedidos).toEqual([{ t: 'objetivos', ids: ['o1'] }])
    expect(r.cache).toEqual({ cargadoMs: 5, objetivos: [{ id: 'o1' }], puestos: [] })
  })

  it('las columnas de registro cubren todo lo que lee la pantalla', () => {
    const cols = COLUMNAS_REGISTRO_VIGILADOR.split(', ')
    for (const c of ['id', 'turno_id', 'hora_entrada_real', 'hora_salida_real', 'horas_trabajadas',
      'latitud_ingreso', 'longitud_ingreso', 'precision_ingreso', 'latitud_egreso', 'longitud_egreso',
      'precision_egreso', 'lat_entrada', 'lng_entrada', 'lat_salida', 'lng_salida',
      'distancia_ingreso_metros', 'gps_ingreso_estado', 'distancia_egreso_metros', 'gps_egreso_estado']) {
      expect(cols).toContain(c)
    }
    // El tipo Registro de la pantalla no declara columnas fuera de la lista.
    const guardia = src('components/guardia/GuardiaMobile.tsx')
    const tipo = guardia.slice(guardia.indexOf('interface Registro {'), guardia.indexOf('}', guardia.indexOf('interface Registro {')))
    const campos = Array.from(tipo.matchAll(/^\s+(\w+)\??:/gm)).map(m => m[1])
    expect(campos.length).toBeGreaterThan(10)
    for (const c of campos) expect(cols).toContain(c)
  })
})

describe('GuardiaMobile ya no baja el historial ni todo el catálogo', () => {
  const guardia = src('components/guardia/GuardiaMobile.tsx')
  it('registros sólo de los turnos cargados, con columnas explícitas', () => {
    expect(guardia).not.toMatch(/from\('registros_asistencia'\)\s*\.select\('\*'\)/)
    expect(guardia).toMatch(/\.select\(COLUMNAS_REGISTRO_VIGILADOR\)[\s\S]{0,80}\.in\('turno_id', turnoIds\)/)
  })
  it('sin intervalo de 60 s ni planilla en cada refresco', () => {
    expect(guardia).not.toMatch(/setInterval\(refrescarSiVisible, 60000\)/)
    expect(guardia).toMatch(/useRefrescoAutomatico\(recargaSilenciosa\)/)
    expect(guardia).toMatch(/INTERVALO_PLANILLA_MS/)
  })
  it('rondas y protocolos usan el disparo compartido', () => {
    expect(src('components/rondas/RondasGuardiaPanel.tsx')).toMatch(/useRefrescoAutomatico/)
    expect(src('components/rondas/RondasGuardiaPanel.tsx')).not.toMatch(/addEventListener\('focus'/)
    expect(src('components/protocolos/useProtocolosVigilador.ts')).toMatch(/useRefrescoAutomatico\(recargar/)
  })
})

describe('Service Worker versionado', () => {
  const sw = src('public/sw.js')
  it('nombre de caché por versión y purga en activate', () => {
    expect(sw).not.toMatch(/CACHE_NAME = 'mercosur-seguridad-v3'/)
    expect(sw).toMatch(/importScripts\('\/sw-version\.js'\)/)
    expect(sw).toMatch(/const CACHE_NAME = PREFIJO_CACHE \+ VERSION/)
    expect(sw).toMatch(/key !== CACHE_NAME/)
  })
  it('no cachea chunks, imágenes optimizadas, otros orígenes ni respuestas no-200; tiene tope', () => {
    expect(sw).toMatch(/'\/_next\/static\/'/)
    expect(sw).toMatch(/'\/_next\/image'/)
    expect(sw).toMatch(/url\.origin !== self\.location\.origin/)
    expect(sw).toMatch(/response\.status === 200 && response\.type === 'basic'/)
    expect(sw).toMatch(/MAX_ENTRADAS/)
  })
  it('el registro usa la versión del build y no busca update en cada vuelta', () => {
    const reg = src('app/PwaRegister.tsx')
    expect(reg).toMatch(/register\(URL_WORKER\)/)
    expect(reg).toMatch(/MIN_ENTRE_BUSQUEDAS_MS/)
    const cfg = src('next.config.js')
    expect(cfg).toMatch(/VERCEL_GIT_COMMIT_SHA/)
    expect(cfg).toMatch(/NEXT_PUBLIC_APP_VERSION: APP_VERSION/)
    expect(cfg).toMatch(/sw-version\.js/)
  })
})

describe('telemetría y diagnóstico', () => {
  it('modelo desde el UA clásico de Android; null con UA reducido', () => {
    expect(modeloDesdeUserAgent('Mozilla/5.0 (Linux; Android 11; SM-A125M Build/RP1A.200720.012) AppleWebKit/537.36')).toBe('SM-A125M')
    expect(modeloDesdeUserAgent('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/120')).toBeNull()
    expect(modeloDesdeUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBeNull()
  })

  it('texto de diagnóstico legible', () => {
    expect(formatearBytes(1536)).toBe('1.5 KB')
    expect(formatearBytes(null)).toBe('—')
    const t = textoDiagnostico({
      version: '0.1.0+abc1234', dispositivo: 'Android SM-A125M', enLinea: true, tipoConexion: '4g',
      usoBytes: 2_000_000, cuotaBytes: 100_000_000, cacheBytes: 50_000, cacheEntradas: 7,
      cachesSw: ['mercosur-seguridad-0.1.0+abc1234'], pendientes: [{ etiqueta: 'Lecturas de protocolo sin enviar', cantidad: 2 }],
      ultimaActualizacion: '02/11/2026 10:00', navegador: 'Chrome', generado: '02/11/2026 10:05',
    })
    expect(t).toContain('Versión: 0.1.0+abc1234')
    expect(t).toContain('en línea (4g)')
    expect(t).toContain('Lecturas de protocolo sin enviar 2')
  })
})
