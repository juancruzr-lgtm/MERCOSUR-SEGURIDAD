// app/api/ia/referencias/preparar/route.ts
//
// Convierte una configuración BORRADOR en una configuración analizable:
// genera el prompt a partir de los criterios que cargó Administración, fija el
// modelo y guarda el schema.
//
// El prompt no se escribe a mano: se DERIVA de los criterios. Así lo que la
// operación ve en pantalla y lo que recibe el modelo no pueden divergir. Su
// sha256 queda guardado para que un análisis viejo siga siendo reconstruible.

import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminIA } from '../../_lib/auth'
import { leerCriterios } from '@/lib/ia/referencias'
import { construirPrompt, schemaRespuesta } from '@/lib/ia/contratos'
import { MODELO_GEMINI_DEFECTO } from '@/lib/ia/gemini'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const ctx = await requireAdminIA(req)
  if (!ctx.ok) return ctx.respuesta

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Body inválido' }, { status: 400 }) }

  const id = typeof body?.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id requerido' }, { status: 400 })

  const { data: conf, error } = await ctx.client
    .from('ia_configuraciones')
    .select('id, analisis_tipo, version, criterios')
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!conf) return NextResponse.json({ error: 'Configuración inexistente' }, { status: 404 })

  const criterios = leerCriterios(conf.criterios).elementos
  if (criterios.length === 0) {
    return NextResponse.json({ error: 'La configuración no tiene criterios cargados' }, { status: 400 })
  }

  const modelo = typeof body?.modelo === 'string' && body.modelo.trim()
    ? body.modelo.trim()
    : MODELO_GEMINI_DEFECTO

  const prompt = construirPrompt(conf.analisis_tipo, criterios)

  const { data: actualizada, error: errorUpdate } = await ctx.client
    .from('ia_configuraciones')
    .update({
      proveedor: 'gemini',
      modelo,
      prompt,
      prompt_sha256: createHash('sha256').update(prompt).digest('hex'),
      schema_json: schemaRespuesta() as any,
    })
    .eq('id', id)
    .select('id, analisis_tipo, version, modelo, prompt, prompt_sha256')
    .single()

  if (errorUpdate) return NextResponse.json({ error: errorUpdate.message }, { status: 500 })

  return NextResponse.json({ configuracion: actualizada })
}
