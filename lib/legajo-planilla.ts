/**
 * lib/legajo-planilla.ts
 *
 * Datos recuperados de la planilla histórica de legajos (ago-2024): qué se
 * recuperó, de quién, en qué quedó cada dato y quién intervino. Lee las filas
 * de legajo_cambios_datos con origen planilla (RLS: sólo Administración y
 * Gerencia) — no hay una segunda copia. Nada se aprueba ni se aplica desde
 * acá: la persona confirma desde su legajo y Administración valida en la bandeja.
 */

import { supabase } from '@/lib/supabase'
import type { EstadoCambio } from '@/lib/datos-personales'

export const ORIGEN_PLANILLA = 'planilla_legajos_2024-08'

export interface DatoPlanilla {
  id: string
  empleado_id: string
  campo: string
  valor_anterior: string | null
  valor_nuevo: string | null
  estado: EstadoCambio
  motivo: string | null
  motivo_rechazo: string | null
  creado_at: string
  revisado_at: string | null
  revisado_por: string | null
}

export interface PersonaPlanilla {
  empleado_id: string
  nombre: string
  apellido: string
  legajo: string | null
  datos: DatoPlanilla[]
}

/** Cómo se lee cada estado para un dato que vino de la planilla. */
export const ESTADO_PLANILLA: Record<EstadoCambio, { texto: string; color: string }> = {
  pendiente_confirmacion: { texto: 'Espera que la persona lo confirme', color: '#93c5fd' },
  pendiente: { texto: 'Confirmado por la persona: falta validar', color: '#fbbf24' },
  aprobado: { texto: 'Validado y aplicado', color: '#86efac' },
  aplicado: { texto: 'Aplicado', color: '#86efac' },
  rechazado: { texto: 'Rechazado por Administración', color: '#fca5a5' },
  descartado: { texto: 'Descartado', color: '#94a3b8' },
}

export type ResumenPlanilla = { total: number; personas: number } & Record<EstadoCambio, number>

export function resumirPlanilla(datos: Pick<DatoPlanilla, 'empleado_id' | 'estado'>[]): ResumenPlanilla {
  const r: ResumenPlanilla = { total: datos.length, personas: new Set(datos.map(d => d.empleado_id)).size,
    pendiente_confirmacion: 0, pendiente: 0, aprobado: 0, aplicado: 0, rechazado: 0, descartado: 0 }
  for (const d of datos) r[d.estado]++
  return r
}

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Agrupa por persona (orden alfabético) y filtra por texto y estado. */
export function agruparPlanilla(
  datos: DatoPlanilla[],
  personas: Map<string, { nombre: string; apellido: string; legajo: string | null }>,
  filtro: { texto?: string; estado?: EstadoCambio | '' } = {},
): PersonaPlanilla[] {
  const texto = normal((filtro.texto ?? '').trim())
  const grupos = new Map<string, PersonaPlanilla>()
  for (const d of datos) {
    if (filtro.estado && d.estado !== filtro.estado) continue
    const p = personas.get(d.empleado_id) ?? { nombre: '', apellido: '(sin datos)', legajo: null }
    if (texto && !normal(`${p.apellido} ${p.nombre} ${p.legajo ?? ''}`).includes(texto)) continue
    const g = grupos.get(d.empleado_id) ?? { empleado_id: d.empleado_id, ...p, datos: [] }
    g.datos.push(d)
    grupos.set(d.empleado_id, g)
  }
  return Array.from(grupos.values()).sort((a, b) => `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es'))
}

/** Lee todo lo recuperado de la planilla, paginando (PostgREST corta en 1000 filas). */
export async function cargarPlanillaHistorica(): Promise<{
  datos: DatoPlanilla[]; personas: Map<string, { nombre: string; apellido: string; legajo: string | null }>
  revisores: Map<string, string>; etiquetas: Map<string, string>; error: string | null
}> {
  const vacio = { datos: [], personas: new Map(), revisores: new Map(), etiquetas: new Map() }
  const datos: DatoPlanilla[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await supabase.from('legajo_cambios_datos')
      .select('id, empleado_id, campo, valor_anterior, valor_nuevo, estado, motivo, motivo_rechazo, creado_at, revisado_at, revisado_por')
      .eq('origen', ORIGEN_PLANILLA).order('creado_at').order('id').range(desde, desde + 999)
    if (error) return { ...vacio, error: error.message }
    datos.push(...((data ?? []) as DatoPlanilla[]))
    if (!data || data.length < 1000) break
  }
  const ids = Array.from(new Set(datos.flatMap(d => [d.empleado_id, d.revisado_por]).filter((x): x is string => !!x)))
  const personas = new Map<string, { nombre: string; apellido: string; legajo: string | null }>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('usuarios').select('id, nombre, apellido, legajo').in('id', ids.slice(i, i + 200))
    if (error) return { ...vacio, error: error.message }
    for (const u of data ?? []) personas.set(u.id, { nombre: u.nombre ?? '', apellido: u.apellido ?? '', legajo: u.legajo ?? null })
  }
  const revisores = new Map<string, string>()
  for (const d of datos) {
    const r = d.revisado_por ? personas.get(d.revisado_por) : null
    if (d.revisado_por && r) revisores.set(d.revisado_por, `${r.nombre} ${r.apellido}`.trim())
  }
  const { data: campos, error: errCampos } = await supabase.from('legajo_campos').select('campo, etiqueta')
  if (errCampos) return { ...vacio, error: errCampos.message }
  const etiquetas = new Map<string, string>((campos ?? []).map(c => [c.campo as string, c.etiqueta as string]))
  return { datos, personas, revisores, etiquetas, error: null }
}
