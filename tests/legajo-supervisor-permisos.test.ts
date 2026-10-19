import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { accesoLegajoPorPuesto, resolverAccesoLegajo } from '@/lib/legajo-supervisor'

// Legajos y evaluaciones de supervisores (JC 19/10, corrección A): una sola
// lista de autorizaciones individuales, independiente del cargo. Identidades
// reales de producción, verificadas el 19/10/2026.

const leer = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8')
const MIG_328 = leer('supabase', 'migrations', '20261030120000_legajo_operativo_supervisores.sql')
const MIG_A = leer('supabase', 'migrations', '20261101120000_legajo_evaluacion_lista_unica.sql')
const VERIF_A = leer('supabase', 'verificacion', 'legajo_evaluacion_lista_unica_post_migracion.sql')

type Persona = { nombre: string; id: string; rol: string; puesto_organizacional: string | null; tieneZona: boolean; vistaAdmin?: boolean }

const AUTORIZADOS: Persona[] = [
  { nombre: 'Juan Cruz Romero (Gerencia)', id: '3a8e3c04-f4f5-48c4-8830-73edccb73667', rol: 'admin', puesto_organizacional: 'gerencia', tieneZona: false },
  { nombre: 'Facundo Romero (Gerencia)', id: '5a8e3f70-77ef-4f89-8332-b9878f32a293', rol: 'admin', puesto_organizacional: 'gerencia', tieneZona: false },
  { nombre: 'Rodolfo Romero (Dirección)', id: '3731aa27-ce78-4817-8faa-66ad1edfabaa', rol: 'admin', puesto_organizacional: 'direccion_operativa', tieneZona: false },
  { nombre: 'Aldo Monzón (Jefe de supervisores)', id: '023769de-9e99-481a-9caa-c604ef56b14b', rol: 'supervisor', puesto_organizacional: 'jefe_supervisores', tieneZona: false },
  { nombre: 'Laura M. (Administración)', id: '1384746c-0520-4ebe-8d7b-17788d833cba', rol: 'admin', puesto_organizacional: 'administracion', tieneZona: false },
  { nombre: 'Joel Juárez (Administración)', id: 'a2cd1908-7e9d-4bf4-8407-ecf644e1f351', rol: 'admin', puesto_organizacional: 'administracion', tieneZona: false },
  { nombre: 'Andrea Narvarte (Administración)', id: 'eecd4b5c-095d-4062-be10-25e78ea9f499', rol: 'admin', puesto_organizacional: 'administracion', tieneZona: false },
]
const SERGIO: Persona = { nombre: 'Sergio Martínez (supervisor + jefatura, vista admin, admin pleno)', id: '69493cc2-15d6-4618-893e-4a9b1d044df8', rol: 'admin', puesto_organizacional: 'jefe_supervisores', tieneZona: true, vistaAdmin: true }

const SIN_ACCESO: Persona[] = [
  SERGIO,
  { nombre: 'Sabino Aranda', id: 'sup-aranda', rol: 'supervisor', puesto_organizacional: 'supervisor', tieneZona: true },
  { nombre: 'Walter Fulla', id: 'sup-fulla', rol: 'supervisor', puesto_organizacional: 'supervisor', tieneZona: true },
  { nombre: 'José Luis Martínez', id: '2b51e32a-f493-46cc-82ee-6880a8c715b8', rol: 'supervisor', puesto_organizacional: 'supervisor', tieneZona: true },
  { nombre: 'Carlos Acosta', id: 'sup-acosta', rol: 'supervisor', puesto_organizacional: 'supervisor', tieneZona: true },
  { nombre: 'Cristian Wilhjelm', id: 'sup-wilhjelm', rol: 'supervisor', puesto_organizacional: 'supervisor', tieneZona: true },
  { nombre: 'Gerencia nueva (no está en la lista)', id: 'ger-nueva', rol: 'admin', puesto_organizacional: 'gerencia', tieneZona: false },
  { nombre: 'Dirección nueva (no está en la lista)', id: 'dir-nueva', rol: 'admin', puesto_organizacional: 'direccion_operativa', tieneZona: false },
  { nombre: 'Administración nueva (no está en la lista)', id: 'adm-nueva', rol: 'admin', puesto_organizacional: 'administracion', tieneZona: false },
]

// La lista sale de las MIGRACIONES (bloques de carga de #328 y de la corrección A).
const idsDeCarga = (sql: string) => {
  const b = sql.slice(sql.indexOf('do $carga$'), sql.indexOf('$carga$;'))
  return Array.from(b.matchAll(/'([0-9a-f-]{36})'::uuid/g), m => m[1])
}
const LISTA = new Set(idsDeCarga(MIG_328).concat(idsDeCarga(MIG_A)))

/** Base simulada con la regla de la corrección A: usuario en la lista. Nada más. */
function baseSimulada(quien: Persona, lista: Set<string> = LISTA) {
  const llamadas: string[] = []
  const db = {
    rpc: async (fn: string) => {
      llamadas.push(fn)
      if (fn !== 'puede_ver_legajo_supervisores_actual') return { data: null, error: { message: 'rpc inesperada' } }
      return { data: lista.has(quien.id), error: null }
    },
  }
  return { db, llamadas }
}

describe('los siete autorizados ven legajos y evaluaciones', () => {
  for (const p of AUTORIZADOS) {
    it(p.nombre, async () => {
      const { db, llamadas } = baseSimulada(p)
      expect(await resolverAccesoLegajo(db, p)).toBe(true)
      // Ningún cargo decide en la pantalla: siempre se le pregunta a la base.
      expect(llamadas).toEqual(['puede_ver_legajo_supervisores_actual'])
    })
  }
})

describe('Sergio, los supervisores y quien no está en la lista NO ven', () => {
  for (const p of SIN_ACCESO) {
    it(p.nombre, async () => {
      const { db } = baseSimulada(p)
      expect(await resolverAccesoLegajo(db, p)).toBe(false)
    })
  }
  it('tener la vista administrativa o admin pleno no da acceso', () => {
    expect(accesoLegajoPorPuesto({ puesto_organizacional: 'jefe_supervisores', rol: 'admin', acceso_admin_pleno: true, acceso_interfaz_admin: true })).toBe('consultar')
  })
  it('a los vigiladores ni se les consulta', async () => {
    const vig: Persona = { nombre: 'Vigilador', id: 'vig-1', rol: 'guardia', puesto_organizacional: 'vigilador', tieneZona: false }
    const { db, llamadas } = baseSimulada(vig)
    expect(await resolverAccesoLegajo(db, vig)).toBe(false)
    expect(llamadas).toEqual([])
    expect(accesoLegajoPorPuesto({ rol: 'guardia' })).toBe('no')
    expect(accesoLegajoPorPuesto(null)).toBe('no')
  })
  it('si la base falla, no se abre (fail-closed)', async () => {
    expect(await resolverAccesoLegajo({ rpc: async () => ({ data: null, error: { message: 'timeout' } }) }, AUTORIZADOS[0])).toBe(false)
    expect(await resolverAccesoLegajo({ rpc: async () => { throw new Error('red') } }, AUTORIZADOS[4])).toBe(false)
  })
})

describe('habilitar a Sergio más adelante = agregarlo a la lista, sin tocar su rol', () => {
  it('con la misma persona, rol y zona, pasa a ver al estar en la lista', async () => {
    const { db } = baseSimulada(SERGIO, new Set(Array.from(LISTA).concat(SERGIO.id)))
    expect(await resolverAccesoLegajo(db, SERGIO)).toBe(true)
  })
  it('la regla de la base no mira zona, puesto ni delegación', () => {
    const fn = MIG_A.slice(MIG_A.indexOf('function public.puede_ver_legajo_supervisores(p_usuario_id uuid)')).split('$$;')[0]
    expect(fn).toContain('join public.legajo_supervisores_accesos a on a.usuario_id = u.id')
    expect(fn).not.toMatch(/supervisor_zonas|puesto_organizacional|tiene_delegacion_gerencia/)
  })
})

describe('las migraciones autorizan exactamente a las siete personas', () => {
  it('lista = 7 (4 de #328 + Juan Cruz, Facundo y Rodolfo); Sergio no está', () => {
    expect(Array.from(LISTA).sort()).toEqual(AUTORIZADOS.map(p => p.id).sort())
    expect(MIG_328 + MIG_A).not.toMatch(/'69493cc2-15d6-4618-893e-4a9b1d044df8'::uuid/)
  })
  it('la carga de la corrección A verifica email y puesto, y aborta si no coinciden', () => {
    const b = MIG_A.slice(MIG_A.indexOf('do $carga$'), MIG_A.indexOf('$carga$;'))
    for (const s of ["'admin@mercosur.com'", "'facundomromero@gmail.com'", "'rodolfofederico2002@hotmail.com'"]) expect(b).toContain(s)
    expect(b).toMatch(/raise exception 'legajo_supervisores_accesos: % \(%\) no coincide con usuarios/)
  })
  it('la evaluación (ranking de la Etapa 1) usa la misma lista que el legajo', () => {
    const fn = MIG_A.slice(MIG_A.indexOf('function public.puede_evaluar_supervisores_actual()')).split('$$;')[0]
    expect(fn).toMatch(/select public\.puede_ver_legajo_supervisores_actual\(\)/)
  })
  it('la verificación post-migración espera exactamente a los siete', () => {
    const esperados = Array.from(VERIF_A.matchAll(/\('([0-9a-f-]{36})'::uuid\)/g), m => m[1]).sort()
    expect(esperados).toEqual(AUTORIZADOS.map(p => p.id).sort())
    expect(VERIF_A).toContain("'Usuarios activos con acceso', '7'")
  })
})
