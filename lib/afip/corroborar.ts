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
    const snap = snapshotBase(u.id, u.cuil ?? null)

    if (cuil.length !== 11) {
      snap.novedades.push('sin_cuil')
      snap.error = 'CUIL faltante o inválido'
    } else {
      const r = await consultarPadronA13(cuil, ta, { cuitRepresentada: config.cuitRepresentada, homo: config.homo })
      consultados++
      if (!r.ok || !r.persona) {
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
    }

    if (snap.novedades.length) conNovedad++
    const { error: eSnap } = await admin.from('afip_padron_snapshot').upsert(snap)
    if (eSnap) errores++
  }

  await cerrar({ ok: true, total: lista.length, consultados, con_novedad: conNovedad, errores })
  return { ok: true, corridaId, total: lista.length, consultados, conNovedad, errores }
}
