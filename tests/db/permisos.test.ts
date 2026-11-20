// Permisos de la base por perfil, sobre el snapshot del esquema vivo (tests/db/schema)
// y el seed ficticio. Cada prueba corre en una transacción que se revierte.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { crearEntorno, type Entorno, OBJETIVO, P, REGISTRO, SUPERVISION, TURNO, ZONA } from './entorno'

let e: Entorno
beforeAll(async () => { e = await crearEntorno() }, 120_000)
afterAll(async () => { await e?.cerrar() })

const SIN_PERMISO = /permission denied/i
const RLS = /row-level security/i
const ids = (rows: { id: string }[]) => rows.map(r => r.id).sort()

describe('entorno', () => {
  it('carga el snapshot con RLS activa y los 6 perfiles del seed', async () => {
    const { rows } = await e.q<{ n: number }>(`select count(*)::int n from pg_tables where schemaname = 'public' and rowsecurity`)
    expect(rows[0].n).toBe(16)
    expect((await e.q(`select 1 from usuarios`)).rows).toHaveLength(6)
  })
  it('auth.uid() y auth.jwt() leen los claims de la sesión', async () => {
    const r = await e.comoUsuario(P.vigilador, () => e.q<{ uid: string; email: string; rol: string }>(
      `select auth.uid()::text uid, auth.jwt() ->> 'email' email, current_user rol`))
    expect(r.rows[0]).toEqual({ uid: P.vigilador.auth, email: P.vigilador.email, rol: 'authenticated' })
  })
})

describe('vigilador', () => {
  it('ve sólo sus propios fichajes y turnos', async () => {
    await e.comoUsuario(P.vigilador, async () => {
      expect(ids((await e.q<{ id: string }>(`select id from registros_asistencia`)).rows)).toEqual([REGISTRO.vigNorte])
      expect(ids((await e.q<{ id: string }>(`select id from turnos`)).rows)).toEqual([TURNO.vigNorte, TURNO.vigNorteManiana].sort())
    })
  })
  it('de usuarios ve sólo su fila', async () => {
    const r = await e.comoUsuario(P.vigilador, () => e.q<{ id: string }>(`select id from usuarios`))
    expect(ids(r.rows)).toEqual([P.vigilador.id])
  })
  it('no puede leer la cuenta bancaria (ni la propia): no hay grant de columna', async () => {
    const err = await e.enTransaccion(() => e.comoUsuario(P.vigilador, () => e.intentar(() => e.q(`select cuenta_bancaria from usuarios`))))
    expect(err?.message).toMatch(SIN_PERMISO)
  })
  it('no puede cambiarse el puesto: la política de update no lo alcanza (0 filas)', async () => {
    await e.enTransaccion(async () => {
      const r = await e.comoUsuario(P.vigilador, () => e.q(`update usuarios set puesto_organizacional = 'gerencia' where id = $1`, [P.vigilador.id]))
      expect(r.afectadas).toBe(0)
    })
  })
  it('no puede escribir horas liquidables en su fichaje (CAMPO_PROTEGIDO)', async () => {
    await e.enTransaccion(async () => {
      const err = await e.comoUsuario(P.vigilador, () => e.intentar(() =>
        e.q(`update registros_asistencia set horas_liquidables = 24 where id = $1`, [REGISTRO.vigNorte])))
      expect(err?.message).toMatch(/CAMPO_PROTEGIDO: horas_liquidables/)
    })
  })
  it('no puede crear un registro que no sea fichaje', async () => {
    await e.enTransaccion(async () => {
      const err = await e.comoUsuario(P.vigilador, () => e.intentar(() =>
        e.q(`insert into registros_asistencia (turno_id, guardia_id, tipo_registro) values ($1, $2, 'carga_manual')`, [TURNO.vigNorteManiana, P.vigilador.id])))
      expect(err?.message).toMatch(/CAMPO_PROTEGIDO/)
    })
  })
  it('puede fichar su propio turno', async () => {
    await e.enTransaccion(async () => {
      const r = await e.comoUsuario(P.vigilador, () =>
        e.q(`insert into registros_asistencia (turno_id, guardia_id, hora_entrada_real) values ($1, $2, '08:00')`, [TURNO.vigNorteManiana, P.vigilador.id]))
      expect(r.afectadas).toBe(1)
    })
  })
  it('no puede fichar a nombre de otro vigilador', async () => {
    await e.enTransaccion(async () => {
      const err = await e.comoUsuario(P.vigilador, () => e.intentar(() =>
        e.q(`insert into registros_asistencia (turno_id, guardia_id, hora_entrada_real) values ($1, $2, '08:00')`, [TURNO.vigSur, P.vigiladorSur.id])))
      expect(err?.message).toMatch(RLS)
    })
  })
  it('no puede borrar su fichaje (sólo la conducción borra)', async () => {
    await e.enTransaccion(async () => {
      const r = await e.comoUsuario(P.vigilador, () => e.q(`delete from registros_asistencia where id = $1`, [REGISTRO.vigNorte]))
      expect(r.afectadas).toBe(0)
    })
  })
  it('no lee la auditoría de liquidación', async () => {
    const r = await e.comoUsuario(P.vigilador, () => e.q(`select 1 from liquidacion_auditoria`))
    expect(r.rows).toHaveLength(0)
  })
})

describe('supervisor (Zona Norte)', () => {
  it('ve turnos y fichajes de su zona y no los de la Zona Sur', async () => {
    await e.comoUsuario(P.supervisor, async () => {
      expect(ids((await e.q<{ id: string }>(`select id from turnos`)).rows)).toEqual([TURNO.vigNorte, TURNO.vigNorteManiana].sort())
      expect(ids((await e.q<{ id: string }>(`select id from registros_asistencia`)).rows)).toEqual([REGISTRO.vigNorte])
    })
  })
  it('ve supervisiones de su zona y no las de la otra', async () => {
    const r = await e.comoUsuario(P.supervisor, () => e.q<{ id: string }>(`select id from supervisiones`))
    expect(ids(r.rows)).toEqual([SUPERVISION.norte])
  })
  it('no puede crear zonas ni asignarse zonas', async () => {
    await e.enTransaccion(async () => {
      await e.comoUsuario(P.supervisor, async () => {
        expect((await e.intentar(() => e.q(`insert into zonas_operativas (nombre) values ('Zona Inventada')`)))?.message).toMatch(RLS)
        expect((await e.intentar(() => e.q(`insert into supervisor_zonas (supervisor_id, zona_id) values ($1, $2)`, [P.supervisor.id, ZONA.sur])))?.message).toMatch(RLS)
      })
    })
  })
  it('no puede modificar un objetivo de otra zona (0 filas)', async () => {
    await e.enTransaccion(async () => {
      const r = await e.comoUsuario(P.supervisor, () => e.q(`update objetivos set direccion = 'x' where id = $1`, [OBJETIVO.sur]))
      expect(r.afectadas).toBe(0)
    })
  })
  it('no puede borrar fichajes (no tiene alcance total)', async () => {
    await e.enTransaccion(async () => {
      const r = await e.comoUsuario(P.supervisor, () => e.q(`delete from registros_asistencia where id = $1`, [REGISTRO.vigNorte]))
      expect(r.afectadas).toBe(0)
    })
  })
  it('no puede cambiar puestos de usuarios', async () => {
    await e.enTransaccion(async () => {
      const r = await e.comoUsuario(P.supervisor, () => e.q(`update usuarios set puesto_organizacional = 'supervisor' where id = $1`, [P.vigilador.id]))
      expect(r.afectadas).toBe(0)
    })
  })
})

describe('jefe de supervisores', () => {
  it('ve turnos y supervisiones de todas las zonas', async () => {
    await e.comoUsuario(P.jefe, async () => {
      expect((await e.q(`select 1 from turnos`)).rows).toHaveLength(3)
      expect((await e.q(`select 1 from supervisiones`)).rows).toHaveLength(2)
    })
  })
  it('no gestiona personal: no puede dar de alta usuarios', async () => {
    await e.enTransaccion(async () => {
      const err = await e.comoUsuario(P.jefe, () => e.intentar(() =>
        e.q(`insert into usuarios (nombre, apellido, legajo, rol) values ('Nuevo', 'Ficticio', 'F-900', 'guardia')`)))
      expect(err?.message).toMatch(RLS)
    })
  })
})

describe('administración', () => {
  it('gestiona personal: puede cambiar el puesto de un vigilador a supervisor', async () => {
    await e.enTransaccion(async () => {
      const r = await e.comoUsuario(P.administracion, () =>
        e.q(`update usuarios set puesto_organizacional = 'supervisor', rol = 'supervisor' where id = $1`, [P.vigilador.id]))
      expect(r.afectadas).toBe(1)
    })
  })
  it('no puede dar nivel gerencia (trigger usuarios_proteger_campos_criticos)', async () => {
    await e.enTransaccion(async () => {
      const err = await e.comoUsuario(P.administracion, () => e.intentar(() =>
        e.q(`update usuarios set puesto_organizacional = 'gerencia' where id = $1`, [P.administracion.id])))
      expect(err?.message).toMatch(/Sólo Gerencia/)
    })
  })
  it('no puede otorgar acceso_admin_pleno ni acceso a Facturación', async () => {
    await e.enTransaccion(async () => {
      await e.comoUsuario(P.administracion, async () => {
        expect((await e.intentar(() => e.q(`update usuarios set acceso_admin_pleno = true where id = $1`, [P.jefe.id])))?.message).toMatch(/Sólo Gerencia/)
        expect((await e.intentar(() => e.q(`update usuarios set acceso_facturacion = true where id = $1`, [P.administracion.id])))?.message).toMatch(/Sólo Gerencia/)
      })
    })
  })
  it('no puede modificar la cuenta bancaria', async () => {
    await e.enTransaccion(async () => {
      const err = await e.comoUsuario(P.administracion, () => e.intentar(() =>
        e.q(`update usuarios set cuenta_bancaria = '0000000000000000000099' where id = $1`, [P.vigilador.id])))
      expect(err?.message).toMatch(/Sólo Gerencia/)
    })
  })
  it('no puede borrar usuarios (sólo Gerencia)', async () => {
    await e.enTransaccion(async () => {
      const r = await e.comoUsuario(P.administracion, () => e.q(`delete from usuarios where id = $1`, [P.vigiladorSur.id]))
      expect(r.afectadas).toBe(0)
    })
  })
  it('lee la auditoría de liquidación', async () => {
    const r = await e.comoUsuario(P.administracion, () => e.q(`select 1 from liquidacion_auditoria`))
    expect(r.rows).toHaveLength(1)
  })
})

describe('gerencia', () => {
  it('puede otorgar acceso a Facturación a Administración', async () => {
    await e.enTransaccion(async () => {
      const r = await e.comoUsuario(P.gerencia, () => e.q(`update usuarios set acceso_facturacion = true where id = $1`, [P.administracion.id]))
      expect(r.afectadas).toBe(1)
    })
  })
  it('el bloqueo de acceso sólo se cambia desde el procedimiento de baja', async () => {
    await e.enTransaccion(async () => {
      const err = await e.comoUsuario(P.gerencia, () => e.intentar(() =>
        e.q(`update usuarios set acceso_bloqueado = true where id = $1`, [P.vigilador.id])))
      expect(err?.message).toMatch(/procedimiento de baja/)
    })
  })
})

describe('restricciones transversales', () => {
  it('un usuario con acceso bloqueado (baja) no ve nada aunque tenga el puesto', async () => {
    await e.enTransaccion(async () => {
      await e.exec(`select set_config('mercosur.baja_rpc', '1', true); update usuarios set acceso_bloqueado = true where id = '${P.supervisor.id}'`)
      await e.comoUsuario(P.supervisor, async () => {
        expect((await e.q(`select 1 from turnos`)).rows).toHaveLength(0)
        expect((await e.q(`select 1 from usuarios`)).rows).toHaveLength(0)
      })
    })
  })
  it('app_config: autenticados no leen claves con nombre de secreto', async () => {
    const r = await e.comoUsuario(P.gerencia, () => e.q<{ key: string }>(`select key from app_config order by key`))
    expect(r.rows.map(x => x.key)).toEqual(['ejemplo_publico'])
  })
  it('anon no tiene grants sobre las tablas del snapshot', async () => {
    for (const t of ['usuarios', 'registros_asistencia', 'turnos', 'app_config']) {
      const err = await e.enTransaccion(() => e.comoAnon(() => e.intentar(() => e.q(`select 1 from ${t}`))))
      expect(err?.message, t).toMatch(SIN_PERMISO)
    }
  })
  it('authenticated no ejecuta funciones internas que sólo son de service_role', async () => {
    const err = await e.enTransaccion(() => e.comoUsuario(P.gerencia, () => e.intentar(() =>
      e.q(`select * from turno_coberturas($1)`, [TURNO.vigNorte]))))
    expect(err?.message).toMatch(SIN_PERMISO)
  })
})
