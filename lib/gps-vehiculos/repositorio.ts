/**
 * lib/gps-vehiculos/repositorio.ts — persistencia de consultas y posiciones.
 *
 *  · `repositorioSupabase`: el real. Usa la RPC `gps_tag_registrar_consulta`
 *    (sólo service_role). Se usa únicamente desde el servidor.
 *  · `RepositorioMemoria`: mismo contrato y mismas reglas que la RPC (valida,
 *    deduplica, atribuye vehículo/supervisor por hora de ubicación). Para
 *    pruebas automatizadas y simulaciones locales.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RegistroConsulta, RepositorioConsultas } from './ciclo'
import { claveDedup, filtrarReportes, supervisorDeVehiculoEn, vehiculoDeTagEn } from './posiciones'
import type { AsignacionSupervisor, AsignacionTag, ConsultaTag, PosicionTag, ResultadoConsulta, SmartTag } from './tipos'

export function repositorioSupabase(admin: SupabaseClient): RepositorioConsultas {
  return {
    async ultimaConsulta(tagId) {
      const { data, error } = await admin.from('gps_tag_consultas')
        .select('hora_consulta').eq('tag_id', tagId).neq('resultado', 'omitida_limite')
        .order('hora_consulta', { ascending: false }).limit(1)
      if (error) throw new Error(`No se pudo leer la última consulta: ${error.message}`)
      return data?.[0] ? new Date(data[0].hora_consulta) : null
    },
    async registrar(r) {
      const { data, error } = await admin.rpc('gps_tag_registrar_consulta', {
        p_tag_id: r.tagId,
        p_hora_consulta: r.horaConsulta.toISOString(),
        p_resultado: r.resultado,
        p_posiciones: r.posiciones.map(p => ({
          lat: p.lat, lng: p.lng, hora_ubicacion: p.horaUbicacion, precision_m: p.precisionM ?? null,
        })),
        p_intentos: r.intentos,
        p_duracion_ms: r.duracionMs,
        p_error_codigo: r.errorCodigo ?? null,
        p_error_detalle: r.errorDetalle ?? null,
      })
      if (error) throw new Error(`No se pudo registrar la consulta: ${error.message}`)
      return { resultado: data.resultado, nuevas: data.nuevas, recibidas: data.recibidas }
    },
  }
}

export class RepositorioMemoria implements RepositorioConsultas {
  consultas: ConsultaTag[] = []
  posiciones: PosicionTag[] = []
  constructor(
    public tags: SmartTag[],
    public asignacionesTag: AsignacionTag[] = [],
    public asignacionesSupervisor: AsignacionSupervisor[] = [],
  ) {}

  async ultimaConsulta(tagId: string) {
    const c = this.consultas.filter(x => x.tag_id === tagId && x.resultado !== 'omitida_limite')
      .sort((a, b) => Date.parse(b.hora_consulta) - Date.parse(a.hora_consulta))[0]
    return c ? new Date(c.hora_consulta) : null
  }

  async registrar(r: RegistroConsulta) {
    const tag = this.tags.find(t => t.id === r.tagId)
    if (!tag) throw new Error('Smart Tag inexistente')
    const id = this.consultas.length + 1
    let resultado: ResultadoConsulta = 'error'
    let nuevas = 0
    if (r.resultado === 'ok') {
      const existentes = new Set(this.posiciones.filter(p => p.tag_id === r.tagId)
        .map(p => claveDedup(p.tag_id, p.hora_ubicacion, p.lat, p.lng)))
      const f = filtrarReportes(r.tagId, r.posiciones, r.horaConsulta, existentes)
      for (const p of f.nuevas) {
        const hora = new Date(p.horaUbicacion)
        const vehiculo = vehiculoDeTagEn(this.asignacionesTag, r.tagId, hora)
        this.posiciones.push({
          id: this.posiciones.length + 1,
          tag_id: r.tagId,
          fuente: tag.proveedor,
          lat: p.lat,
          lng: p.lng,
          precision_m: p.precisionM ?? null,
          hora_ubicacion: hora.toISOString(),
          hora_consulta: r.horaConsulta.toISOString(),
          vehiculo_id: vehiculo,
          supervisor_id: vehiculo ? supervisorDeVehiculoEn(this.asignacionesSupervisor, vehiculo, hora) : null,
        })
      }
      nuevas = f.nuevas.length
      resultado = r.posiciones.length === 0 ? 'sin_datos' : nuevas > 0 ? 'nueva_posicion' : 'sin_novedad'
    }
    this.consultas.push({
      id, tag_id: r.tagId, proveedor: tag.proveedor, hora_consulta: r.horaConsulta.toISOString(), resultado,
      posiciones_recibidas: r.posiciones.length, posiciones_nuevas: nuevas, error_codigo: r.errorCodigo ?? null,
      intentos: r.intentos,
    })
    return { resultado, nuevas, recibidas: r.posiciones.length }
  }
}
