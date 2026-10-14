/**
 * lib/credencial-pedido.ts
 *
 * Pedido de credencial al vigilador (migración 20261018120000). Cuando Gerencia
 * abre «Pedido de credencial», cada vigilador responde UNA vez al entrar a la app
 * (nunca durante un fichaje): sube la foto de su credencial (frente y dorso, con el
 * vencimiento), avisa que está en trámite o dice por qué no la tiene. La foto va a
 * Documentación; cuando Administración la aprueba, cuenta como «tiene credencial»
 * y se copia al servidor (ADMINISTRACION/POLICIA/CREDENCIALES).
 */

import { supabase } from '@/lib/supabase'
import type { TipoDocumento } from '@/lib/documentacion'

export type RespuestaCredencial = 'tiene' | 'en_tramite' | 'no_tiene'

export interface DeclaracionCredencial { respuesta: RespuestaCredencial; detalle: string | null; at: string; origen?: string }

export interface MiEstadoCredencial {
  pedir: boolean
  abierto?: boolean
  declaracion?: DeclaracionCredencial | null
  foto?: { estado: string; vence_el: string | null; at: string } | null
  puede_subir?: boolean
  /** Motivo, si Administración rechazó la última foto (se vuelve a pedir). */
  rechazo?: string | null
}

export interface FotoCredencial {
  documento_id: string
  estado: 'pendiente_revision' | 'aprobado' | 'aceptado'
  vence_el: string | null
  fecha_emision: string | null
  subido_at: string
  origen: string
  archivos: { id: string; cara: string | null; mime: string }[]
  servidor: { destino: string; estado: 'pendiente' | 'tomada' | 'hecha' | 'error' }[]
}

export interface CredencialDeEmpleado {
  foto: FotoCredencial | null
  pendiente_revision: string | null
  declaracion: DeclaracionCredencial | null
}

/** El tipo «credencial» tal como está en documentacion_tipos (frente y dorso, vencimiento declarado). */
export const TIPO_CREDENCIAL: TipoDocumento = {
  codigo: 'credencial', nombre: 'Credencial de vigilador', ayuda: 'Foto del frente y del dorso, con la fecha de vencimiento.', orden: 60,
  requisito: 'obligatorio', etapa: 'permanencia', caras: ['Frente', 'Dorso'], multiple: false, campo_fecha: 'opcional',
  etiqueta_fecha: 'Fecha de emisión', campo_vencimiento: 'declarado', vigencia_meses: null, etiqueta_detalle: null,
  sube_vigilador: true, sensibilidad: 'comun', constancia: 'conformidad',
  texto_constancia: 'Confirmo que este documento es mío y que sus datos son correctos.', referencia: null,
}

export const TEXTO_RESPUESTA: Record<RespuestaCredencial, string> = {
  tiene: 'Tiene credencial',
  en_tramite: 'Dice que está en trámite',
  no_tiene: 'Dice que no tiene credencial',
}

/** Línea corta para el tablero y el legajo: «Dice que está en trámite (13/10): presenté…». */
export function declaracionTexto(d: DeclaracionCredencial | null | undefined): string | null {
  if (!d) return null
  const f = d.at ? d.at.slice(0, 10).split('-').reverse().join('/') : ''
  return `${TEXTO_RESPUESTA[d.respuesta]}${f ? ` (${f})` : ''}${d.detalle ? `: ${d.detalle}` : ''}`
}

const POSPUESTO = 'mercosur.credencial.pospuesto'

/** «Ahora no la tengo encima»: se vuelve a pedir la próxima vez que entre a la app (no en esta sesión). */
export function pospuesto(): boolean {
  try { return sessionStorage.getItem(POSPUESTO) === '1' } catch { return false }
}
export function posponer(): void {
  try { sessionStorage.setItem(POSPUESTO, '1') } catch { /* sin almacenamiento: se vuelve a pedir */ }
}

const mensaje = (e: { code?: string; message?: string } | null, def: string) => !e ? null : (e.message || def)

export async function cargarMiEstado(): Promise<MiEstadoCredencial> {
  const { data, error } = await supabase.rpc('credencial_mi_estado')
  if (error || !data) return { pedir: false }
  return data as MiEstadoCredencial
}

export async function declarar(respuesta: RespuestaCredencial, detalle?: string): Promise<string | null> {
  const { error } = await supabase.rpc('credencial_declarar', { p_respuesta: respuesta, p_detalle: detalle?.trim() || null })
  return mensaje(error, 'No se pudo guardar la respuesta')
}

export async function cargarCredencialDeEmpleado(empleadoId: string): Promise<{ datos: CredencialDeEmpleado | null; denegado: boolean; error: string | null }> {
  const { data, error } = await supabase.rpc('credencial_de_empleado', { p_empleado_id: empleadoId })
  if (error) {
    const denegado = error.code === '42501'
    return { datos: null, denegado, error: denegado ? null : (error.message || 'No se pudo leer la credencial') }
  }
  return { datos: data as CredencialDeEmpleado, denegado: false, error: null }
}

/** Validación del formulario del vigilador (la base vuelve a validar). */
export function validarPedido(p: { frente: File | null; dorso: File | null; venceEl: string; hoy: string }): string | null {
  if (!p.frente || !p.dorso) return 'Sacá las dos fotos: frente y dorso.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.venceEl)) return 'Poné la fecha de vencimiento que figura en la credencial.'
  if (p.venceEl < '2000-01-01') return 'La fecha de vencimiento no es válida.'
  const [y, m, d] = p.hoy.split('-').map(Number)
  if (p.venceEl > `${y + 20}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`) return 'La fecha de vencimiento no es válida.'
  return null
}
