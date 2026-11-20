// Rendimiento de RLS (20261221140000): el alcance total se calcula una vez por consulta.
// Debe dar EXACTAMENTE lo mismo que hoy, para lectura y escritura, en cada perfil ficticio.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { crearEntorno, type Entorno, P, OBJETIVO } from './entorno'

const MIG = join(__dirname, '..', '..', 'supabase', 'migrations')
const NUEVA = join(MIG, '20261221140000_rls_alcance_total_una_vez_por_consulta.sql')
const ROLLBACK = join(__dirname, '..', '..', 'supabase', 'rollback', '20261221140000_rls_alcance_total_una_vez_por_consulta_rollback.sql')

let e: Entorno
beforeAll(async () => {
  e = await crearEntorno()
  for (const m of ['20261220150000_usuarios_jerarquia_base', '20261220160000_supervisiones_sin_edicion_directa'])
    await e.aplicarArchivo(join(MIG, m + '.sql'))
}, 240_000)
afterAll(async () => { await e?.cerrar() })

const politicas = async () => (await e.q<any>(
  `select tablename, policyname, qual, with_check from pg_policies
    where policyname in ('registros_asistencia_alcance_total','registros_asistencia_select_alcance','turnos_alcance_operativo','supervisiones_select_alcance')
    order by 1, 2`)).rows

async function vista() {
  const out: Record<string, any> = {}
  let k = 0
  for (const [n, p] of Object.entries(P)) {
    const dia = (d: number) => `2026-11-${String(10 + k * 2 + d).padStart(2, '0')}`
    k++
    out[n] = await e.comoUsuario(p, async () => {
      const ids = async (t: string, col = 'id::text') => (await e.q<any>(`select ${col} k from ${t} order by 1`)).rows.map((r: any) => r.k).join(',')
      const alta = async (obj: string, fecha: string) => (await e.intentar(() => e.q(
        `insert into turnos (guardia_id, objetivo_id, fecha, hora_inicio, hora_fin, estado, publicado) values ($1,$2,$3,'08:00','20:00','programado',true)`,
        [P.vigilador.id, obj, fecha]))) === null
      return {
        registros: await ids('registros_asistencia'), turnos: await ids('turnos', "objetivo_id::text || ' ' || fecha::text"), supervisiones: await ids('supervisiones'),
        altaNorte: await alta(OBJETIVO.norte, dia(0)), altaSur: await alta(OBJETIVO.sur, dia(1)),
      }
    })
  }
  return out
}

describe('RLS: alcance total una vez por consulta', () => {
  it('cada perfil ve y escribe exactamente lo mismo que hoy', async () => {
    let antes: any
    await e.enTransaccion(async () => { antes = await vista() })
    // sanidad: el supervisor de zona ve menos que Administración y no da de alta en otra zona
    expect(antes.supervisor.turnos.length).toBeLessThan(antes.administracion.turnos.length)
    expect([antes.supervisor.altaNorte, antes.supervisor.altaSur]).toEqual([true, false])
    await e.enTransaccion(async () => {
      await e.aplicarArchivo(NUEVA)
      expect(await vista()).toEqual(antes)
    })
  })
  it('el rollback deja las políticas exactamente como hoy', async () => {
    await e.enTransaccion(async () => {
      const hoy = await politicas()
      expect(hoy).toHaveLength(4)
      await e.aplicarArchivo(NUEVA)
      expect(await politicas()).not.toEqual(hoy)
      await e.aplicarArchivo(ROLLBACK)
      expect(await politicas()).toEqual(hoy)
    })
  })
})
