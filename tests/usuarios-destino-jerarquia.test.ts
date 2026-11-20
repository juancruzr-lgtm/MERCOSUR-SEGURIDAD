import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { esCuentaGerencial, nivelDe, puedeOperarSobre } from '@/app/api/_lib/destino-usuario'

// ── Base falsa (service role) ────────────────────────────────────────────────
type Fila = Record<string, any>
const db: Record<string, Fila[]> = {}
const authUpdates: string[] = []
const reparados: string[] = []
const sincronizados: string[] = []

function semilla() {
  db.usuarios = [
    { id: 'ger', auth_user_id: 'tok-ger', rol: 'admin', puesto_organizacional: 'gerencia', estado: 'activo', dni: '11111111', email: 'g@x.test' },
    { id: 'ger2', auth_user_id: 'tok-ger2', rol: 'admin', puesto_organizacional: 'gerencia', estado: 'activo', dni: '22222222', email: 'g2@x.test' },
    { id: 'adm', auth_user_id: 'tok-adm', rol: 'admin', puesto_organizacional: 'administracion', estado: 'activo', dni: '33333333', email: 'a@x.test' },
    { id: 'sup', auth_user_id: 'tok-sup', rol: 'supervisor', puesto_organizacional: 'supervisor', estado: 'activo', dni: '44444444', email: 's@x.test' },
    { id: 'pleno', auth_user_id: 'tok-pleno', rol: 'supervisor', puesto_organizacional: 'supervisor', estado: 'activo', acceso_admin_pleno: true, dni: '55555555', email: 'p@x.test' },
    { id: 'vig', auth_user_id: 'tok-vig', rol: 'guardia', puesto_organizacional: 'vigilador', estado: 'activo', dni: '66666666', email: 'v@x.test' },
  ]
  db.gerencia_delegaciones = []
  db.supervisor_zonas = []
  db.turnos = []
  db.objetivos = []
}

class Consulta {
  private filtros: Array<(f: Fila) => boolean> = []
  private cambio: Fila | null = null
  constructor(private tabla: string) {}
  select() { return this }
  order() { return this }
  limit() { return this }
  eq(c: string, v: unknown) { this.filtros.push(f => f[c] === v); return this }
  neq(c: string, v: unknown) { this.filtros.push(f => f[c] !== v); return this }
  in(c: string, vs: unknown[]) { this.filtros.push(f => vs.includes(f[c])); return this }
  not(c: string, _op: string, v: unknown) { this.filtros.push(f => f[c] != v); return this }
  update(p: Fila) { this.cambio = p; return this }
  insert(p: Fila) { const fila = { id: `nuevo-${(db[this.tabla] ??= []).length}`, ...p }; db[this.tabla].push(fila); this.filtros = [f => f === fila]; return this }
  private filas() {
    const filas = (db[this.tabla] ?? []).filter(f => this.filtros.every(fn => fn(f)))
    if (this.cambio) for (const f of filas) Object.assign(f, this.cambio)
    return filas
  }
  maybeSingle() { return Promise.resolve({ data: this.filas()[0] ?? null, error: null }) }
  single() { const f = this.filas()[0]; return Promise.resolve(f ? { data: f, error: null } : { data: null, error: { message: 'sin fila' } }) }
  then(ok: (r: unknown) => unknown, ko?: (e: unknown) => unknown) { return Promise.resolve({ data: this.filas(), error: null }).then(ok, ko) }
}

const clienteFalso = {
  from: (t: string) => new Consulta(t),
  rpc: async () => ({ data: null, error: null }),
  auth: {
    getUser: async (token: string) => ({ data: { user: token ? { id: token } : null }, error: token ? null : { message: 'x' } }),
    admin: { updateUserById: async (id: string) => { authUpdates.push(id); return { error: null } } },
  },
}

vi.mock('@supabase/supabase-js', () => ({ createClient: () => clienteFalso }))
vi.mock('@/app/api/_lib/auth-repair', () => ({
  repairEmployeeAuthUser: async (_c: unknown, u: { id: string }) => { reparados.push(u.id); return { action: 'reparado', user: { id: u.id } } },
  auditAuthUsers: async (_c: unknown, f: { usuario_id?: string | null } = {}) => ({
    report: {}, authIndex: {}, users: db.usuarios.filter(u => !f.usuario_id || u.id === f.usuario_id),
  }),
  summarizeRepairs: (r: unknown[]) => ({ reparados: r.length, recreados: 0, creados: 0, vinculados: 0, omitidos: 0, errores: 0 }),
}))
vi.mock('@/app/api/_lib/acceso-password', () => ({ marcarCambioObligatorio: async () => ({ ok: true }) }))
vi.mock('@/app/api/_lib/employee-auth', async (original) => ({
  ...(await original<typeof import('@/app/api/_lib/employee-auth')>()),
  ensureEmployeeAuth: async (_c: unknown, u: { id: string }) => { sincronizados.push(u.id); return { action: 'actualizado', user: u } },
}))

import { PATCH as patchUsuarios, POST as postUsuarios } from '@/app/api/usuarios/route'
import { POST as postEmail } from '@/app/api/update-user-email/route'
import { POST as postReset } from '@/app/api/reset-user-password/route'
import { POST as postCreate } from '@/app/api/create-user/route'
import { POST as postRepair } from '@/app/api/admin/repair-auth-users/route'
import { POST as postSync } from '@/app/api/sync-employee-auth/route'

beforeEach(() => {
  semilla()
  authUpdates.length = 0
  reparados.length = 0
  sincronizados.length = 0
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:9'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'
})

const pedido = (token: string, body: unknown, method = 'POST') =>
  new NextRequest('http://localhost/api/x', { method, headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
const fila = (id: string) => db.usuarios.find(u => u.id === id)!

// ── Regla pura ───────────────────────────────────────────────────────────────
describe('puedeOperarSobre — regla jerárquica', () => {
  const ger = { id: 'g', rol: 'admin', puesto_organizacional: 'gerencia' }
  const adm = { id: 'a', rol: 'admin', puesto_organizacional: 'administracion' }
  const sup = { id: 's', rol: 'supervisor', puesto_organizacional: 'supervisor' }
  const vig = { id: 'v', rol: 'guardia', puesto_organizacional: 'vigilador' }

  it('niveles y fallback por rol sin puesto', () => {
    expect(nivelDe(vig)).toBeLessThan(nivelDe(sup))
    expect(nivelDe({ puesto_organizacional: 'jefe_supervisores' })).toBeLessThan(nivelDe({ puesto_organizacional: 'direccion_operativa' }))
    expect(nivelDe({ puesto_organizacional: 'direccion_operativa' })).toBeLessThan(nivelDe(adm))
    expect(nivelDe(adm)).toBeLessThan(nivelDe(ger))
    expect(nivelDe({ rol: 'admin', puesto_organizacional: null })).toBe(nivelDe(ger))
    expect(nivelDe({ rol: 'supervisor', puesto_organizacional: null })).toBe(nivelDe(sup))
  })
  it('cuenta gerencial: puesto, override o delegación', () => {
    expect(esCuentaGerencial(ger)).toBe(true)
    expect(esCuentaGerencial({ ...sup, acceso_admin_pleno: true })).toBe(true)
    expect(esCuentaGerencial({ ...adm, acceso_gerencia_delegado: true })).toBe(true)
    expect(esCuentaGerencial(adm)).toBe(false)
  })
  it('Administración → Gerencia: rechazado', () => expect(puedeOperarSobre(adm, ger).ok).toBe(false))
  it('Gerencia → Gerencia: OK', () => expect(puedeOperarSobre(ger, { ...ger, id: 'g2' }).ok).toBe(true))
  it('Administración → vigilador: OK', () => expect(puedeOperarSobre(adm, vig).ok).toBe(true))
  it('supervisor → administración: rechazado (destino superior)', () => expect(puedeOperarSobre(sup, adm).ok).toBe(false))
  it('autoescalada: nadie cambia su propio puesto ni rol', () => {
    expect(puedeOperarSobre(adm, adm, { puesto_organizacional: 'gerencia' }).ok).toBe(false)
    expect(puedeOperarSobre(sup, sup, { puesto_organizacional: 'jefe_supervisores' }).ok).toBe(false)
    expect(puedeOperarSobre(ger, ger, { puesto_organizacional: 'administracion' }).ok).toBe(false)
    expect(puedeOperarSobre(adm, adm, { puesto_organizacional: 'administracion' }).ok).toBe(true) // sin cambio real
  })
  it('autoescalada por permisos especiales: rechazada (incluso Gerencia sobre sí)', () => {
    expect(puedeOperarSobre(adm, adm, { overrides: ['acceso_admin_pleno'] }).ok).toBe(false)
    expect(puedeOperarSobre(ger, ger, { overrides: ['acceso_admin_pleno'] }).ok).toBe(false)
  })
  it('asignar puesto superior al propio: rechazado', () => {
    expect(puedeOperarSobre(sup, vig, { puesto_organizacional: 'jefe_supervisores' }).ok).toBe(false)
    expect(puedeOperarSobre(adm, vig, { puesto_organizacional: 'gerencia' }).ok).toBe(false)
    expect(puedeOperarSobre(adm, { ...vig, puesto_organizacional: null }, { rol: 'admin' }).ok).toBe(false)
    expect(puedeOperarSobre(adm, vig, { puesto_organizacional: 'administracion' }).ok).toBe(true)
  })
  it('permisos especiales: sólo Gerencia los otorga', () => {
    expect(puedeOperarSobre(adm, vig, { overrides: ['acceso_admin_pleno'] }).ok).toBe(false)
    expect(puedeOperarSobre(adm, vig, { overrides: ['acceso_facturacion'] }).ok).toBe(false)
    expect(puedeOperarSobre(ger, vig, { overrides: ['acceso_admin_pleno'] }).ok).toBe(true)
  })
})

// ── Rutas ────────────────────────────────────────────────────────────────────
describe('PATCH /api/usuarios', () => {
  it('Administración → Gerencia (inactivar): 403 y no cambia nada', async () => {
    const r = await patchUsuarios(pedido('tok-adm', { usuario_id: 'ger', estado: 'inactivo' }, 'PATCH'))
    expect(r.status).toBe(403)
    expect(fila('ger').estado).toBe('activo')
  })
  it('Administración → Gerencia (bajar puesto): 403', async () => {
    const r = await patchUsuarios(pedido('tok-adm', { usuario_id: 'ger', puesto_organizacional: 'vigilador' }, 'PATCH'))
    expect(r.status).toBe(403)
    expect(fila('ger').puesto_organizacional).toBe('gerencia')
  })
  it('Administración → cuenta con override gerencial: 403', async () => {
    const r = await patchUsuarios(pedido('tok-adm', { usuario_id: 'pleno', telefono: '123' }, 'PATCH'))
    expect(r.status).toBe(403)
  })
  it('Gerencia → Gerencia: OK', async () => {
    const r = await patchUsuarios(pedido('tok-ger', { usuario_id: 'ger2', estado: 'inactivo' }, 'PATCH'))
    expect(r.status).toBe(200)
    expect(fila('ger2').estado).toBe('inactivo')
  })
  it('Administración → vigilador: OK', async () => {
    const r = await patchUsuarios(pedido('tok-adm', { usuario_id: 'vig', telefono: '3410000000' }, 'PATCH'))
    expect(r.status).toBe(200)
    expect(fila('vig').telefono).toBe('3410000000')
  })
  it('autoescalada (propio puesto a gerencia o propio rol): 403', async () => {
    expect((await patchUsuarios(pedido('tok-adm', { usuario_id: 'adm', puesto_organizacional: 'gerencia' }, 'PATCH'))).status).toBe(403)
    expect((await patchUsuarios(pedido('tok-adm', { usuario_id: 'adm', puesto_organizacional: 'supervisor' }, 'PATCH'))).status).toBe(403)
    expect(fila('adm').puesto_organizacional).toBe('administracion')
  })
  it('autoescalada por permisos especiales en el cuerpo: 403', async () => {
    const r = await patchUsuarios(pedido('tok-adm', { usuario_id: 'adm', acceso_admin_pleno: true, telefono: '1' }, 'PATCH'))
    expect(r.status).toBe(403)
  })
  it('asignar puesto superior al propio: 403', async () => {
    const r = await patchUsuarios(pedido('tok-adm', { usuario_id: 'vig', puesto_organizacional: 'gerencia' }, 'PATCH'))
    expect(r.status).toBe(403)
    expect(fila('vig').puesto_organizacional).toBe('vigilador')
  })
  it('asignar puesto igual al propio: OK', async () => {
    const r = await patchUsuarios(pedido('tok-adm', { usuario_id: 'vig', puesto_organizacional: 'administracion' }, 'PATCH'))
    expect(r.status).toBe(200)
  })
})

describe('POST /api/usuarios (alta)', () => {
  it('Administración no da de alta a alguien con puesto Gerencia: 403', async () => {
    const r = await postUsuarios(pedido('tok-adm', { nombre: 'N', apellido: 'A', legajo: '9', puesto_organizacional: 'gerencia' }))
    expect(r.status).toBe(403)
  })
  it('Administración da de alta un vigilador: OK', async () => {
    const r = await postUsuarios(pedido('tok-adm', { nombre: 'N', apellido: 'A', legajo: '9', rol: 'guardia', puesto_organizacional: 'vigilador' }))
    expect(r.status).toBe(200)
  })
})

describe('POST /api/update-user-email', () => {
  it('Administración → Gerencia: 403, no toca Auth ni la base', async () => {
    const r = await postEmail(pedido('tok-adm', { usuario_id: 'ger', email: 'otro@x.test' }))
    expect(r.status).toBe(403)
    expect(authUpdates).toHaveLength(0)
    expect(fila('ger').email).toBe('g@x.test')
  })
  it('Gerencia → Gerencia: OK', async () => {
    expect((await postEmail(pedido('tok-ger', { usuario_id: 'ger2', email: 'nuevo@x.test' }))).status).toBe(200)
    expect(authUpdates).toEqual(['tok-ger2'])
  })
  it('Administración → vigilador: OK', async () => {
    expect((await postEmail(pedido('tok-adm', { usuario_id: 'vig', email: 'nuevo@x.test' }))).status).toBe(200)
  })
})

describe('POST /api/reset-user-password', () => {
  it('Administración → Gerencia: 403 y no restablece', async () => {
    expect((await postReset(pedido('tok-adm', { usuario_id: 'ger' }))).status).toBe(403)
    expect(reparados).toHaveLength(0)
  })
  it('Administración → cuenta con override gerencial: 403', async () => {
    expect((await postReset(pedido('tok-adm', { usuario_id: 'pleno' }))).status).toBe(403)
  })
  it('Gerencia → Gerencia: OK', async () => {
    expect((await postReset(pedido('tok-ger', { usuario_id: 'ger2' }))).status).toBe(200)
    expect(reparados).toEqual(['ger2'])
  })
  it('Administración → vigilador: OK', async () => {
    expect((await postReset(pedido('tok-adm', { usuario_id: 'vig' }))).status).toBe(200)
  })
})

describe('POST /api/create-user', () => {
  it('Administración → Gerencia: 403', async () => {
    expect((await postCreate(pedido('tok-adm', { usuario_id: 'ger' }))).status).toBe(403)
    expect(reparados).toHaveLength(0)
  })
  it('Gerencia → Gerencia: OK', async () => {
    expect((await postCreate(pedido('tok-ger', { usuario_id: 'ger2' }))).status).toBe(200)
  })
  it('Administración → vigilador: OK; supervisor → vigilador: OK', async () => {
    expect((await postCreate(pedido('tok-adm', { usuario_id: 'vig' }))).status).toBe(200)
    expect((await postCreate(pedido('tok-sup', { usuario_id: 'vig' }))).status).toBe(200)
  })
})

describe('POST /api/admin/repair-auth-users', () => {
  it('Administración → Gerencia puntual: 403', async () => {
    expect((await postRepair(pedido('tok-adm', { usuario_id: 'ger', confirm: true }))).status).toBe(403)
    expect(reparados).toHaveLength(0)
  })
  it('reparación masiva por Administración saltea cuentas gerenciales', async () => {
    expect((await postRepair(pedido('tok-adm', { repair_all: true, confirm: true }))).status).toBe(200)
    expect(reparados).not.toContain('ger')
    expect(reparados).not.toContain('pleno')
    expect(reparados).toContain('vig')
  })
  it('Gerencia → Gerencia puntual: OK', async () => {
    expect((await postRepair(pedido('tok-ger', { usuario_id: 'ger2', confirm: true }))).status).toBe(200)
    expect(reparados).toEqual(['ger2'])
  })
})

describe('POST /api/sync-employee-auth', () => {
  it('Administración no sincroniza cuentas gerenciales', async () => {
    // rol 'admin' ya se excluye por consulta; la cuenta con override también queda afuera.
    expect((await postSync(pedido('tok-adm', {}))).status).toBe(200)
    expect(sincronizados).not.toContain('pleno')
    expect(sincronizados).toContain('vig')
  })
})
