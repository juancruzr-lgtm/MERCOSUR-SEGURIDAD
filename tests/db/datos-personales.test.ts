// DNI/teléfono/CUIL según responsabilidad (usuarios_datos_personales) y lectura directa de esas
// columnas cerrada para las sesiones del navegador. Perfiles ficticios (seed.sql).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { crearEntorno, type Entorno, P } from './entorno'

const MIG = (m: string) => join(__dirname, '..', '..', 'supabase', 'migrations', m)
let e: Entorno
beforeAll(async () => {
  e = await crearEntorno()
  await e.aplicarArchivo(join(__dirname, 'asistencia', '00-stubs.sql'))
  for (const m of ['20261220150000_usuarios_jerarquia_base', '20261220164000_usuarios_identidad_rpc'])
    await e.aplicarArchivo(join(__dirname, '..', '..', 'supabase', 'migrations', m + '.sql'))
  await e.aplicarArchivo(MIG('20261221100000_usuarios_datos_personales.sql'))
}, 240_000)
afterAll(async () => { await e?.cerrar() })

const ver = async (p: any) => (await e.comoUsuario(p, () => e.q<{ d: any }>(`select usuarios_datos_personales() d`))).rows[0].d
const TODOS = Object.values(P).map(p => p.id).sort()

describe('usuarios_datos_personales', () => {
  it('vigilador: sólo lo propio (con CUIL)', async () => {
    const d = await ver(P.vigilador)
    expect(Object.keys(d)).toEqual([P.vigilador.id])
    expect(Object.keys(d[P.vigilador.id]).sort()).toEqual(['cuil', 'dni', 'telefono'])
  })
  it('supervisor de zona: personal de su zona con DNI y teléfono, sin CUIL; nada de otra zona', async () => {
    const d = await ver(P.supervisor)
    expect(d[P.vigilador.id]).toEqual({ dni: '00000001', telefono: '0000-000001' })
    expect(d[P.vigiladorSur.id]).toBeUndefined()
    expect(d[P.administracion.id]).toBeUndefined()
    expect(d[P.supervisor.id].cuil).toBeDefined()  // lo propio sí
  })
  it('supervisor: pedir por id a alguien fuera de su alcance no devuelve nada', async () => {
    const d = (await e.comoUsuario(P.supervisor, () => e.q<{ d: any }>(`select usuarios_datos_personales($1::uuid[]) d`, [[P.vigiladorSur.id]]))).rows[0].d
    expect(d).toEqual({})
  })
  it('jefa de supervisores (alcance todas): DNI y teléfono de todos, sin CUIL ajeno', async () => {
    const d = await ver(P.jefe)
    expect(Object.keys(d).sort()).toEqual(TODOS)
    expect(d[P.vigiladorSur.id].cuil).toBeUndefined()
    expect(d[P.vigiladorSur.id].dni).toBe('00000006')
  })
  it('Administración y Gerencia: todo con CUIL', async () => {
    for (const p of [P.administracion, P.gerencia]) {
      const d = await ver(p)
      expect(Object.keys(d).sort()).toEqual(TODOS)
      expect(d[P.vigiladorSur.id].cuil).toBe('20-00000006-0')
    }
  })
  it('anon no puede ejecutarla', async () => {
    await e.enTransaccion(async () => {
      const err = await e.comoAnon(() => e.intentar(() => e.q(`select usuarios_datos_personales()`)))
      expect(err?.message).toMatch(/permission denied/)
    })
  })
  it('el supervisor ve al relevo cargado como guardia final en su zona', async () => {
    await e.enTransaccion(async () => {
      await e.q(`update registros_asistencia set guardia_final_id = $1 where id = '60000000-0000-4000-8000-000000000001'`, [P.vigiladorSur.id])
      expect((await ver(P.supervisor))[P.vigiladorSur.id]).toEqual({ dni: '00000006', telefono: '0000-000006' })
    })
  })
})

describe('con la revocación de columnas', () => {
  beforeAll(async () => { await e.aplicarArchivo(MIG('20261221110000_usuarios_columnas_personales_por_funcion.sql')) })
  it('nadie lee dni/cuil/telefono directo; el resto de columnas sí', async () => { await e.enTransaccion(async () => {
    for (const p of [P.vigilador, P.supervisor, P.jefe, P.administracion, P.gerencia]) {
      for (const col of ['dni', 'cuil', 'telefono'])
        expect((await e.comoUsuario(p, () => e.intentar(() => e.q(`select ${col} from usuarios limit 1`))))?.message, `${col}`).toMatch(/permission denied/)
      expect(await e.comoUsuario(p, () => e.intentar(() => e.q(`select id, nombre, apellido, legajo, rol, puesto_organizacional from usuarios`)))).toBeNull()
    }
  }) })
  it('la función sigue respondiendo con el mismo criterio', async () => {
    expect((await ver(P.supervisor))[P.vigilador.id]).toEqual({ dni: '00000001', telefono: '0000-000001' })
    expect((await ver(P.administracion))[P.vigilador.id].cuil).toBe('20-00000001-0')
  })
  it('el vigilador puede seguir cargando su teléfono (captura obligatoria)', async () => {
    await e.enTransaccion(async () => {
      const err = await e.comoUsuario(P.vigilador, () => e.intentar(() => e.q(`update usuarios set telefono = '1111-2222' where auth_user_id = auth.uid()`)))
      expect(err).toBeNull()
    })
  })
})
