/**
 * lib/gps-vehiculos/datos.ts — lecturas para la sección "Vehículos de supervisión".
 *
 * Lee con el cliente del navegador: la RLS (gps_vehiculos_puede_ver_actual) deja
 * ver sólo a Gerencia. Las escrituras van por RPC (validan permiso en la base).
 * Nunca lee supervisor_route_points: las fuentes no se mezclan.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { asignacionVigente, clasificarAntiguedad, estadoActualizacion, type Antiguedad, type EstadoActualizacion } from './posiciones'
import type { AsignacionSupervisor, AsignacionTag, ConsultaTag, PosicionTag, SmartTag, Vehiculo } from './tipos'

export interface FilaVehiculo {
  vehiculo: Vehiculo
  tag: SmartTag | null
  supervisorId: string | null
  estadoAsignacion: 'completa' | 'sin_supervisor' | 'sin_tag' | 'sin_asignar'
  ultimaPosicion: PosicionTag | null
  ultimaConsulta: ConsultaTag | null
  antiguedad: Antiguedad
  estado: EstadoActualizacion
}

/** Arma las filas (puro, testeable). */
export function armarFilasVehiculos(d: {
  vehiculos: Vehiculo[]
  tags: SmartTag[]
  asignacionesTag: AsignacionTag[]
  asignacionesSupervisor: AsignacionSupervisor[]
  ultimasPosiciones: PosicionTag[]
  ultimasConsultas: ConsultaTag[]
  ahora: Date
}): FilaVehiculo[] {
  return d.vehiculos.filter(v => v.estado !== 'baja').map(vehiculo => {
    const at = asignacionVigente(d.asignacionesTag.filter(a => a.vehiculo_id === vehiculo.id))
    const as = asignacionVigente(d.asignacionesSupervisor.filter(a => a.vehiculo_id === vehiculo.id))
    const tag = at ? d.tags.find(t => t.id === at.tag_id) ?? null : null
    // Última posición DEL VEHÍCULO (atribuida en su hora), no la del tag: si el tag
    // pasó a otro vehículo, sus posiciones nuevas no se muestran acá.
    const ultimaPosicion = d.ultimasPosiciones.filter(p => p.vehiculo_id === vehiculo.id)
      .sort((a, b) => Date.parse(b.hora_ubicacion) - Date.parse(a.hora_ubicacion))[0] ?? null
    const ultimaConsulta = tag ? d.ultimasConsultas.filter(c => c.tag_id === tag.id && c.resultado !== 'omitida_limite')
      .sort((a, b) => Date.parse(b.hora_consulta) - Date.parse(a.hora_consulta))[0] ?? null : null
    return {
      vehiculo,
      tag,
      supervisorId: as?.supervisor_id ?? null,
      estadoAsignacion: tag && as ? 'completa' : tag ? 'sin_supervisor' : as ? 'sin_tag' : 'sin_asignar',
      ultimaPosicion,
      ultimaConsulta,
      antiguedad: clasificarAntiguedad(ultimaPosicion?.hora_ubicacion, d.ahora),
      estado: estadoActualizacion({
        tieneTag: !!tag, ultimaConsulta, ultimaHoraUbicacion: ultimaPosicion?.hora_ubicacion ?? null, ahora: d.ahora,
      }),
    }
  })
}

const COLS_POS = 'id, tag_id, fuente, lat, lng, precision_m, hora_ubicacion, hora_consulta, vehiculo_id, supervisor_id'
const COLS_CONS = 'id, tag_id, proveedor, hora_consulta, resultado, posiciones_recibidas, posiciones_nuevas, error_codigo, intentos'

export async function cargarVehiculosSupervision(sb: SupabaseClient, ahora = new Date()) {
  const [v, t, at, as] = await Promise.all([
    sb.from('gps_vehiculos').select('id, identificador, patente, descripcion, estado').order('identificador'),
    sb.from('gps_tags').select('id, nombre, modelo, proveedor, identificador_externo, estado, es_prueba').order('nombre'),
    sb.from('gps_vehiculo_tag_asignaciones').select('id, vehiculo_id, tag_id, desde, hasta'),
    sb.from('gps_vehiculo_supervisor_asignaciones').select('id, vehiculo_id, supervisor_id, desde, hasta'),
  ])
  const err = v.error || t.error || at.error || as.error
  if (err) throw new Error(err.message)
  const vehiculos = (v.data ?? []) as Vehiculo[]
  const ids = vehiculos.map(x => x.id)
  const tagIds = ((t.data ?? []) as SmartTag[]).map(x => x.id)
  // Últimas 48 h alcanzan para "última conocida"; si no hay, se busca la última por vehículo.
  const desde = new Date(ahora.getTime() - 48 * 3600_000).toISOString()
  const [p, c] = await Promise.all([
    ids.length ? sb.from('gps_tag_posiciones').select(COLS_POS).in('vehiculo_id', ids).gte('hora_ubicacion', desde)
      .order('hora_ubicacion', { ascending: false }).limit(500) : Promise.resolve({ data: [], error: null }),
    tagIds.length ? sb.from('gps_tag_consultas').select(COLS_CONS).in('tag_id', tagIds).gte('hora_consulta', desde)
      .order('hora_consulta', { ascending: false }).limit(500) : Promise.resolve({ data: [], error: null }),
  ])
  if (p.error || c.error) throw new Error((p.error || c.error)!.message)
  const ultimasPosiciones = [...(p.data ?? [])] as PosicionTag[]
  const conPos = new Set(ultimasPosiciones.map(x => x.vehiculo_id))
  for (const id of ids.filter(i => !conPos.has(i))) {
    const r = await sb.from('gps_tag_posiciones').select(COLS_POS).eq('vehiculo_id', id)
      .order('hora_ubicacion', { ascending: false }).limit(1)
    if (!r.error && r.data?.[0]) ultimasPosiciones.push(r.data[0] as PosicionTag)
  }
  return {
    tags: (t.data ?? []) as SmartTag[],
    filas: armarFilasVehiculos({
      vehiculos, tags: (t.data ?? []) as SmartTag[],
      asignacionesTag: (at.data ?? []) as AsignacionTag[],
      asignacionesSupervisor: (as.data ?? []) as AsignacionSupervisor[],
      ultimasPosiciones, ultimasConsultas: (c.data ?? []) as ConsultaTag[], ahora,
    }),
  }
}

/** Historial del vehículo entre dos instantes, por HORA DE UBICACIÓN. */
export async function cargarHistorialVehiculo(sb: SupabaseClient, vehiculoId: string, desde: Date, hasta: Date) {
  const { data, error } = await sb.from('gps_tag_posiciones').select(COLS_POS)
    .eq('vehiculo_id', vehiculoId).gte('hora_ubicacion', desde.toISOString()).lt('hora_ubicacion', hasta.toISOString())
    .order('hora_ubicacion', { ascending: true }).limit(2000)
  if (error) throw new Error(error.message)
  void sb.rpc('gps_vehiculos_registrar_acceso', {
    p_accion: 'ver_historial', p_vehiculo_id: vehiculoId,
    p_detalle: { desde: desde.toISOString(), hasta: hasta.toISOString() },
  })
  return (data ?? []) as PosicionTag[]
}

/** Consultas y posiciones de un tag en una ventana (para la prueba de 24 h). */
export async function cargarDatosPrueba(sb: SupabaseClient, tagId: string, desde: Date, hasta: Date) {
  const [c, p] = await Promise.all([
    sb.from('gps_tag_consultas').select(COLS_CONS).eq('tag_id', tagId)
      .gte('hora_consulta', desde.toISOString()).lt('hora_consulta', hasta.toISOString()).limit(1000),
    sb.from('gps_tag_posiciones').select(COLS_POS).eq('tag_id', tagId)
      .gte('hora_consulta', desde.toISOString()).lt('hora_consulta', hasta.toISOString()).limit(2000),
  ])
  if (c.error || p.error) throw new Error((c.error || p.error)!.message)
  void sb.rpc('gps_vehiculos_registrar_acceso', { p_accion: 'ver_prueba', p_detalle: { tag_id: tagId } })
  return { consultas: (c.data ?? []) as ConsultaTag[], posiciones: (p.data ?? []) as PosicionTag[] }
}
