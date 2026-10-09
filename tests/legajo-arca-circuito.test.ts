import { readFileSync } from 'fs'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ARCA simulado: WSAA y padrón. Nada sale a la red.
const wsaa = vi.hoisted(() => ({ falla: false }))
const padron = vi.hoisted(() => ({ respuesta: null as any, llamadas: 0 }))
vi.mock('@/lib/afip/wsaa', () => ({
  obtenerTA: async () => { if (wsaa.falla) throw new Error('WSAA caído'); return { token: 't', sign: 's', expira: '' } },
}))
vi.mock('@/lib/afip/padron', () => ({
  SERVICIO_PADRON_A13: 'ws_sr_padron_a13',
  consultarPadronA13: async () => { padron.llamadas++; return padron.respuesta },
}))
vi.mock('@/lib/afip/ta-store-supabase', () => ({ taStoreSupabase: () => ({}) }))

import { corroborarEmpleado, esperarConTope } from '@/lib/afip/corroborar'

const config = { certPem: '', keyPem: '', cuitRepresentada: '30000000000', homo: false } as any

/** Cliente admin mínimo que registra cada escritura por tabla. */
function cliente(usuario: Record<string, unknown> | null) {
  const escrituras: { tabla: string; op: string; valor: any }[] = []
  const from = (tabla: string) => {
    const q: any = {
      insert: (v: any) => { escrituras.push({ tabla, op: 'insert', valor: v }); return q },
      update: (v: any) => { escrituras.push({ tabla, op: 'update', valor: v }); return q },
      upsert: async (v: any) => { escrituras.push({ tabla, op: 'upsert', valor: v }); return { error: null } },
      select: () => q, eq: () => q,
      single: async () => ({ data: { id: 'c1' }, error: null }),
      maybeSingle: async () => ({ data: usuario, error: null }),
      then: (r: any) => r({ error: null }),
    }
    return q
  }
  return { cliente: { from } as any, escrituras }
}

const juan = { id: 'e1', cuil: '20-30111222-3', nombre: 'Juan', apellido: 'Pérez' }

beforeEach(() => { wsaa.falla = false; padron.llamadas = 0; padron.respuesta = null })

describe('ARCA: consulta individual', () => {
  it('consulta UNA vez, guarda la foto y registra la consulta con quién la pidió', async () => {
    padron.respuesta = { ok: true, persona: { idPersona: '20301112223', estado: 'ACTIVO', nombre: 'JUAN', apellido: 'PEREZ', domicilios: [], raw: {} } }
    const c = cliente(juan)
    const r = await corroborarEmpleado(c.cliente, config, 'e1', { tipo: 'legajo', solicitadoPor: 'adm-1' })
    expect(r).toEqual({ ok: true, novedades: [] })
    expect(padron.llamadas).toBe(1)
    const corrida = c.escrituras.find(e => e.tabla === 'afip_corroboracion_corrida' && e.op === 'insert')!
    expect(corrida.valor.detalle).toMatchObject({ tipo: 'individual', origen: 'legajo', usuario_id: 'e1', solicitado_por: 'adm-1' })
    expect(c.escrituras.some(e => e.tabla === 'afip_padron_snapshot' && e.op === 'upsert')).toBe(true)
  })
  it('si ARCA (WSAA) falla: no toca datos del empleado ni la foto anterior, y queda registrada la falla', async () => {
    wsaa.falla = true
    const c = cliente(juan)
    const r = await corroborarEmpleado(c.cliente, config, 'e1', { tipo: 'legajo', solicitadoPor: 'adm-1' })
    expect(r.ok).toBe(false)
    expect(c.escrituras.some(e => e.tabla === 'usuarios')).toBe(false)
    expect(c.escrituras.some(e => e.tabla === 'afip_padron_snapshot')).toBe(false)
    const cierre = c.escrituras.find(e => e.tabla === 'afip_corroboracion_corrida' && e.op === 'update')!
    expect(cierre.valor.ok).toBe(false)
  })
  it('nunca escribe en usuarios, ni con diferencias de nombre', async () => {
    padron.respuesta = { ok: true, persona: { idPersona: '20301112223', estado: 'INACTIVO', nombre: 'OTRO', apellido: 'NOMBRE', domicilios: [], raw: {} } }
    const c = cliente(juan)
    const r = await corroborarEmpleado(c.cliente, config, 'e1', { tipo: 'legajo', solicitadoPor: null })
    expect(r.novedades).toEqual(expect.arrayContaining(['estado_no_activo', 'apellido_difiere', 'nombre_difiere']))
    expect(c.escrituras.every(e => e.tabla !== 'usuarios')).toBe(true)
  })
  it('sin CUIL válido no consulta a ARCA', async () => {
    const c = cliente({ ...juan, cuil: null })
    const r = await corroborarEmpleado(c.cliente, config, 'e1', { tipo: 'legajo', solicitadoPor: null })
    expect(padron.llamadas).toBe(0)
    expect(r.novedades).toEqual(['sin_cuil'])
  })
})

describe('ARCA: el alta nunca se traba', () => {
  it('si ARCA no responde, se sigue al cumplirse el tope', async () => {
    const t0 = Date.now()
    expect(await esperarConTope(new Promise(() => {}), 50)).toBeUndefined()
    expect(Date.now() - t0).toBeLessThan(1000)
  })
  it('si ARCA falla, el error no se propaga', async () => {
    await expect(esperarConTope(Promise.reject(new Error('caído')), 50)).resolves.toBeUndefined()
  })
  it('si responde a tiempo, devuelve el resultado', async () => {
    expect(await esperarConTope(Promise.resolve(7), 50)).toBe(7)
  })
  it('la ruta de alta usa el tope y no depende del resultado', () => {
    const ruta = readFileSync(join(__dirname, '..', 'app', 'api', 'usuarios', 'route.ts'), 'utf8')
    expect(ruta).toMatch(/esperarConTope\(corroborarEmpleado\(/)
  })
})

describe('ARCA: abrir el legajo no consulta', () => {
  it('al abrir sólo se lee la última foto; la consulta es sólo el botón', () => {
    const comp = readFileSync(join(__dirname, '..', 'components', 'legajo', 'CorroboracionArca.tsx'), 'utf8')
    const efecto = comp.slice(comp.indexOf('const cargar = useCallback'), comp.indexOf('useEffect(() => { void cargar() }, [cargar])'))
    expect(efecto).toMatch(/cargarArca\(/)
    expect(efecto).not.toMatch(/corroborarDesdeLegajo/)
    expect(comp.match(/corroborarDesdeLegajo\(/g)).toHaveLength(1)
    expect(comp).toMatch(/const corroborar = async \(\) => \{[\s\S]*?corroborarDesdeLegajo\(/)
  })
})
