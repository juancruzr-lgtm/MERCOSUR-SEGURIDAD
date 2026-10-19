import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { accesoLegajoPorPuesto, resolverAccesoLegajo } from '@/lib/legajo-supervisor'

// Permiso del legajo operativo de supervisores (JC 19/10): siete personas.
// Las identidades son las reales de producción (verificadas el 19/10/2026).

const MIGRACION = readFileSync(
  join(__dirname, '..', 'supabase', 'migrations', '20261030120000_legajo_operativo_supervisores.sql'), 'utf8')
const VERIFICACION = readFileSync(
  join(__dirname, '..', 'supabase', 'verificacion', 'legajo_operativo_supervisores_post_migracion.sql'), 'utf8')

type Persona = { nombre: string; id: string; rol: string; puesto_organizacional: string | null; tieneZona: boolean }

const AUTORIZADOS: Persona[] = [
  { nombre: 'Juan Cruz Romero', id: '3a8e3c04-f4f5-48c4-8830-73edccb73667', rol: 'admin', puesto_organizacional: 'gerencia', tieneZona: false },
  { nombre: 'Facundo Romero', id: '5a8e3f70-77ef-4f89-8332-b9878f32a293', rol: 'admin', puesto_organizacional: 'gerencia', tieneZona: false },
  { nombre: 'Rodolfo Romero', id: '3731aa27-ce78-4817-8faa-66ad1edfabaa', rol: 'admin', puesto_organizacional: 'direccion_operativa', tieneZona: false },
  { nombre: 'Aldo Monzón', id: '023769de-9e99-481a-9caa-c604ef56b14b', rol: 'supervisor', puesto_organizacional: 'jefe_supervisores', tieneZona: false },
  { nombre: 'Laura M.', id: '1384746c-0520-4ebe-8d7b-17788d833cba', rol: 'admin', puesto_organizacional: 'administracion', tieneZona: false },
  { nombre: 'Joel Juárez', id: 'a2cd1908-7e9d-4bf4-8407-ecf644e1f351', rol: 'admin', puesto_organizacional: 'administracion', tieneZona: false },
  { nombre: 'Andrea Narvarte', id: 'eecd4b5c-095d-4062-be10-25e78ea9f499', rol: 'admin', puesto_organizacional: 'administracion', tieneZona: false },
]

const SIN_ACCESO: Persona[] = [
  { nombre: 'Sergio Martínez (jefe, supervisa Rosario)', id: '69493cc2-15d6-4618-893e-4a9b1d044df8', rol: 'admin', puesto_organizacional: 'jefe_supervisores', tieneZona: true },
  { nombre: 'Sabino Aranda', id: 'sup-aranda', rol: 'supervisor', puesto_organizacional: 'supervisor', tieneZona: true },
  { nombre: 'Walter Fulla', id: 'sup-fulla', rol: 'supervisor', puesto_organizacional: 'supervisor', tieneZona: true },
  { nombre: 'José Luis Martínez', id: '2b51e32a-f493-46cc-82ee-6880a8c715b8', rol: 'supervisor', puesto_organizacional: 'supervisor', tieneZona: true },
  { nombre: 'Carlos Acosta', id: 'sup-acosta', rol: 'supervisor', puesto_organizacional: 'supervisor', tieneZona: true },
  { nombre: 'Cristian Wilhjelm', id: 'sup-wilhjelm', rol: 'supervisor', puesto_organizacional: 'supervisor', tieneZona: true },
  { nombre: 'Vigilador cualquiera', id: 'vig-1', rol: 'guardia', puesto_organizacional: 'vigilador', tieneZona: false },
  { nombre: 'Otra persona de Administración (sin autorización nominal)', id: 'adm-nueva', rol: 'admin', puesto_organizacional: 'administracion', tieneZona: false },
]

// Las autorizaciones nominales salen de la MIGRACIÓN (bloque de carga), no de este test.
const bloqueCarga = MIGRACION.slice(MIGRACION.indexOf('do $carga$'), MIGRACION.indexOf('$carga$;'))
const NOMINALES = new Set(Array.from(bloqueCarga.matchAll(/'([0-9a-f-]{36})'::uuid/g), m => m[1]))

/** Base simulada con la misma regla que puede_ver_legajo_supervisores(p_usuario_id). */
function baseSimulada(quien: Persona, nominales: Set<string> = NOMINALES) {
  const llamadas: string[] = []
  const db = {
    rpc: async (fn: string) => {
      llamadas.push(fn)
      if (fn !== 'puede_ver_legajo_supervisores_actual') return { data: null, error: { message: 'rpc inesperada' } }
      const porPuesto = quien.puesto_organizacional === 'gerencia' || quien.puesto_organizacional === 'direccion_operativa'
      return { data: porPuesto || (nominales.has(quien.id) && !quien.tieneZona), error: null }
    },
  }
  return { db, llamadas }
}

describe('los siete autorizados ven los legajos', () => {
  for (const p of AUTORIZADOS) {
    it(p.nombre, async () => {
      const { db, llamadas } = baseSimulada(p)
      expect(await resolverAccesoLegajo(db, p)).toBe(true)
      // Gerencia y Dirección se resuelven por puesto, sin consultar; el resto, sólo con la base.
      const porPuesto = p.puesto_organizacional === 'gerencia' || p.puesto_organizacional === 'direccion_operativa'
      expect(llamadas).toEqual(porPuesto ? [] : ['puede_ver_legajo_supervisores_actual'])
    })
  }
})

describe('Sergio y los supervisores NO ven legajos ajenos', () => {
  for (const p of SIN_ACCESO) {
    it(p.nombre, async () => {
      const { db } = baseSimulada(p)
      expect(await resolverAccesoLegajo(db, p)).toBe(false)
    })
  }
  it('a supervisores y vigiladores ni se les consulta la base', async () => {
    for (const p of SIN_ACCESO.filter(x => x.puesto_organizacional === 'supervisor' || x.puesto_organizacional === 'vigilador')) {
      expect(accesoLegajoPorPuesto(p)).toBe('no')
      const { db, llamadas } = baseSimulada(p)
      await resolverAccesoLegajo(db, p)
      expect(llamadas).toEqual([])
    }
  })
  it('aunque alguien cargue a Sergio en la lista por error, con zona asignada no accede', async () => {
    const sergio = SIN_ACCESO[0]
    const { db } = baseSimulada(sergio, new Set(Array.from(NOMINALES).concat(sergio.id)))
    expect(await resolverAccesoLegajo(db, sergio)).toBe(false)
  })
  it('tener puesto de Administración no alcanza: decide la base', () => {
    expect(accesoLegajoPorPuesto({ puesto_organizacional: 'administracion', rol: 'admin' })).toBe('consultar')
    expect(accesoLegajoPorPuesto({ puesto_organizacional: 'jefe_supervisores', rol: 'admin', acceso_admin_pleno: true, acceso_interfaz_admin: true })).toBe('consultar')
  })
  it('si la base falla, no se abre (fail-closed)', async () => {
    const db = { rpc: async () => ({ data: null, error: { message: 'timeout' } }) }
    expect(await resolverAccesoLegajo(db, AUTORIZADOS[4])).toBe(false)
    const roto = { rpc: async () => { throw new Error('red') } }
    expect(await resolverAccesoLegajo(roto, AUTORIZADOS[3])).toBe(false)
  })
})

describe('la migración autoriza exactamente a quien corresponde', () => {
  it('la carga nominal son 4: Aldo, Laura, Joel y Andrea; Sergio no está', () => {
    expect(Array.from(NOMINALES).sort()).toEqual(AUTORIZADOS.filter(p => p.puesto_organizacional === 'jefe_supervisores' || p.puesto_organizacional === 'administracion').map(p => p.id).sort())
    expect(MIGRACION).not.toContain('69493cc2-15d6-4618-893e-4a9b1d044df8')
  })
  it('la carga verifica email, puesto y estado, y aborta si no coinciden', () => {
    for (const email of ['aldomonzon@hotmail.com', 'lauram@mercosurseguridad.com.ar', 'joelajuarez23@gmail.com', 'cvman64@hotmail.com']) {
      expect(bloqueCarga).toContain(`'${email}'`)
    }
    expect(bloqueCarga).toMatch(/raise exception 'legajo_supervisores_accesos: % \(%\) no coincide con usuarios/)
  })
  it('por puesto sólo Gerencia y Dirección Operativa; nominal sólo sin zona asignada', () => {
    const fn = MIGRACION.slice(MIGRACION.indexOf('function public.puede_ver_legajo_supervisores(p_usuario_id uuid)'))
      .split('$$;')[0]
    expect(fn).toContain("u.puesto_organizacional in ('direccion_operativa', 'gerencia')")
    expect(fn).not.toMatch(/'administracion'|'jefe_supervisores'|'supervisor'/)
    expect(fn).toMatch(/legajo_supervisores_accesos a where a\.usuario_id = u\.id\)\s*and not exists \(select 1 from public\.supervisor_zonas/)
  })
  it('la tabla de autorizaciones no queda abierta a la app', () => {
    expect(MIGRACION).toContain('revoke all on public.legajo_supervisores_accesos from public, anon, authenticated;')
    expect(MIGRACION).toMatch(/revoke all on function public\.puede_ver_legajo_supervisores\(uuid\)\s+from public, anon, authenticated;/)
  })
  it('la verificación post-migración espera exactamente a los siete', () => {
    const esperados = Array.from(VERIFICACION.matchAll(/\('([0-9a-f-]{36})'::uuid\)/g), m => m[1]).sort()
    expect(esperados).toEqual(AUTORIZADOS.map(p => p.id).sort())
    expect(VERIFICACION).toContain("'Usuarios activos con acceso', '7'")
  })
})
