/**
 * lib/gestion-admin/cargar.ts
 *
 * Carga del Tablero de Administración. SÓLO LECTURA.
 *  - Documentación del personal: RPC existente documentacion_control +
 *    situacionDeTipo (la misma regla que la Matriz de documentación).
 *  - Credenciales: RPC existente habilitacion_tablero.
 *  - Empresa/clientes/proveedores, tareas y reclamos: tablas de la migración
 *    20261216120000 (si no está aplicada, se informa y se sigue con lo demás).
 *  - Facturación pendiente: fact_prefacturas no emitidas ni descartadas.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { situacionDeTipo, type ControlDocumentacionDatos } from '@/lib/documentacion'
import type { Tablero as TableroHabilitaciones } from '@/lib/habilitacion'
import type { FuentesAdmin, Obligacion, Seguimiento, TareaAdmin } from './obligaciones'

export interface DatosAdmin {
  fuentes: FuentesAdmin
  migracion: boolean
  nombresPersonal: Map<string, string>
  advertencias: string[]
}

const SITUACION: Record<string, FuentesAdmin['documentacionPersonal'][number]['situacion']> = {
  falta: 'falta', vencido: 'vencido', por_vencer: 'por_vencer', presentado: 'para_revisar',
  validado: 'ok', no_cargado: 'ok', no_corresponde: 'no_corresponde',
}

export async function cargarAdministracion(sb: SupabaseClient, hoy: string): Promise<DatosAdmin> {
  const advertencias: string[] = []
  const nombresPersonal = new Map<string, string>()

  const documentacionPersonal: FuentesAdmin['documentacionPersonal'] = []
  const dc = await sb.rpc('documentacion_control')
  if (dc.error) advertencias.push('Documentación del personal: sin permiso o no disponible.')
  else {
    const d = dc.data as ControlDocumentacionDatos
    const tipos = d.tipos.filter(t => t.requisito === 'obligatorio')
    for (const p of d.personas) {
      nombresPersonal.set(p.empleado_id, `${p.apellido}, ${p.nombre}`)
      for (const t of tipos) {
        const s = situacionDeTipo(t, p.documentos, d.hoy ?? hoy, p.situaciones)
        documentacionPersonal.push({ empleadoId: p.empleado_id, tipo: t.codigo, situacion: SITUACION[s.base] ?? 'ok' })
      }
    }
  }

  let credenciales: FuentesAdmin['credenciales'] = []
  const hb = await sb.rpc('habilitacion_tablero')
  if (hb.error) advertencias.push('Credenciales del personal: sin permiso o no disponible.')
  else credenciales = ((hb.data as TableroHabilitaciones).filas ?? []).map(f => ({ empleadoId: f.empleado_id, codigo: f.codigo }))

  let migracion = true
  let obligaciones: Obligacion[] = []
  let seguimientos: Seguimiento[] = []
  let tareas: TareaAdmin[] = []
  let documentosPendientesRevision = 0
  let reclamosAbiertos: number | null = null
  const ob = await sb.from('gestion_obligaciones').select('*')
  if (ob.error) {
    migracion = false
    advertencias.push('Documentación de empresa, clientes y proveedores, tareas y reclamos: falta aplicar la migración 20261216120000.')
  } else {
    obligaciones = (ob.data ?? []).map((o: any) => ({
      codigo: o.codigo, nombre: o.nombre, ambito: o.ambito, tipoFuente: o.tipo_fuente, jurisdiccion: o.jurisdiccion, norma: o.norma,
      fuenteUrl: o.fuente_url, verificadoAt: o.verificado_at, validacion: o.validacion, periodicidadMeses: o.periodicidad_meses,
      diasAviso: o.dias_aviso ?? [90, 60, 30, 15, 0], documentosRequeridos: o.documentos_requeridos ?? [], activo: o.activo,
    }))
    const [sg, ta, dp, rc] = await Promise.all([
      sb.from('gestion_seguimientos').select('*'),
      sb.from('gestion_tareas_admin').select('id, titulo, proceso, responsable_id, plazo, estado, created_at, resuelta_at'),
      sb.from('gestion_documentos').select('id', { count: 'exact', head: true }).eq('estado_revision', 'pendiente').is('anulado_at', null),
      sb.from('gestion_reclamos').select('id', { count: 'exact', head: true }).neq('estado', 'cerrado'),
    ])
    seguimientos = (sg.data ?? []).map((s: any) => ({
      id: s.id, obligacionCodigo: s.obligacion_codigo, titularTipo: s.titular_tipo, titularId: s.titular_id,
      titularNombre: s.titular_tipo === 'empresa' ? 'Mercosur Seguridad' : s.titular_id, responsableId: s.responsable_id, reemplazoId: s.reemplazo_id,
      venceEl: s.vence_el, documentoVigenteId: s.documento_vigente_id, tramite: s.tramite, tramiteIniciadoAt: s.tramite_iniciado_at,
      presentadoAt: s.presentado_at, faltantes: s.faltantes ?? [], validadoPor: s.validado_por, validadoAt: s.validado_at, ultimoMovimientoAt: s.ultimo_movimiento_at,
    }))
    tareas = (ta.data ?? []).map((t: any) => ({
      id: t.id, titulo: t.titulo, proceso: t.proceso, responsableId: t.responsable_id, plazo: t.plazo, estado: t.estado, creadaAt: t.created_at, resueltaAt: t.resuelta_at,
    }))
    documentosPendientesRevision = dp.count ?? 0
    reclamosAbiertos = rc.error ? null : rc.count ?? 0
  }

  let prefacturasPendientes: number | null = null
  const pf = await sb.from('fact_prefacturas').select('id', { count: 'exact', head: true }).not('estado', 'in', '("emitida","descartada")')
  if (pf.error) advertencias.push('Facturación: sin permiso para este usuario.')
  else prefacturasPendientes = pf.count ?? 0

  return {
    fuentes: {
      hoy, documentacionPersonal, credenciales, obligaciones, seguimientos, tareas, documentosPendientesRevision,
      prefacturasPendientes,
      // No hay hoy una fuente confiable de "diferencias de liquidación": se muestra no disponible.
      diferenciasLiquidacion: null,
      reclamosAbiertos,
    },
    migracion,
    nombresPersonal,
    advertencias,
  }
}
