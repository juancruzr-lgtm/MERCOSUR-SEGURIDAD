import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin, requireCapacidad } from '../../_lib/employee-auth'
import { cargarPersonalVisual, escribirPlanillaPersonalVisual } from '@/lib/visual-personal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Exporta la "Planilla de importación de personal" de Visual con el personal
// ACTIVO (y, salvo ?bajas=0, las bajas ya liquidadas con su fecha de baja para
// inactivarlas en Visual). Trae PII de varios legajos → va por admin + capacidad.
export async function GET(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })
  const noAutorizado = await requireCapacidad(req, admin.client, 'preparar_liquidacion')
  if (noAutorizado) return noAutorizado

  const incluirBajas = req.nextUrl.searchParams.get('bajas') !== '0'
  const { empleados, error } = await cargarPersonalVisual(admin.client, { incluirBajas })
  if (error) return NextResponse.json({ error }, { status: 500 })
  const r = await escribirPlanillaPersonalVisual(empleados)

  const hoy = new Date().toISOString().slice(0, 10)
  return new NextResponse(r.buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="PersonalVisual_${hoy}.xlsx"`,
      // Resumen para que la UI avise sin abrir el archivo.
      'X-Personal-Activos': String(r.activos),
      'X-Personal-Bajas': String(r.bajas),
      'X-Personal-Faltantes': String(r.conFaltantes),
    },
  })
}
