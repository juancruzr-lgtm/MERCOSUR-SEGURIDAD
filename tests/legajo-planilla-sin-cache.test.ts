import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// Incidente 02/11/2026: el legajo no mostraba las horas del 30 y 31 de octubre.
// Los registros estaban en la base; la API servía la foto que el Data Cache de
// Next 14 había guardado de la consulta del mes (misma URL todo el mes) el 30/10.
// Noviembre, por la misma razón, mostraba 0 h para todos.

const RAIZ = join(__dirname, '..')

// ── 1. El cliente del servidor nunca lee de la caché de Next ─────────────────

describe('getSupabaseAdmin: cada lectura va a la base', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it('PostgREST y auth.getUser se piden con cache: no-store', async () => {
    const vistos: { url: string; cache?: string; method?: string }[] = []
    vi.stubGlobal('fetch', async (input: any, init: any = {}) => {
      vistos.push({ url: String(input), cache: init.cache, method: init.method })
      const cuerpo = String(input).includes('/auth/v1/user') ? { id: 'auth-1' } : []
      return new Response(JSON.stringify(cuerpo), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:9'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
    const { getSupabaseAdmin } = await vi.importActual<typeof import('@/app/api/_lib/employee-auth')>('@/app/api/_lib/employee-auth')
    const { client } = getSupabaseAdmin()
    await client!.from('registros_asistencia').select('id').gte('turno.fecha', '2026-10-01').lte('turno.fecha', '2026-10-31')
    await client!.auth.getUser('token')
    expect(vistos.length).toBe(2)
    for (const v of vistos) expect(v.cache).toBe('no-store')
  })

  it('ningún cliente de Supabase creado en app/ queda sin fetchSinCache', () => {
    const archivos = (dir: string): string[] => readdirSync(dir).flatMap(n => {
      const p = join(dir, n)
      return statSync(p).isDirectory() ? archivos(p) : /\.tsx?$/.test(n) ? [p] : []
    })
    const sinProteger: string[] = []
    for (const archivo of archivos(join(RAIZ, 'app/api'))) {
      const texto = readFileSync(archivo, 'utf8')
      let i = texto.indexOf('createClient(')
      while (i >= 0) {
        // Hasta el cierre de la llamada: alcanza con mirar el bloque siguiente.
        const llamada = texto.slice(i, i + 400)
        const protegida = /fetch:\s*(fetchSinCache|sinCache)/.test(llamada) || /fetchCache\s*=\s*'force-no-store'/.test(texto)
        if (!protegida) sinProteger.push(archivo.slice(RAIZ.length + 1))
        i = texto.indexOf('createClient(', i + 1)
      }
    }
    expect(sinProteger).toEqual([])
  })
})

// ── 2. Mi Planilla del cierre de octubre ─────────────────────────────────────

const EMP = 'emp-1'
const OBJ = { nombre: 'MUSEO MACRO', es_prueba: false }

type Turno = { id: string; fecha: string; hora_inicio: string; hora_fin: string; guardia_id: string; estado: string; objetivo_id: string; tipo_evento: string; puesto_id: null }
type Registro = Record<string, any>

let turnos: Turno[] = []
let registros: Registro[] = []

const turno = (id: string, fecha: string, hi: string, hf: string): Turno =>
  ({ id, fecha, hora_inicio: hi, hora_fin: hf, guardia_id: EMP, estado: 'programado', objetivo_id: 'o1', tipo_evento: 'normal', puesto_id: null })
const fichaje = (t: Turno, extra: Registro = {}): Registro => ({
  id: `r-${t.id}`, turno_id: t.id, guardia_id: EMP, guardia_final_id: null, tipo_registro: 'fichaje_gps',
  hora_entrada_real: t.hora_inicio, hora_salida_real: t.hora_fin, hora_entrada_final: null, hora_salida_final: null,
  horas_trabajadas: null, horas_liquidables: null, objetivo_final_id: null, origen_cobertura: null,
  cobertura_anulada_at: null, cierre_automatico: false, gps_ingreso_estado: null, gps_egreso_estado: null, ...extra,
})

// Base simulada que aplica los filtros que usa la ruta: si un filtro de fecha
// estuviera mal, la prueba lo ve.
function cliente() {
  const tabla = (nombre: string): any => {
    const filtros: ((f: any) => boolean)[] = []
    const valor = (f: any, campo: string) => campo.split('.').reduce((o, k) => o?.[k], f)
    const filas = (): any[] => {
      const base = nombre === 'registros_asistencia'
        ? registros.map(r => ({ ...r, turno: { ...turnos.find(t => t.id === r.turno_id), objetivo: OBJ, puesto: null } }))
        : nombre === 'turnos' ? turnos.map(t => ({ ...t, objetivo: OBJ, puesto: null }))
        : nombre === 'usuarios' ? [{ id: EMP, auth_user_id: 'auth-1', rol: 'guardia' }]
        : []
      return base.filter(f => filtros.every(p => p(f)))
    }
    const b: any = {
      select: () => b, order: () => b, limit: () => b,
      eq: (c: string, v: any) => { filtros.push(f => valor(f, c) === v); return b },
      gte: (c: string, v: any) => { filtros.push(f => String(valor(f, c)) >= v); return b },
      lte: (c: string, v: any) => { filtros.push(f => String(valor(f, c)) <= v); return b },
      in: (c: string, v: any[]) => { filtros.push(f => v.includes(valor(f, c))); return b },
      not: (c: string, _op: string, lista: string) => {
        const excl = lista.replace(/[()"]/g, '').split(',')
        filtros.push(f => !excl.includes(valor(f, c))); return b
      },
      or: (expr: string) => {
        const conds = expr.split(',').map(s => { const [c, , v] = s.split('.'); return { c, v } })
        filtros.push(f => conds.some(({ c, v }) => valor(f, c) === v)); return b
      },
      single: async () => ({ data: filas()[0] ?? null, error: null }),
      then: (ok: any) => ok({ data: filas(), error: null }),
    }
    return b
  }
  return { auth: { getUser: async () => ({ data: { user: { id: 'auth-1' } }, error: null }) }, from: tabla }
}

vi.mock('@/app/api/_lib/employee-auth', () => ({ fetchSinCache: fetch, getBearerToken: () => 'tok', getSupabaseAdmin: () => ({ client: cliente() }) }))
vi.mock('../app/api/_lib/employee-auth', () => ({ fetchSinCache: fetch, getBearerToken: () => 'tok', getSupabaseAdmin: () => ({ client: cliente() }) }))

const planilla = async (mes: string) => {
  const { GET } = await import('@/app/api/legajo/[id]/planilla/route')
  const res = await GET(new NextRequest(`http://localhost/api/legajo/${EMP}/planilla?mes=${mes}`, { headers: { Authorization: 'Bearer tok' } }), { params: { id: EMP } })
  expect(res.status).toBe(200)
  return res.json()
}
const horasDel = (json: any, fecha: string) =>
  json.filas.filter((f: any) => f.fecha === fecha).reduce((s: number, f: any) => s + f.horas, 0)

// El caso del reclamo (ALMARA): 30/10 07-15, 31/10 13-19, más nocturnos en los bordes.
const t29n = turno('t29n', '2026-10-29', '19:00', '07:00')   // cruza al 30: es del 29
const t30 = turno('t30', '2026-10-30', '07:00', '15:00')
const t31 = turno('t31', '2026-10-31', '13:00', '19:00')
const t31n = turno('t31n', '2026-10-31', '20:00', '08:00')   // termina el 01/11: es de octubre
const t01 = turno('t01', '2026-11-01', '08:00', '14:00')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-02T18:00:00Z'))
  turnos = [t29n, t30, t31, t31n, t01]
  registros = [t29n, t30, t31, t31n, t01].map(t => fichaje(t))
})
afterEach(() => { vi.useRealTimers() })

describe('Mi Planilla: cierre de octubre 2026', () => {
  it('el 30 y el 31 cuentan sus horas, y el total del mes las incluye', async () => {
    const oct = await planilla('2026-10')
    expect(horasDel(oct, '2026-10-30')).toBe(8)
    // 13-19 (6 h) + nocturno 20-08 (12 h), ambos empezaron el 31.
    expect(horasDel(oct, '2026-10-31')).toBe(18)
    expect(oct.filas.find((f: any) => f.turno_id === 't31').estado).toBe('trabajado')
    expect(oct.total_horas).toBe(12 + 8 + 6 + 12)
  })

  it('un nocturno pertenece al día en que empezó: el del 29 no suma al 30', async () => {
    const oct = await planilla('2026-10')
    expect(horasDel(oct, '2026-10-29')).toBe(12)
    expect(oct.filas.filter((f: any) => f.turno_id === 't29n').map((f: any) => f.fecha)).toEqual(['2026-10-29'])
  })

  it('el nocturno del 31 no se corre a noviembre ni se cuenta dos veces', async () => {
    const nov = await planilla('2026-11')
    expect(nov.filas.some((f: any) => f.turno_id === 't31n')).toBe(false)
    expect(nov.total_horas).toBe(6)
    const oct = await planilla('2026-10')
    expect(oct.filas.some((f: any) => f.turno_id === 't01')).toBe(false)
  })

  it('lo que asentó el supervisor manda: sin horas extra ni descuentos por GPS', async () => {
    // Entró tarde y salió antes: el supervisor dejó 2 h. Y una salida GPS
    // larguísima no agrega horas sobre las programadas.
    registros = registros.map(r => r.turno_id === 't31'
      ? { ...r, horas_liquidables: 2, origen_cobertura: 'confirmacion_supervisor' }
      : r.turno_id === 't30' ? { ...r, hora_salida_real: '20:38' } : r)
    const oct = await planilla('2026-10')
    expect(horasDel(oct, '2026-10-31')).toBe(2 + 12)
    expect(horasDel(oct, '2026-10-30')).toBe(8)
  })

  it('un fichaje que llega después de la primera consulta aparece en la siguiente', async () => {
    registros = registros.filter(r => r.turno_id !== 't31')
    const antes = await planilla('2026-10')
    expect(antes.filas.find((f: any) => f.turno_id === 't31').estado).toBe('programado')
    registros.push(fichaje(t31))
    const despues = await planilla('2026-10')
    expect(despues.total_horas - antes.total_horas).toBe(6)
  })

  it('septiembre no cambia: el nocturno del 30/09 sigue siendo de septiembre', async () => {
    vi.setSystemTime(new Date('2026-10-15T15:00:00Z'))
    const s30n = turno('s30n', '2026-09-30', '19:00', '07:00')
    turnos.push(s30n); registros.push(fichaje(s30n))
    const sep = await planilla('2026-09')
    expect(sep.total_horas).toBe(12)
    const oct = await planilla('2026-10')
    expect(oct.filas.some((f: any) => f.turno_id === 's30n')).toBe(false)
  })
})
