// lib/afip/corroborar.ts
//
// Corroboración diaria de empleados contra el Padrón A13 de AFIP/ARCA. Por cada
// usuario ACTIVO con CUIL: consulta el padrón, compara nombre/apellido/estado y
// captura el domicilio (localidad/provincia — datos que faltaban para el LSD).
// Guarda una foto por empleado (afip_padron_snapshot) y un resumen de la corrida
// (afip_corroboracion_corrida). Server-side (service_role + clave privada).
//
// OJO: el Padrón A13 da datos de la PERSONA por CUIL, NO la lista de altas/bajas
// de la relación laboral. Para "me entero tarde de un alta/baja" hace falta el WS
// de Relaciones Laborales (Mi Simplificación), que se autoriza y agrega aparte.
// Esto corrobora y completa los datos de los empleados que ya están cargados.

import type { SupabaseClient } from '@supabase/supabase-js'
import { obtenerTA } from '@/lib/afip/wsaa'
import { consultarPadronA13, SERVICIO_PADRON_A13 } from '@/lib/afip/padron'
import { taStoreSupabase } from '@/lib/afip/ta-store-supabase'
import type { AfipConfig } from '@/lib/afip/config'
import type { ResultadoPadron } from '@/lib/afip/padron'

export interface ResumenCorroboracion {
  ok: boolean
  corridaId?: string
  total: number
  consultados: number
  conNovedad: number
  errores: number
  error?: string
}

/** Normaliza para comparar: sin tildes, mayúsculas, espacios colapsados. */
const norm = (s?: string | null): string =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim()

/** Fila de snapshot con todas las columnas explícitas (evita valores viejos). */
function snapshotBase(usuarioId: string, cuil: string | null) {
  return {
    usuario_id: usuarioId,
    cuil,
    existe: false,
    estado_clave: null as string | null,
    tipo_persona: null as string | null,
    apellido: null as string | null,
    nombre: null as string | null,
    razon_social: null as string | null,
    direccion: null as string | null,
    localidad: null as string | null,
    cod_postal: null as string | null,
    provincia: null as string | null,
    domicilio: null as any,
    novedades: [] as string[],
    error: null as string | null,
    consultado_at: new Date().toISOString(),
  }
}

export interface EmpleadoACorroborar { id: string; cuil: string | null; nombre: string | null; apellido: string | null }

/**
 * Foto de un empleado a partir de la respuesta del padrón (null = no se
 * consultó porque el CUIL falta o es inválido). Sólo compara: no modifica nada
 * del legajo ni del usuario. Un estado distinto de ACTIVO es un dato fiscal,
 * no una baja laboral.
 */
export function snapshotDesdePadron(u: EmpleadoACorroborar, r: ResultadoPadron | null) {
  const snap = snapshotBase(u.id, u.cuil ?? null)
  if (!r) {
    snap.novedades.push('sin_cuil')
    snap.error = 'CUIL faltante o inválido'
  } else if (!r.ok || !r.persona) {
    snap.novedades.push('cuil_inexistente')
    snap.error = r.error || 'Sin datos'
  } else {
    const p = r.persona
    const dom = p.domicilios?.[0] || null
    snap.existe = true
    snap.estado_clave = p.estado ?? null
    snap.tipo_persona = p.tipoPersona ?? null
    snap.apellido = p.apellido ?? null
    snap.nombre = p.nombre ?? null
    snap.razon_social = p.razonSocial ?? null
    snap.direccion = dom?.direccion ?? null
    snap.localidad = dom?.localidad ?? null
    snap.cod_postal = dom?.codigoPostal ?? null
    snap.provincia = dom?.descProvincia ?? null
    snap.domicilio = dom
    if ((p.estado || '').toUpperCase() !== 'ACTIVO') snap.novedades.push('estado_no_activo')
    if (p.apellido && norm(p.apellido) !== norm(u.apellido)) snap.novedades.push('apellido_difiere')
    if (p.nombre && norm(p.nombre) !== norm(u.nombre)) snap.novedades.push('nombre_difiere')
  }
  return snap
}

/**
 * Espera una tarea hasta `ms`; pasado ese tiempo sigue sin ella (devuelve
 * undefined). Los errores de la tarea no se propagan: el alta de un empleado
 * nunca se traba ni falla por ARCA.
 */
export async function esperarConTope<T>(tarea: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const tope = new Promise<undefined>(r => { timer = setTimeout(() => r(undefined), ms) })
  try {
    return await Promise.race([tarea.catch(() => undefined), tope])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export interface ResultadoIndividual { ok: boolean; novedades?: string[]; error?: string }

/**
 * Corroboración de UN empleado (legajo o alta). Deja constancia como una
 * corrida de 1, con quién la pidió y desde dónde. No toca `usuarios`.
 */
export async function corroborarEmpleado(
  admin: SupabaseClient,
  config: AfipConfig,
  usuarioId: string,
  origen: { tipo: 'legajo' | 'alta'; solicitadoPor: string | null },
): Promise<ResultadoIndividual> {
  const detalle = { tipo: 'individual', origen: origen.tipo, usuario_id: usuarioId, solicitado_por: origen.solicitadoPor }
  const { data: corrida, error: eCorrida } = await admin
    .from('afip_corroboracion_corrida').insert({ total: 1, detalle }).select('id').single()
  if (eCorrida || !corrida) return { ok: false, error: eCorrida?.message || 'No se pudo registrar la consulta' }
  const cerrar = (patch: Record<string, unknown>) => admin.from('afip_corroboracion_corrida')
    .update({ finalizada_at: new Date().toISOString(), ...patch }).eq('id', corrida.id)

  const { data: u, error: eU } = await admin.from('usuarios').select('id, cuil, nombre, apellido').eq('id', usuarioId).maybeSingle()
  if (eU || !u) { await cerrar({ ok: false, detalle: { ...detalle, error: eU?.message || 'Empleado inexistente' } }); return { ok: false, error: 'Empleado inexistente' } }

  const cuil = (u.cuil || '').replace(/\D/g, '')
  let r: ResultadoPadron | null = null
  if (cuil.length === 11) {
    try {
      const ta = await obtenerTA(SERVICIO_PADRON_A13, config, taStoreSupabase(admin))
      r = await consultarPadronA13(cuil, ta, { cuitRepresentada: config.cuitRepresentada, homo: config.homo })
    } catch (e: any) {
      const msg = `WSAA: ${e?.message || e}`
      await cerrar({ ok: false, detalle: { ...detalle, error: msg } })
      return { ok: false, error: 'No se pudo autenticar con ARCA. Probá más tarde.' }
    }
  }
  const snap = snapshotDesdePadron(u, r)
  const { error: eSnap } = await admin.from('afip_padron_snapshot').upsert(snap)
  await cerrar({ ok: !eSnap, consultados: r ? 1 : 0, con_novedad: snap.novedades.length ? 1 : 0, errores: eSnap ? 1 : 0 })
  if (eSnap) return { ok: false, error: 'No se pudo guardar el resultado' }
  return { ok: true, novedades: snap.novedades }
}

export async function corroborarEmpleados(
  admin: SupabaseClient,
  config: AfipConfig,
): Promise<ResumenCorroboracion> {
  // Abrir la corrida.
  const { data: corrida, error: eCorrida } = await admin
    .from('afip_corroboracion_corrida')
    .insert({})
    .select('id')
    .single()
  if (eCorrida || !corrida) {
    return { ok: false, total: 0, consultados: 0, conNovedad: 0, errores: 0, error: eCorrida?.message || 'No se pudo abrir la corrida' }
  }
  const corridaId = corrida.id as string

  const cerrar = async (patch: Record<string, any>) => {
    await admin.from('afip_corroboracion_corrida')
      .update({ finalizada_at: new Date().toISOString(), ...patch })
      .eq('id', corridaId)
  }

  // Empleados activos (acotado: PostgREST corta en 1000 sin límite explícito).
  const { data: usuarios, error: eUsuarios } = await admin
    .from('usuarios')
    .select('id, cuil, nombre, apellido, estado')
    .eq('estado', 'activo')
    .order('apellido')
    .limit(2000)
  if (eUsuarios) {
    await cerrar({ ok: false, detalle: { error: eUsuarios.message } })
    return { ok: false, corridaId, total: 0, consultados: 0, conNovedad: 0, errores: 0, error: eUsuarios.message }
  }
  const lista = usuarios || []

  // Autenticar (una vez, TA cacheado). Si WSAA falla, la corrida queda marcada.
  const store = taStoreSupabase(admin)
  let ta
  try {
    ta = await obtenerTA(SERVICIO_PADRON_A13, config, store)
  } catch (e: any) {
    const msg = `WSAA: ${e?.message || e}`
    await cerrar({ ok: false, total: lista.length, detalle: { error: msg } })
    return { ok: false, corridaId, total: lista.length, consultados: 0, conNovedad: 0, errores: 0, error: msg }
  }

  let consultados = 0
  let conNovedad = 0
  let errores = 0

  for (const u of lista) {
    const cuil = (u.cuil || '').replace(/\D/g, '')
    const r = cuil.length === 11
      ? await consultarPadronA13(cuil, ta, { cuitRepresentada: config.cuitRepresentada, homo: config.homo })
      : null
    if (r) consultados++
    const snap = snapshotDesdePadron(u, r)
    if (snap.novedades.length) conNovedad++
    const { error: eSnap } = await admin.from('afip_padron_snapshot').upsert(snap)
    if (eSnap) errores++
  }

  await cerrar({ ok: true, total: lista.length, consultados, con_novedad: conNovedad, errores })
  return { ok: true, corridaId, total: lista.length, consultados, conNovedad, errores }
}
