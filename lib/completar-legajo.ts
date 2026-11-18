/**
 * lib/completar-legajo.ts — "Completá tu legajo" del vigilador.
 * La base decide qué falta (mi_legajo_pendiente), cuántas veces se puede
 * posponer (mi_legajo_posponer, máx. 3) y si puede validar (mi_legajo_validar).
 * Ver supabase/migrations/20261215100000_completar_legajo_vigilador.sql.
 */
import { supabase } from '@/lib/supabase'
import { comprimirImagen } from '@/lib/comprimir-imagen'
import type { TipoDocumento } from '@/lib/documentacion'
import type { LecturaDni } from '@/lib/dni-lectura'

export interface PendienteLegajo {
  pedir: boolean
  faltan?: string[]
  por_confirmar?: number
  dni?: boolean
  dni_rechazo?: string | null
  credencial?: boolean
  validado?: boolean
  pospuesto?: number
  puede_posponer?: boolean
}

/** El tipo «dni» tal como está en documentacion_tipos (frente y dorso). */
export const TIPO_DNI: TipoDocumento = {
  codigo: 'dni', nombre: 'DNI', ayuda: 'Foto del frente y del dorso.', orden: 10,
  requisito: 'obligatorio', etapa: 'ingreso', caras: ['Frente', 'Dorso'], multiple: false, campo_fecha: 'no',
  etiqueta_fecha: 'Fecha de emisión', campo_vencimiento: 'no', vigencia_meses: null, etiqueta_detalle: null,
  sube_vigilador: true, sensibilidad: 'comun', constancia: 'conformidad',
  texto_constancia: 'Confirmo que este documento es mío y que sus datos son correctos.', referencia: null,
}

const msj = (e: { message?: string } | null, d: string) => (e?.message ?? '').trim() || d

/** Si la consulta falla, no se pide nada: nunca traba el trabajo. */
export async function cargarPendiente(): Promise<PendienteLegajo> {
  const { data, error } = await supabase.rpc('mi_legajo_pendiente')
  if (error || !data) return { pedir: false }
  return data as PendienteLegajo
}

export async function posponerCompletar(): Promise<string | null> {
  const { error } = await supabase.rpc('mi_legajo_posponer')
  return error ? msj(error, 'No se pudo posponer') : null
}

export async function validarMisDatos(): Promise<{ pendiente: PendienteLegajo | null; error: string | null }> {
  const { data, error } = await supabase.rpc('mi_legajo_validar')
  return error ? { pendiente: null, error: msj(error, 'No se pudo confirmar') } : { pendiente: data as PendienteLegajo, error: null }
}

const aBase64 = (f: Blob) => new Promise<string>((ok, mal) => {
  const r = new FileReader()
  r.onload = () => ok(String(r.result).replace(/^data:[^,]+,/, ''))
  r.onerror = () => mal(r.error)
  r.readAsDataURL(f)
})

/** La IA lee el DNI. Si falla, devuelve null: la persona completa a mano. */
export async function leerDni(frente: File, dorso: File): Promise<LecturaDni | null> {
  try {
    const achicar = (f: File) => comprimirImagen(f, { ladoMayor: 1800, quality: 0.85, timeoutMs: 15_000 }).catch(() => f)
    const [a, b] = await Promise.all([achicar(frente), achicar(dorso)])
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return null
    const res = await fetch('/api/legajo/leer-dni', {
      method: 'POST', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ frente: await aBase64(a), dorso: await aBase64(b) }),
    })
    if (!res.ok) return null
    const { lectura } = await res.json() as { lectura?: LecturaDni }
    return lectura ?? null
  } catch {
    return null
  }
}
