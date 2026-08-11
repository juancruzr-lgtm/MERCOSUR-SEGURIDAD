// app/api/ia/referencias/route.ts
//
// Alta y mantenimiento de configuraciones de Referencias IA (uniforme, libro).
// Sólo administración escribe. La LECTURA no pasa por acá: el panel consulta
// `ia_configuraciones` directo con el cliente del navegador y la RLS de
// 20260811100000 resuelve el alcance.
//
// FASE B: no toca Gemini, no arma prompts, no analiza nada.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdminIA } from '../_lib/auth'
import { siguienteVersion, validarCriterios, type TipoReferenciaIA } from '@/lib/ia/referencias'

export const runtime = 'nodejs'

// punto_control incluido: la configuración es global (criterios y prompt), pero
// las FOTOS de referencia de ronda no van acá — cada punto tiene la suya, se
// carga desde el editor del punto y se guarda en ronda_punto_referencias.
const TIPOS_VALIDOS: TipoReferenciaIA[] = ['uniforme', 'libro_guardia', 'punto_control']

// ── POST — crear una configuración nueva (borrador) ─────────────────────────
export async function POST(req: NextRequest) {
  const ctx = await requireAdminIA(req)
  if (!ctx.ok) return ctx.respuesta

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const tipo = body?.analisis_tipo
  if (!TIPOS_VALIDOS.includes(tipo)) {
    return NextResponse.json({ error: 'analisis_tipo inválido' }, { status: 400 })
  }

  const nombre = typeof body?.nombre === 'string' ? body.nombre.trim() : ''
  if (!nombre) return NextResponse.json({ error: 'El nombre es obligatorio' }, { status: 400 })

  const validacion = validarCriterios(body?.criterios)
  if (!validacion.ok) return NextResponse.json({ error: validacion.error }, { status: 400 })

  // La versión la calcula el servidor, nunca el cliente: es la clave de la
  // trazabilidad y no puede depender de lo que mande el navegador.
  const { data: existentes, error: errorExistentes } = await ctx.client
    .from('ia_configuraciones')
    .select('version')
    .eq('analisis_tipo', tipo)

  if (errorExistentes) {
    return NextResponse.json({ error: errorExistentes.message }, { status: 500 })
  }

  const version = siguienteVersion((existentes ?? []).map(e => e.version as string))

  const { data: creada, error } = await ctx.client
    .from('ia_configuraciones')
    .insert({
      analisis_tipo: tipo,
      version,
      nombre: nombre.slice(0, 120),
      descripcion: typeof body?.descripcion === 'string' ? body.descripcion.trim().slice(0, 600) || null : null,
      criterios: validacion.criterios,
      // modelo / prompt quedan NULL: es un borrador operativo hasta FASE C.
      activo: false,
      vigente_desde: new Date().toISOString(),
      created_by: ctx.usuario.id,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ configuracion: creada })
}

// ── PATCH — editar criterios / activar / desactivar ─────────────────────────
export async function PATCH(req: NextRequest) {
  const ctx = await requireAdminIA(req)
  if (!ctx.ok) return ctx.respuesta

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body inválido' }, { status: 400 })
  }

  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  const { data: actual, error: errorActual } = await ctx.client
    .from('ia_configuraciones')
    .select('id, analisis_tipo, activo')
    .eq('id', id)
    .maybeSingle()

  if (errorActual) return NextResponse.json({ error: errorActual.message }, { status: 500 })
  if (!actual) return NextResponse.json({ error: 'Configuración inexistente' }, { status: 404 })

  const cambios: Record<string, unknown> = {}

  if (typeof body?.nombre === 'string' && body.nombre.trim()) {
    cambios.nombre = body.nombre.trim().slice(0, 120)
  }
  if (typeof body?.descripcion === 'string') {
    cambios.descripcion = body.descripcion.trim().slice(0, 600) || null
  }
  if (body?.criterios !== undefined) {
    const validacion = validarCriterios(body.criterios)
    if (!validacion.ok) return NextResponse.json({ error: validacion.error }, { status: 400 })
    cambios.criterios = validacion.criterios
  }

  // ── Activación ────────────────────────────────────────────────────────────
  // §7 del pedido: nunca se borra la anterior. Se le cierra la vigencia y se
  // abre la de la nueva. La historia queda completa y consultable.
  //
  // El orden importa: `uq_ia_configuraciones_activa_por_tipo` sólo admite una
  // activa por tipo, así que primero se cierra la vieja y después se abre la
  // nueva. Si el segundo update fallara, el tipo queda sin configuración activa
  // — falla cerrado, que es el modo correcto de fallar acá.
  if (body?.activo === true && !actual.activo) {
    const ahora = new Date().toISOString()

    const { error: errorCierre } = await ctx.client
      .from('ia_configuraciones')
      .update({ activo: false, vigente_hasta: ahora })
      .eq('analisis_tipo', actual.analisis_tipo)
      .eq('activo', true)

    if (errorCierre) {
      return NextResponse.json(
        { error: `No se pudo cerrar la vigencia anterior: ${errorCierre.message}` },
        { status: 500 },
      )
    }

    cambios.activo = true
    cambios.vigente_desde = ahora
    cambios.vigente_hasta = null
  }

  if (body?.activo === false && actual.activo) {
    cambios.activo = false
    cambios.vigente_hasta = new Date().toISOString()
  }

  if (Object.keys(cambios).length === 0) {
    return NextResponse.json({ error: 'Nada para actualizar' }, { status: 400 })
  }

  const { data: actualizada, error } = await ctx.client
    .from('ia_configuraciones')
    .update(cambios)
    .eq('id', id)
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ configuracion: actualizada })
}
