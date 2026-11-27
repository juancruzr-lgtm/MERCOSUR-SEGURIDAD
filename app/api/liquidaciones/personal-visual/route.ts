import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin, requireCapacidad } from '../../_lib/employee-auth'
import { escribirPlanillaPersonalVisual, type EmpleadoVisual } from '@/lib/visual-personal'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const CAMPOS_USUARIO = 'id, legajo, legajo_visual, apellido, nombre, cuil, dni, cuenta_bancaria, telefono, email, estado'
const CAMPOS_DATOS = 'empleado_id, fecha_nacimiento, nacionalidad, fecha_ingreso, domicilio_calle, domicilio_numero, domicilio_piso_depto, domicilio_localidad, domicilio_provincia, domicilio_cp, contacto_emergencia_telefono, obra_social_nombre, obra_social_codigo'
const dc = (v: unknown): string => (v == null ? '' : String(v)).trim()

/**
 * Trae el personal para exportar a Visual: los ACTIVOS y, si incluirBajas, las
 * bajas confirmadas con liquidación final hecha (para inactivarlas en Visual con
 * su fecha de baja). Corre con service_role (lee dni/cuil/cuenta de usuarios y
 * datos personales): por eso vive acá, en app/api, y no en lib del cliente.
 */
async function cargarPersonalVisual(client: any, incluirBajas: boolean): Promise<{ empleados: EmpleadoVisual[]; error: string | null }> {
  const { data: us, error: eu } = await client.from('usuarios').select(CAMPOS_USUARIO)
    .eq('estado', 'activo').not('es_prueba', 'is', true)
  if (eu) return { empleados: [], error: eu.message || String(eu) }
  const activos = (us ?? []) as any[]

  const bajaFecha = new Map<string, string>()
  let usuariosBaja: any[] = []
  if (incluirBajas) {
    const { data: bajas } = await client.from('baja_laboral')
      .select('empleado_id, fecha_baja, estado, final:liquidacion_final(estado)').eq('estado', 'confirmada')
    for (const b of (bajas ?? []) as any[]) {
      const finales = Array.isArray(b.final) ? b.final : (b.final ? [b.final] : [])
      if (finales.some((f: any) => f && f.estado && f.estado !== 'anulada') && b.empleado_id) {
        bajaFecha.set(String(b.empleado_id), String(b.fecha_baja ?? ''))
      }
    }
    const idsBaja = Array.from(bajaFecha.keys()).filter(id => !activos.some(a => String(a.id) === id))
    if (idsBaja.length) {
      const { data: ub } = await client.from('usuarios').select(CAMPOS_USUARIO).in('id', idsBaja)
      usuariosBaja = (ub ?? []) as any[]
    }
  }

  const todos = [...activos, ...usuariosBaja]
  const ids = todos.map(u => String(u.id))
  const datos = new Map<string, any>()
  const sueldo = new Map<string, number>()
  for (let i = 0; i < ids.length; i += 500) {
    const lote = ids.slice(i, i + 500)
    const [{ data: dd }, { data: ss }] = await Promise.all([
      client.from('legajo_datos_personales').select(CAMPOS_DATOS).in('empleado_id', lote),
      client.from('liquidacion_sueldo_mensual').select('usuario_id, importe').in('usuario_id', lote).is('vigencia_hasta', null),
    ])
    for (const d of (dd ?? []) as any[]) datos.set(String(d.empleado_id), d)
    for (const s of (ss ?? []) as any[]) if (!sueldo.has(String(s.usuario_id))) sueldo.set(String(s.usuario_id), Number(s.importe))
  }

  const empleados: EmpleadoVisual[] = todos.map(u => {
    const uid = String(u.id)
    const d = datos.get(uid) ?? {}
    return {
      usuario_id: uid,
      legajo: u.legajo ?? null, legajo_visual: u.legajo_visual ?? null,
      apellido: u.apellido ?? null, nombre: u.nombre ?? null, cuil: u.cuil ?? null, dni: u.dni ?? null,
      cuenta_bancaria: u.cuenta_bancaria ?? null, telefono: u.telefono ?? null, email: u.email ?? null,
      fecha_nacimiento: d.fecha_nacimiento ?? null, nacionalidad: d.nacionalidad ?? null, fecha_ingreso: d.fecha_ingreso ?? null,
      domicilio_calle: d.domicilio_calle ?? null, domicilio_numero: d.domicilio_numero ?? null,
      domicilio_piso_depto: d.domicilio_piso_depto ?? null, domicilio_localidad: d.domicilio_localidad ?? null,
      domicilio_provincia: d.domicilio_provincia ?? null, domicilio_cp: d.domicilio_cp ?? null,
      contacto_emergencia_telefono: d.contacto_emergencia_telefono ?? null,
      obra_social_nombre: d.obra_social_nombre ?? null, obra_social_codigo: d.obra_social_codigo ?? null,
      sueldo_base: sueldo.has(uid) ? (sueldo.get(uid) as number) : null,
      fecha_baja: bajaFecha.get(uid) ?? null,
    }
  })
  empleados.sort((a, b) =>
    Number(Boolean(a.fecha_baja)) - Number(Boolean(b.fecha_baja)) || dc(a.apellido).localeCompare(dc(b.apellido)))
  return { empleados, error: null }
}

// Exporta la "Planilla de importación de personal" de Visual con el personal
// ACTIVO (y, salvo ?bajas=0, las bajas ya liquidadas con su fecha de baja).
export async function GET(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })
  const noAutorizado = await requireCapacidad(req, admin.client, 'preparar_liquidacion')
  if (noAutorizado) return noAutorizado

  const incluirBajas = req.nextUrl.searchParams.get('bajas') !== '0'
  const { empleados, error } = await cargarPersonalVisual(admin.client, incluirBajas)
  if (error) return NextResponse.json({ error }, { status: 500 })
  const r = await escribirPlanillaPersonalVisual(empleados)

  const hoy = new Date().toISOString().slice(0, 10)
  return new NextResponse(r.buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="PersonalVisual_${hoy}.xlsx"`,
      'X-Personal-Activos': String(r.activos),
      'X-Personal-Bajas': String(r.bajas),
      'X-Personal-Faltantes': String(r.conFaltantes),
    },
  })
}
