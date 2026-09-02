import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../../_lib/employee-auth'
import { proveedorPorDefecto } from '@/lib/whatsapp'
import { normalizarTelefonoAr } from '@/lib/telefono-ar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const secreto = process.env.push_cron_secret || process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  if (!secreto || auth !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  // normalizarTelefonoAr devuelve { e164, motivo, original }: lo que viaja a
  // Meta es e164, y sin e164 no hay número al que mandar.
  const telefono = normalizarTelefonoAr('3413914544')
  if (!telefono.e164) {
    return NextResponse.json({ error: `Telefono de prueba invalido: ${telefono.motivo}` }, { status: 500 })
  }

  const proveedor = proveedorPorDefecto()
  if (!proveedor.configurado) {
    return NextResponse.json({ error: 'Proveedor WhatsApp no configurado' }, { status: 503 })
  }

  const resultado = await proveedor.enviar({
    telefono: telefono.e164,
    plantilla: process.env.WHATSAPP_PLANTILLA_15 || 'puesto_descubierto_15',
    variables: ['PRUEBA WHATSAPP', 'Puesto de prueba', '14:00 - 22:00', 'Juan Cruz Romero'],
  })

  return NextResponse.json({
    prueba: true,
    plantilla: process.env.WHATSAPP_PLANTILLA_15 || 'puesto_descubierto_15',
    telefonoUltimos4: telefono.e164.slice(-4),
    ok: resultado.ok,
    idProveedor: resultado.idProveedor ?? null,
    error: resultado.error ?? null,
  }, { status: resultado.ok ? 200 : 502 })
}
