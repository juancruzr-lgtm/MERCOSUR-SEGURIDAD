/**
 * /api/bajas/confirmar — CONFIRMAR BAJA (Administración / Gerencia).
 *
 *   POST { baja_id, vacaciones: {devengadas, tomadas, pendientes, metodo, verificadas, nota} | null }
 *
 * 1. RPC baja_confirmar con la identidad de quien confirma (permiso y auditoría):
 *    en UNA transacción confirma la baja, pasa a desvinculado, bloquea el acceso
 *    en la base (política restrictiva en todas las tablas) y genera el borrador de
 *    liquidación final. Si falla, no cambia nada.
 * 2. Ban en Supabase Auth (no inicia sesión ni renueva tokens). Si falla, la base
 *    ya está bloqueada: se informa y se puede reintentar desde la baja.
 * 3. Aviso push a Operaciones por los turnos asignados después de la baja (sin
 *    importes ni documentación). Si falla, el aviso queda en la pantalla.
 * Reintentar es seguro: la RPC devuelve la baja ya confirmada sin duplicar nada.
 */
import { NextRequest, NextResponse } from 'next/server'
import { SIN_CACHE, clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { bloquearAccesoAuth } from '@/app/api/_lib/employee-auth'
import { sendToUsers } from '@/app/api/_lib/push-notificaciones'
import type { PushSubscriptionRow } from '@/app/api/_lib/web-push'
import { TIPO_AVISO_BAJA, armarAvisosTurnosFuturos, type TurnoFuturo } from '@/lib/baja-avisos'

export const runtime = 'nodejs'
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

const responder = (cuerpo: unknown, status = 200) => NextResponse.json(cuerpo, { status, headers: SIN_CACHE })

export async function POST(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)
  const body = await req.json().catch(() => null) as { baja_id?: string; vacaciones?: unknown } | null
  if (!body?.baja_id || !/^[0-9a-f-]{36}$/i.test(body.baja_id)) return responder({ error: 'Falta la baja' }, 400)

  const { data, error } = await c.usuario.rpc('baja_confirmar', { p_baja_id: body.baja_id, p_vacaciones: body.vacaciones ?? null })
  if (error) return responder({ error: error.message }, /Administración o Gerencia/.test(error.message) ? 403 : 400)
  const r = data as { baja_id: string; final_id: string; repetida: boolean; auth_user_id: string | null; turnos_futuros: TurnoFuturo[] }

  // 2) Ban en Auth.
  const { data: baja } = await c.admin.from('baja_laboral').select('empleado_id, nombre, fecha_baja').eq('id', r.baja_id).maybeSingle()
  const empleadoId = (baja as { empleado_id?: string } | null)?.empleado_id ?? null
  let auth: 'bloqueado' | 'sin_cuenta' | 'error' = 'sin_cuenta'
  let authError: string | null = null
  if (r.auth_user_id) {
    const { error: e } = await bloquearAccesoAuth(c.admin, r.auth_user_id)
    if (e) { auth = 'error'; authError = e.message }
    else {
      auth = 'bloqueado'
      if (empleadoId) await c.admin.rpc('baja_registrar_bloqueo_auth', { p_empleado_id: empleadoId, p_bloqueado: true })
    }
  }

  // 3) Aviso a Operaciones (best effort; nunca deshace la confirmación).
  let avisos = 0
  try {
    if (!r.repetida && r.turnos_futuros?.length && baja) {
      const objetivos = Array.from(new Set(r.turnos_futuros.map(t => t.objetivo_id).filter(Boolean))) as string[]
      const [{ data: objs }, { data: sz }, { data: jefes }] = await Promise.all([
        c.admin.from('objetivos').select('id, zona_id').in('id', objetivos.length ? objetivos : ['00000000-0000-0000-0000-000000000000']),
        c.admin.from('supervisor_zonas').select('supervisor_id, zona_id'),
        c.admin.from('usuarios').select('id').eq('estado', 'activo').eq('puesto_organizacional', 'jefe_supervisores'),
      ])
      const zonaDeObjetivo = new Map<string, string | null>(((objs ?? []) as any[]).map(o => [o.id, o.zona_id ?? null]))
      const supervisoresPorZona = new Map<string, string[]>()
      for (const s of (sz ?? []) as any[]) supervisoresPorZona.set(s.zona_id, [...(supervisoresPorZona.get(s.zona_id) ?? []), s.supervisor_id])
      const lista = armarAvisosTurnosFuturos({
        persona: String((baja as any).nombre ?? 'empleado'), fechaBaja: String((baja as any).fecha_baja),
        turnos: r.turnos_futuros, zonaDeObjetivo, supervisoresPorZona, jefes: ((jefes ?? []) as any[]).map(j => j.id),
      })
      const usuarios = Array.from(new Set(lista.flatMap(a => a.usuarios)))
      if (usuarios.length) {
        const { data: subs } = await c.admin.from('push_subscriptions').select('id, usuario_id, endpoint, p256dh, auth').eq('activo', true).in('usuario_id', usuarios)
        for (const a of lista) {
          const res = await sendToUsers(c.admin, (subs ?? []) as PushSubscriptionRow[], a.usuarios, a.turnoId, TIPO_AVISO_BAJA, { title: a.titulo, body: a.cuerpo, tag: `${TIPO_AVISO_BAJA}-${a.turnoId}` })
          avisos += Number((res as any)?.sent ?? 0)
        }
      }
    }
  } catch (e) {
    console.error('BAJA aviso turnos futuros', e)
  }

  return responder({
    baja_id: r.baja_id, final_id: r.final_id, repetida: r.repetida, turnos_futuros: r.turnos_futuros ?? [],
    acceso: { base: 'bloqueado', auth, error: authError }, avisos_enviados: avisos,
  })
}
