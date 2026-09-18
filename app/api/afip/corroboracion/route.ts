/**
 * /api/afip/corroboracion — lectura y disparo manual de la corroboración A13.
 *
 *   GET  → últimas corridas + foto por empleado (para la pantalla de resultados).
 *   POST → corre la corroboración AHORA (botón "Corroborar ahora").
 *
 * Ambos gateados por capacidad `gestionar_personal` (Administración/Gerencia).
 * Las tablas AFIP son sólo-servidor (RLS cerrada), por eso se leen acá con el
 * cliente admin y no directo desde el navegador.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin, requireCapacidad } from '../../_lib/employee-auth'
import { afipConfigDesdeEnv } from '@/lib/afip/config'
import { corroborarEmpleados } from '@/lib/afip/corroborar'

export const runtime = 'nodejs'
export const maxDuration = 60
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const denegado = await requireCapacidad(req, admin.client, 'gestionar_personal')
  if (denegado) return denegado

  const [{ data: corridas }, { data: snapshots }] = await Promise.all([
    admin.client
      .from('afip_corroboracion_corrida')
      .select('id, iniciada_at, finalizada_at, total, consultados, con_novedad, errores, ok, detalle')
      .order('iniciada_at', { ascending: false })
      .limit(10),
    admin.client
      .from('afip_padron_snapshot')
      .select('usuario_id, cuil, existe, estado_clave, tipo_persona, apellido, nombre, razon_social, direccion, localidad, cod_postal, provincia, novedades, error, consultado_at, usuarios(nombre, apellido, legajo)')
      .order('consultado_at', { ascending: false })
      .limit(2000),
  ])

  return NextResponse.json({ corridas: corridas ?? [], snapshots: snapshots ?? [] })
}

export async function POST(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const denegado = await requireCapacidad(req, admin.client, 'gestionar_personal')
  if (denegado) return denegado

  const cfg = afipConfigDesdeEnv()
  if (cfg.error || !cfg.config) return NextResponse.json({ error: cfg.error }, { status: 400 })

  const resultado = await corroborarEmpleados(admin.client, cfg.config)
  return NextResponse.json(resultado, { status: resultado.ok ? 200 : 500 })
}
