/**
 * lib/baja-laboral.ts
 *
 * Procedimiento de baja laboral (migración 20261110120000), lado cliente. Un solo
 * registro por desvinculación, el mismo desde Guardias, desde el Legajo o desde
 * Diferencias con ARCA. Borrador → Confirmar (bloquea acceso, genera la
 * liquidación final). Todo pasa por RPC/rutas con permisos en el servidor.
 */

import { supabase } from '@/lib/supabase'
import { comprimirImagen } from '@/lib/comprimir-imagen'
import { esPdf, pdfAImagenes } from '@/lib/pdf-imagen'
import { subirDocumento } from '@/lib/documentacion-datos'
import type { TipoDocumento } from '@/lib/documentacion'
import { resumenVacaciones, type ResumenVacaciones, type VacacionTomada } from '@/lib/baja-vacaciones'
import type { LecturaBaja } from '@/lib/baja-lectura'
import type { BajaFila } from '@/lib/liquidacion-final-datos'

export type { BajaFila }

export interface CausaCatalogo { codigo: string; nombre: string; orden: number; evaluar: string[]; presentismo: string; ayuda: string | null }
export interface DocumentoBaja {
  documento_id: string
  ia_estado: 'sin_leer' | 'leido' | 'ilegible' | 'error'
  ia_datos: LecturaBaja | { error?: string } | null
  documento: { id: string; tipo: string; estado: string; fecha_emision: string | null; detalle: string | null } | null
}

// 'baja_arca': constancia de baja de ARCA/AFIP (Simplificación Registral), para
// contratos eventuales o a plazo fijo que terminan sin telegrama.
export const TIPOS_DOCUMENTO_BAJA = ['telegrama_renuncia', 'telegrama_despido', 'baja_arca', 'cartas_documento', 'acuerdo_desvinculacion', 'documentacion_baja'] as const

const errorTexto = (e: { message?: string } | null | undefined) => (e ? (e.message || 'Error') : null)

async function encabezado(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const t = data.session?.access_token
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' }
}

async function postJson<T>(url: string, body: unknown): Promise<{ data: T | null; error: string | null }> {
  try {
    const r = await fetch(url, { method: 'POST', cache: 'no-store', headers: await encabezado(), body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({})) as T & { error?: string }
    if (!r.ok) return { data: null, error: j.error || `Error ${r.status}` }
    return { data: j, error: null }
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : 'Sin conexión' }
  }
}

export async function cargarCausas(): Promise<CausaCatalogo[]> {
  const { data } = await supabase.from('baja_causa').select('codigo, nombre, orden, evaluar, presentismo, ayuda').eq('activo', true).order('orden')
  return (data ?? []) as CausaCatalogo[]
}

export async function cargarTiposDocumentoBaja(): Promise<TipoDocumento[]> {
  const { data } = await supabase.from('documentacion_tipos').select('*').in('codigo', [...TIPOS_DOCUMENTO_BAJA]).eq('activo', true).order('orden')
  return (data ?? []) as TipoDocumento[]
}

/** Bajas de una persona (la más reciente primero). */
export async function bajasDeEmpleado(empleadoId: string): Promise<{ data: BajaFila[]; error: string | null }> {
  const { data, error } = await supabase.from('baja_laboral').select('*').eq('empleado_id', empleadoId).order('registrada_at', { ascending: false })
  return { data: (data ?? []) as BajaFila[], error: errorTexto(error) }
}

export async function leerBaja(id: string): Promise<BajaFila | null> {
  const { data } = await supabase.from('baja_laboral').select('*').eq('id', id).maybeSingle()
  return (data as BajaFila) ?? null
}

export async function guardarBorrador(bajaId: string | null, empleadoId: string, datos: {
  causa?: string | null; fecha_baja?: string | null; fecha_notificacion?: string | null; observaciones?: string | null; origen?: string
}): Promise<{ bajaId: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('baja_guardar_borrador', { p_baja_id: bajaId, p_empleado_id: empleadoId, p_datos: datos })
  return { bajaId: (data as { baja_id?: string } | null)?.baja_id ?? null, error: errorTexto(error) }
}

export async function documentosDeBaja(bajaId: string): Promise<DocumentoBaja[]> {
  const { data } = await supabase.from('baja_laboral_documento')
    .select('documento_id, ia_estado, ia_datos, documento:documentacion_documentos(id, tipo, estado, fecha_emision, detalle)')
    .eq('baja_id', bajaId).order('vinculado_at')
  return (data ?? []) as unknown as DocumentoBaja[]
}

/** Sube el documento al legajo (circuito de documentación existente) y lo vincula a la baja. */
export async function adjuntarDocumento(p: {
  bajaId: string; empleadoId: string; tipo: TipoDocumento; fecha: string | null; detalle: string | null; archivos: File[]; onProgreso?: (t: string) => void
}): Promise<{ documentoId: string | null; error: string | null }> {
  const r = await subirDocumento({ empleadoId: p.empleadoId, tipo: p.tipo, fechaEmision: p.fecha, venceEl: null, detalle: p.detalle, archivos: p.archivos, onProgreso: p.onProgreso })
  if (r.error || !r.documentoId) return { documentoId: null, error: r.error ?? 'No se pudo subir' }
  const { error } = await supabase.rpc('baja_vincular_documento', { p_baja_id: p.bajaId, p_documento_id: r.documentoId })
  return { documentoId: r.documentoId, error: errorTexto(error) }
}

const aBase64 = (f: Blob) => new Promise<string>((ok, mal) => {
  const lector = new FileReader()
  lector.onload = () => ok(String(lector.result).replace(/^data:[^,]+,/, ''))
  lector.onerror = () => mal(lector.error)
  lector.readAsDataURL(f)
})

/** La IA lee el documento (hasta 4 páginas). Sólo sugiere; no cambia la baja. */
export async function leerDocumentoConIA(bajaId: string, documentoId: string, archivo: File): Promise<{ lectura: LecturaBaja | null; error: string | null }> {
  let paginas: Blob[] = [archivo]
  if (esPdf(archivo)) {
    try { paginas = await pdfAImagenes(archivo, { maxPaginas: 4, ladoMax: 1800 }) } catch { return { lectura: null, error: 'No se pudo convertir el PDF para leerlo' } }
  } else {
    try { paginas = [await comprimirImagen(archivo, { maxWidth: 1800, quality: 0.85, timeoutMs: 15000 })] } catch { /* se manda la original */ }
  }
  const imagenes = await Promise.all(paginas.map(aBase64))
  const r = await postJson<{ lectura: LecturaBaja }>('/api/bajas/leer-documento', { baja_id: bajaId, documento_id: documentoId, imagenes })
  return { lectura: r.data?.lectura ?? null, error: r.error }
}

/** Vacaciones tomadas: novedades aprobadas de la app + registros manuales. */
export async function vacacionesTomadas(empleadoId: string): Promise<VacacionTomada[]> {
  const [{ data: nov }, { data: man }] = await Promise.all([
    supabase.from('novedades_laborales').select('id, fecha_desde, fecha_hasta, cantidad_dias, dias_informados')
      .eq('empleado_id', empleadoId).eq('tipo', 'vacaciones').eq('estado', 'aprobada'),
    supabase.from('legajo_vacaciones_tomadas').select('id, periodo, dias, desde, hasta, observacion').eq('empleado_id', empleadoId).is('anulado_at', null),
  ])
  const out: VacacionTomada[] = []
  for (const n of (nov ?? []) as any[]) {
    const dias = n.dias_informados != null ? Number(n.dias_informados) : Number(n.cantidad_dias ?? 0)
    out.push({ origen: 'novedad', id: n.id, dias, desde: n.fecha_desde, hasta: n.fecha_hasta, periodo: n.fecha_desde ? Number(String(n.fecha_desde).slice(0, 4)) : null })
  }
  for (const m of (man ?? []) as any[]) out.push({ origen: 'manual', id: m.id, dias: Number(m.dias), desde: m.desde, hasta: m.hasta, periodo: m.periodo, observacion: m.observacion })
  return out.sort((a, b) => String(a.desde ?? a.periodo).localeCompare(String(b.desde ?? b.periodo)))
}

export async function registrarVacaciones(empleadoId: string, v: { periodo: number; dias: number; desde: string | null; hasta: string | null; observacion: string }): Promise<string | null> {
  const { error } = await supabase.rpc('vacaciones_registrar_tomadas', {
    p_empleado_id: empleadoId, p_periodo: v.periodo, p_dias: v.dias, p_desde: v.desde, p_hasta: v.hasta, p_observacion: v.observacion, p_respaldo: null,
  })
  return errorTexto(error)
}

export async function anularVacaciones(id: string, motivo: string): Promise<string | null> {
  const { error } = await supabase.rpc('vacaciones_anular_tomadas', { p_id: id, p_motivo: motivo })
  return errorTexto(error)
}

export async function resumenVacacionesDeBaja(baja: Pick<BajaFila, 'empleado_id' | 'fecha_ingreso' | 'fecha_baja'>): Promise<ResumenVacaciones> {
  return resumenVacaciones({ ingreso: baja.fecha_ingreso, baja: baja.fecha_baja, tomadas: await vacacionesTomadas(baja.empleado_id) })
}

/** Turnos asignados después de una fecha (vista previa antes de confirmar). */
export async function turnosPosteriores(empleadoId: string, fecha: string) {
  const { data } = await supabase.from('turnos').select('id, fecha, hora_inicio, hora_fin, estado, objetivo:objetivos(nombre)')
    .eq('guardia_id', empleadoId).gt('fecha', fecha).not('estado', 'in', '(cancelado,reemplazado,anulado)').order('fecha')
  return ((data ?? []) as any[]).map(t => ({ turno_id: t.id, fecha: t.fecha, hora_inicio: t.hora_inicio, hora_fin: t.hora_fin, estado: t.estado, objetivo: t.objetivo?.nombre ?? null }))
}

export interface ResultadoConfirmar {
  baja_id: string; final_id: string; repetida: boolean
  turnos_futuros: { turno_id: string; fecha: string; objetivo: string | null; hora_inicio: string | null }[]
  acceso: { base: 'bloqueado'; auth: 'bloqueado' | 'sin_cuenta' | 'error'; error: string | null }
  avisos_enviados: number
}

export async function confirmarBaja(bajaId: string, vacaciones: Record<string, unknown> | null) {
  return postJson<ResultadoConfirmar>('/api/bajas/confirmar', { baja_id: bajaId, vacaciones })
}

export async function rectificarBaja(bajaId: string, datos: { fecha_baja?: string; causa?: string; fecha_notificacion?: string | null }, motivo: string): Promise<string | null> {
  const { error } = await supabase.rpc('baja_rectificar', { p_baja_id: bajaId, p_datos: datos, p_motivo: motivo })
  return errorTexto(error)
}

export async function anularBaja(bajaId: string, motivo: string): Promise<string | null> {
  const { error } = await supabase.rpc('baja_anular', { p_baja_id: bajaId, p_motivo: motivo })
  return errorTexto(error)
}

export async function reintentarBloqueoAuth(empleadoId: string) {
  return postJson<{ auth: string }>('/api/bajas/acceso', { empleado_id: empleadoId, accion: 'reintentar_bloqueo' })
}

export async function rehabilitarAcceso(empleadoId: string, motivo: string) {
  return postJson<{ ok: boolean }>('/api/bajas/acceso', { empleado_id: empleadoId, accion: 'rehabilitar', motivo })
}

export async function historialDeBaja(bajaId: string) {
  const { data } = await supabase.from('baja_laboral_historial').select('id, accion, datos, por, at').eq('baja_id', bajaId).order('id', { ascending: false })
  return (data ?? []) as { id: number; accion: string; datos: any; por: string | null; at: string }[]
}

/** Estado de la liquidación final de una baja (para el legajo). */
export async function estadoLiquidacionDeBaja(bajaId: string): Promise<{ id: string; estado: string } | null> {
  const { data } = await supabase.from('liquidacion_final').select('id, estado').eq('baja_id', bajaId).maybeSingle()
  return (data as { id: string; estado: string } | null) ?? null
}

/** Estado de acceso de una persona (columnas nuevas; si no existen, null). */
export async function accesoDeEmpleado(empleadoId: string): Promise<{ bloqueado: boolean; auth: boolean } | null> {
  const { data, error } = await supabase.from('usuarios').select('acceso_bloqueado, acceso_auth_bloqueado_at').eq('id', empleadoId).maybeSingle()
  if (error || !data) return null
  return { bloqueado: Boolean((data as any).acceso_bloqueado), auth: Boolean((data as any).acceso_auth_bloqueado_at) }
}
