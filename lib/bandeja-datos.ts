// Carga de las filas del mes desde la base.
//
// Vivía dentro de BandejaPlanillas. Se extrae porque el indicador de desempeño
// necesita exactamente las mismas filas: si cada pantalla hiciera sus propias
// consultas, tarde o temprano una traería un turno que la otra no, y los dos
// números dirían cosas distintas sobre el mismo mes.
//
// Acá no hay lógica de negocio: son las consultas y nada más. Qué turno entra y
// qué registro manda lo decide construirFilasBandeja.

import { supabase } from '@/lib/supabase'
import { fetchPaginadoResult } from '@/lib/fetch-paginado'
import {
  construirFilasBandeja, objetivoEnAlcance,
} from '@/lib/bandeja-planillas'
import type { FilaBandejaMensual } from '@/lib/bandeja-planillas'
import {
  effectiveGuardia, resolverLineaLiquidacion, selectRegistroPrincipal,
} from '@/lib/liquidacion'
import { etiquetaCaracteristica } from '@/lib/caracteristica-turno'

export function limitesDelMesDesempeno(mes: string): { desde: string; hasta: string } {
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(y, m, 0).getDate()
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, '0')}` }
}

export interface CargaFilasParams {
  mes: string
  esAdmin: boolean
  /** Id del usuario, para resolver su alcance por zona. */
  usuarioId: string | null
}

export interface CargaFilasResultado {
  filas: FilaBandejaMensual[]
  error: string | null
}

/**
 * Todas las consultas del mes se paginan. PostgREST corta en `max_rows` (1000
 * en este proyecto) sin devolver error: un `.limit()` mayor no lo levanta, sólo
 * hace creer que alcanza. El segundo `order` por id es lo que hace segura la
 * paginación: sin un desempate estable, dos páginas pueden repetir u omitir.
 */
export async function cargarFilasBandeja(p: CargaFilasParams): Promise<CargaFilasResultado> {
  const { desde, hasta } = limitesDelMesDesempeno(p.mes)

  const [turnosR, registrosR, aceptR, soliR, reviR, guardiasR, zonasR] = await Promise.all([
    fetchPaginadoResult((d, h) => supabase.from('turnos')
      .select('id, fecha, hora_inicio, hora_fin, estado, tipo_evento, guardia_id, objetivo_id, puesto_id, puesto:puestos(nombre), objetivo:objetivos(nombre, es_prueba, zona_id)')
      .gte('fecha', desde).lte('fecha', hasta)
      .order('fecha', { ascending: false }).order('id')
      .range(d, h)),
    fetchPaginadoResult((d, h) => supabase.from('registros_asistencia')
      .select('id, turno_id, guardia_id, guardia_final_id, tipo_registro, hora_entrada_real, hora_salida_real, hora_entrada_final, hora_salida_final, horas_trabajadas, horas_liquidables, cierre_automatico, cobertura_anulada_at, observacion, origen_cobertura, turno:turnos!inner(fecha)')
      .gte('turno.fecha', desde).lte('turno.fecha', hasta)
      .order('id')
      .range(d, h)),
    fetchPaginadoResult((d, h) => supabase.from('aceptaciones_planilla')
      .select('turno_id, empleado_id, turno:turnos!inner(fecha)')
      .gte('turno.fecha', desde).lte('turno.fecha', hasta)
      .order('turno_id')
      .range(d, h)),
    fetchPaginadoResult((d, h) => supabase.from('solicitudes_modificacion_planilla')
      .select('id, turno_id, empleado_id, texto, estado, created_at, turno:turnos!inner(fecha)')
      .gte('turno.fecha', desde).lte('turno.fecha', hasta)
      .order('created_at', { ascending: false }).order('id')
      .range(d, h)),
    fetchPaginadoResult((d, h) => supabase.from('revisiones_planilla')
      .select('turno_id, empleado_id, solicitud_id, accion, created_at, turno:turnos!inner(fecha)')
      .gte('turno.fecha', desde).lte('turno.fecha', hasta)
      .order('turno_id')
      .range(d, h)),
    fetchPaginadoResult((d, h) => supabase.from('usuarios')
      .select('id, nombre, apellido')
      .order('id')
      .range(d, h)),
    supabase.from('supervisor_zonas').select('zona_id').eq('supervisor_id', p.usuarioId ?? ''),
  ])

  const err = turnosR.error || registrosR.error || guardiasR.error
  if (err) return { filas: [], error: err.message }

  // Quién marcó cada ausencia y cuándo: sale de la auditoría que ya escribe la
  // RPC. No hacen falta columnas nuevas.
  const idsAusencia = ((registrosR.data ?? []) as any[])
    .filter(r => r.tipo_registro === 'ausencia').map(r => r.id)
  let auditoriaAusencias: any[] = []
  if (idsAusencia.length > 0) {
    const { data } = await supabase
      .from('registros_asistencia_auditoria')
      .select('registro_id, modificado_por, created_at')
      .in('registro_id', idsAusencia)
      .eq('campo', 'ausencia_supervisor')
    auditoriaAusencias = (data ?? []) as any[]
  }

  const filas = construirFilasBandeja({
    turnos:        (turnosR.data ?? []) as any[],
    registros:     (registrosR.data ?? []) as any[],
    aceptaciones:  (aceptR.data ?? []) as any[],
    solicitudes:   (soliR.data ?? []) as any[],
    revisiones:    (reviR.data ?? []) as any[],
    guardias:      (guardiasR.data ?? []) as any[],
    auditoriaAusencias,
    zonasMias:     ((zonasR.data ?? []) as any[]).map(z => z.zona_id),
    esAdmin:       p.esAdmin,
  }, {
    selectRegistroPrincipal, effectiveGuardia, resolverLineaLiquidacion,
    etiquetaCaracteristica, objetivoEnAlcance,
  })

  return { filas, error: null }
}
